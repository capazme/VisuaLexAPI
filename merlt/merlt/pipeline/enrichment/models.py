"""
Enrichment Models
=================

Dataclass per la pipeline di enrichment.

Contenuti:
- EntityType: Enum dei tipi di entità estraibili
- EnrichmentContent: Contenuto da processare (fonte)
- ExtractedEntity: Entità estratta da LLM
- ExtractedRelation: Relazione estratta da LLM
- LinkedEntity: Entità dopo linking/dedup
- EnrichmentResult: Risultato finale pipeline
"""

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional


class EntityType(Enum):
    """
    Tipi di entità nel Knowledge Graph MERL-T (23 tipi).

    Tutti i tipi sono potenzialmente estraibili da LLM.
    Se l'LLM incontra un riferimento nuovo (es. Direttiva UE),
    può creare uno stub da arricchire successivamente.

    Allineato a: docs/archive/02-methodology/knowledge-graph.md
    """

    # ─────────────────────────────────────────────────────────────────────────
    # FONTI NORMATIVE
    # ─────────────────────────────────────────────────────────────────────────
    NORMA = "norma"
    VERSIONE = "versione"
    DIRETTIVA_UE = "direttiva_ue"
    REGOLAMENTO_UE = "regolamento_ue"

    # ─────────────────────────────────────────────────────────────────────────
    # STRUTTURA TESTUALE
    # ─────────────────────────────────────────────────────────────────────────
    COMMA = "comma"
    LETTERA = "lettera"
    NUMERO = "numero"
    DEFINIZIONE = "definizione"  # Alias breve
    DEFINIZIONE_LEGALE = "definizione_legale"  # Alias completo

    # ─────────────────────────────────────────────────────────────────────────
    # GIURISPRUDENZA E DOTTRINA
    # ─────────────────────────────────────────────────────────────────────────
    ATTO_GIUDIZIARIO = "atto_giudiziario"
    CASO = "caso"
    DOTTRINA = "dottrina"
    PRECEDENTE = "precedente"  # Massime giurisprudenziali (Cass., Corte Cost., etc.)
    BROCARDO = "brocardo"  # Massime latine (Pacta sunt servanda, etc.)

    # ─────────────────────────────────────────────────────────────────────────
    # SOGGETTI E RUOLI
    # ─────────────────────────────────────────────────────────────────────────
    SOGGETTO_GIURIDICO = "soggetto_giuridico"
    RUOLO_GIURIDICO = "ruolo_giuridico"
    ORGANO = "organo"

    # ─────────────────────────────────────────────────────────────────────────
    # CONCETTI GIURIDICI
    # ─────────────────────────────────────────────────────────────────────────
    CONCETTO = "concetto"
    PRINCIPIO = "principio"
    DIRITTO_SOGGETTIVO = "diritto_soggettivo"
    INTERESSE_LEGITTIMO = "interesse_legittimo"
    RESPONSABILITA = "responsabilita"

    # ─────────────────────────────────────────────────────────────────────────
    # DINAMICHE
    # ─────────────────────────────────────────────────────────────────────────
    FATTO_GIURIDICO = "fatto_giuridico"
    PROCEDURA = "procedura"
    SANZIONE = "sanzione"
    TERMINE = "termine"

    # ─────────────────────────────────────────────────────────────────────────
    # LOGICA E REASONING
    # ─────────────────────────────────────────────────────────────────────────
    REGOLA = "regola"
    PROPOSIZIONE = "proposizione"
    MODALITA_GIURIDICA = "modalita_giuridica"


