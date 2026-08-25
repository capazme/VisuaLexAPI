# Spike 1 — Audit Design System

> Ricognizione pre-intervento. Nessun codice toccato. Da qui decidiamo insieme quali token aggiungere, come ridisegnare `Modal`, e quale è il confine tra "sostituzione meccanica" e "riprogettazione".

---

## 1. Token esistenti (stato attuale)

Il progetto ha **già un sistema di token ben strutturato** basato su:
- `frontend/src/index.css` — variabili HSL per light/dark + `@theme` block Tailwind v4
- `frontend/tailwind.config.js` — alias semantici che leggono dalle variabili CSS

### Token semantici (light + dark)

| Categoria | Token | Light | Dark |
|-----------|-------|-------|------|
| Base | `background`, `foreground` | bianco / slate-950 | slate-950 / bianco |
| Superfici | `card`, `popover`, `muted` | slate-50/96 | slate-900 |
| Azione | `primary` (blue), `secondary`, `accent` | blue-600 | blue-500 |
| Stato | `destructive`, `success`, `warning` | red-600, green-500, amber-500 | dark variants |
| Struttura | `border`, `input`, `ring` | slate-200 | slate-800 |

### Token feature-specifici (già presenti)

| Token | Hue | Semantica in-app |
|-------|-----|------------------|
| `brocardi` | viola (270°) | annotazioni/commenti legali |
| `tree` | verde (160°) | albero articoli |
| `quicknorm` | ambra (38°) | scorciatoie/frequent |
| `alias` | indigo (245°) | alias personalizzati |

### Scala colore raw

- `slate` 50-950 (neutrale)
- `primary` 50-950 (blu brand)
- Font: Inter (sans), Merriweather (serif, testo legale), JetBrains Mono (kbd/mono)

**Verdetto**: il token layer è **sufficiente per il 90% dei casi**. Non servono nuovi token "a caso". I buchi sono 3, documentati sotto.

---

## 2. Bypass dei token — dove e perché

Totale hit di colori hardcoded nel codice TSX/TS: **~139 occorrenze** distribuite in 3 categorie.

### 2.1 — StudyMode sepia theme (55 hit, ~40% del totale)

**File**: `components/features/workspace/StudyMode/*.tsx` (7 file)

```tsx
bg-[#f4ecd8]   text-[#5c4b37]   border-[#d4c4a8]
bg-[#efe5d1]   text-[#8b7355]   hover:bg-[#e4d4b8]
```

**Non è un bug**: è un **tema "sepia"** intenzionale (stile Kindle) selezionabile dall'utente. Il problema è che questi 6 colori sono hardcoded inline invece di essere token CSS.

**Decisione richiesta (D-1)**: promuovere il sepia theme a token CSS variables? Opzioni:
- **(a)** aggiungere `--sepia-bg`, `--sepia-text`, `--sepia-border`, `--sepia-section`, `--sepia-muted`, `--sepia-section-hover` in `index.css` come 4° theme (accanto a light/dark/sistema) → bonus: si potrà attivare sepia globalmente, non solo in StudyMode;
- **(b)** tenere i colori sepia locali allo StudyMode ma estrarli in una costante `STUDY_MODE_SEPIA` in un file `StudyMode/theme.ts` (no token globali) — sepia resta feature-locale;
- **(c)** eliminare il tema sepia (poco usato?) e usare solo light/dark.

Raccomandazione: **(a)** se usi sepia abitualmente, **(b)** se è una feature nice-to-have. Mai **(c)** senza capire quanto lo usi.

### 2.2 — Category palette in environmentUtils (6 hit)

**File**: `utils/environmentUtils.ts`

```ts
compliance: { color: '#8B5CF6' },  // viola
civil: { color: '#3B82F6' },       // blu
penal: { color: '#EF4444' },       // rosso
administrative: { color: '#F59E0B' }, // ambra
eu: { color: '#10B981' },          // verde
other: { color: '#6B7280' },       // grigio
```

**Non è un bug**: è una **tavolozza di categoria** per distinguere ambienti per area del diritto. I colori sono corretti, ma sono hex letterali invece di riferirsi a token semantici.

**Decisione richiesta (D-2)**: rendere questa tavolozza token-based?
- **(a)** aggiungere in `index.css` token `--category-compliance`, `--category-civil`, ecc. → coerenza + dark theme support;
- **(b)** lasciare hex letterali in `environmentUtils.ts` → è una tavolozza "dato", non una "variabile di design";
- **(c)** mapparli a token Tailwind esistenti della scala colori completa (`violet-500`, `blue-500`, `red-500`, `amber-500`, `emerald-500`, `gray-500`).

Raccomandazione: **(c)** è il compromesso migliore — si usano classi tailwind dirette (`bg-violet-500`), niente nuovi token da mantenere, dark mode gestito automaticamente.

### 2.3 — Highlight inline styles (8 hit)

**File**: `components/features/search/ArticleTabContent.tsx`, `components/features/workspace/StudyMode/StudyModeContent.tsx`, `components/features/environments/EnvironmentContentViewer.tsx`

