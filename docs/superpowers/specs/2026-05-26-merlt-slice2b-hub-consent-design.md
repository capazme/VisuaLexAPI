# MERL-T ↔ VisuaLex — Slice 2b Design: Hub & Consent

**Branch:** `visualex-merlt-main` · **Data:** 2026-05-26 · **Dipende da:** Slice 1 (eventi RLCF), Slice 2a (grafo)
**Prerequisito di:** Slice 2c (Apprendi dai miei appunti)

---

## 1. Goal e framing

Trasformare la pagina `/merlt` da UI "da sviluppatore" (5 tab con editor JSON che chiamano endpoint **non montati** sul BFF) in un **hub user-facing** per un avvocato, e **risolvere il consenso frammentato** che oggi rende il tracking incoerente.

Slice 2b è **fondativo**: chiude i 3 bug bloccanti e costruisce la superficie (hub + consenso) su cui vivranno le feature attive (contribuzione in 2c, Q&A, ops).

### Problemi reali da chiudere (verificati nel codice)
1. **`GET /api/merlt/features` non esiste** sul BFF (`routes/merlt/index.ts` monta solo `health, graph, consent, profile, events`). → `useMerltFeatures` rotto, l'hub non carica.
2. **Consenso su due fonti non sincronizzate**: il server (`MerltUserPreference` + `consentGuard`) è il gate forte degli eventi (403 se `none`), ma i tracker di Slice 1 leggono `hasMerltConsent()` da **localStorage**, mai sincronizzato col server (l'unico path era il `/features` rotto). Tracker e guard possono divergere.
3. **Contratto consenso rotto**: `merltService.updateMerltConsent` usa `PUT {consentLevel,...}`, il BFF espone `POST {level, reason?}`. Il setter consenso è inutilizzabile dalla UI.

> Nota: `MerltWorkspacePage` chiama anche ~20 endpoint (`/merlt/experts/*`, `/enrichment/*`, `/ops/*`, `/documents/*`, `/rlcf/*`, `/profile/me/full`) che **non sono montati** sul BFF → 404. La pagina è quasi interamente morta. Viene rimossa.

---

## 2. Decisioni architetturali load-bearing

| # | Decisione | Motivazione |
|---|-----------|-------------|
| D1 | **Il server è l'unica fonte di verità del consenso.** `MerltUserPreference` + `consentGuard` restano il gate forte. | Difesa in profondità: anche con client errato, il BFF blocca con 403. |
| D2 | **`localStorage` retrocede a cache di solo primo-paint.** Il `ConsentContext` ricarica `GET /consent` al login e il server vince al reconcile. | Elimina la divergenza; evita un flash "non consentito" prima che la GET risolva. |
| D3 | **Feature gating derivato client-side**, niente `GET /features`. | Tutte le info esistono già lato client (flag build-time, consenso dal context, `isAdmin` da `useAuth`). Una superficie in meno da mantenere. |
| D4 | **Fix del contratto è solo lato client** (`POST {level, reason}`); il BFF è già corretto. | Meno lavoro: rimuovere il path `PUT`, allineare il service. |
| D5 | **Guard admin server-side** (`requireAdmin`) per le future route ops. | Oggi il blocco è solo `disabled` cosmetico = falla OWASP Broken Access Control. Si crea ora lo scaffold. |
| D6 | **Hub = dashboard a card** (single scroll), non tab. | Mette consenso/privacy e profilo al centro; degrada con card "in arrivo" per le aree non ancora pronte; promovibile a pagina dedicata se una card diventa densa. |
| D7 | **Consenso first-run = banner non bloccante** alla prima azione tracciabile (slot `global`), non un modale al login. | Chiede il consenso nel punto in cui i dati verrebbero raccolti (GDPR-friendly) senza interrompere un workflow non correlato. |

---

## 3. Architettura runtime

```
Login/refresh
   │
   ▼
ConsentContext  ──GET /api/merlt/consent──►  BFF consent route ──► Prisma MerltUserPreference
   │  (stato: loading|ready|error)                                       (fonte di verità)
   │  scrive cache boot in localStorage
   ▼
useMerltConsent() / useMerltFeatures()  (derivazione client-side: flag + level + isAdmin)
   │
   ├─► Tracker Slice 1 (article-viewed, ecc.) — gate su context (non più localStorage)
   ├─► ConsentBanner (slot global) — appare se level==='none' + prima azione tracciabile
   ├─► ConsentDialog — set/upgrade/revoke via POST/DELETE /consent
   └─► MerltHubPage (/merlt) — card Consenso / Profilo / Grafo / (in arrivo) / Ops(admin)
```

Il `consentGuard` server resta sul path `/api/merlt/events/*` e (in 2c) sui path contrib: è il gate che conta davvero.

---

## 4. Componenti

### 4.1 Frontend (`frontend/src/`)

**Nuovo — `features/merlt/consent/`** (la dir è citata in CLAUDE.md ma non esiste):
- `ConsentContext.tsx` — provider che fa `GET /consent` su auth, espone stato union `{ status: 'loading' } | { status: 'ready'; consent: ConsentState } | { status: 'error'; error }`, più `setConsent(level, reason?)` (→ `POST /consent`) e `revokeConsent(reason?)` (→ `DELETE /consent`). Scrive la cache boot in `localStorage` via `merltConsent.ts`. **Non blocca** il render dell'app: in `loading` i consumer trattano come "consenso sconosciuto → non tracciare".
- `useConsent.ts` — hook di consumo (`const { status, consent, setConsent } = useConsent()`), + selettore `canTrack` (`consent?.level !== 'none'`).
- `ConsentDialog.tsx` — spiega i 3 livelli in italiano chiaro, privacy-first: `none` (nessun apprendimento), `basic` (grafo + segnali passivi anonimizzati), `full` (anche contribuzione/validazione RLCF). Toggle granulari (contribution/validation/graph) mostrati **solo in `full`** e derivati da `preferencesForLevel` (read-only display in `basic`). Scrive via `setConsent`.
- `ConsentBanner.tsx` — banner non bloccante; appare quando `feature on AND status==='ready' AND level==='none' AND !dismissedThisSession AND prima azione tracciabile osservata` (sottoscrive `merltEventBus`). "Scopri/Gestisci" apre il dialog; "Non ora" dismette per la sessione.

**Modificati:**
- `features/merlt/merltConsent.ts` — resta ma **ridocumentato come cache** (non SoT). `getMerltConsentLevel/setMerltConsentLevel` usati solo dal context per il boot.
- `features/merlt/useMerltFeatures.ts` — **riscritto**: deriva tutto client-side (no rete). Ritorna `{ merltEnabled, graphEnabled, consentLevel, canContribute, canValidate, graphReadable, opsVisible, isLoading }`. `canContribute/canValidate = level==='full'`; `graphReadable = level!=='none'`; `opsVisible = isAdmin`.
- `services/merltService.ts` — **fix consenso**: `setMerltConsent(level, reason?)` → `POST /merlt/consent { level, reason }`; `revokeMerltConsent(reason?)` → `DELETE /merlt/consent`. **Rimuovere** `getMerltFeatures` + `updateMerltConsent` (PUT). Rimuovere i client verso endpoint non montati (experts/enrichment/ops/documents/rlcf) — saranno reintrodotti puliti in 2c/fasi successive.
- `features/merlt/tracking/*.ts` — i 5 tracker passano da `hasMerltConsent()` (localStorage) a `useConsent().canTrack` (context). Stesso comportamento fire-and-forget; il guard server resta backstop.
- `plugins/registry.tsx` — il `ConsentBanner` si monta sullo slot `global` (come `GlobalMerltSlot`), così sopravvive ai cambi rotta.
- `App.tsx` — rotta `merlt` punta a `MerltHubPage`; `ConsentProvider` avvolge l'app (o il sottoalbero autenticato).
- `components/layout/Sidebar.tsx` — voce `/merlt` invariata (gated da `VITE_FEATURE_MERLT`).

**Nuovo — `pages/MerltHubPage.tsx`** (sostituisce `MerltWorkspacePage.tsx`, che viene **eliminato**):
- Banner di stato consenso (livello attuale + "gestisci").
- Card **Consenso & Privacy** (cambia livello, toggle granulari in `full`, audit trail da `lastAuditAt` + lista audit se disponibile).
- Card **Profilo / Authority** (`GET /merlt/profile`, stato degradato se 503).
- Card **Grafo giuridico** (link → `/grafo`).
- Card **Contributi RLCF** + **Q&A** in stato "in arrivo" (placeholder; 2c riempie Contributi).
- Card **Ops** solo se `opsVisible` (admin).
- Tutto gated da `VITE_FEATURE_MERLT` (off → "MERL-T non disponibile").

### 4.2 BFF Node (`backend/src/`)

**Nuovo:**
- `middleware/merlt/requireAdmin.ts` — dopo `authenticate`, `403 { detail: 'admin_required' }` se `!req.user.isAdmin`. Test dedicati. (Montato sulle route ops in Fase 4; creato ora come scaffold.)

**Invariato (già corretto):**
- `routes/merlt/consent.ts` — `GET/POST/DELETE /consent` con `{ level, reason? }` e `preferencesForLevel`. Nessuna modifica.
- `routes/merlt/profile.ts` — `GET /profile`. Nessuna modifica.

**Nessuna nuova migrazione Prisma in 2b.**

---

## 5. Data flow — set consenso da `none` a `full`

```
ConsentDialog "Attiva full"
  → useConsent().setConsent('full', reason)
  → POST /api/merlt/consent { level:'full', reason }
  → consent.ts applyLevelChange: upsert MerltUserPreference + MerltConsentAudit (transazione)
  → ritorna ConsentResponse completa
  → ConsentContext aggiorna stato 'ready' + cache localStorage
  → tracker.canTrack diventa true → eventi non più 403 lato consentGuard
```

---

## 6. Testing strategy

- **Unit (vitest, FE):** `ConsentContext` (hydrate, reconcile cache vs server, stato degradato), `useMerltFeatures` (derivazione), `ConsentDialog` (livelli/toggle), `ConsentBanner` (condizioni di apparizione + dismiss). Aggiornare i test dei 5 tracker (mock del context al posto di `hasMerltConsent`).
- **Unit (vitest+supertest, BFF):** `requireAdmin` (200 admin / 403 non-admin / 401 no-auth).
- **Regressione:** i test esistenti di `consent.ts` restano verdi (nessuna modifica BFF al consenso).
- **Smoke E2E:** sezione "Slice 2b" in `docs/merlt-smoke-checklist.md` (dare/cambiare/revocare consenso, banner first-run, hub render, gate tracker).

---

## 7. Done criteria

- [ ] `GET /features` eliminato come dipendenza; hub carica senza errori.
- [ ] Consenso impostabile/revocabile dalla UI (contratto `POST/DELETE {level,reason}`).
- [ ] `ConsentContext` = unica fonte client; tracker gateati sul context; server resta gate forte.
- [ ] `MerltWorkspacePage` rimossa; `MerltHubPage` dashboard live (Consenso/Profilo/Grafo + placeholder + Ops-admin).
- [ ] `ConsentBanner` first-run + `ConsentDialog` con copy privacy.
- [ ] `requireAdmin` con test (scaffold Fase 4).
- [ ] Tutti i test FE/BFF verdi (incluso fix di eventuali errori pre-esistenti incontrati); lint/tsc puliti.
- [ ] CLAUDE.md aggiornato + smoke checklist Slice 2b.

---

## 8. Out of scope (→ 2c / fasi successive)

- Route proxy BFF per contribution/validation, Q&A esperti, ops (Fasi 2-4 / Slice 2c).
- UI Q&A esperti (la "Slice 3" menzionata in CLAUDE.md → diventa Fase 3 dell'hub).
- Qualsiasi modifica a MERL-T.

---

## 9. Files coinvolti — summary

**FE nuovi:** `features/merlt/consent/{ConsentContext,useConsent,ConsentDialog,ConsentBanner}.tsx`, `pages/MerltHubPage.tsx`.
**FE modificati:** `features/merlt/{merltConsent,useMerltFeatures}.ts`, `services/merltService.ts`, `features/merlt/tracking/*.ts`, `plugins/registry.tsx`, `App.tsx`, `components/layout/Sidebar.tsx`.
**FE eliminati:** `pages/MerltWorkspacePage.tsx`.
**BFF nuovi:** `middleware/merlt/requireAdmin.ts`.
**Doc:** questo design + `docs/sprint-plan-merlt-slice2b-2026-05-26.md` + aggiornamento `CLAUDE.md` + `docs/merlt-smoke-checklist.md`.
