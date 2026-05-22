"""
Ingestion Scheduler
====================

Service per scheduling automatico di ingestion norme.

Usa APScheduler per eseguire job periodici basati su cron expression.
I schedule sono persistiti in PostgreSQL (tabella ingestion_schedules).

Esempio:
    >>> from merlt.services.ingestion_scheduler import IngestionScheduler
    >>>
    >>> scheduler = IngestionScheduler()
    >>> await scheduler.start()
    >>> await scheduler.add_schedule("codice_civile", "0 3 * * *")
"""

import structlog
from datetime import datetime, UTC
from typing import Any, Dict, List, Optional

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from merlt.experts.models import IngestionSchedule
from merlt.rlcf.database import get_async_session

log = structlog.get_logger()


class IngestionScheduler:
    """
    Scheduler per ingestion automatica norme.

    Gestisce schedule CRUD e integra con APScheduler per esecuzione.
    """

    def __init__(self):
        self._scheduler = None
        self._running = False

    async def start(self):
        """Avvia APScheduler e carica schedule dal DB."""
        try:
            from apscheduler.schedulers.asyncio import AsyncIOScheduler
            self._scheduler = AsyncIOScheduler()
            self._scheduler.start()
            self._running = True

            # Load existing schedules
            async with get_async_session() as session:
                schedules = await self.list_schedules(session)
                for sched in schedules:
                    if sched["enabled"]:
                        self._add_job(sched["id"], sched["tipo_atto"], sched["cron_expr"])

            log.info("IngestionScheduler started", job_count=len(schedules) if schedules else 0)
        except ImportError:
            log.warning("APScheduler not installed, ingestion scheduling disabled")
        except Exception as e:
            log.error("Failed to start IngestionScheduler", error=str(e))

    async def stop(self):
        """Ferma lo scheduler."""
        if self._scheduler and self._running:
            self._scheduler.shutdown(wait=False)
            self._running = False
            log.info("IngestionScheduler stopped")

    def _add_job(self, schedule_id: int, tipo_atto: str, cron_expr: str):
        """Aggiunge un job APScheduler."""
        if not self._scheduler:
            return

        from apscheduler.triggers.cron import CronTrigger

        try:
            trigger = CronTrigger.from_crontab(cron_expr)
            job_id = f"ingestion_{schedule_id}"

            # Remove existing job if any
            existing = self._scheduler.get_job(job_id)
            if existing:
                self._scheduler.remove_job(job_id)

            self._scheduler.add_job(
                self._run_ingestion,
                trigger=trigger,
                id=job_id,
                args=[schedule_id, tipo_atto],
                replace_existing=True,
            )
            log.info("Ingestion job added", schedule_id=schedule_id, tipo_atto=tipo_atto, cron=cron_expr)
        except Exception as e:
            log.error("Failed to add ingestion job", schedule_id=schedule_id, error=str(e))

    def _remove_job(self, schedule_id: int):
        """Rimuove un job APScheduler."""
        if not self._scheduler:
            return

        job_id = f"ingestion_{schedule_id}"
        try:
            self._scheduler.remove_job(job_id)
        except Exception as e:
            log.debug("job_removal_skipped", job_id=job_id, error=str(e))

    async def _run_ingestion(self, schedule_id: int, tipo_atto: str):
        """Esegue ingestion per uno schedule."""
        log.info("Ingestion job triggered", schedule_id=schedule_id, tipo_atto=tipo_atto)

        async with get_async_session() as session:
            # Mark as running
            await session.execute(
                update(IngestionSchedule)
                .where(IngestionSchedule.id == schedule_id)
                .values(last_run_at=datetime.now(UTC).replace(tzinfo=None), last_run_status="running")
            )
            await session.commit()

        status = "success"
        try:
            from merlt.pipeline.external_ingestion import ExternalIngestionPipeline
            pipeline = ExternalIngestionPipeline()
            await pipeline.ingest_tipo_atto(tipo_atto)
        except Exception as e:
            status = "failed"
            log.error("Ingestion job failed", schedule_id=schedule_id, error=str(e))

        async with get_async_session() as session:
            await session.execute(
                update(IngestionSchedule)
                .where(IngestionSchedule.id == schedule_id)
                .values(last_run_status=status)
            )
            await session.commit()

    # -------------------------------------------------------------------------
    # CRUD
    # -------------------------------------------------------------------------

    async def add_schedule(
        self,
        session: AsyncSession,
        tipo_atto: str,
        cron_expr: str,
        enabled: bool = True,
        description: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Crea un nuovo schedule."""
        schedule = IngestionSchedule(
            tipo_atto=tipo_atto,
            cron_expr=cron_expr,
            enabled=enabled,
            description=description,
        )
        session.add(schedule)
        await session.commit()
        await session.refresh(schedule)

        if enabled:
            self._add_job(schedule.id, tipo_atto, cron_expr)

        log.info("Schedule created", schedule_id=schedule.id, tipo_atto=tipo_atto)
        return self._to_dict(schedule)

    async def update_schedule(
        self,
        session: AsyncSession,
        schedule_id: int,
        **kwargs: Any,
    ) -> Optional[Dict[str, Any]]:
        """Aggiorna uno schedule esistente."""
        result = await session.execute(
            select(IngestionSchedule).where(IngestionSchedule.id == schedule_id)
        )
        schedule = result.scalar_one_or_none()
        if not schedule:
            return None

        for key, value in kwargs.items():
            if hasattr(schedule, key) and value is not None:
                setattr(schedule, key, value)

        await session.commit()
        await session.refresh(schedule)

        # Update APScheduler job
        self._remove_job(schedule_id)
        if schedule.enabled:
            self._add_job(schedule.id, schedule.tipo_atto, schedule.cron_expr)

        return self._to_dict(schedule)

    async def remove_schedule(self, session: AsyncSession, schedule_id: int) -> bool:
        """Rimuove uno schedule."""
        result = await session.execute(
            select(IngestionSchedule).where(IngestionSchedule.id == schedule_id)
        )
        schedule = result.scalar_one_or_none()
        if not schedule:
            return False

        self._remove_job(schedule_id)
        await session.delete(schedule)
        await session.commit()
        log.info("Schedule removed", schedule_id=schedule_id)
        return True

    async def toggle_schedule(self, session: AsyncSession, schedule_id: int) -> Optional[Dict[str, Any]]:
        """Pausa/riprendi uno schedule."""
        result = await session.execute(
            select(IngestionSchedule).where(IngestionSchedule.id == schedule_id)
        )
        schedule = result.scalar_one_or_none()
        if not schedule:
            return None

        schedule.enabled = not schedule.enabled
        await session.commit()
        await session.refresh(schedule)

        if schedule.enabled:
            self._add_job(schedule.id, schedule.tipo_atto, schedule.cron_expr)
        else:
            self._remove_job(schedule_id)

        return self._to_dict(schedule)

    async def list_schedules(self, session: AsyncSession) -> List[Dict[str, Any]]:
        """Lista tutti gli schedule."""
        result = await session.execute(
            select(IngestionSchedule).order_by(IngestionSchedule.id)
        )
        return [self._to_dict(s) for s in result.scalars().all()]

    @staticmethod
    def _to_dict(schedule: IngestionSchedule) -> Dict[str, Any]:
        return {
            "id": schedule.id,
            "tipo_atto": schedule.tipo_atto,
            "cron_expr": schedule.cron_expr,
            "enabled": schedule.enabled,
            "description": schedule.description,
            "last_run_at": schedule.last_run_at.isoformat() if schedule.last_run_at else None,
            "last_run_status": schedule.last_run_status,
            "next_run_at": schedule.next_run_at.isoformat() if schedule.next_run_at else None,
            "created_at": schedule.created_at.isoformat() if schedule.created_at else None,
        }
