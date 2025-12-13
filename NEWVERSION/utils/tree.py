"""
Tree Extractor for Normattiva and EUR-Lex
=========================================

Extracts hierarchical structure of legal norms from Normattiva and EUR-Lex.

Provides two APIs:
- get_tree(): Flat list of articles (backward compatible)
- get_hierarchical_tree(): Full tree structure with Libro/Titolo/Capo/Sezione hierarchy
"""

import asyncio
import aiohttp
from bs4 import BeautifulSoup
import structlog
import re
from aiocache import cached
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any, Tuple, Union
from enum import Enum

# Configurazione del logging
log = structlog.get_logger()


# =============================================================================
# Dataclasses for Hierarchical Tree Structure
# =============================================================================

class NormLevel(Enum):
    """Level types in Italian legal norm hierarchy."""
    ALLEGATO = "allegato"
    LIBRO = "libro"
    TITOLO = "titolo"
    CAPO = "capo"
    SEZIONE = "sezione"
    PARAGRAFO = "paragrafo"
    ARTICOLO = "articolo"


@dataclass
class NormNode:
    """
    A node in the hierarchical norm tree.

    Can represent either a structural division (Libro, Titolo, etc.)
    or a leaf node (Articolo).
    """
    level: NormLevel
    number: str  # Roman numeral for divisions, Arabic for articles (e.g., "IV", "1453")
    title: Optional[str] = None  # e.g., "Delle obbligazioni"
    url: Optional[str] = None  # Only for articles
    children: List['NormNode'] = field(default_factory=list)
    attachment_number: Optional[int] = None  # For Allegato handling

    @property
    def is_article(self) -> bool:
        return self.level == NormLevel.ARTICOLO

    @property
    def full_text(self) -> str:
        """Returns 'Libro IV - Delle obbligazioni' format."""
        level_name = self.level.value.capitalize()
        if self.title:
            return f"{level_name} {self.number} - {self.title}"
        return f"{level_name} {self.number}"


@dataclass
class NormTree:
    """
    Complete hierarchical tree for a norm.

    Root contains the full structure from Libro down to Articolo.
    """
    base_urn: str
    children: List[NormNode] = field(default_factory=list)
    article_count: int = 0


# Pattern per estrarre i livelli strutturali dal testo (possono essere multipli in una stringa)
# Es. "LIBRO PRIMO DELLE PERSONE E DELLA FAMIGLIA TITOLO I DELLE PERSONE FISICHE"
LEVEL_EXTRACT_PATTERNS = {
    NormLevel.LIBRO: re.compile(r'LIBRO\s+(PRIMO|SECONDO|TERZO|QUARTO|QUINTO|SESTO|SETTIMO|OTTAVO|NONO|DECIMO|[IVXLCDM]+)\s+(.+?)(?=\s+TITOLO|\s+CAPO|\s+SEZIONE|$)', re.IGNORECASE),
    NormLevel.TITOLO: re.compile(r'TITOLO\s+([IVXLCDM]+)\s+(.+?)(?=\s+CAPO|\s+SEZIONE|$)', re.IGNORECASE),
    NormLevel.CAPO: re.compile(r'CAPO\s+([IVXLCDM]+)\s+(.+?)(?=\s+SEZIONE|$)', re.IGNORECASE),
    NormLevel.SEZIONE: re.compile(r'SEZIONE\s+([IVXLCDM]+)\s+(.+?)$', re.IGNORECASE),
}

# Mapping per numeri ordinali italiani
ORDINAL_TO_ROMAN = {
    'PRIMO': 'I', 'SECONDO': 'II', 'TERZO': 'III', 'QUARTO': 'IV',
    'QUINTO': 'V', 'SESTO': 'VI', 'SETTIMO': 'VII', 'OTTAVO': 'VIII',
    'NONO': 'IX', 'DECIMO': 'X',
}

