---
story_id: MERLT-1.6
title: Plugin host minimo (disaccoppiamento)
epic: EPIC-MERLT-1
sprint: MERLT-1b
priority: P1
points: 3
status: not_started
depends_on: [MERLT-1.5]
gate: feature flag toggle verde
skill_driver: "feature-dev:code-architect + bmad:dev-story"
---

# MERLT-1.6 — Plugin host minimo (disaccoppiamento)

## User Story
Come dev che vuole testare VisuaLex senza MERL-T acceso (o stage gradualmente)
voglio un feature flag che disabiliti tutta la UI MERL-T senza toccare `ArticleTabContent`
così che il disaccoppiamento sia pulito e MERL-T sia un plugin vero, non hardcoded.

## Acceptance Criteria
- [ ] `frontend/src/plugins/registry.tsx` rifattorizzato: API per registrare plugin con `id`, `slots`, `enabled`
- [ ] `frontend/src/plugins/types.ts` rifattorizzato con TypeScript types per `Plugin`, `PluginSlot`, `PluginSlotProps`
- [ ] `frontend/src/plugins/slots/ArticleMerltSlot.tsx` esporta lo slot component
- [ ] `frontend/src/components/features/search/ArticleTabContent.tsx` usa `<PluginSlot id="article-merlt" articleUrn={...}/>` invece di import diretto del componente MERL-T
- [ ] Feature flag `VITE_FEATURE_MERLT=false` (in `frontend/.env`) → `<PluginSlot id="article-merlt">` non rendera nulla; app gira come vanilla
- [ ] Feature flag `VITE_FEATURE_MERLT=true` → slot MERL-T rendera normalmente (incluso il tracker `useArticleViewedTracker`)
- [ ] Smoke manuale: toggle flag, restart frontend, verifica UI (con flag off, niente componenti MERL-T visibili in DOM tramite DevTools)
- [ ] Test plugin host: registry registra/legge correttamente; PluginSlot rispetta enabled flag

## Technical Notes
- Riusa il plugin registry abbozzato nel commit `81be277`, ma rifattorizza per essere tipizzato
- `MERLT_ENABLED` (env start.sh, runtime container) e `VITE_FEATURE_MERLT` (env frontend, UI plugin host) sono indipendenti per design
- Lo Story 1.6 NON aggiunge altri slot oltre `article-merlt` (saranno aggiunti negli Slice 2-3 per Q&A, graph viewer, ecc.)
- Pattern minimal viable: registry come singleton lazy-init, PluginSlot legge da context

## Dependencies
- MERLT-1.5 (vertical slice deve essere funzionante prima di disaccoppiarla)

## Definition of Done
- [ ] Tutti gli AC verdi
- [ ] Toggle flag verifica manuale (entrambi i valori)
- [ ] Commit `refactor(merlt): introduce plugin host for MERL-T UI decoupling`