class RelationType(Enum):
    """
    Tipi di relazioni nel Knowledge Graph (65 tipi).

    Allineato a docs/archive/02-methodology/knowledge-graph.md
    Schema LKIF-compliant con 65 relazioni organizzate in 11 categorie.
    """

    # ─────────────────────────────────────────────────────────────────────────
    # RELAZIONI STRUTTURALI (5)
    # ─────────────────────────────────────────────────────────────────────────
    CONTIENE = "CONTIENE"  # Norma contiene Comma, Comma contiene Lettera
    PARTE_DI = "PARTE_DI"  # Inverso di contiene
    VERSIONE_PRECEDENTE = "VERSIONE_PRECEDENTE"  # Versione → Versione precedente
    VERSIONE_SUCCESSIVA = "VERSIONE_SUCCESSIVA"  # Versione → Versione successiva
    HA_VERSIONE = "HA_VERSIONE"  # Norma → Versione

    # ─────────────────────────────────────────────────────────────────────────
    # RELAZIONI DI MODIFICA (9)
    # ─────────────────────────────────────────────────────────────────────────
    SOSTITUISCE = "SOSTITUISCE"  # Sostituzione testuale completa
    INSERISCE = "INSERISCE"  # Aggiunta senza rimozione
    ABROGA_TOTALMENTE = "ABROGA_TOTALMENTE"  # Abrogazione completa
    ABROGA_PARZIALMENTE = "ABROGA_PARZIALMENTE"  # Abrogazione di clausole
    SOSPENDE = "SOSPENDE"  # Sospensione temporanea efficacia
    PROROGA = "PROROGA"  # Estensione termini/validità
    INTEGRA = "INTEGRA"  # Integrazione senza sostituzione
    DEROGA_A = "DEROGA_A"  # Eccezione senza modifica testo
    CONSOLIDA = "CONSOLIDA"  # Testo unico da norme sparse

    # ─────────────────────────────────────────────────────────────────────────
    # RELAZIONI SEMANTICHE (7)
    # ─────────────────────────────────────────────────────────────────────────
    DISCIPLINA = "DISCIPLINA"  # Norma disciplina Concetto
    APPLICA = "APPLICA"  # Brocardo/Principio si applica ad Articolo
    APPLICA_A = "APPLICA_A"  # Norma si applica a Soggetto
    DEFINISCE = "DEFINISCE"  # Norma definisce termine legale
    PREVEDE_SANZIONE = "PREVEDE_SANZIONE"  # Norma prevede Sanzione
    STABILISCE_TERMINE = "STABILISCE_TERMINE"  # Norma stabilisce Termine
    PREVEDE = "PREVEDE"  # Norma prevede Procedura

    # ─────────────────────────────────────────────────────────────────────────
    # RELAZIONI DI DIPENDENZA (3)
    # ─────────────────────────────────────────────────────────────────────────
    DIPENDE_DA = "DIPENDE_DA"  # Dipendenza logica tra norme
    PRESUPPONE = "PRESUPPONE"  # Prerequisito implicito
    SPECIES = "SPECIES"  # Relazione gerarchica is-a

    # ─────────────────────────────────────────────────────────────────────────
    # RELAZIONI CITAZIONE/INTERPRETAZIONE (3)
    # ─────────────────────────────────────────────────────────────────────────
    CITA = "CITA"  # Citazione esplicita
    INTERPRETA = "INTERPRETA"  # Interpretazione giudiziaria/dottrinale
    COMMENTA = "COMMENTA"  # Commento dottrinale

    # ─────────────────────────────────────────────────────────────────────────
    # RELAZIONI EUROPEE (3)
    # ─────────────────────────────────────────────────────────────────────────
    ATTUA = "ATTUA"  # Norma nazionale attua direttiva UE
    RECEPISCE = "RECEPISCE"  # Recepimento specifico direttiva
    CONFORME_A = "CONFORME_A"  # Conformità a standard UE

    # ─────────────────────────────────────────────────────────────────────────
    # RELAZIONI ISTITUZIONALI (3)
    # ─────────────────────────────────────────────────────────────────────────
    EMESSO_DA = "EMESSO_DA"  # Atto emesso da Organo
    HA_COMPETENZA_SU = "HA_COMPETENZA_SU"  # Organo ha competenza su materia
    GERARCHICAMENTE_SUPERIORE = "GERARCHICAMENTE_SUPERIORE"  # Gerarchia organi

    # ─────────────────────────────────────────────────────────────────────────
    # RELAZIONI CASE-BASED (3)
    # ─────────────────────────────────────────────────────────────────────────
    RIGUARDA = "RIGUARDA"  # Atto riguarda Soggetto/Caso
    APPLICA_NORMA_A_CASO = "APPLICA_NORMA_A_CASO"  # Applicazione giudiziaria
    PRECEDENTE_DI = "PRECEDENTE_DI"  # Precedente giurisprudenziale

    # ─────────────────────────────────────────────────────────────────────────
    # RELAZIONI CLASSIFICAZIONE (2)
    # ─────────────────────────────────────────────────────────────────────────
    FONTE = "FONTE"  # Norma ha fonte documento/codice
    CLASSIFICA_IN = "CLASSIFICA_IN"  # Classificazione tematica (EuroVoc)

    # ─────────────────────────────────────────────────────────────────────────
    # RELAZIONI LKIF - MODALITÀ E REASONING (28)
    # ─────────────────────────────────────────────────────────────────────────
    IMPONE = "IMPONE"  # Norma impone obbligo/divieto/permesso
    CONFERISCE = "CONFERISCE"  # Norma conferisce diritto/potere
    TITOLARE_DI = "TITOLARE_DI"  # Soggetto titolare di diritto/obbligo
    RIVESTE_RUOLO = "RIVESTE_RUOLO"  # Soggetto assume ruolo giuridico
    ATTRIBUISCE_RESPONSABILITA = "ATTRIBUISCE_RESPONSABILITA"  # Attribuzione responsabilità
    RESPONSABILE_PER = "RESPONSABILE_PER"  # Soggetto responsabile per
    ESPRIME_PRINCIPIO = "ESPRIME_PRINCIPIO"  # Norma esprime principio
    CONFORMA_A = "CONFORMA_A"  # Conformità a principio
    DEROGA_PRINCIPIO = "DEROGA_PRINCIPIO"  # Deroga eccezionale a principio
    BILANCIA_CON = "BILANCIA_CON"  # Bilanciamento tra principi
    PRODUCE_EFFETTO = "PRODUCE_EFFETTO"  # Fatto produce effetto giuridico
    PRESUPPOSTO_DI = "PRESUPPOSTO_DI"  # Fatto è presupposto per effetto
    COSTITUTIVO_DI = "COSTITUTIVO_DI"  # Fatto costituisce rapporto/status
    ESTINGUE = "ESTINGUE"  # Fatto estingue diritto/obbligo
    MODIFICA_EFFICACIA = "MODIFICA_EFFICACIA"  # Fatto modifica efficacia
    APPLICA_REGOLA = "APPLICA_REGOLA"  # Atto giudiziario applica regola
    IMPLICA = "IMPLICA"  # Implicazione logica
    CONTRADICE = "CONTRADICE"  # Contraddizione tra proposizioni
    GIUSTIFICA = "GIUSTIFICA"  # Giustificazione/reasoning
    LIMITA = "LIMITA"  # Limitazione di diritti/poteri
    TUTELA = "TUTELA"  # Norma/Procedura tutela diritto
    VIOLA = "VIOLA"  # Fatto viola norma/diritto
    COMPATIBILE_CON = "COMPATIBILE_CON"  # Compatibilità tra norme/principi
    INCOMPATIBILE_CON = "INCOMPATIBILE_CON"  # Incompatibilità
    SPECIFICA = "SPECIFICA"  # Specificazione astratto → concreto
    ESEMPLIFICA = "ESEMPLIFICA"  # Caso esemplifica concetto
    CAUSA_DI = "CAUSA_DI"  # Causalità tra fatti
    CONDIZIONE_DI = "CONDIZIONE_DI"  # Condizione sospensiva/risolutiva

    # ─────────────────────────────────────────────────────────────────────────
    # RELAZIONE GENERICA (fallback)
    # ─────────────────────────────────────────────────────────────────────────
    CORRELATO = "CORRELATO"  # Relazione generica non classificata


