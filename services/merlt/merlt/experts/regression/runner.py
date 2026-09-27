"""
Regression Test Runner.

Executes gold standard queries against the pipeline and compares responses.
"""

import asyncio
import random
import time
import uuid
import structlog
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional, Protocol

from .comparator import CombinedComparator, ComparatorConfig
from .models import (
    GoldStandardQuery,
    QueryResult,
    QueryStatus,
    RegressionReport,
    RegressionResult,
)
from .suite import GoldStandardSuite

log = structlog.get_logger()


class PipelineProtocol(Protocol):
    """Protocol for the pipeline to test."""

    async def process(self, query: str) -> Dict[str, Any]:
        """
        Process a query and return response.

        Expected return format:
            {
                "response": str,  # The main response text
                "metadata": {
                    "contributing_experts": List[str],
                    "citations": List[str],
                    "confidence": float,
                    ...
                }
            }
        """
        ...


@dataclass
class RunnerConfig:
    """
    Configuration for the regression runner.

    Attributes:
        parallel_queries: Max queries to run in parallel
        timeout_seconds: Timeout for each query
        pass_threshold: Score threshold for passing
        degradation_threshold: Score drop threshold for degradation alert
        retry_on_error: Number of retries on pipeline error
        save_responses: Whether to save actual responses
    """

    parallel_queries: int = 5
    timeout_seconds: float = 60.0
    pass_threshold: float = 0.7
    degradation_threshold: float = 0.1
    retry_on_error: int = 2
    save_responses: bool = True


