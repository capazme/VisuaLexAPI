# Sprint Plan: MERL-T Slice 2b — Hub & Consent

**Branch:** `visualex-merlt-main` · **Design:** `./design.md`
**Obiettivo:** chiudere i 3 bug bloccanti (features fantasma, consenso frammentato, contratto rotto) e costruire l'hub user-facing + il consenso server-SoT. Prerequisito di Slice 2c.

## Executive Summary

9 storie, tutte frontend/BFF (nessuna modifica MERL-T, nessuna nuova migrazione Prisma). Ordine pensato per sbloccare presto il consenso (2b.1-2b.4) e poi le superfici UI (2b.5-2b.7). TDD dove c'è logica; code-review (`feature-dev:code-reviewer`) dopo ogni storia con fix di **tutti** gli issue; commit per storia (mai auto-commit/push).

## Story Inventory

### MERLT-2b.1 — Fix contratto consenso client + pulizia service
- **Scope:** `services/merltService.ts`: nuovo `setMerltConsent(level, reason?)` → `POST /merlt/consent {level, reason}`; `revokeMerltConsent(reason?)` → `DELETE /merlt/consent`. Rimuovere `updateMerltConsent` (PUT) e `getMerltFeatures`. Rimuovere i client verso endpoint non montati (experts/enrichment/ops/documents/rlcf/profile-me) — saranno reintrodotti in 2c.
- **AC:** chiamate consenso colpiscono il contratto BFF corretto; nessun import rotto residuo; tsc pulito.
- **Test:** unit service (mock axios) per `setMerltConsent`/`revokeMerltConsent`.
- **Skill:** `tdd`.

### MERLT-2b.2 — ConsentContext + useConsent (SoT + cache boot)
- **Scope:** `features/merlt/consent/ConsentContext.tsx` + `useConsent.ts`. Hydrate via `GET /consent` su auth; stato union `loading|ready|error`; `setConsent`/`revokeConsent`; cache boot in `localStorage` (via `merltConsent.ts` ridocumentato). Non blocca il render app. `ConsentProvider` montato in `App.tsx`.
- **AC:** al login il context riflette lo stato server; reconcile cache↔server (server vince); `canTrack` derivato.
- **Test:** unit (hydrate ok, errore→degradato, reconcile cache stale, setConsent aggiorna stato+cache).
- **Skill:** `tdd`, `react-patterns`.

### MERLT-2b.3 — Riscrittura useMerltFeatures client-side
- **Scope:** `features/merlt/useMerltFeatures.ts` riscritto: deriva da `VITE_FEATURE_MERLT` + `isMerltGraphEnabled()` + `useConsent` + `useAuth().isAdmin`. Nessuna rete. Ritorna `{merltEnabled, graphEnabled, consentLevel, canContribute, canValidate, graphReadable, opsVisible}`.
- **AC:** nessuna chiamata a `/features`; derivazione coerente con `preferencesForLevel`.
- **Test:** unit (matrice level×isAdmin→flags).
- **Skill:** `tdd`.

### MERLT-2b.4 — Migrazione tracker Slice 1 al context
- **Scope:** i 5 tracker (`features/merlt/tracking/*.ts`) passano da `hasMerltConsent()` a `useConsent().canTrack`. Stesso fire-and-forget.
- **AC:** tracker emettono solo se `canTrack`; comportamento invariato altrove; guard server resta backstop.
- **Test:** aggiornare i test esistenti dei tracker (mock context al posto di `hasMerltConsent`); restano verdi.
- **Skill:** `tdd`.

### MERLT-2b.5 — ConsentDialog (3 livelli + privacy copy)
- **Scope:** `features/merlt/consent/ConsentDialog.tsx`. Spiega none/basic/full in italiano privacy-first; toggle granulari mostrati solo in `full` (read-only display altrimenti); scrive via `setConsent`.
- **AC:** cambio livello persistito server; copy chiara per non-tecnico; accessibile (focus, Esc).
- **Test:** unit (render livelli, selezione, chiamata setConsent, toggle visibili solo full).
- **Skill:** `tdd`, `frontend-design`.

### MERLT-2b.6 — ConsentBanner first-run (slot global)
- **Scope:** `features/merlt/consent/ConsentBanner.tsx` montato sullo slot `global` (`plugins/registry.tsx`). Appare se `feature on AND ready AND level==='none' AND !dismissed AND prima azione tracciabile` (sub `merltEventBus`). "Scopri/Gestisci"→dialog; "Non ora"→dismiss sessione.
- **AC:** non bloccante; non riappare dopo dismiss nella sessione; non appare se consenso già dato.
- **Test:** unit (condizioni apparizione/dismiss; trigger su evento bus).
- **Skill:** `tdd`, `react-patterns`.

### MERLT-2b.7 — MerltHubPage dashboard + rimozione vecchia page
- **Scope:** nuova `pages/MerltHubPage.tsx` (dashboard a card: banner stato, Consenso&Privacy, Profilo/Authority [`GET /profile`], Grafo→`/grafo`, placeholder Contributi/Q&A, Ops se admin). **Eliminare** `pages/MerltWorkspacePage.tsx`. Aggiornare `App.tsx` (rotta) + verificare Sidebar. Gated `VITE_FEATURE_MERLT`.
- **AC:** hub carica senza errori; card profilo degrada su 503; Ops visibile solo admin.
- **Test:** unit (render card per stato consenso; Ops gating).
- **Skill:** `frontend-design`, `tdd`.

### MERLT-2b.8 — Middleware requireAdmin (BFF)
- **Scope:** `backend/src/middleware/merlt/requireAdmin.ts`: dopo `authenticate`, 403 `admin_required` se `!req.user.isAdmin`. Scaffold per Fase 4 (non ancora montato su route reali).
- **AC:** 200 admin / 403 non-admin / 401 no-auth.
- **Test:** vitest+supertest sul middleware.
- **Skill:** `tdd`, `security-audit`.

### MERLT-2b.9 — Chiusura Slice 2b
- **Scope:** aggiornare `CLAUDE.md` (sezione MERL-T Slice 2b), sezione "Slice 2b" in `docs/merlt-smoke-checklist.md`, fix di tutti gli issue di review residui + eventuali errori test/lint/tsc pre-esistenti incontrati.
- **AC:** Done criteria del design tutti spuntati; suite verde.
- **Skill:** `code-review`, `scribe`.

## Cross-cutting
- **Feature flag:** `VITE_FEATURE_MERLT` (intera integrazione). Nessun nuovo flag.
- **Testing target:** ogni storia con logica ha unit test; i tracker mantengono i test verdi; BFF `requireAdmin` coperto.
- **Done Slice 2b:** vedi §7 del design doc.