@dataclass
class EnrichmentContent:
    """
    Contenuto da processare per estrazione entità.

    Rappresenta un chunk di testo proveniente da una fonte
    (Brocardi, manuale, etc.) pronto per l'estrazione LLM.

    Attributes:
        id: Identificativo unico (es. "brocardi:1337:spiegazione")
        text: Testo da cui estrarre entità
        article_refs: URN degli articoli citati/correlati
        source: Nome della fonte (es. "brocardi", "manuale:Torrente")
        content_type: Tipo di contenuto (spiegazione, ratio, capitolo)
        metadata: Metadata aggiuntivi dalla fonte
    """
    id: str
    text: str
    article_refs: List[str]
    source: str
    content_type: str = ""
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ExtractedEntity:
    """
    Entità estratta da LLM.

    Rappresenta un concetto, principio o definizione identificato
    dall'LLM nel testo di input.

    Attributes:
        nome: Nome dell'entità (es. "buona fede")
        tipo: Tipo di entità (concetto, principio, definizione)
        descrizione: Descrizione/definizione estratta
        articoli_correlati: Articoli del codice menzionati
        ambito: Ambito giuridico (es. "diritto_civile", "obbligazioni")
        fonte: Fonte da cui è stata estratta
        confidence: Confidenza dell'estrazione (0.0-1.0)
        raw_context: Contesto originale da cui è stata estratta
    """
    nome: str
    tipo: EntityType
    descrizione: str = ""
    articoli_correlati: List[str] = field(default_factory=list)
    ambito: str = "diritto_civile"
    fonte: str = ""
    confidence: float = 1.0
    raw_context: str = ""

    @property
    def normalized_nome(self) -> str:
        """Nome normalizzato per deduplicazione."""
        return self.nome.lower().strip().replace(" ", "_")

    @property
    def node_id(self) -> str:
        """ID del nodo nel grafo."""
        return f"{self.tipo.value}:{self.normalized_nome}"


