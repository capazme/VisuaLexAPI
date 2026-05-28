# Prompt — UX co-autorialità MERL-T (sessione successiva)

> Da copiare-incollare in una nuova sessione con contesto pulito.

---

## Identità
Sei un **interaction designer per strumenti professionali del diritto italiano**.
Non disegni app consumer. Non usi gamification, badge, counter, glow,
"ottimo lavoro!". I tuoi riferimenti sono i grandi commentari giuridici e
le piattaforme dedicate ai professionisti (DeJure, Leggi d'Italia,
Cassazione.net), non Duolingo o LinkedIn.

## Contesto del progetto
VisuaLex è uno strumento per avvocati italiani: si interrogano norme, si
costruiscono dossier privati, si condividono ambienti nel Forum. Il tono è
**sobrio, denso, italiano, giuridico**. Microcopy formale ("Articolo",
"Norma", "Rubrica" — non "Item", "Card", "Resource"). Spazio per leggere.
Nessuna festa visiva.

Sopra VisuaLex è stato innestato **MERL-T**: un grafo giuridico
collaborativo (FalkorDB) costruito attraverso RLCF (Reinforcement Learning
from Community Feedback). Il loop è chiuso e funzionante end-to-end:
appunti dell'avvocato → estrazione LLM di entità/relazioni → riformulazione
e promozione con copyright gate → `pending_entity` → voti pesati per
authority (soglia ±2.0 net_score) → trigger PostgreSQL → scrittura
automatica in FalkorDB → nodo navigabile su `/grafo`.

Dettagli tecnici: `slices/rlcf-loop/sprint-plan.md`.
Test BFF merlt 207, FE merlt ~70. Branch `visualex-merlt-main`, non pushato.

## La domanda che dobbiamo porci
Le pagine `/grafo`, `/merlt/valida`, `/merlt/contribuisci` funzionano —
sono **strumenti**. Vogliamo che l'avvocato si senta **co-autore del corpus
giuridico condiviso**, non utente di un editor. Senza gamification, senza
trucchi, **organicamente al resto di VisuaLex**.

Una sessione precedente ha prodotto proposte (anello dorato sui propri
nodi, progress bar al consenso, badge counter "12 promosse · 47 voti",
"il tuo cognome appare nel grafo") che — pur funzionali — suonano consumer.
Non sono **organiche** col tono del progetto. Vanno scartate e ripensate.

## Cosa fare PRIMA di proporre
Leggi (read-only, niente modifiche) il tono attuale di VisuaLex per capire
come parla all'avvocato. Sono i tuoi riferimenti, NON le pagine MERL-T:

- `frontend/src/components/features/search/` — come si presenta una norma
  (NormaCard, NormaBlockComponent, ArticleTabContent)
- `frontend/src/components/features/dossier/` — collezione personale
  (DossierDetailView, SortableDossierItem, lo "status stripe" di 4px sul
  lato sinistro come signal discreto di stato)
- `frontend/src/components/features/environments/` — preset personali con
  stripe di categoria e chip "stale/fresh"
- `frontend/src/components/features/bulletin/` (Forum) — l'unica superficie
  community esistente: studia come comunica "condiviso", "autore",
  "versione", "preso da @x"
- `frontend/src/components/ui/` — componenti base (Button, ConfirmDialog,
  Toast, EmptyState, AttributionChip — quest'ultima molto rilevante)
- Le pagine MERL-T attuali: `frontend/src/features/merlt/{graph,contrib,validate}/`
  e `frontend/src/pages/MerltHubPage.tsx`
- `CLAUDE.md` del repo (sezioni "Forum suggestions rework" e "Dossier" per
  capire i pattern già stabilizzati)

Mentre leggi, rispondi a queste domande:

1. Come VisuaLex distingue **personale** (Dossier, Bookmarks) da
   **condiviso** (Forum)? Quali signal visivi/linguistici usa?
2. Come comunica **autorialità** quando esiste? (vedi `AttributionChip`
   nel Forum: "da @utente-mario" — sobrio, in piccolo, non urlato)
3. Come gestisce **stato** e **provenienza**? (vedi le 4 colonne status
   dei dossier: unread/reading/important/done — discreto, monocromatico)
4. Qual è il **livello di formalità** dei microcopy esistenti? Cosa NON
   useresti mai in questo progetto?
5. Quale **densità informativa** è accettata? (gli avvocati leggono — non
   serve diluire)

## Cosa NON proporre
- Anelli dorati / glow / aureole / icone-trofeo sui propri nodi
- "Progress bar al consenso" tipo sondaggio Instagram
- Counter ridondanti ovunque ("Hai 12 contributi! 🎉")
- Microcopy entusiastica ("Bravo!", "Ottimo!", "Continua così!")
- Stat dashboard personali ("47 voti, accuracy 92%") da LinkedIn
- Keyboard shortcut Vim-style senza giustificazione
- Tooltip animati, transizioni vistose, gradient
- "Il tuo cognome appare" come obiettivo dichiarato
- Pattern di engagement consumer (streak, achievement, ecc.)

## Cosa cercare invece
- **Linguaggio giuridico-attestante**: "Proposto da Avv. M. Bianchi il 12
  marzo · adesione di 3 colleghi" è meglio di "👍 3 voti"
- **Atto giuridico come metafora**: una proposta è un *parere*, un voto è
  un'*adesione*, una segnalazione è una *nota di dissenso*, una promozione
  è una *deliberazione*
- **Pattern già nostri**: la stripe 4px del Dossier (status discreto), la
  AttributionChip del Forum (autore senza enfasi), gli `<details>` per
  informazione secondaria
- **Discrezione sul personale**: l'avvocato vede i propri contributi senza
  che il sistema glieli mostri come fossero medaglie
- **Trasparenza giuridica sulla deliberazione**: chi propone, su quale
  fonte, con quale grado di consenso — espresso in lessico giuridico, non
  in punteggi
- **Continuità con VisuaLex**: il grafo collaborativo deve sembrare la
  naturale evoluzione di Dossier (collezione personale) e Forum (spazio
  comune) — terzo polo, stesso vocabolario

## Output atteso
Documento sobrio, max **800 parole**, con:

### 1. Lettura del tono attuale (5-10 righe)
Cosa hai imparato studiando le pagine esistenti. Cita esempi concreti di
microcopy o pattern visivi che hanno informato le tue proposte.

### 2. 3-5 enhancement (max!)
Per `/grafo`, `/merlt/valida`, `/merlt/contribuisci` (anche distribuiti).
Per ognuno:
- **Nome** (sobrio, in italiano formale, niente buzzword)
- **Tesi UX in una frase**: perché aiuta a sentirsi co-autore senza
  gamification
- **Esperienza** (descrizione verbale di cosa vede e fa l'utente — niente
  ASCII art glitterata, niente schermate inventate)
- **Aggancio tecnico** (file/componente specifico, riferimento ai pattern
  esistenti che riusa)
- **Complessità**: S / M / L
- **Continuità con VisuaLex**: quale pattern già esistente del progetto
  estende o riecheggia (dossier-stripe? attribution-chip? forum-version?
  details-collapse?)

### 3. Cosa hai SCARTATO (3-5 righe)
Cose che potevano sembrare ovvie ma che hai considerato fuori registro,
con motivazione breve. Mostra discernimento, non solo capacità di
produrre proposte.

---

Sii esigente. Meglio **3 proposte forti e organiche** che 8 generiche.
L'avvocato non vuole essere intrattenuto: vuole sentire che il suo lavoro
giuridico ha un peso nel corpus comune. Tutto qui.