@cached(ttl=3600)
async def get_tree(normurn, link=False, details=False):
    """
    Recupera l'albero degli articoli da un URN normativo e ne estrae le informazioni.

    Args:
        normurn (str): URL della norma.
        link (bool): Se includere i link agli articoli.
        details (bool): Se includere i testi delle sezioni.

    Returns:
        tuple: Lista di articoli (e sezioni, se richiesto) estratti e conteggio, oppure un messaggio di errore.
    """
    log.info(f"Fetching tree for norm URN: {normurn}")
    if not normurn or not isinstance(normurn, str):
        log.error("Invalid URN provided")
        return "Invalid URN provided", 0

    try:
        async with aiohttp.ClientSession(connector=aiohttp.TCPConnector(ssl=False)) as session:
            async with session.get(normurn, timeout=30) as response:
                response.raise_for_status()
                text = await response.text()
    except aiohttp.ClientError as e:
        log.error(f"HTTP error while fetching page: {e}", exc_info=True)
        return f"Failed to retrieve the page: {e}", 0
    except asyncio.TimeoutError:
        log.error("Request timed out")
        return "Request timed out", 0
    except Exception as e:
        log.error(f"Unexpected error: {e}", exc_info=True)
        return f"Unexpected error: {e}", 0

    soup = BeautifulSoup(text, 'html.parser')

    if "normattiva" in normurn:
        return await _parse_normattiva_tree(soup, normurn, link, details)
    elif "eur-lex" in normurn:
        return await _parse_eurlex_tree(soup)

    log.warning(f"Unrecognized norm URN format: {normurn}")
    return "Unrecognized norm URN format", 0


async def _parse_normattiva_tree(soup, normurn, link, details):
    """Parsa la struttura dell'albero degli articoli per Normattiva."""
    log.info("Parsing Normattiva structure")
    tree = soup.find('div', id='albero')

    if not tree:
        log.warning("Div with id 'albero' not found")
        return "Div with id 'albero' not found", 0

    uls = tree.find_all('ul')
    if not uls:
        log.warning("No 'ul' elements found within the 'albero' div")
        return "No 'ul' elements found within the 'albero' div", 0

    result = []
    count_articles = 0  # Contatore solo per gli articoli

    current_attachment = None  # Variabile per tracciare il numero dell'allegato corrente

    for ul in uls:
        for li in ul.find_all('li', recursive=False):
            # Check if the list item is a section/title
            if 'singolo_risultato_collapse' in li.get('class', []):
                if details:
                    section_text = li.get_text(separator=" ", strip=True)
                    result.append(section_text)
                continue  # Skip further processing for section items

            # Check if the list item indicates an allegato
            allegato_tag = li.find('a', class_='link_allegato')  # Supponendo che gli allegati abbiano questa classe
            if allegato_tag:
                # Estrai il numero dell'allegato
                allegato_text = allegato_tag.get_text(strip=True)
                match = re.match(r'Allegato\s+(\d+)', allegato_text, re.IGNORECASE)
                if match:
                    current_attachment = int(match.group(1))
                    log.info(f"Detected attachment number: {current_attachment}")
                continue  # Passa agli articoli successivi

            # Process regular articles
            a_tag = li.find('a', class_='numero_articolo')
            if a_tag:
                article_data = _extract_normattiva_article(a_tag, normurn, link, attachment_number=current_attachment)
                if article_data:
                    result.append(article_data)
                    count_articles += 1

    log.info(f"Extracted {count_articles} unique articles from Normattiva")
    return result, count_articles