@dataclass
class ExtractedRelation:
    """
    Relazione estratta da LLM.

    Rappresenta una relazione tra entità o tra entità e norme
    identificata dall'LLM.

    Attributes:
        source_id: ID dell'entità/nodo sorgente
        target_id: ID dell'entità/nodo target
        relation_type: Tipo di relazione
        fonte: Fonte da cui è stata estratta
        confidence: Confidenza dell'estrazione
    """
    source_id: str
    target_id: str
    relation_type: RelationType
    fonte: str = ""
    confidence: float = 1.0


@dataclass
class LinkedEntity:
    """
    Entità dopo il processo di linking/dedup.

    Contiene le informazioni finali pronte per la scrittura
    nel grafo, incluso il flag se è nuova o merge.

    Attributes:
        entity: Entità estratta originale
        node_id: ID finale del nodo nel grafo
        is_new: True se è un nuovo nodo, False se merge
        merged_from: Lista fonti se è un merge
        final_descrizione: Descrizione finale (dopo merge)
    """
    entity: ExtractedEntity
    node_id: str
    is_new: bool = True
    merged_from: List[str] = field(default_factory=list)
    final_descrizione: str = ""

    def __post_init__(self):
        if not self.final_descrizione:
            self.final_descrizione = self.entity.descrizione


@dataclass
class EnrichmentStats:
    """
    Statistiche di un'esecuzione di enrichment.

    Traccia tutte le 23 tipologie di entità del Knowledge Graph.
    Usa dizionari dinamici per supportare tutti i tipi di EntityType.
    """

    # Contatori dinamici per tipo (entity_type.value → count)
    entities_created: Dict[str, int] = field(default_factory=dict)
    entities_merged: Dict[str, int] = field(default_factory=dict)

    # Relazioni
    relations_created: int = 0

    # Errori
    extraction_errors: int = 0
    linking_errors: int = 0
    write_errors: int = 0

    def increment(self, entity_type: str, created: bool = True) -> None:
        """
        Incrementa il contatore per un tipo di entità.

        Args:
            entity_type: Valore EntityType.value (es. "concetto", "norma")
            created: True per created, False per merged
        """
        target = self.entities_created if created else self.entities_merged
        target[entity_type] = target.get(entity_type, 0) + 1

    def get_count(self, entity_type: str, created: bool = True) -> int:
        """Restituisce il contatore per un tipo di entità."""
        target = self.entities_created if created else self.entities_merged
        return target.get(entity_type, 0)

    @property
    def total_entities_created(self) -> int:
        """Totale entità create (tutte le tipologie)."""
        return sum(self.entities_created.values())

    @property
    def total_entities_merged(self) -> int:
        """Totale entità merge (dedup)."""
        return sum(self.entities_merged.values())

    @property
    def total_errors(self) -> int:
        """Totale errori."""
        return self.extraction_errors + self.linking_errors + self.write_errors

    def by_category(self, category: str) -> Dict[str, int]:
        """
        Restituisce contatori per categoria.

        Categories: fonti_normative, struttura_testuale, giurisprudenza,
                   soggetti_ruoli, concetti, dinamiche, logica
        """
        categories = {
            "fonti_normative": ["norma", "versione", "direttiva_ue", "regolamento_ue"],
            "struttura_testuale": ["comma", "lettera", "numero", "definizione_legale"],
            "giurisprudenza": ["atto_giudiziario", "caso", "dottrina"],
            "soggetti_ruoli": ["soggetto_giuridico", "ruolo_giuridico", "organo"],
            "concetti": ["concetto", "principio", "diritto_soggettivo", "interesse_legittimo", "responsabilita"],
            "dinamiche": ["fatto_giuridico", "procedura", "sanzione", "termine"],
            "logica": ["regola", "proposizione", "modalita_giuridica"],
        }

        types_in_category = categories.get(category, [])
        return {t: self.entities_created.get(t, 0) for t in types_in_category}


