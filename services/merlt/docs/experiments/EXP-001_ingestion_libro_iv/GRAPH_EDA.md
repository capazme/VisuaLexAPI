# MERL-T Graph - Exploratory Data Analysis

> **Data**: 2025-12-04 23:00
> **Scope**: Libro IV Codice Civile (Art. 1173-2059)
> **Post-fix**: Massime re-ingestion con parsing strutturato

---

## 1. Panoramica Generale

| Metrica | Valore |
|---------|--------|
| **Totale Nodi** | 12,410 |
| **Totale Relazioni** | 14,703 |
| **Grado Medio** | 2.37 |

---

## 2. Distribuzione Nodi per Label

| Label | Count | % |
|-------|-------|---|
| **Norma** | 1,005 | 8.1% |
| **Dottrina** | 1,630 | 13.1% |
| **AttoGiudiziario** | 9,775 | 78.8% |

---

## 3. Distribuzione Relazioni per Tipo

| Tipo Relazione | Count | % | Descrizione |
|----------------|-------|---|-------------|
| `:interpreta` | 11,182 | 76.1% | Giurisprudenza → Norma |
| `:contiene` | 1,891 | 12.9% | Gerarchia normativa |
| `:commenta` | 1,630 | 11.1% | Dottrina → Norma |
| `:cita` | 0 | 0.0% | Norma → Norma (riferimenti) |

---

## 4. Statistiche AttoGiudiziario (Giurisprudenza)

### 4.1 Completezza Campi

| Campo | Count | % |
|-------|-------|---|
| numero_sentenza | 9,771 | 99.96% |
| anno | 9,771 | 99.96% |
| massima (testo) | 9,775 | 100.0% |
| organo_emittente | 9,775 | 100.0% |
| estremi | 9,775 | 100.0% |
| materia | 9,775 | 100.0% |

### 4.2 Distribuzione per Anno (Top 15)

```
2025:  291 █████████
2024:  246 ████████
2023:  256 ████████
2022:  282 █████████
2021:  276 █████████
2020:  242 ████████
2019:  298 █████████
2018:  369 ████████████
2017:  281 █████████
2016:  268 ████████
2015:  181 ██████
2014:  242 ████████
2013:  265 ████████
2012:  175 █████
2011:  282 █████████
```

### 4.3 Distribuzione per Organo

| Organo | Count | % |
|--------|-------|---|
| Corte di Cassazione | 9,761 | 99.9% |
| Giurisprudenza (generico) | 14 | 0.1% |

### 4.4 Distribuzione per Materia

| Materia | Count |
|---------|-------|
| Diritto civile | 9,772 |
| Diritto penale | 3 |

---

## 5. Statistiche Dottrina

### 5.1 Distribuzione per Fonte

| Fonte | Count |
|-------|-------|
| Brocardi.it | 1,630 |

### 5.2 Composizione

- **Spiegazioni**: ~887 (1 per articolo)
- **Brocardi (massime latine)**: ~743

---

## 6. Analisi Connettività

### 6.1 Articoli con più Giurisprudenza (Top 10)

```
Art. 1223:  413 ██████████████████████████████████████████████████████████████████████████████████
Art. 2043:  314 ██████████████████████████████████████████████████████████████
Art. 2059:  268 █████████████████████████████████████████████████████
Art. 1176:  191 ██████████████████████████████████████
Art. 1226:  175 ███████████████████████████████████
Art. 1218:  159 ███████████████████████████████
Art. 1227:  134 ██████████████████████████
Art. 1224:  128 █████████████████████████
Art. 1453:  120 ████████████████████████
Art. 2051:  120 ████████████████████████
```

**Osservazione**: Gli articoli più citati sono quelli fondamentali delle obbligazioni:
- Art. 1223: Risarcimento del danno
- Art. 2043: Responsabilità extracontrattuale
- Art. 2059: Danni non patrimoniali
- Art. 1453: Risoluzione per inadempimento

### 6.2 Statistiche Relazioni :interpreta

| Metrica | Valore |
|---------|--------|
| Min relazioni per articolo | 1 |
| Max relazioni per articolo | 413 |
| **Media relazioni per articolo** | **16.2** |