```ts
yellow: 'background-color:#FEF3C7;color:#92400E;',
green:  'background-color:#D1FAE5;color:#065F46;',
red:    'background-color:#FEE2E2;color:#991B1B;',
blue:   'background-color:#DBEAFE;color:#1E3A8A;',
```

**Duplicato**: questi colori **esistono già come classi CSS** in `index.css`:
```css
.highlight-yellow { background-color: rgb(253 224 71 / 0.5); }
.highlight-green  { background-color: rgb(110 231 183 / 0.45); }
...
```

Ma sono classi CSS, non stile inline iniettabile in HTML. Siccome le annotation usano `innerHTML` + `span style=...`, serve un colore inline.

**Decisione richiesta (D-3)**: come gestire colori highlight per innerHTML injection?
- **(a)** estrarre i 4 hex in `utils/highlightColors.ts` (costanti condivise) → una sola fonte di verità, 8 hit diventano 1;
- **(b)** generare gli `<span>` con `className="highlight-yellow"` invece di `style="..."` → usa le classi CSS esistenti;
- **(c)** spostare i token highlight in CSS variables `--hl-yellow-bg`, `--hl-yellow-fg` in `index.css` e generare `style="background-color:hsl(var(--hl-yellow-bg))..."` → token-native, dark mode ready.

Raccomandazione: **(b)** è la più pulita (usa ciò che già esiste). **(c)** se servono colori highlight diversi in dark mode.

### 2.4 — Sostituzioni meccaniche (rimanenti ~10 hit)

Questi sono bug puri, già risolvibili con replace meccanico:

| File | Linea | Uso | Sostituzione |
|------|-------|-----|--------------|
| `components/auth/LoginForm.tsx` | 50 | `bg-[#F3F4F6]` / `dark:bg-[#0F172A]` | `bg-background` (già light/dark aware) |
| `components/auth/RegisterForm.tsx` | 87, 132 | idem | idem |
| `components/features/search/SearchPanel.tsx` | 461 | `shadow-[0_0_8px_rgba(59,130,246,0.5)]` | usare `shadow-glow` del tailwind config |
| `components/features/search/NormaCard.tsx` | 479 | `shadow-[0_-4px_10px_rgba(59,130,246,0.3)]` | aggiungere token `shadow-glow-sm` |
| `components/features/search/SearchForm.tsx` | 441 | `shadow-[0_0_8px_rgba(59,130,246,0.5)]` | `shadow-glow` |
| `components/features/environments/EnvironmentPage.tsx` | 412, 1124 | `'#6B7280'15` fallback | `gray-500` via hex-to-alpha util |
| `components/features/workspace/StudyMode/StudyMode.tsx` | 479 | `rgba(148,163,184,0.3)` inline gradient | token slate-400/30 |
| `hooks/useTour.ts` | 152 | `rgba(0,0,0,0.85)` overlay driver.js | library API, no replacement possibile |

---

## 3. Consolidamento dialog — stato attuale

### Primitive esistenti

- **`Modal.tsx`** (128 LOC) — base ben fatto: Escape handler, body scroll lock, AnimatePresence, backdrop, header con titolo + close, content scrollabile, 5 size varianti.

### Stato dei 6 dialog consumer

| Dialog | LOC | Usa `Modal` base? | Escape? | Body lock? | Backdrop style | z-index |
|--------|-----|------------------|---------|-----------|---------------|---------|
| `FeedbackModal` | 180 | ✅ | via Modal | via Modal | via Modal | z-50 |
| `ConfirmDialog` | 121 | ❌ ri-implementa | ✅ | ✅ | `bg-slate-900/40 blur-sm` | z-50 |
| `AnnexSwitchDialog` | 138 | ❌ ri-implementa | ❌ **bug** | ❌ **bug** | `bg-slate-950/40 blur-md` | z-[100] |
| `DossierModal` | 129 | ❌ ri-implementa | ❌ **bug** | ❌ **bug** | `bg-black/50 blur-sm` | z-[100] |
| `CopyModal` | 276 | ❌ ri-implementa | ❌ **bug** | ❌ **bug** | custom | z-50 |
| `AdvancedExportModal` | 548 | ❌ ri-implementa | ❌ **bug** | ❌ **bug** | custom | z-50 |

### Bug reali emersi dall'audit

1. **4 dialog non chiudono con Escape** (AnnexSwitch, Dossier, Copy, AdvancedExport). Premere Esc non fa nulla → accessibilità violata.
2. **4 dialog non bloccano lo scroll del body** → aprendo un modal con una pagina lunga sotto, la pagina continua a scrollare sotto il modal.
3. **Z-index incoerente**: alcuni usano `z-50`, altri `z-[100]`. Se appare un toast (z-50) sopra AnnexSwitchDialog (z-[100]) è nascosto. Se appare un tooltip (tippy z-9999) su DossierModal, tutto sballato.
4. **4 backdrop con stili diversi**: `bg-slate-900/40` (ConfirmDialog + Modal base) vs `bg-slate-950/40 blur-md` (AnnexSwitch) vs `bg-black/50 blur-sm` (DossierModal) vs custom. Inconsistenza visiva evidente aprendo 2 dialog diversi consecutivamente.

