---
story_id: MERLT-1.4
title: Consent API + consentGuard middleware
epic: EPIC-MERLT-1
sprint: MERLT-1a
priority: P0
points: 5
status: not_started
depends_on: [MERLT-1.2, MERLT-1.3]
gate: consent lifecycle integration test verde
skill_driver: "superpowers:test-driven-development"
---

# MERLT-1.4 — Consent API + consentGuard middleware

## User Story
Come avvocato che usa VisuaLex
voglio dare/revocare consenso al tracking MERL-T in modo esplicito
così che il mio dato venga inviato a MERL-T solo se ho acconsentito.

## Acceptance Criteria
- [ ] `backend/src/routes/merlt/consent.ts` con:
  - `GET /api/merlt/consent` — ritorna stato consenso per `req.user.id`
  - `POST /api/merlt/consent` — accetta consenso (body: `{ consentBase, consentFull?, consentVersion }`)
  - `DELETE /api/merlt/consent` — revoca consenso (setta `revokedAt = now()`)
- [ ] `backend/src/routes/merlt/index.ts` mount router su `/api/merlt` con middleware `authenticate` (JWT, riusa esistente)
- [ ] `backend/src/services/merlt/consentGuard.ts` middleware Express:
  - Legge `MerltConsent` per `req.user.id`
  - Se `consentBase=false` o `revokedAt != null` → risponde `403 { error: "consent_required" }`
  - Altrimenti `next()`
- [ ] Audit log: ogni transizione (accepted_base, accepted_full, revoked, upgraded) crea record `MerltConsentAudit` con `ip` (da `req.ip`) + `userAgent` (da headers)
- [ ] Integration test `backend/tests/integration/merlt/consent-lifecycle.test.ts`:
  - POST consent → 200 + DB row presente
  - GET consent → ritorna stato corretto
  - DELETE consent → 200 + `revokedAt` settato + audit row con `action=revoked`
  - Second POST con consent_full=true → audit con `action=upgraded`
- [ ] Coverage ≥80% su `services/merlt/consentGuard.ts`

## Technical Notes
- Riusa middleware `authenticate` esistente in `backend/src/middleware/` (verificare path esatto)
- Riusa `backend/tests/setup.ts` esistente per integration test boilerplate
- `consentGuard` va montato SOLO su `/api/merlt/events/*`, NON su consent.ts (altrimenti loop: l'utente non può dare il consenso perché non ce l'ha)
- `consentVersion` permette versioning del testo legale (utente deve re-accettare se il testo cambia)

## Dependencies
- MERLT-1.2 (Prisma models)
- MERLT-1.3 (Zod consent schemas)

## Definition of Done
- [ ] Tutti gli AC verdi
- [ ] Integration test verde
- [ ] Commit `feat(merlt): add consent API and consentGuard middleware`