def _extract_normattiva_article(a_tag, normurn, link, attachment_number=None):
    """
    Estrae i dettagli di un articolo da Normattiva, includendo il link se richiesto.

    Args:
        a_tag (bs4.element.Tag): Il tag <a> contenente il numero dell'articolo.
        normurn (str): URN base della norma.
        link (bool): Se includere il link all'articolo.
        attachment_number (int, optional): Numero dell'allegato se l'articolo appartiene a un allegato.

    Returns:
        dict or str: Dizionario con il numero dell'articolo e il link, oppure solo il numero dell'articolo.
    """
    # Rimuove eventuali prefissi come "art. " e spazi
    text_content = a_tag.get_text(separator=" ", strip=True)
    text_content = re.sub(r'^\s*art\.\s*', '', text_content, flags=re.IGNORECASE)

    if link:
        # Estrai eventuali estensioni dall'articolo
        match = re.match(r'^(\d+)([a-zA-Z.]*)$', text_content)
        if match:
            article_number = match.group(1)
            extension = match.group(2).replace('-', '').lower()  # Rimuovi trattini e abbassa il caso
            if extension:
                article_number += extension
        else:
            article_number = text_content  # In caso di formato inatteso

        modified_url = _generate_article_url(normurn, article_number, attachment_number=attachment_number)
        return {text_content: modified_url}
    return text_content


def _generate_article_url(normurn, article_number, attachment_number=None):
    """
    Genera un URL per un articolo specifico basato sull'URN base, sul numero dell'articolo
    e, se presente, sul numero dell'allegato.

    Args:
        normurn (str): URN base della norma.
        article_number (str): Numero dell'articolo, possibili estensioni incluse (es. '27bis').
        attachment_number (int, optional): Numero dell'allegato se l'articolo appartiene a un allegato.

    Returns:
        str: URL completo per l'articolo specifico.
    """
    log.info(f"Generating article URL for article_number: {article_number}, attachment_number: {attachment_number} based on normurn: {normurn}")

    # Normalize article_number: rimuovi spazi e trattini, converti in minuscolo
    article_number = article_number.lower().replace(' ', '').replace('-', '')

    # Regex per identificare i suffissi di versione e di articolo
    split_pattern = re.compile(r'([~@!])')

    parts = split_pattern.split(normurn, maxsplit=1)

    if len(parts) == 1:
        # Nessun suffisso presente, costruisci l'URN base
        base_urn = normurn
        suffix = ''
    else:
        # Suffisso presente, separa base e suffisso
        base_urn, sep, suffix = parts

    # Aggiungi il numero dell'allegato se fornito
    if attachment_number is not None:
        base_urn = f"{base_urn}:{attachment_number}"
        log.info(f"Added attachment number to URN: {base_urn}")

    # Costruisci il nuovo URN con l'articolo
    new_urn = f"{base_urn}~art{article_number}{sep}{suffix}" if suffix else f"{base_urn}~art{article_number}"

    log.info(f"Generated article URL: {new_urn}")
    return new_urn


async def _parse_eurlex_tree(soup, normurn):
    """Parsa la struttura dell'albero degli articoli per Eur-Lex."""
    log.info("Parsing Eur-Lex structure")
    result, seen = [], set()

    for a_tag in soup.find_all('a'):
        if 'Articolo' in a_tag.text:
            article_number = _extract_eurlex_article(a_tag, seen)
            if article_number:
                result.append(article_number)

    count = len(result)
    log.info(f"Extracted {count} unique articles from Eur-Lex")
    return result, count


def _extract_eurlex_article(a_tag, seen):
    """Estrae i dettagli di un articolo da Eur-Lex."""
    match = re.search(r'Articolo\s+(\d+\s*\w*)', a_tag.get_text(strip=True))
    if match:
        article_number = match.group(1).strip()
        if article_number not in seen:
            seen.add(article_number)
            return article_number
    return None

# =============================================================================
# Hierarchical Tree API (New)
# =============================================================================

