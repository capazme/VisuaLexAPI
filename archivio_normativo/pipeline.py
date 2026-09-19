"""One act at a time: resolve → index → diff → fetch what changed → store.

The diff is what makes an update run cheap. `/fetch_act_fingerprints` gives a
hash per article from one download; an article whose hash equals the stored
one is "unchanged" without a request. Everything else — first run, `--full`,
no fingerprints, a moved hash, a unit missing from the store — is fetched
through `/stream_article_text` in batches. Nothing is written in
`--dry-run`; every write is committed per unit so a killed run loses
nothing and `--resume` continues it.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field, replace
from datetime import datetime
from pathlib import Path
from typing import Callable, Iterable, Protocol

from .hierarchy import IndexedArticle, walk_tree
from .manifest import ActSpec
from .sources.visualex import (
    ActResolution, ArticleResult, VisuaLexClient, VisuaLexError, select_fingerprints,
)
from .store import ActRecord, Store, UnitRecord

BROCARDI_TOOL = "visualex.show_brocardi_info"


def unit_id(act_id: str, kind: str, number: str) -> str:
    return f"{act_id}:{'art' if kind == 'article' else 'rec'}:{number}"


def today(now: Callable[[], datetime]) -> str:
    return now().date().isoformat()


def stamp(now: Callable[[], datetime]) -> str:
    return now().replace(microsecond=0).isoformat()


@dataclass
class RunOptions:
    out_dir: Path
    dry_run: bool = False
    full: bool = False
    resume_run_id: int | None = None
    enrich_override: tuple[str, ...] | None = None
    refresh_enrich: bool = False
    batch_size: int = 25
    enrich_ttl_days: int = 90


@dataclass
class ActReport:
    act_id: str
    label: str
    resolved: bool = True
    reason: str | None = None
    text_status: str = "consolidated"
    fingerprints_available: bool | None = None
    total: int = 0
    new: int = 0
    updated: int = 0
    unchanged: int = 0
    failed: int = 0
    skipped: int = 0
    recitals: int = 0
    planned_new: int = 0
    planned_changed: int = 0
    enrich_planned: int = 0
    enrich_ok: int = 0
    enrich_empty: int = 0
    enrich_error: int = 0
    enrich_kept: int = 0
    failures: list[tuple[str, str]] = field(default_factory=list)
    changed: bool = False

    def count(self, outcome: str) -> None:
        setattr(self, outcome, getattr(self, outcome) + 1)

    def fail(self, uid: str, reason: str) -> None:
        self.failed += 1
        self.failures.append((uid, reason))


@dataclass(frozen=True)
class UnitOutcome:
    unit_id: str
    number: str
    outcome: str  # new | updated | unchanged


class Enricher(Protocol):
    async def enrich_act(self, spec: ActSpec, res: ActResolution, units: list[UnitOutcome],
                         report: ActReport) -> None: ...


def _chunks(items: list, size: int) -> Iterable[list]:
    size = max(1, int(size))
    for start in range(0, len(items), size):
        yield items[start:start + size]


class Pipeline:
    def __init__(self, *, store: Store | None, visualex: VisuaLexClient, options: RunOptions,
                 run_id: int | None, log: logging.Logger, now: Callable[[], datetime],
                 enricher: Enricher | None = None):
        self.store = store
        self.visualex = visualex
        self.options = options
        self.run_id = run_id
        self.log = log
        self.now = now
        self.enricher = enricher
        if not options.dry_run and (store is None or run_id is None):
            raise ValueError("a store and a run id are required unless dry_run")

    # -- driver --------------------------------------------------------------

    async def run(self, specs: Iterable[ActSpec]) -> list[ActReport]:
        reports = []
        for spec in specs:
            try:
                reports.append(await self.process_act(spec))
            except Exception as exc:  # noqa: BLE001 — one act must not end the run
                self.log.exception("act=%s crashed: %s", spec.id, exc)
                reports.append(ActReport(spec.id, spec.label, resolved=False,
                                         reason=f"unexpected error: {exc}", text_status=spec.text_status()))
        return reports

    # -- one act -------------------------------------------------------------

    def _kinds(self, spec: ActSpec) -> tuple[str, ...]:
        return self.options.enrich_override if self.options.enrich_override is not None else spec.enrich

    async def process_act(self, spec: ActSpec) -> ActReport:
        report = ActReport(spec.id, spec.label, text_status=spec.text_status())
        self.log.info("ACT %s (%s) start", spec.id, spec.label)
        try:
            res = await self.visualex.resolve_act(spec)
        except VisuaLexError as exc:
            report.resolved = False
            report.reason = str(exc)
            self.log.error("ACT %s unresolved: %s", spec.id, exc)
            return report

        tree = await self.visualex.fetch_tree(res.act_url)
        # The tree lists every annex; the act is one of them. Positions are
        # re-counted within the annex so the archive's order starts at 0.
        indexed = [replace(a, position=i)
                   for i, a in enumerate(a for a in walk_tree(tree.items) if a.annex == res.annex)]
        if not indexed and tree.count:
            report.resolved = False
            report.reason = (f"no article in annex {res.annex!r}; the tree has "
                             f"{[x.get('number') for x in tree.annexes]}")
            self.log.error("ACT %s: %s", spec.id, report.reason)
            return report
        rubriche = await self.visualex.fetch_rubriche(res.act_url)

        fingerprints: dict[str, dict] = {}
        if not spec.is_eu():
            fp = await self.visualex.fetch_fingerprints(res.act_url)
            report.fingerprints_available = fp.available
            fingerprints = select_fingerprints(fp, [a.number for a in indexed])
            if fp.available and not fingerprints:
                self.log.warning("ACT %s: fingerprints answer overlaps no article of annex %r; full fetch",
                                 spec.id, res.annex)
        report.total = len(indexed)

        kinds = self._kinds(spec)
        brocardi = "brocardi" in kinds and not spec.is_eu()
        to_fetch, unchanged, brocardi_only = self._plan(spec, indexed, fingerprints, kinds, report)

        if self.options.dry_run:
            report.enrich_planned = len(brocardi_only) + (len(to_fetch) if brocardi else 0)
            if self.enricher is not None:
                report.enrich_planned += self.enricher.plan_act(spec, [a.number for a in indexed])
            self.log.info("DRY-RUN act=%s new=%d changed=%d unchanged=%d enrichment_calls=%d",
                          spec.id, report.planned_new, report.planned_changed, report.unchanged,
                          report.enrich_planned)
            return report

        assert self.store is not None and self.run_id is not None
        # The act row first: units reference it (FOREIGN KEY), and a run killed
        # mid-act must still leave a coherent archive.
        self._upsert_act(spec, res)
        outcomes: list[UnitOutcome] = []
        for a in unchanged:
            uid = unit_id(spec.id, "article", a.number)
            self.store.touch_checked(uid, self.run_id, today(self.now))
            self.store.log_unit(self.run_id, uid, "unchanged", "fingerprint")
            report.count("unchanged")
            outcomes.append(UnitOutcome(uid, a.number, "unchanged"))
            self.log.info("UNCHANGED act=%s art=%s (fingerprint)", spec.id, a.number)

        outcomes += await self._fetch(spec, res, to_fetch, rubriche, fingerprints, brocardi, report)
        if brocardi_only:
            await self._fetch(spec, res, brocardi_only, rubriche, fingerprints, True, report,
                              brocardi_pass=True)

        if spec.wants_recitals():
            await self._recitals(spec, report)

        self._upsert_act(spec, res)  # again, with the final unit count

        if self.enricher is not None:
            await self.enricher.enrich_act(spec, res, outcomes, report)

        report.changed = self.store.act_changed_in_run(spec.id, self.run_id)
        self.log.info("ACT %s done: new=%d updated=%d unchanged=%d failed=%d skipped=%d",
                      spec.id, report.new, report.updated, report.unchanged, report.failed, report.skipped)
        return report

    @staticmethod
    def _act_identifier(spec: ActSpec, res: ActResolution) -> str:
        return spec.celex if (spec.is_eu() and spec.celex) else res.act_url

    def _upsert_act(self, spec: ActSpec, res: ActResolution) -> None:
        assert self.store is not None
        self.store.upsert_act(ActRecord(
            id=spec.id, area=spec.area, label=spec.label, source=spec.source,
            identifier=self._act_identifier(spec, res), act_type=spec.act_type,
            date=spec.date or res.data, act_number=spec.act_number or res.numero_atto,
            annex=res.annex, source_url=res.act_url, text_status=spec.text_status(),
            consolidated_celex=spec.celex_consolidated,
        ), unit_count=len(self.store.units_for_act(spec.id)), updated_at=stamp(self.now))

    def _plan(self, spec: ActSpec, indexed: list[IndexedArticle], fingerprints: dict[str, dict],
              kinds: tuple[str, ...], report: ActReport):
        """Split the index into (to_fetch, unchanged, brocardi_only)."""
        stored_fp = self.store.fingerprints_for_act(spec.id) if self.store else {}
        known_ids = self.store.unit_ids_for_act(spec.id) if self.store else set()
        skip = set()
        if self.store and self.options.resume_run_id is not None and self.run_id == self.options.resume_run_id:
            skip = self.store.logged_unit_ids(self.run_id)
        to_fetch: list[IndexedArticle] = []
        unchanged: list[IndexedArticle] = []
        brocardi_only: list[IndexedArticle] = []
        want_brocardi = "brocardi" in kinds and not spec.is_eu()
        for a in indexed:
            uid = unit_id(spec.id, "article", a.number)
            if uid in skip:
                report.count("skipped")
                continue
            known = uid in known_ids
            same = (fingerprints.get(a.number) is not None and known
                    and stored_fp.get(a.number) == fingerprints[a.number]["fingerprint"])
            if self.options.full or not same:
                to_fetch.append(a)
                if known:
                    report.planned_changed += 1
                else:
                    report.planned_new += 1
                continue
            if want_brocardi and self._brocardi_due(spec, uid):
                brocardi_only.append(a)
            unchanged.append(a)
        if self.options.dry_run:
            report.unchanged = len(unchanged)
        return to_fetch, unchanged, brocardi_only

    def _brocardi_due(self, spec: ActSpec, uid: str) -> bool:
        if self.options.refresh_enrich:
            return True
        existing = self.store.get_enrichment(spec.id, uid, "brocardi") if self.store else None
        if existing is None:
            return True
        return self._older_than_ttl(existing["fetched_at"])

    def _older_than_ttl(self, fetched_at: str) -> bool:
        try:
            age = self.now() - datetime.fromisoformat(fetched_at)
        except ValueError:
            return True
        return age.days >= self.options.enrich_ttl_days

    async def _fetch(self, spec: ActSpec, res: ActResolution, targets: list[IndexedArticle],
                     rubriche, fingerprints: dict[str, dict], brocardi: bool, report: ActReport,
                     brocardi_pass: bool = False) -> list[UnitOutcome]:
        assert self.store is not None and self.run_id is not None
        outcomes: list[UnitOutcome] = []
        by_number_index = {a.number: a for a in targets}
        for batch in _chunks(targets, self.options.batch_size):
            numbers = [a.number for a in batch]
            try:
                results = await self.visualex.stream_articles(spec, numbers, res.annex, brocardi)
            except VisuaLexError as exc:
                for a in batch:
                    self._fail(spec, a.number, str(exc), report)
                continue
            answered = {r.number: r for r in results}
            for a in batch:
                r = answered.get(a.number)
                if r is None:
                    self._fail(spec, a.number, "not returned by VisuaLex (not in the act?)", report)
                    continue
                if r.error or r.text is None:
                    self._fail(spec, a.number, r.error or "empty text", report)
                    continue
                uid = unit_id(spec.id, "article", a.number)
                record = self._record(spec, res, by_number_index[a.number], r, rubriche, fingerprints)
                outcome = self.store.upsert_unit(record, self.run_id)
                if brocardi_pass:
                    # The text came along, but this pass was for the annotations:
                    # the unit was already counted as unchanged.
                    self.store.log_unit(self.run_id, uid, "unchanged", "brocardi refresh")
                else:
                    self.store.log_unit(self.run_id, uid, outcome)
                    report.count(outcome)
                    outcomes.append(UnitOutcome(uid, a.number, outcome))
                    self.log.info("%s act=%s art=%s hash=%s", outcome.upper(), spec.id, a.number,
                                  record.text_hash[:12])
                if brocardi:
                    self._store_brocardi(spec, uid, r, report)
        return outcomes

    def _fail(self, spec: ActSpec, number: str, reason: str, report: ActReport) -> None:
        uid = unit_id(spec.id, "article", number)
        report.fail(uid, reason)
        if self.store is not None and self.run_id is not None:
            self.store.log_unit(self.run_id, uid, "failed", reason)
        self.log.error("FAILED act=%s art=%s reason=%s", spec.id, number, reason)

    def _record(self, spec: ActSpec, res: ActResolution, a: IndexedArticle, r: ArticleResult,
                rubriche, fingerprints: dict[str, dict]) -> UnitRecord:
        fp = fingerprints.get(a.number) or {}
        if spec.is_eu() and spec.celex:
            identifier = f"{spec.celex}#art_{a.number}"
        else:
            identifier = r.urn or f"{res.act_url}~art{a.number}"
        return UnitRecord(
            id=unit_id(spec.id, "article", a.number), act_id=spec.id, kind="article", number=a.number,
            position=a.position, identifier=identifier, rubrica=rubriche.rubriche.get(a.number),
            parte=a.parte, libro=a.libro, titolo=a.titolo, capo=a.capo, sezione=a.sezione,
            text=r.text, fingerprint=fp.get("fingerprint"), abrogato=a.number in rubriche.abrogati,
            version=spec.version, vigenza_al=today(self.now), ultimo_aggiornamento=fp.get("date"),
            source_url=r.url or r.urn, fetched_at=stamp(self.now),
        )

    def _store_brocardi(self, spec: ActSpec, uid: str, r: ArticleResult, report: ActReport) -> None:
        assert self.store is not None and self.run_id is not None
        if r.brocardi:
            self.store.upsert_enrichment(spec.id, uid, "brocardi", BROCARDI_TOOL, {}, None, r.brocardi,
                                         "ok", None, stamp(self.now), self.run_id)
            report.enrich_ok += 1
        elif r.brocardi_error:
            self.store.upsert_enrichment(spec.id, uid, "brocardi", BROCARDI_TOOL, {}, None, None,
                                         "error", r.brocardi_error, stamp(self.now), self.run_id)
            report.enrich_error += 1
            self.log.warning("ENRICH brocardi act=%s unit=%s error=%s", spec.id, uid, r.brocardi_error)

    async def _recitals(self, spec: ActSpec, report: ActReport) -> None:
        assert self.store is not None and self.run_id is not None
        try:
            recitals = await self.visualex.fetch_recitals(spec)
        except VisuaLexError as exc:
            self.log.error("FAILED act=%s recitals reason=%s", spec.id, exc)
            report.fail(unit_id(spec.id, "recital", "*"), f"recitals: {exc}")
            return
        for position, rec in enumerate(recitals):
            uid = unit_id(spec.id, "recital", rec.number)
            record = UnitRecord(
                id=uid, act_id=spec.id, kind="recital", number=rec.number, position=position,
                identifier=f"{spec.celex}#rct_{rec.number}" if spec.celex else None, rubrica=None,
                parte=None, libro=None, titolo=None, capo=None, sezione=None, text=rec.text,
                fingerprint=None, abrogato=False, version=spec.version, vigenza_al=today(self.now),
                ultimo_aggiornamento=None, source_url=None, fetched_at=stamp(self.now),
            )
            outcome = self.store.upsert_unit(record, self.run_id)
            self.store.log_unit(self.run_id, uid, outcome)
            report.recitals += 1
            self.log.info("%s act=%s rec=%s", outcome.upper(), spec.id, rec.number)
