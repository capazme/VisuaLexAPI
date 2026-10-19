"""F8 - contribution journey: upload -> extract -> candidates -> promote.

The uploaded note gets a run-id trailer so every run produces unique content
(MERL-T dedupes uploads by content hash; a byte-identical re-upload would
return the previous document and stale candidates). The promotion-gate
negatives are checked in the server's evaluation order (missing_fonte ->
not_attested -> not_reformulated); NB an EMPTY fonte fails Zod (min 1) with
400 before reaching the gate, so the missing_fonte probe sends a whitespace
fonte instead. Extraction failures that smell like a missing LLM key degrade
to FlowSkipped, not FAIL.
"""
from __future__ import annotations

from pathlib import Path

from e2e.context import Context
from e2e.report import Report, StepFailure, FlowSkipped

TAGS: frozenset[str] = frozenset(
    {"needs_merlt", "needs_full_consent", "needs_worker", "needs_llm", "slow"}
)

SAMPLE_NOTE = Path(__file__).resolve().parents[1] / "data" / "sample_note.txt"

# Used only if data/sample_note.txt is missing so the flow stays standalone.
FALLBACK_NOTE = """Appunti di studio - risoluzione del contratto (art. 1453 c.c.)

Nei contratti a prestazioni corrispettive, quando uno dei contraenti non
adempie le sue obbligazioni, l'altro puo' a sua scelta chiedere l'adempimento
o la risoluzione del contratto, salvo in ogni caso il risarcimento del danno.

Concetti chiave:
- Sinallagma: il nesso di corrispettivita' tra le prestazioni.
- Inadempimento di non scarsa importanza (art. 1455 c.c.) come presupposto.
- La diffida ad adempiere (art. 1454 c.c.) come via stragiudiziale.
- La clausola risolutiva espressa (art. 1456 c.c.) opera di diritto.
"""

# Substrings that mark an extraction failure as "LLM unavailable" rather than
# a harness/stack bug (missing OPENROUTER_API_KEY, auth, quota).
LLM_ERROR_MARKERS = ("api key", "api_key", "openrouter", "llm", "unauthorized", "401", "quota", "credit")


