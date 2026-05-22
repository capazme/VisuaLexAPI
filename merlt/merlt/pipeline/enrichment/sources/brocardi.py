"""
Brocardi Enrichment Source
==========================

Fonte di enrichment che estrae contenuti da Brocardi.it.

Contenuti estratti:
- Spiegazione dell'articolo
- Ratio legis
- Brocardi (massime latine)
- Relazioni storiche (Guardasigilli)

Riutilizza BrocardiScraper esistente per il fetch.

Esempio:
    from merlt.pipeline.enrichment.sources import BrocardiSource

    source = BrocardiSource()
    async for content in source.fetch(scope):
        print(f"Contenuto: {content.content_type} - {content.id}")
"""

import logging
from typing import AsyncIterator, List, Optional

from merlt.pipeline.enrichment.models import EnrichmentContent
from merlt.pipeline.enrichment.sources.base import BaseEnrichmentSource
from merlt.clients import BrocardiScraper, NormaVisitata, Norma

# TODO: Implement URN generation locally
# from merlt.utils.urngenerator import generate_urn

logger = logging.getLogger(__name__)


class BrocardiEnrichmentSource(BaseEnrichmentSource):
    """
    Fonte di enrichment da Brocardi.it.

    Estrae spiegazioni, ratio, brocardi e relazioni per ogni articolo.

    Attributes:
        _scraper: BrocardiScraper sottostante
        _graph_client: Client per query articoli da grafo (opzionale)
        act_type: Tipo di atto (default: codice civile)

    Example:
        >>> source = BrocardiSource()
        >>> async for content in source.fetch(EnrichmentScope(articoli=(1173, 2059))):
        ...     print(f"Estratto: {content.id}")
    """

    def __init__(
        self,
        graph_client=None,
        act_type: str = "codice civile",
        phase: int = 1,
    ):
        """
        Inizializza la fonte Brocardi.

        Args:
            graph_client: FalkorDBClient per query articoli esistenti (opzionale)
            act_type: Tipo di atto giuridico (default: codice civile)
            phase: Fase di esecuzione (default: 1, fonte primaria)
        """
        super().__init__(phase=phase)
        self._scraper = None
        self._graph_client = graph_client
        self.act_type = act_type

    @property
    def source_name(self) -> str:
        return "brocardi"

    async def initialize(self) -> None:
        """Inizializza lo scraper Brocardi."""
        if not self._initialized:
            self._scraper = BrocardiScraper()
            self._initialized = True
            logger.info("BrocardiEnrichmentSource inizializzato")

    async def fetch(
        self,
        scope: Optional["EnrichmentScope"] = None
    ) -> AsyncIterator[EnrichmentContent]:
        """
        Recupera contenuti da Brocardi per gli articoli nello scope.

        Per ogni articolo estrae:
        - Spiegazione → 1 EnrichmentContent
        - Ratio → 1 EnrichmentContent
        - Brocardi → 1 EnrichmentContent (aggregati)
        - Relazioni → 1 EnrichmentContent per relazione

        Args:
            scope: Filtro articoli (libro, range, URN)

        Yields:
            EnrichmentContent per ogni contenuto trovato
        """
        # Inizializza lazy
        if not self._initialized:
            await self.initialize()

        # Determina articoli da processare
        articles = await self._get_articles_to_process(scope)
        logger.info(f"Brocardi: {len(articles)} articoli da processare")

        for article_num, article_urn in articles:
            try:
                # Crea NormaVisitata per lo scraper
                norma_visitata = self._create_norma_visitata(article_num)

                # Fetch info da Brocardi
                position, info, url = await self._scraper.get_info(norma_visitata)

                if not info:
                    logger.debug(f"Nessuna info Brocardi per art. {article_num}")
                    continue

                # Yield spiegazione
                if info.get('Spiegazione'):
                    yield EnrichmentContent(
                        id=f"brocardi:{article_num}:spiegazione",
                        text=info['Spiegazione'],
                        article_refs=[article_urn],
                        source=self.source_name,
                        content_type="spiegazione",
                        metadata={
                            "position": position,
                            "url": url,
                            "article_num": article_num,
                        }
                    )

                # Yield ratio
                if info.get('Ratio'):
                    yield EnrichmentContent(
                        id=f"brocardi:{article_num}:ratio",
                        text=info['Ratio'],
                        article_refs=[article_urn],
                        source=self.source_name,
                        content_type="ratio",
                        metadata={
                            "position": position,
                            "url": url,
                            "article_num": article_num,
                        }
                    )

                # Yield brocardi (massime latine aggregate)
                if info.get('Brocardi'):
                    brocardi_text = "\n\n".join(info['Brocardi'])
                    yield EnrichmentContent(
                        id=f"brocardi:{article_num}:brocardi",
                        text=brocardi_text,
                        article_refs=[article_urn],
                        source=self.source_name,
                        content_type="brocardo",
                        metadata={
                            "position": position,
                            "url": url,
                            "article_num": article_num,
                            "count": len(info['Brocardi']),
                        }
                    )

                # Yield relazioni storiche
                if info.get('Relazioni'):
                    for idx, rel in enumerate(info['Relazioni']):
                        # Estrai articoli correlati dalle relazioni
                        rel_article_refs = [article_urn]
                        if rel.get('articoli_citati'):
                            for citato in rel['articoli_citati']:
                                num = citato.get('numero', '')
                                if num:
                                    # TODO: Crea URN per articolo citato usando generate_urn locale
                                    # from merlt.utils.urngenerator import generate_urn
                                    # rel_urn = generate_urn(self.act_type, article=str(num))
                                    # if rel_urn:
                                    #     rel_article_refs.append(rel_urn)
                                    pass  # Skip for now

                        yield EnrichmentContent(
                            id=f"brocardi:{article_num}:relazione:{idx}",
                            text=rel.get('testo', ''),
                            article_refs=rel_article_refs,
                            source=self.source_name,
                            content_type=f"relazione_{rel.get('tipo', 'unknown')}",
                            metadata={
                                "position": position,
                                "url": url,
                                "article_num": article_num,
                                "relazione_tipo": rel.get('tipo'),
                                "relazione_titolo": rel.get('titolo'),
                                "numero_paragrafo": rel.get('numero_paragrafo'),
                            }
                        )

            except Exception as e:
                logger.error(f"Errore fetch Brocardi art. {article_num}: {e}")
                continue

    async def _get_articles_to_process(
        self,
        scope: Optional["EnrichmentScope"]
    ) -> List[tuple]:
        """
        Determina gli articoli da processare.

        Se graph_client è disponibile, query il grafo.
        Altrimenti, genera range da scope.

        Returns:
            Lista di (article_num, article_urn)
        """
        # Se abbiamo client grafo, query articoli esistenti
        if self._graph_client:
            return await self._query_articles_from_graph(scope)

        # Altrimenti, genera da scope
        return self._generate_articles_from_scope(scope)

    async def _query_articles_from_graph(
        self,
        scope: Optional["EnrichmentScope"]
    ) -> List[tuple]:
        """Query articoli dal grafo esistente."""
        query = """
            MATCH (n:Norma)
            WHERE n.tipo_atto = 'codice civile'
            RETURN n.numero_articolo as num, n.URN as urn
            ORDER BY toInteger(n.numero_articolo)
        """

        results = await self._graph_client.query(query)
        articles = []

        for row in results:
            num = row.get('num')
            urn = row.get('urn')
            if num and urn:
                # Applica filtro scope
                try:
                    art_num = int(num.replace('-', ''))
                    if scope is None or scope.matches_article(art_num):
                        articles.append((num, urn))
                except ValueError:
                    continue

        return articles

    def _generate_articles_from_scope(
        self,
        scope: Optional["EnrichmentScope"]
    ) -> List[tuple]:
        """Genera lista articoli da scope."""
        # TODO: Implement generate_urn locally
        # For now, generate URN using NormaVisitata
        if scope is None:
            # Default: Libro IV (1173-2059)
            start, end = 1173, 2059
        elif scope.articoli:
            if isinstance(scope.articoli, tuple):
                start, end = scope.articoli
            else:
                # Lista specifica
                return [
                    (str(n), self._create_norma_visitata(str(n)).urn)
                    for n in scope.articoli
                ]
        else:
            start, end = 1173, 2059

        return [
            (str(n), self._create_norma_visitata(str(n)).urn)
            for n in range(start, end + 1)
        ]

    def _create_norma_visitata(self, article_num: str) -> NormaVisitata:
        """Crea NormaVisitata per BrocardiScraper."""
        norma = Norma(
            tipo_atto_str="codice civile",
            data="1942-03-16",
            numero_atto="262"
        )
        return NormaVisitata(
            norma=norma,
            numero_articolo=article_num
        )


# Import qui per evitare circular
from merlt.pipeline.enrichment.config import EnrichmentScope