---

## 7. Analisi Temporale Giurisprudenza

| Metrica | Valore |
|---------|--------|
| Anno più vecchio | 1952 |
| Anno più recente | 2025 |
| **Copertura temporale** | **73 anni** |

### 7.1 Distribuzione per Decennio

```
1950s:     1
1960s:    53 █
1970s:   704 ██████████████
1980s:   743 ██████████████
1990s: 1,704 ██████████████████████████████████
2000s: 2,412 ████████████████████████████████████████████████
2010s: 2,561 ███████████████████████████████████████████████████
2020s: 1,593 ███████████████████████████████
```

**Osservazione**: Crescita esponenziale dal 1970 ad oggi, con picco negli anni 2010.

---

## 8. Sample Data

### 8.1 Sample Massime per Art. 1453

**[1] Cass. civ. n. 15659/2011**
> In tema di prova dell'inadempimento di una obbligazione, il creditore che agisca per la risoluzione contrattuale, per il...

**[2] Cass. civ. n. 6553/1981**
> Ai sensi dell'art. 1184 c.c., il termine per l'adempimento dell'obbligazione si presume stabilito a favore del debitore,...

**[3] Cass. civ. n. 20/1987**
> L'accettazione, da parte del creditore, dell'adempimento parziale — che, a norma dell'art. 1181 c.c., egli avrebbe potut...

### 8.2 Sample Dottrina per Art. 1453

**[1] Ratio Art. 1453 c.c.**
> Se il contratto è a prestazioni corrispettive, ciascuna di esse trova giustificazione nell'altra, per cui il venir meno...

**[2] Spiegazione Art. 1453 c.c.**
> L'azione di risoluzione. Legittimazione attiva e passiva. Due punti devono subito essere messi in evidenza...

---

## 9. Quality Metrics

| Check | Risultato |
|-------|-----------|
| node_id duplicati | **0** |
| 'unknown' residui | **0** |
| AttoGiudiziario orfani | **0** |
| Dottrina orfani | **0** |

---

## 10. Summary Table

```
┌─────────────────────────────────────────────────────────────────┐
│                    MERL-T GRAPH SUMMARY                         │
│                    Libro IV Codice Civile                       │
├─────────────────────────────────────────────────────────────────┤
│  NODI                                                           │
│    Totale:                               12,410                 │
│    Norma:                                 1,005                 │
│    Dottrina:                              1,630                 │
│    AttoGiudiziario:                       9,775                 │
├─────────────────────────────────────────────────────────────────┤
│  RELAZIONI                                                      │
│    Totale:                               14,703                 │
│    :contiene (gerarchia):                 1,891                 │
│    :commenta (dottrina):                  1,630                 │
│    :interpreta (giurisprud.):            11,182                 │
│    :cita (riferimenti):                       0                 │
├─────────────────────────────────────────────────────────────────┤
│  QUALITÀ DATI                                                   │
│    Massime con numero valido:              99.96%               │
│    Massime con anno:                       99.96%               │
│    Massime con testo:                     100.00%               │
│    'unknown' residui:                           0               │
├─────────────────────────────────────────────────────────────────┤
│  COPERTURA                                                      │
│    Articoli processati:                        887              │
│    Range anni giurisprudenza:           1952-2025              │
└─────────────────────────────────────────────────────────────────┘
```

---

## 11. Confronto Pre/Post Fix Massime

| Metrica | Pre-Fix | Post-Fix | Δ |
|---------|---------|----------|---|
| AttoGiudiziario | 827 | **9,775** | +1,082% |
| Con numero valido | 0 | 9,771 | +∞ |
| Con anno | 0 | 9,771 | +∞ |
| Con massima | ~400 | 9,775 | +2,344% |
| 'unknown' | 827 | **0** | -100% |
| :interpreta | 23,056 | 11,182 | -51% (dedup) |

**Note**: La riduzione delle relazioni è dovuta alla corretta deduplicazione. Prima ogni massima con `unknown_NNN` era un nodo separato; ora le stesse sentenze citate da più articoli sono deduplicate correttamente.

---

*Report generato automaticamente - EXP-001 Run 5 (Post-Fix)*
