"""
Manual Enrichment Source
========================

Fonte di enrichment che estrae contenuti da manuali PDF.

Utilizza PyMuPDF (fitz) per il parsing PDF e chunking intelligente
basato sulla struttura del documento.

Esempio:
    from merlt.pipeline.enrichment.sources import ManualSource

    source = ManualSource(
        path="data/manuali/libro_iv/",
        manual_name="Torrente",
    )
    async for content in source.fetch(scope):
        print(f"Capitolo: {content.metadata.get('chapter')}")
"""

import logging
import re
from pathlib import Path
from typing import AsyncIterator, Dict, List, Optional, Any

from merlt.pipeline.enrichment.models import EnrichmentContent
from merlt.pipeline.enrichment.sources.base import BaseEnrichmentSource

logger = logging.getLogger(__name__)


# Pattern per identificare riferimenti ad articoli del codice civile
ARTICLE_PATTERN = re.compile(
    r'(?:art\.?|articol[oi])\s*(\d+(?:\s*[-–]\s*\d+)?(?:\s*(?:e|,)\s*\d+)*)',
    re.IGNORECASE
)

# Pattern per titoli di sezione
SECTION_PATTERNS = [
    re.compile(r'^(?:CAPITOLO|CAP\.?)\s+[IVXLCDM\d]+', re.IGNORECASE | re.MULTILINE),
    re.compile(r'^(?:SEZIONE|SEZ\.?)\s+[IVXLCDM\d]+', re.IGNORECASE | re.MULTILINE),
    re.compile(r'^\d+\.\s+[A-Z]', re.MULTILINE),  # "1. Titolo"
    re.compile(r'^[IVXLCDM]+\.\s+[A-Z]', re.MULTILINE),  # "I. Titolo"
]