@dataclass
class EnrichmentError:
    """Errore durante enrichment."""

    content_id: str
    phase: str  # "extraction", "linking", "writing"
    error_type: str
    error_message: str
    timestamp: datetime = field(default_factory=datetime.now)
    recoverable: bool = True


@dataclass
class EnrichmentResult:
    """
    Risultato finale di una pipeline di enrichment.

    Contiene statistiche, errori e informazioni sulle entità create.

    Example:
        >>> result = await kg.enrich(config)
        >>> print(f"Creati {result.stats.total_entities_created} entità")
        >>> if result.errors:
        ...     print(f"Con {len(result.errors)} errori")
    """

    # Statistiche
    stats: EnrichmentStats = field(default_factory=EnrichmentStats)

    # Errori
    errors: List[EnrichmentError] = field(default_factory=list)

    # Tracking
    contents_processed: int = 0
    contents_skipped: int = 0  # Già processati (checkpoint)

    # Timing
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None

    # Dettagli (per debug)
    entities_created: List[str] = field(default_factory=list)

    @property
    def success(self) -> bool:
        """True se completato senza errori critici."""
        return self.stats.total_errors == 0

    @property
    def duration_seconds(self) -> Optional[float]:
        """Durata in secondi."""
        if self.started_at and self.completed_at:
            return (self.completed_at - self.started_at).total_seconds()
        return None

    def add_error(
        self,
        content_id: str,
        phase: str,
        error: Exception
    ) -> None:
        """Aggiungi un errore al risultato."""
        self.errors.append(EnrichmentError(
            content_id=content_id,
            phase=phase,
            error_type=type(error).__name__,
            error_message=str(error),
        ))

        # Aggiorna contatori
        if phase == "extraction":
            self.stats.extraction_errors += 1
        elif phase == "linking":
            self.stats.linking_errors += 1
        elif phase == "writing":
            self.stats.write_errors += 1

    def summary(self) -> str:
        """Restituisce un riepilogo testuale con tutte le 23 tipologie."""
        s = self.stats
        lines = [
            "═" * 60,
            "ENRICHMENT RESULT",
            "═" * 60,
            f"Contents processati: {self.contents_processed}",
            f"Contents skippati: {self.contents_skipped}",
            "",
        ]

        # Categorie dal knowledge-graph.md
        categories = [
            ("FONTI NORMATIVE", ["norma", "versione", "direttiva_ue", "regolamento_ue"]),
            ("STRUTTURA TESTUALE", ["comma", "lettera", "numero", "definizione_legale"]),
            ("GIURISPRUDENZA/DOTTRINA", ["atto_giudiziario", "caso", "dottrina"]),
            ("SOGGETTI/RUOLI", ["soggetto_giuridico", "ruolo_giuridico", "organo"]),
            ("CONCETTI GIURIDICI", ["concetto", "principio", "diritto_soggettivo", "interesse_legittimo", "responsabilita"]),
            ("DINAMICHE", ["fatto_giuridico", "procedura", "sanzione", "termine"]),
            ("LOGICA/REASONING", ["regola", "proposizione", "modalita_giuridica"]),
        ]

        for cat_name, types in categories:
            cat_total = sum(s.get_count(t) for t in types)
            if cat_total > 0:
                lines.append(f"─ {cat_name}:")
                for t in types:
                    created = s.get_count(t, created=True)
                    merged = s.get_count(t, created=False)
                    if created > 0 or merged > 0:
                        lines.append(f"  {t:<20} {created:>4} (+{merged} merge)")
                lines.append("")

        lines.extend([
            "─" * 60,
            f"TOTALE ENTITÀ: {s.total_entities_created} create, {s.total_entities_merged} merge",
            f"Relazioni:     {s.relations_created}",
            "─" * 60,
        ])

        if self.errors:
            lines.extend([
                f"ERRORI: {len(self.errors)}",
                *[f"  - [{e.phase}] {e.content_id}: {e.error_message}"
                  for e in self.errors[:5]],
            ])
            if len(self.errors) > 5:
                lines.append(f"  ... e altri {len(self.errors) - 5}")
        else:
            lines.append("Nessun errore ✓")

        if self.duration_seconds:
            lines.append(f"\nDurata: {self.duration_seconds:.1f}s")

        lines.append("═" * 60)
        return "\n".join(lines)