@cached(ttl=3600)
async def get_hierarchical_tree(normurn: str) -> Tuple[Union[NormTree, str], int]:
    """
    Get full hierarchical tree for a norm.

    Args:
        normurn: URL/URN of the norm (e.g., Codice Civile URL)

    Returns:
        (NormTree, article_count) or (error_message, 0) on failure

    Example:
        >>> tree, count = await get_hierarchical_tree(codice_civile_url)
        >>> print(f"Found {count} articles in {len(tree.children)} top-level divisions")
    """
    log.info(f"Fetching hierarchical tree for: {normurn}")

    if not normurn or not isinstance(normurn, str):
        log.error("Invalid URN provided")
        return "Invalid URN provided", 0

    try:
        async with aiohttp.ClientSession(connector=aiohttp.TCPConnector(ssl=False)) as session:
            async with session.get(normurn, timeout=30) as response:
                response.raise_for_status()
                text = await response.text()
    except aiohttp.ClientError as e:
        log.error(f"HTTP error while fetching page: {e}", exc_info=True)
        return f"Failed to retrieve the page: {e}", 0
    except asyncio.TimeoutError:
        log.error("Request timed out")
        return "Request timed out", 0
    except Exception as e:
        log.error(f"Unexpected error: {e}", exc_info=True)
        return f"Unexpected error: {e}", 0

    soup = BeautifulSoup(text, 'html.parser')

    if "normattiva" in normurn:
        return _parse_normattiva_hierarchical(soup, normurn)

    log.warning(f"Hierarchical parsing only supported for Normattiva, falling back to flat")
    return "Hierarchical parsing only supported for Normattiva", 0


@dataclass
class HierarchyState:
    """Tracks current position in the norm hierarchy during parsing."""
    libro: Optional[NormNode] = None
    titolo: Optional[NormNode] = None
    capo: Optional[NormNode] = None
    sezione: Optional[NormNode] = None

    def get_path(self) -> List[NormNode]:
        """Return list of current hierarchy nodes (non-None only)."""
        return [n for n in [self.libro, self.titolo, self.capo, self.sezione] if n]

    def update_from_levels(self, levels: Dict[NormLevel, NormNode]):
        """Update hierarchy state from extracted levels, clearing lower levels as needed."""
        if NormLevel.LIBRO in levels:
            self.libro = levels[NormLevel.LIBRO]
            self.titolo = None
            self.capo = None
            self.sezione = None
        if NormLevel.TITOLO in levels:
            self.titolo = levels[NormLevel.TITOLO]
            self.capo = None
            self.sezione = None
        if NormLevel.CAPO in levels:
            self.capo = levels[NormLevel.CAPO]
            self.sezione = None
        if NormLevel.SEZIONE in levels:
            self.sezione = levels[NormLevel.SEZIONE]


def _parse_normattiva_hierarchical(soup, normurn: str) -> Tuple[NormTree, int]:
    """
    Parse Normattiva HTML into hierarchical NormTree structure.

    Normattiva uses a flat structure where structural sections contain
    concatenated hierarchy levels like "LIBRO PRIMO...TITOLO I...CAPO I..."
    """
    log.info("Parsing Normattiva hierarchical structure")

    tree_div = soup.find('div', id='albero')
    if not tree_div:
        log.warning("Div with id 'albero' not found")
        return NormTree(base_urn=normurn), 0

    # Collect all articles with their hierarchy info
    articles_with_hierarchy = []
    hierarchy_state = HierarchyState()
    current_attachment = None

    # Find all ul elements (there can be multiple in allegati_lista)
    all_uls = tree_div.find_all('ul')

    for ul in all_uls:
        for li in ul.find_all('li', recursive=False):
            classes = li.get('class', [])

            # Skip box headers
            if 'box_articoli' in classes or 'box_allegati' in classes:
                continue

            # Structural section (may contain multiple levels)
            if 'singolo_risultato_collapse' in classes:
                text = li.get_text(separator=" ", strip=True)
                levels = _extract_hierarchy_levels(text)
                if levels:
                    hierarchy_state.update_from_levels(levels)
                continue

            # Allegato
            allegato_tag = li.find('a', class_='link_allegato')
            if allegato_tag:
                allegato_text = allegato_tag.get_text(strip=True)
                match = re.match(r'Allegato\s+(\d+)', allegato_text, re.IGNORECASE)
                if match:
                    current_attachment = int(match.group(1))
                continue

            # Article
            a_tag = li.find('a', class_='numero_articolo')
            if a_tag:
                article_num = _extract_article_number(a_tag)
                if article_num and article_num != 'orig.':  # Skip version links
                    url = _generate_article_url(normurn, article_num, current_attachment)
                    articles_with_hierarchy.append({
                        'number': article_num,
                        'url': url,
                        'attachment': current_attachment,
                        'hierarchy': hierarchy_state.get_path().copy()
                    })

    # Build tree structure from collected articles
    tree = _build_tree_from_articles(normurn, articles_with_hierarchy)
    return tree, len(articles_with_hierarchy)