async def run(ctx: Context, report: Report) -> None:
    bff = ctx.cfg.bff
    user = ctx.user_a
    run_id = ctx.cfg.run_id

    with report.step("upload note (multipart, field 'file' + 'title')"):
        base = SAMPLE_NOTE.read_bytes() if SAMPLE_NOTE.exists() else FALLBACK_NOTE.encode()
        note_bytes = base + f"\n\nRiferimento run E2E: {run_id}\n".encode()
        status, body = await user.req_multipart(
            f"{bff}/merlt/contrib/documents",
            file_bytes=note_bytes,
            filename=f"e2e-note-{run_id}.txt",
            content_type="text/plain",
            fields={"title": f"E2E appunti {run_id}"},
            expect=(201, 503),
        )
        if status == 503:
            raise FlowSkipped("MERL-T non raggiungibile (upload 503)")
        document_id = body.get("documentId") if isinstance(body, dict) else None
        if document_id is None:
            raise StepFailure(f"no documentId in upload response: {body}")
        ctx.cap("documentId", document_id)
        if body.get("duplicate"):
            report.note("MERL-T ha marcato l'upload come duplicate (contenuto gia' visto)")

    with report.step("negative: .exe upload -> 400 invalid_file"):
        _, body = await user.req_multipart(
            f"{bff}/merlt/contrib/documents",
            file_bytes=b"MZ\x90\x00 not a note",
            filename=f"e2e-{run_id}.exe",
            content_type="application/octet-stream",
            expect=400,
        )
        if not (isinstance(body, dict) and body.get("detail") == "invalid_file"):
            raise StepFailure(f"expected detail=invalid_file, got {body}")

    with report.step("extract -> 202 jobId"):
        _, body = await user.req(
            "POST", f"{bff}/merlt/contrib/documents/{document_id}/extract",
            json={}, expect=202,
        )
        job_id = body.get("jobId")
        if not job_id:
            raise StepFailure(f"no jobId in extract response: {body}")
        ctx.cap("extractionJobId", job_id)

    with report.step(f"poll extraction job (max {ctx.cfg.extract_poll_max:.0f}s)"):
        job_url = f"{bff}/merlt/contrib/jobs/{job_id}/status"

        async def fetch() -> dict:
            _, b = await user.req("GET", job_url)
            return b if isinstance(b, dict) else {}

        job = await user.poll(
            fetch,
            lambda b: b.get("status") in ("completed", "failed", "timeout"),
            max_wait=ctx.cfg.extract_poll_max,
            label="extraction job (hint: docker logs visualex-merlt-worker --tail 50)",
        )
        if job.get("status") == "failed":
            err = str(job.get("error") or "").lower()
            if any(m in err for m in LLM_ERROR_MARKERS):
                raise FlowSkipped("estrazione LLM non disponibile (OPENROUTER_API_KEY?)")
            raise StepFailure(f"extraction failed: {job.get('error')}", {"job": job})
        if job.get("status") == "timeout":
            raise StepFailure("extraction job reported timeout", {"job": job})
        report.note(f"extraction completed, candidatesCreated={job.get('candidatesCreated')}")

    with report.step("list candidates"):
        _, body = await user.req(
            "GET", f"{bff}/merlt/contrib/documents/{document_id}/candidates",
        )
        candidates = body.get("candidates") if isinstance(body, dict) else None
        if candidates is None:
            raise StepFailure(f"no candidates array in response: {body}")
        entity_cands = [
            c for c in candidates
            if isinstance(c, dict)
            and c.get("candidate_type") == "entity"
            and c.get("status") != "promoted"
        ]
        report.note(f"{len(candidates)} candidati totali, {len(entity_cands)} entity promuovibili")

    if not entity_cands:
        report.note("nessun candidato entity estratto dalla nota: gate e promozione non testabili in questo run")
        await _check_me_jobs(ctx, report, job_id)
        return

    cand = entity_cands[0]
    cand_id = cand["id"]
    nome = (cand.get("entity_text") or f"Concetto E2E {run_id}").strip()
    verbatim = cand.get("verbatim_excerpt") or ""
    reformulated = (
        f"Rielaborazione E2E {run_id}: il concetto '{nome}' emerge dai miei appunti "
        "come principio generale in tema di risoluzione del contratto."
    )
    valid_fonte = f"E2E harness run {run_id}"

    with report.step("gate negative: attested=false -> 422 not_attested"):
        _, body = await user.req(
            "POST", f"{bff}/merlt/contrib/candidates/{cand_id}/promote",
            json={
                "candidateType": "entity", "nome": nome, "tipo": "concetto",
                "descrizione": reformulated, "fonte": valid_fonte, "attested": False,
            },
            expect=422,
        )
        if not (isinstance(body, dict) and body.get("reason") == "not_attested"):
            raise StepFailure(f"expected reason=not_attested, got {body}")

    with report.step("gate negative: whitespace fonte -> 422 missing_fonte"):
        # fonte='' would fail Zod min(1) with 400 before the gate; a single
        # space passes Zod and trips the gate's trim() check instead.
        _, body = await user.req(
            "POST", f"{bff}/merlt/contrib/candidates/{cand_id}/promote",
            json={
                "candidateType": "entity", "nome": nome, "tipo": "concetto",
                "descrizione": reformulated, "fonte": " ", "attested": True,
            },
            expect=422,
        )
        if not (isinstance(body, dict) and body.get("reason") == "missing_fonte"):
            raise StepFailure(f"expected reason=missing_fonte, got {body}")

    with report.step("gate negative: descrizione == verbatim -> 422 not_reformulated"):
        # The gate compares against the AUTHORITATIVE verbatim fetched from
        # MERL-T; a whitespace-only descrizione normalizes to '' and also trips
        # the check when the candidate has no verbatim excerpt.
        _, body = await user.req(
            "POST", f"{bff}/merlt/contrib/candidates/{cand_id}/promote",
            json={
                "candidateType": "entity", "nome": nome, "tipo": "concetto",
                "descrizione": verbatim or " ", "fonte": valid_fonte, "attested": True,
            },
            expect=422,
        )
        if not (isinstance(body, dict) and body.get("reason") == "not_reformulated"):
            raise StepFailure(f"expected reason=not_reformulated, got {body}")

    with report.step("happy promote -> pendingId"):
        _, body = await user.req(
            "POST", f"{bff}/merlt/contrib/candidates/{cand_id}/promote",
            json={
                "candidateType": "entity", "nome": nome, "tipo": "concetto",
                "descrizione": reformulated, "fonte": valid_fonte, "attested": True,
            },
        )
        pending_id = body.get("pendingId") if isinstance(body, dict) else None
        if pending_id:
            ctx.cap("pendingId", pending_id)
            report.note(f"promosso: pendingId={pending_id}")
        elif isinstance(body, dict) and body.get("hasDuplicates"):
            report.note("MERL-T ha rilevato possibili duplicati: nessun pendingId creato (deferred)")
        else:
            raise StepFailure(f"promote returned neither pendingId nor hasDuplicates: {body}")

    await _check_me_jobs(ctx, report, job_id)


async def _check_me_jobs(ctx: Context, report: Report, job_id: str) -> None:
    with report.step("GET /contrib/me/jobs contains our job"):
        _, body = await ctx.user_a.req("GET", f"{ctx.cfg.bff}/merlt/contrib/me/jobs")
        jobs = body.get("jobs") if isinstance(body, dict) else None
        if not isinstance(jobs, list) or not any(
            isinstance(j, dict) and j.get("id") == job_id for j in jobs
        ):
            raise StepFailure(f"job {job_id} not in me/jobs", {"jobs": jobs})