### Limiti del `Modal` base attuale

Il Modal base gestisce header + content, ma **manca di**:
- **Slot footer** (actions row) — ogni consumer re-implementa la riga "Annulla / Conferma";
- **Icon header variant** (icona + titolo + sottotitolo) — pattern usato da ConfirmDialog e AnnexSwitchDialog;
- **Focus management** — autofocus sul primo bottone o campo input;
- **ARIA roles** — `role="alertdialog"` vs `role="dialog"`;
- **Variant API** — `danger`/`info`/`success` per colorare header icon senza riscrivere il componente.

**Decisione richiesta (D-4)**: come procedere sul Modal base?
- **(a)** estendere `Modal.tsx` con API opzionale per `footer`, `icon`, `variant`, `role`, `autoFocus` → 1 primitivo evoluto, migrazione dei 5 dialog è pura sostituzione;
- **(b)** tenere `Modal.tsx` minimale e creare `<Dialog>` come wrapper sopra `Modal` con API ricca (ConfirmDialog-style) → 2 primitivi (Modal "raw" per casi custom, Dialog "strutturato" per casi standard);
- **(c)** fare un refactor radicale stile shadcn/Radix: `<Dialog.Root>` + `<Dialog.Trigger>` + `<Dialog.Content>` + `<Dialog.Footer>` → più flessibile ma rewrite totale.

Raccomandazione: **(a)** è il compromesso vincente — API incrementale, migration path lineare (ogni dialog diventa JSX più corto), nessuna breaking change per FeedbackModal.

---

## 4. Toast / Notification

| Componente | LOC | Scope | Overlap |
|------------|-----|-------|---------|
| `Toast.tsx` | 159 | Notifiche transienti + Undo | - |
| `ChangelogNotification.tsx` | 204 | Banner novità versione (dismissible) | Usa pattern toast ma layer diverso |

**Non sono veri duplicati**: Toast è "messaggio effimero con auto-dismiss", ChangelogNotification è "annuncio persistente". Hanno esigenze UX diverse.

**Decisione richiesta (D-5)**: mantenere separati o unificare?
- **(a)** mantenerli separati, documentare chiaramente i ruoli (Toast = transient, ChangelogNotification = persistent banner) → zero lavoro;
- **(b)** unificare sotto un `NotificationCenter` con varianti `transient` / `persistent` / `sticky` → refactor sostanzioso ma elimina l'incertezza su "quale usare".

Raccomandazione: **(a)**. Hanno semantica davvero diversa. Forzare unificazione sarebbe over-engineering.

---

## 5. Skeleton

`Skeleton.tsx` esporta 8 simboli: `Skeleton` (base) + 7 varianti domain-specific (`SkeletonText`, `SkeletonCard`, `ArticleSkeleton`, `DossierListSkeleton`, `HistoryListSkeleton`, `NormaCardSkeleton`, `SkeletonProps`).

**Non è duplicazione**: è composizione — le varianti usano tutte il `Skeleton` base. Pattern corretto.

**Nessuna decisione richiesta.** Skeleton sta bene com'è.

---

## 6. Decisioni aperte — sommario per il via libera

| # | Decisione | Opzioni | Raccomandazione |
|---|-----------|---------|-----------------|
| D-1 | Sepia theme StudyMode | token globali / costanti locali / rimozione | (b) costanti locali in `StudyMode/theme.ts` |
| D-2 | Category palette ambienti | nuovi token / hex letterali / tailwind scala piena | (c) classi tailwind (`bg-violet-500` ecc.) |
| D-3 | Highlight colors inline | costanti condivise / className / CSS vars | (b) className dove possibile |
| D-4 | Modal API evolution | estensione / wrapper / Radix-style | (a) estendere `Modal.tsx` |
| D-5 | Toast vs Changelog | separati / unificati | (a) separati |

Decisioni fatte sopra → traduciamo in 5 step di implementazione (ognuno un PR o un commit isolato):

1. **Fix bug accessibilità dialog** (D-4 abilitante) — estendere `Modal.tsx` con `footer`, `icon`, `variant`, `autoFocus`, `role`. Migrare i 5 dialog a usarlo. Chiude 4 bug a11y noti.
2. **Unificare z-index** in un file `lib/layers.ts` (backdrop, modal, tooltip, toast) usato da tutti.
3. **Replace meccanico** sez. 2.4 (~10 hit): bg auth, shadow glow, gradient slate.
4. **Highlight colors** (D-3): estrazione classe + fallback costante per innerHTML injection.
5. **StudyMode sepia** (D-1) + **category palette** (D-2) → decisione tua su quale strada.

**Nessuno di questi 5 step è ancora stato iniziato.** Aspetto feedback su D-1..D-5 prima di procedere.

---

_Documento di ricognizione. Zero codice modificato. Generato: 2026-04-22._