class RegressionRunner:
    """
    Runs regression tests against the pipeline.

    Example:
        >>> suite = GoldStandardSuite.load("gold_standard.json")
        >>> runner = RegressionRunner(suite, pipeline=my_pipeline)
        >>> report = await runner.run()
        >>> print(report.summary())
    """

    def __init__(
        self,
        suite: GoldStandardSuite,
        pipeline: PipelineProtocol,
        comparator: Optional[CombinedComparator] = None,
        config: Optional[RunnerConfig] = None,
        on_query_complete: Optional[Callable[[QueryResult], None]] = None,
    ):
        """
        Initialize runner.

        Args:
            suite: Gold standard test suite
            pipeline: Pipeline to test
            comparator: Response comparator
            config: Runner configuration
            on_query_complete: Callback called after each query completes
        """
        self.suite = suite
        self.pipeline = pipeline
        self.comparator = comparator or CombinedComparator()
        self.config = config or RunnerConfig()
        self.on_query_complete = on_query_complete

        # Use threshold from config
        if self.comparator.config.pass_threshold != self.config.pass_threshold:
            self.comparator.config = ComparatorConfig(
                semantic_weight=self.comparator.config.semantic_weight,
                structural_weight=self.comparator.config.structural_weight,
                pass_threshold=self.config.pass_threshold,
            )

    async def run(
        self,
        query_ids: Optional[List[str]] = None,
        tags: Optional[List[str]] = None,
        version: Optional[str] = None,
    ) -> RegressionReport:
        """
        Run regression tests.

        Args:
            query_ids: Specific query IDs to run (None = all)
            tags: Filter by topic tags (None = all)
            version: Current version identifier

        Returns:
            Complete regression report
        """
        run_id = str(uuid.uuid4())[:8]
        started_at = datetime.now()

        log.info(
            "regression_run_started",
            run_id=run_id,
            suite=self.suite.config.name,
            total_queries=self.suite.query_count,
        )

        # Get queries to run
        queries = self._get_queries(query_ids, tags)

        if not queries:
            log.warning("regression_no_queries", run_id=run_id)
            return RegressionReport(
                run_id=run_id,
                suite_name=self.suite.config.name,
                result=RegressionResult(),
                current_version=version,
                started_at=started_at,
                completed_at=datetime.now(),
            )

        # Run queries with parallelism
        results = await self._run_queries(queries)

        # Aggregate results
        result = self._aggregate_results(results)

        completed_at = datetime.now()

        report = RegressionReport(
            run_id=run_id,
            suite_name=self.suite.config.name,
            result=result,
            baseline_version=self.suite.config.version,
            current_version=version,
            started_at=started_at,
            completed_at=completed_at,
            metadata={
                "config": {
                    "parallel_queries": self.config.parallel_queries,
                    "timeout_seconds": self.config.timeout_seconds,
                    "pass_threshold": self.config.pass_threshold,
                },
                "filter": {
                    "query_ids": query_ids,
                    "tags": tags,
                },
            },
        )

        log.info(
            "regression_run_completed",
            run_id=run_id,
            pass_rate=result.pass_rate,
            passed=result.passed,
            failed=result.failed,
            degraded=result.degraded,
            duration_seconds=report.duration_seconds,
        )

        return report

    def _get_queries(
        self,
        query_ids: Optional[List[str]],
        tags: Optional[List[str]],
    ) -> List[GoldStandardQuery]:
        """Get queries based on filters."""
        queries = self.suite.queries

        # Filter by IDs
        if query_ids:
            id_set = set(query_ids)
            queries = [q for q in queries if q.query_id in id_set]

        # Filter by tags
        if tags:
            tag_set = set(tags)
            queries = [q for q in queries if tag_set & set(q.topic_tags)]

        return queries

    async def _run_queries(
        self,
        queries: List[GoldStandardQuery],
    ) -> List[QueryResult]:
        """Run queries with parallelism control."""
        semaphore = asyncio.Semaphore(self.config.parallel_queries)

        async def run_with_semaphore(query: GoldStandardQuery) -> QueryResult:
            async with semaphore:
                return await self._run_single_query(query)

        # Create tasks
        tasks = [run_with_semaphore(q) for q in queries]

        # Run with gather
        gathered_results = await asyncio.gather(*tasks, return_exceptions=True)

        # Handle exceptions
        final_results = []
        for i, result in enumerate(gathered_results):
            if isinstance(result, Exception):
                final_results.append(
                    QueryResult(
                        query_id=queries[i].query_id,
                        status=QueryStatus.ERROR,
                        error_message=str(result),
                    )
                )
            else:
                final_results.append(result)

        return final_results

    async def _run_single_query(
        self,
        query: GoldStandardQuery,
    ) -> QueryResult:
        """Run a single query against the pipeline."""
        start_time = time.perf_counter()

        for attempt in range(self.config.retry_on_error + 1):
            try:
                # Call pipeline with timeout
                pipeline_response = await asyncio.wait_for(
                    self.pipeline.process(query.query_text),
                    timeout=self.config.timeout_seconds,
                )

                latency_ms = (time.perf_counter() - start_time) * 1000

                # Extract response and metadata
                actual_response = pipeline_response.get("response", "")
                actual_metadata = pipeline_response.get("metadata", {})

                # Compare responses
                similarity = await self.comparator.compare(
                    query.expected,
                    actual_response,
                    actual_metadata,
                )

                # Determine status
                baseline_score = self.suite.get_baseline_score(query.query_id)
                status, score_change = self._determine_status(
                    similarity.overall_score,
                    baseline_score,
                )

                result = QueryResult(
                    query_id=query.query_id,
                    status=status,
                    actual_response=actual_response if self.config.save_responses else None,
                    similarity=similarity,
                    previous_score=baseline_score,
                    score_change=score_change,
                    latency_ms=latency_ms,
                )

                # Invoke callback
                if self.on_query_complete:
                    self.on_query_complete(result)

                log.debug(
                    "regression_query_completed",
                    query_id=query.query_id,
                    status=status.value,
                    score=similarity.overall_score,
                    latency_ms=latency_ms,
                )

                return result

            except asyncio.TimeoutError:
                if attempt < self.config.retry_on_error:
                    delay = self._retry_delay(attempt)
                    log.warning(
                        "regression_query_timeout_retry",
                        query_id=query.query_id,
                        attempt=attempt + 1,
                        delay_seconds=delay,
                    )
                    await asyncio.sleep(delay)
                    continue

                return QueryResult(
                    query_id=query.query_id,
                    status=QueryStatus.ERROR,
                    error_message=f"Timeout after {self.config.timeout_seconds}s",
                    latency_ms=(time.perf_counter() - start_time) * 1000,
                )

            except Exception as e:
                if attempt < self.config.retry_on_error:
                    delay = self._retry_delay(attempt)
                    log.warning(
                        "regression_query_error_retry",
                        query_id=query.query_id,
                        error=str(e),
                        attempt=attempt + 1,
                        delay_seconds=delay,
                    )
                    await asyncio.sleep(delay)
                    continue

                log.error(
                    "regression_query_failed",
                    query_id=query.query_id,
                    error=str(e),
                )

                return QueryResult(
                    query_id=query.query_id,
                    status=QueryStatus.ERROR,
                    error_message=str(e),
                    latency_ms=(time.perf_counter() - start_time) * 1000,
                )

        # Should not reach here, but return error just in case
        return QueryResult(
            query_id=query.query_id,
            status=QueryStatus.ERROR,
            error_message="Unknown error",
        )

    def _determine_status(
        self,
        current_score: float,
        baseline_score: Optional[float],
    ) -> tuple[QueryStatus, float]:
        """Determine query status based on score and baseline."""
        score_change = 0.0

        if baseline_score is not None:
            score_change = current_score - baseline_score

            # Check for degradation
            if score_change < -self.config.degradation_threshold:
                return QueryStatus.DEGRADED, score_change

            # Check for improvement
            if score_change > self.config.degradation_threshold:
                return QueryStatus.IMPROVED, score_change

        # Check pass/fail
        if current_score >= self.config.pass_threshold:
            return QueryStatus.PASSED, score_change
        else:
            return QueryStatus.FAILED, score_change

    def _retry_delay(self, attempt: int, base_delay: float = 1.0, max_delay: float = 30.0) -> float:
        """Calculate exponential backoff delay with jitter."""
        delay = min(base_delay * (2 ** attempt), max_delay)
        jitter = delay * (0.5 + random.random() * 0.5)
        return jitter

    def _aggregate_results(
        self,
        results: List[QueryResult],
    ) -> RegressionResult:
        """Aggregate individual results into overall result."""
        total = len(results)
        passed = sum(1 for r in results if r.status == QueryStatus.PASSED)
        failed = sum(1 for r in results if r.status == QueryStatus.FAILED)
        degraded = sum(1 for r in results if r.status == QueryStatus.DEGRADED)
        improved = sum(1 for r in results if r.status == QueryStatus.IMPROVED)
        errors = sum(1 for r in results if r.status == QueryStatus.ERROR)

        return RegressionResult(
            total_queries=total,
            passed=passed,
            failed=failed,
            degraded=degraded,
            improved=improved,
            errors=errors,
            results=results,
        )

    async def run_single(self, query_id: str) -> Optional[QueryResult]:
        """
        Run a single query by ID.

        Args:
            query_id: Query ID to run

        Returns:
            Query result or None if not found
        """
        query = self.suite.get_query(query_id)
        if not query:
            return None

        return await self._run_single_query(query)

    async def update_baselines(self, results: Optional[RegressionResult] = None):
        """
        Update baseline scores from successful results.

        Args:
            results: Results to use for baseline (runs full suite if None)
        """
        if results is None:
            report = await self.run()
            results = report.result

        for query_result in results.results:
            if query_result.status in (QueryStatus.PASSED, QueryStatus.IMPROVED):
                if query_result.similarity:
                    self.suite.set_baseline_score(
                        query_result.query_id,
                        query_result.similarity.overall_score,
                    )

        log.info(
            "regression_baselines_updated",
            count=len([r for r in results.results if r.status in (QueryStatus.PASSED, QueryStatus.IMPROVED)]),
        )