def _extract_hierarchy_levels(text: str) -> Dict[NormLevel, NormNode]:
    """
    Extract all hierarchy levels from a concatenated section text.

    Example: "LIBRO PRIMO DELLE PERSONE E DELLA FAMIGLIA TITOLO I DELLE PERSONE FISICHE"
    Returns: {LIBRO: NormNode(...), TITOLO: NormNode(...)}
    """
    levels = {}
    text = text.strip()

    for level, pattern in LEVEL_EXTRACT_PATTERNS.items():
        match = pattern.search(text)
        if match:
            number = match.group(1).upper()
            title = match.group(2).strip() if match.group(2) else None

            # Convert ordinal to Roman if needed
            if number in ORDINAL_TO_ROMAN:
                number = ORDINAL_TO_ROMAN[number]

            levels[level] = NormNode(
                level=level,
                number=number,
                title=title
            )

    return levels


def _build_tree_from_articles(
    normurn: str,
    articles: List[Dict[str, Any]]
) -> NormTree:
    """
    Build NormTree from list of articles with their hierarchy info.

    Creates a proper tree structure with Libro→Titolo→Capo→Sezione→Articolo
    """
    tree = NormTree(base_urn=normurn, article_count=len(articles))

    # Use dictionaries to track unique nodes at each level
    libri: Dict[str, NormNode] = {}
    titoli: Dict[str, NormNode] = {}
    capi: Dict[str, NormNode] = {}
    sezioni: Dict[str, NormNode] = {}

    for art_info in articles:
        hierarchy = art_info['hierarchy']
        article_node = NormNode(
            level=NormLevel.ARTICOLO,
            number=art_info['number'],
            url=art_info['url'],
            attachment_number=art_info['attachment']
        )

        # Find or create parent nodes
        parent_node = None
        current_libro_key = None
        current_titolo_key = None
        current_capo_key = None

        for h_node in hierarchy:
            if h_node.level == NormLevel.LIBRO:
                current_libro_key = h_node.number
                if current_libro_key not in libri:
                    libri[current_libro_key] = NormNode(
                        level=NormLevel.LIBRO,
                        number=h_node.number,
                        title=h_node.title
                    )
                    tree.children.append(libri[current_libro_key])
                parent_node = libri[current_libro_key]

            elif h_node.level == NormLevel.TITOLO:
                titolo_key = f"{current_libro_key}_{h_node.number}"
                current_titolo_key = titolo_key
                if titolo_key not in titoli:
                    titoli[titolo_key] = NormNode(
                        level=NormLevel.TITOLO,
                        number=h_node.number,
                        title=h_node.title
                    )
                    if parent_node:
                        parent_node.children.append(titoli[titolo_key])
                parent_node = titoli[titolo_key]

            elif h_node.level == NormLevel.CAPO:
                capo_key = f"{current_titolo_key}_{h_node.number}"
                current_capo_key = capo_key
                if capo_key not in capi:
                    capi[capo_key] = NormNode(
                        level=NormLevel.CAPO,
                        number=h_node.number,
                        title=h_node.title
                    )
                    if parent_node:
                        parent_node.children.append(capi[capo_key])
                parent_node = capi[capo_key]

            elif h_node.level == NormLevel.SEZIONE:
                sezione_key = f"{current_capo_key}_{h_node.number}"
                if sezione_key not in sezioni:
                    sezioni[sezione_key] = NormNode(
                        level=NormLevel.SEZIONE,
                        number=h_node.number,
                        title=h_node.title
                    )
                    if parent_node:
                        parent_node.children.append(sezioni[sezione_key])
                parent_node = sezioni[sezione_key]

        # Add article to the deepest parent found
        if parent_node:
            parent_node.children.append(article_node)
        else:
            # No hierarchy - add directly to tree
            tree.children.append(article_node)

    return tree


