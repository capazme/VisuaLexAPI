---
story_id: MERLT-1.2
title: Prisma schema + migration (MerltConsent, MerltConsentAudit, MerltUserAuthorityCache)
epic: EPIC-MERLT-1
sprint: MERLT-1a
priority: P0
points: 3
status: not_started
depends_on: [MERLT-1.0]
gate: migration applicata
skill_driver: "bmad:dev-story (ruolo database-architect inline)"
---

# MERLT-1.2 — Prisma schema + migration

## User Story
Come BFF che deve gestire consenso e authority MERL-T per utente
voglio le tabelle Prisma corrispondenti
così che il consenso e l'authority cache vivano su DB persistente, non in memoria.

## Acceptance Criteria
- [ ] `backend/prisma/schema.prisma` aggiunge i 3 modelli secondo design doc §5.3:
  - `MerltConsent` (userId PK, consentBase, consentFull, consentVersion, acceptedAt, revokedAt, updatedAt)
  - `MerltConsentAudit` (id cuid, userId, action enum-string, fromVersion, toVersion, ip, userAgent, createdAt; index su userId + createdAt)
  - `MerltUserAuthorityCache` (userId PK, authorityScore, baselineQual, trackRecord, performance, totalContributions, syncedAt)
- [ ] `npx prisma migrate dev --name add_merlt_consent` genera migration
- [ ] Migration applicata, `npx prisma migrate status` mostra "Database schema is up to date"
- [ ] `npx prisma generate` rigenera client TypeScript
- [ ] `npm run build` verde
- [ ] Verifica via psql: tabelle `MerltConsent`, `MerltConsentAudit`, `MerltUserAuthorityCache` presenti nel DB VisuaLex

## Technical Notes
- Nessuna foreign key cross-DB (Postgres VisuaLex e Postgres MERL-T sono separati)
- `MerltConsentAudit.action` è String (non enum Prisma) per flessibilità schema: `accepted_base | accepted_full | revoked | upgraded`
- Indici load-bearing: query del consenso per userId è sul critical path di ogni event capture

## Dependencies
- MERLT-1.0 (env Postgres VisuaLex deve girare)

## Definition of Done
- [ ] Tutti gli AC verdi
- [ ] Migration committata in `backend/prisma/migrations/`
- [ ] Commit `feat(merlt): add Prisma models for consent and authority cache`