class ManualEnrichmentSource(BaseEnrichmentSource):
    """
    Fonte di enrichment da manuali PDF.

    Estrae capitoli/sezioni da PDF e identifica articoli citati
    per il linking con il backbone del grafo.

    Attributes:
        path: Path alla directory contenente i PDF
        manual_name: Nome del manuale (per tracking)
        act_type: Tipo di atto giuridico (es. "codice civile", "codice penale")
        chunk_size: Dimensione target dei chunk in caratteri
        overlap: Sovrapposizione tra chunk

    Example:
        >>> source = ManualSource("data/manuali/libro_iv/", "Torrente", act_type="codice civile")
        >>> async for content in source.fetch():
        ...     print(f"Articoli citati: {content.article_refs}")
    """

    def __init__(
        self,
        path: str,
        manual_name: str = "unknown",
        act_type: str = "codice civile",
        chunk_size: int = 4000,
        overlap: int = 200,
        phase: int = 2,
    ):
        """
        Inizializza la fonte manuale.

        Args:
            path: Path alla directory con i PDF
            manual_name: Nome del manuale per identificazione
            act_type: Tipo di atto (es. "codice civile", "codice penale")
            chunk_size: Dimensione target chunk in caratteri
            overlap: Caratteri di sovrapposizione tra chunk
            phase: Fase di esecuzione (default: 2, arricchimento)
        """
        super().__init__(phase=phase)
        self.path = Path(path)
        self.manual_name = manual_name
        self.act_type = act_type
        self.chunk_size = chunk_size
        self.overlap = overlap
        self._fitz = None

    @property
    def source_name(self) -> str:
        return f"manuale:{self.manual_name}"

    async def initialize(self) -> None:
        """Importa PyMuPDF (fitz) se disponibile."""
        if not self._initialized:
            try:
                import fitz
                self._fitz = fitz
                logger.info(f"ManualEnrichmentSource inizializzato: {self.path}")
            except ImportError:
                logger.warning(
                    "PyMuPDF non installato. Installa con: pip install pymupdf"
                )
                raise ImportError(
                    "PyMuPDF richiesto per ManualEnrichmentSource. "
                    "Installa con: pip install pymupdf"
                )
            self._initialized = True

    async def fetch(
        self,
        scope: Optional["EnrichmentScope"] = None
    ) -> AsyncIterator[EnrichmentContent]:
        """
        Estrae contenuti dai PDF nella directory.

        Processa ogni PDF, chunka il testo e identifica articoli citati.

        Args:
            scope: Filtro opzionale (non usato per manual source)

        Yields:
            EnrichmentContent per ogni chunk estratto
        """
        # Inizializza lazy
        if not self._initialized:
            await self.initialize()

        # Trova PDF: supporta sia file singolo che directory
        if self.path.is_file() and self.path.suffix.lower() == ".pdf":
            # Path è un file PDF singolo
            pdf_files = [self.path]
        elif self.path.is_dir():
            # Path è una directory, cerca tutti i PDF
            pdf_files = list(self.path.glob("*.pdf"))
        else:
            pdf_files = []

        if not pdf_files:
            logger.warning(f"Nessun PDF trovato in: {self.path}")
            return

        logger.info(f"Trovati {len(pdf_files)} PDF")

        for pdf_path in pdf_files:
            try:
                async for content in self._process_pdf(pdf_path, scope):
                    yield content
            except Exception as e:
                logger.error(f"Errore processing {pdf_path}: {e}")
                continue

    async def _process_pdf(
        self,
        pdf_path: Path,
        scope: Optional["EnrichmentScope"]
    ) -> AsyncIterator[EnrichmentContent]:
        """
        Processa un singolo PDF.

        Args:
            pdf_path: Path al file PDF
            scope: Filtro scope

        Yields:
            EnrichmentContent per ogni chunk
        """
        logger.info(f"Processing PDF: {pdf_path.name}")

        doc = self._fitz.open(pdf_path)
        pdf_name = pdf_path.stem

        try:
            # Estrai testo con metadata pagine
            full_text = ""
            page_map = []  # [(start_char, page_num)]

            for page_num in range(len(doc)):
                page = doc[page_num]
                page_text = page.get_text()

                if page_text:
                    page_map.append((len(full_text), page_num + 1))
                    full_text += page_text + "\n\n"

            if not full_text.strip():
                logger.warning(f"PDF vuoto: {pdf_path}")
                return

            # Chunk il testo
            chunks = self._chunk_text(full_text)
            logger.info(f"Creati {len(chunks)} chunk da {pdf_path.name}")

            for idx, (chunk_text, start_pos) in enumerate(chunks):
                # Estrai articoli citati
                article_refs = self._extract_article_refs(chunk_text)

                # Filtra per scope se specificato
                if scope and article_refs:
                    article_refs = [
                        ref for ref in article_refs
                        if self._ref_matches_scope(ref, scope)
                    ]

                # Se scope è definito e nessun articolo matcha, skip
                if scope and scope.articoli and not article_refs:
                    continue

                # Determina pagina
                page_num = self._get_page_for_position(start_pos, page_map)

                yield EnrichmentContent(
                    id=f"manual:{pdf_name}:chunk_{idx}",
                    text=chunk_text,
                    article_refs=article_refs,
                    source=self.source_name,
                    content_type="capitolo",
                    metadata={
                        "pdf_name": pdf_name,
                        "chunk_index": idx,
                        "page_num": page_num,
                        "char_start": start_pos,
                        "manual_name": self.manual_name,
                    }
                )

        finally:
            doc.close()

    def _chunk_text(self, text: str) -> List[tuple]:
        """
        Chunka il testo rispettando la struttura.

        Prova a dividere su confini di sezione, altrimenti su paragrafi.

        Args:
            text: Testo completo

        Returns:
            Lista di (chunk_text, start_position)
        """
        chunks = []
        current_pos = 0

        while current_pos < len(text):
            # Determina fine chunk
            end_pos = min(current_pos + self.chunk_size, len(text))

            # Se non siamo alla fine, cerca un punto di taglio migliore
            if end_pos < len(text):
                # Cerca fine sezione
                section_break = self._find_section_break(
                    text, current_pos, end_pos
                )
                if section_break:
                    end_pos = section_break
                else:
                    # Fallback: fine paragrafo
                    para_break = text.rfind('\n\n', current_pos, end_pos)
                    if para_break > current_pos + self.chunk_size // 2:
                        end_pos = para_break + 2

            chunk_text = text[current_pos:end_pos].strip()
            if chunk_text:
                chunks.append((chunk_text, current_pos))

            # Prossimo chunk con overlap
            current_pos = max(current_pos + 1, end_pos - self.overlap)

        return chunks

    def _find_section_break(
        self,
        text: str,
        start: int,
        end: int
    ) -> Optional[int]:
        """Trova un confine di sezione nel range."""
        search_text = text[start:end]

        for pattern in SECTION_PATTERNS:
            matches = list(pattern.finditer(search_text))
            if matches:
                # Prendi l'ultimo match nel range
                last_match = matches[-1]
                break_pos = start + last_match.start()
                # Assicurati che non sia troppo vicino all'inizio
                if break_pos > start + self.chunk_size // 3:
                    return break_pos

        return None

    def _extract_article_refs(self, text: str) -> List[str]:
        """
        Estrae riferimenti ad articoli dal testo.

        Args:
            text: Testo da analizzare

        Returns:
            Lista di URN per articoli trovati
        """
        urns = []
        seen = set()

        for match in ARTICLE_PATTERN.finditer(text):
            art_nums = match.group(1)

            # Gestisci range (es. "1337-1339")
            if '-' in art_nums or '–' in art_nums:
                parts = re.split(r'[-–]', art_nums)
                if len(parts) == 2:
                    try:
                        start = int(parts[0].strip())
                        end = int(parts[1].strip())
                        for n in range(start, end + 1):
                            if n not in seen:
                                seen.add(n)
                                urns.append(self._article_to_urn(n))
                    except ValueError:
                        continue

            # Gestisci liste (es. "1337, 1338 e 1339")
            else:
                nums = re.findall(r'\d+', art_nums)
                for num_str in nums:
                    try:
                        n = int(num_str)
                        if n not in seen and 1 <= n <= 3000:  # Range plausibile CC
                            seen.add(n)
                            urns.append(self._article_to_urn(n))
                    except ValueError:
                        continue

        return urns

    def _article_to_urn(self, article_num: int) -> str:
        """
        Converte numero articolo in URN usando generate_urn.

        Supporta qualsiasi tipo di atto configurato (codice civile, penale, ecc.)
        """
        from merlt.utils.urngenerator import generate_urn
        return generate_urn(self.act_type, article=str(article_num))

    def _ref_matches_scope(
        self,
        urn: str,
        scope: "EnrichmentScope"
    ) -> bool:
        """Verifica se un URN matcha lo scope."""
        try:
            if "~art" in urn:
                art_num = int(urn.split("~art")[-1])
                return scope.matches_article(art_num)
        except (ValueError, IndexError):
            pass
        return True

    def _get_page_for_position(
        self,
        pos: int,
        page_map: List[tuple]
    ) -> int:
        """Determina la pagina per una posizione carattere."""
        for i, (start_char, page_num) in enumerate(page_map):
            if i + 1 < len(page_map):
                if start_char <= pos < page_map[i + 1][0]:
                    return page_num
            else:
                return page_num
        return 1


# Import qui per evitare circular
from merlt.pipeline.enrichment.config import EnrichmentScope