def _extract_article_number(a_tag) -> str:
    """Extract article number from <a> tag, removing 'art.' prefix."""
    text = a_tag.get_text(separator=" ", strip=True)
    text = re.sub(r'^\s*art\.\s*', '', text, flags=re.IGNORECASE)
    return text


# =============================================================================
# Position String API (for MERL-T integration)
# =============================================================================

def get_article_position(tree: NormTree, article_num: str) -> Optional[str]:
    """
    Get the position string for an article in Brocardi format.

    Args:
        tree: NormTree from get_hierarchical_tree()
        article_num: Article number (e.g., "1453", "1453bis")

    Returns:
        Position string like "Libro IV - Delle obbligazioni, Titolo II - Dei contratti..."
        or None if article not found

    Example:
        >>> tree, _ = await get_hierarchical_tree(codice_civile_url)
        >>> pos = get_article_position(tree, "1453")
        >>> print(pos)
        "Libro IV - Delle obbligazioni, Titolo II - Dei contratti in generale, Capo XIV - Della risoluzione del contratto"
    """
    path = []

    def find_article(nodes: List[NormNode], current_path: List[NormNode]) -> bool:
        for node in nodes:
            if node.is_article:
                if _normalize_article_num(node.number) == _normalize_article_num(article_num):
                    path.extend(current_path)
                    return True
            else:
                # Structural node - add to path and search children
                if find_article(node.children, current_path + [node]):
                    return True
        return False

    if find_article(tree.children, []):
        # Filter out articles and join structural nodes
        structural_path = [n for n in path if not n.is_article]
        return ", ".join(node.full_text for node in structural_path)

    return None


def get_all_articles_with_positions(tree: NormTree) -> List[Dict[str, Any]]:
    """
    Get all articles with their positions for batch processing.

    Returns:
        List of {"number": "1453", "url": "...", "position": "Libro IV - ..."}
    """
    results = []

    def collect_articles(nodes: List[NormNode], current_path: List[NormNode]):
        for node in nodes:
            if node.is_article:
                position = ", ".join(n.full_text for n in current_path if not n.is_article)
                results.append({
                    "number": node.number,
                    "url": node.url,
                    "position": position if position else None,
                    "attachment": node.attachment_number
                })
            else:
                collect_articles(node.children, current_path + [node])

    collect_articles(tree.children, [])
    return results


def _normalize_article_num(num: str) -> str:
    """Normalize article number for comparison (1453-bis -> 1453bis)."""
    return num.lower().replace(' ', '').replace('-', '')


# =============================================================================
# Test Main
# =============================================================================

async def main():
    """Test function for hierarchical tree extraction."""
    # Test with Codice Civile
    normurn = 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262'
    print(f"Fetching hierarchical tree for: {normurn}")

    tree, count = await get_hierarchical_tree(normurn)

    if isinstance(tree, str):
        print(f"Error: {tree}")
        return

    print(f"Found {count} articles")
    print(f"Top-level divisions: {len(tree.children)}")

    # Show first few divisions
    for node in tree.children[:3]:
        print(f"  {node.full_text} ({len(node.children)} children)")

    # Test position lookup
    position = get_article_position(tree, "1453")
    if position:
        print(f"\nPosition of Art. 1453: {position}")


if __name__ == "__main__":
    asyncio.run(main())

