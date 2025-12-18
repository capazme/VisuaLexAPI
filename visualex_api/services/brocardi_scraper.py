import structlog
import re
import os
from typing import Optional, Tuple, Union, Dict, Any, List
from dataclasses import dataclass

import requests
from bs4 import BeautifulSoup
from aiocache import cached, Cache
from aiocache.serializers import JsonSerializer

from ..tools.map import BROCARDI_CODICI
from ..tools.norma import NormaVisitata
from ..tools.text_op import normalize_act_type
from ..tools.sys_op import BaseScraper
from ..tools.cache_manager import get_cache_manager
from .http_client import http_client
from ..tools.exceptions import DocumentNotFoundError
from ..tools.selectors import BrocardiSelectors

# Configure structured logger
log = structlog.get_logger()

# Costante per il base URL
BASE_URL: str = "https://brocardi.it"

# Autorità giudiziarie italiane per parsing massime
AUTORITA_GIUDIZIARIE = {
    # Corte Costituzionale
    'corte_cost': r'(?:Corte\s+cost\.?|C\.\s*cost\.?|Corte\s+Costituzionale)',
    # Corte di Cassazione (civile, penale, lavoro, sezioni unite)
    'cassazione': r'(?:Cass\.?\s*(?:civ|pen|lav|sez\.?\s*un)?\.?)',
    # Consiglio di Stato
    'cons_stato': r'(?:Cons\.?\s*(?:St\.?|Stato)|Consiglio\s+di\s+Stato)',
    # TAR (Tribunale Amministrativo Regionale)
    'tar': r'(?:TAR\s*(?:Lazio|Lombardia|Campania|Sicilia|Veneto|Piemonte|Emilia[\s-]?Romagna|Toscana|Puglia|Calabria|Liguria|Marche|Abruzzo|Sardegna|Friuli|Umbria|Basilicata|Molise|Valle\s*d\'?Aosta|Trentino)?)',
    # Corte dei Conti
    'corte_conti': r'(?:Corte\s+(?:dei\s+)?[Cc]onti|C\.\s*conti)',
    # Corte d'Appello
    'appello': r'(?:App\.?|C\.\s*App\.?|Corte\s+(?:d\'?)?[Aa]ppello)',
    # Tribunale ordinario
    'tribunale': r'(?:Trib\.?|Tribunale)',
    # Corte di Giustizia UE
    'cgue': r'(?:CGUE|Corte\s+[Gg]iust\.?\s*(?:UE|CE)?|C\.\s*Giust\.?\s*UE)',
    # Corte Europea Diritti dell'Uomo
    'cedu': r'(?:CEDU|Corte\s+EDU|Corte\s+[Ee]uropea\s+[Dd]iritti)',
}

# Pattern combinato per tutte le autorità
AUTORITA_PATTERN = '|'.join(f'({pattern})' for pattern in AUTORITA_GIUDIZIARIE.values())


@dataclass
class RelazioneContent:
    """Contenuto di una Relazione storica (Guardasigilli)."""
    tipo: str  # "libro_obbligazioni" o "codice_civile"
    titolo: str
    numero_paragrafo: Optional[str]
    testo: str
    articoli_citati: List[Dict[str, str]]  # [{"numero": "1286", "titolo": "...", "url": "..."}]


class BrocardiScraper(BaseScraper):
    def __init__(self) -> None:
        log.info("Initializing BrocardiScraper")
        self.knowledge: List[Dict[str, Any]] = [BROCARDI_CODICI]
        self.cache = get_cache_manager().get_persistent("brocardi")
        self.selectors = BrocardiSelectors()

    @staticmethod
    def _clean_text(text: str) -> str:
        """Pulisce il testo estratto dall'HTML (normalizza whitespace)."""
        if not text:
            return ""
        # Aggiungi spazio dopo tag di chiusura se seguito da lettera
        cleaned = re.sub(r'>(\w)', r'> \1', text)
        # Normalizza whitespace multipli
        cleaned = re.sub(r'\s+', ' ', cleaned)
        return cleaned.strip()

    def _extract_article_links(self, element) -> List[Dict[str, str]]:
        """
        Estrae link agli articoli da un elemento HTML.

        Returns:
            Lista di dict con {numero, titolo, url}
        """
        links = []
        for a_tag in element.find_all('a', href=True):
            href = a_tag.get('href', '')
            if '/art' in href and '.html' in href:
                match = re.search(r'/art(\d+[a-z]*)\.html', href)
                if match:
                    links.append({
                        'numero': match.group(1),
                        'titolo': a_tag.get('title', ''),
                        'url': href if href.startswith('http') else f"{BASE_URL}{href}"
                    })
        return links

    def _extract_footnotes(self, corpo) -> List[Dict[str, Any]]:
        """
        Estrae note a piè di pagina dalla pagina Brocardi.it.

        Patterns supportati:
        - Brocardi: <a class="nota-ref" href="#nota_XXXX">(1)</a> con <a name="nota_XXXX"> in div.corpoDelTesto.nota
        - Legacy: <sup>1</sup> con div.nota
        - Legacy: <a href="#nota1">1</a> con <div id="nota1">

        Returns:
            Lista di dict con {numero, testo, tipo}
        """
        footnotes = []

        try:
            # Pattern 1 (BROCARDI): <a class="nota-ref" href="#nota_XXXX">(N)</a>
            # con contenuto in <div class="corpoDelTesto nota"> che contiene <a name="nota_XXXX">
            nota_refs = corpo.find_all('a', class_='nota-ref')
            for nota_ref in nota_refs:
                href = nota_ref.get('href', '')
                if href.startswith('#nota_'):
                    anchor_name = href[1:]  # Rimuovi '#' -> "nota_XXXX"
                    numero_text = nota_ref.get_text(strip=True)
                    # Estrai numero da "(1)" o "1"
                    numero_match = re.search(r'\((\d+)\)|^(\d+)$', numero_text)
                    if numero_match:
                        numero = int(numero_match.group(1) or numero_match.group(2))

                        # Cerca l'anchor <a name="nota_XXXX"> nel documento
                        target_anchor = corpo.find('a', attrs={'name': anchor_name})
                        if target_anchor:
                            # Il contenuto della nota è nel div genitore
                            parent_div = target_anchor.find_parent('div', class_='nota')
                            if parent_div:
                                # Estrai testo con separatore spazio per evitare parole attaccate
                                testo_completo = parent_div.get_text(separator=' ', strip=True)
                                # Rimuovi il pattern "(N)" iniziale
                                testo = re.sub(r'^\(\d+\)\s*', '', testo_completo)
                                if testo:
                                    footnotes.append({
                                        'numero': numero,
                                        'testo': self._clean_text(testo),
                                        'tipo': 'nota_dispositivo'
                                    })

            # Pattern 2 (BROCARDI alternativo): Cerca direttamente div.corpoDelTesto.nota
            # se non trovati con pattern 1
            if not footnotes:
                nota_divs = corpo.find_all('div', class_=lambda c: c and 'nota' in c and 'corpoDelTesto' in c)
                for nota_div in nota_divs:
                    testo_completo = nota_div.get_text(separator=' ', strip=True)
                    # Pattern "(1) testo nota"
                    match = re.match(r'^\((\d+)\)\s*(.+)$', testo_completo, re.DOTALL)
                    if match:
                        footnotes.append({
                            'numero': int(match.group(1)),
                            'testo': self._clean_text(match.group(2)),
                            'tipo': 'nota_dispositivo'
                        })

            # Pattern 3 (Legacy): Superscript + div.nota generico
            if not footnotes:
                for sup in corpo.find_all('sup'):
                    numero = sup.get_text(strip=True)
                    if numero.isdigit():
                        nota_div = corpo.find('div', class_='nota',
                                             string=lambda t: t and numero in t)
                        if nota_div:
                            footnotes.append({
                                'numero': int(numero),
                                'testo': self._clean_text(nota_div.get_text()),
                                'tipo': 'nota'
                            })

            # Pattern 4 (Legacy): Anchor href="#notaX" con id="notaX"
            if not footnotes:
                for a_tag in corpo.find_all('a', href=lambda h: h and h.startswith('#nota') and '_' not in h):
                    href = a_tag.get('href', '')
                    nota_id = href[1:]
                    numero = a_tag.get_text(strip=True)
                    if numero.isdigit():
                        target = corpo.find(id=nota_id)
                        if target:
                            footnotes.append({
                                'numero': int(numero),
                                'testo': self._clean_text(target.get_text()),
                                'tipo': 'riferimento'
                            })

            # Deduplica per numero
            seen = {}
            for fn in footnotes:
                num = fn['numero']
                if num not in seen:
                    seen[num] = fn

            # Ordina per numero
            result = sorted(seen.values(), key=lambda x: x['numero'])

            if result:
                log.info(f"[FOOTNOTES] Extracted {len(result)} footnotes from Brocardi")

            return result

        except Exception as e:
            log.warning(f"[FOOTNOTES] Error extracting footnotes: {e}")
            return []

    def _extract_related_articles(self, soup) -> Dict[str, Any]:
        """
        Estrae articoli correlati (precedente/successivo).

        Returns:
            Dict con {previous: {...}, next: {...}}
        """
        related = {}

        try:
            # Cerca link "Art. precedente" e "Art. successivo"
            for a_tag in soup.find_all('a', href=True):
                text = a_tag.get_text(strip=True).lower()
                href = a_tag.get('href', '')

                if 'precedente' in text and '/art' in href:
                    match = re.search(r'/art(\d+[a-z]*)\.html', href)
                    if match:
                        related['previous'] = {
                            'numero': match.group(1),
                            'url': href if href.startswith('http') else f"{BASE_URL}{href}",
                            'titolo': a_tag.get('title', '')
                        }

                elif 'successivo' in text and '/art' in href:
                    match = re.search(r'/art(\d+[a-z]*)\.html', href)
                    if match:
                        related['next'] = {
                            'numero': match.group(1),
                            'url': href if href.startswith('http') else f"{BASE_URL}{href}",
                            'titolo': a_tag.get('title', '')
                        }

            if related:
                log.info(f"[RELATED] Found {len(related)} related articles")

            return related

        except Exception as e:
            log.warning(f"[RELATED] Error extracting related articles: {e}")
            return {}

    def _extract_cross_references(self, corpo) -> List[Dict[str, str]]:
        """
        Estrae riferimenti incrociati ad altri articoli dal contenuto.

        Returns:
            Lista di dict con {articolo, tipo_atto, url, sezione}
        """
        cross_refs = []
        seen_urls = set()

        try:
            # Mappa delle sezioni
            sections_map = {
                'brocardi-content': 'brocardi',
                'container-ratio': 'ratio',
                'text': 'spiegazione',
                'sentenza': 'massime'
            }

            # Cerca tutti i link ad articoli
            for section_class, section_name in sections_map.items():
                sections = corpo.find_all('div', class_=section_class)

                for section in sections:
                    for a_tag in section.find_all('a', href=True):
                        href = a_tag.get('href', '')

                        # Pattern per articoli: /codice-civile/...art123.html
                        if '/art' in href and '.html' in href:
                            # Evita duplicati
                            if href in seen_urls:
                                continue
                            seen_urls.add(href)

                            # Estrai numero articolo
                            match = re.search(r'/art(\d+[a-z]*)\.html', href)
                            if match:
                                # Estrai tipo_atto dal path
                                tipo_atto = None
                                if '/codice-civile/' in href:
                                    tipo_atto = 'Codice Civile'
                                elif '/codice-penale/' in href:
                                    tipo_atto = 'Codice Penale'
                                elif '/costituzione/' in href:
                                    tipo_atto = 'Costituzione'
                                elif '/codice-procedura-civile/' in href:
                                    tipo_atto = 'Codice Procedura Civile'
                                elif '/codice-procedura-penale/' in href:
                                    tipo_atto = 'Codice Procedura Penale'

                                cross_refs.append({
                                    'articolo': match.group(1),
                                    'tipo_atto': tipo_atto,
                                    'url': href if href.startswith('http') else f"{BASE_URL}{href}",
                                    'sezione': section_name,
                                    'testo': a_tag.get_text(strip=True)
                                })

            if cross_refs:
                log.info(f"[CROSS_REF] Extracted {len(cross_refs)} cross-references")

            return cross_refs

        except Exception as e:
            log.warning(f"[CROSS_REF] Error extracting cross-references: {e}")
            return []

    def _parse_massima(self, sentenza_div) -> Optional[Dict[str, Any]]:
        """
        Parsa una singola massima giurisprudenziale dalla struttura HTML Brocardi.

        Returns:
            Dict with: autorita, numero, anno, massima (text)
            or None if parsing fails
        """
        try:
            result = {
                'autorita': None,
                'numero': None,
                'anno': None,
                'massima': None
            }

            # Find the header with case number (usually in <strong>)
            header = sentenza_div.find('strong')
            if header:
                header_text = header.get_text(strip=True)

                # Pattern: (Autorita) n. (Numero)/(Anno)
                match = re.match(
                    rf'^({AUTORITA_PATTERN})\s*n\.\s*(\d+)/(\d{{4}})',
                    header_text,
                    re.IGNORECASE
                )
                if match:
                    groups = match.groups()
                    num_autorita = len(AUTORITA_GIUDIZIARIE)
                    for i in range(num_autorita):
                        if groups[i]:
                            result['autorita'] = groups[i].strip()
                            break
                    result['numero'] = groups[-2]
                    result['anno'] = groups[-1]
                else:
                    # Fallback: try to extract any number/year pattern
                    num_match = re.search(r'n\.\s*(\d+)/(\d{4})', header_text)
                    if num_match:
                        result['numero'] = num_match.group(1)
                        result['anno'] = num_match.group(2)

                    # Extract autorita from beginning
                    auth_match = re.match(rf'^({AUTORITA_PATTERN})', header_text, re.IGNORECASE)
                    if auth_match:
                        for g in auth_match.groups():
                            if g:
                                result['autorita'] = g.strip().rstrip('.')
                                break
                    elif not result['autorita']:
                        # Last fallback: take everything before "n."
                        fallback_match = re.match(r'^([^n]+?)(?:\s*n\.|\s*$)', header_text)
                        if fallback_match:
                            result['autorita'] = fallback_match.group(1).strip().rstrip('.')

            # Get full text (excluding the header)
            full_text = self._clean_text(sentenza_div.get_text())

            # Remove the header part from the text to get just the massima
            if result['numero'] and result['anno']:
                pattern = rf'(?:{AUTORITA_PATTERN})[^n]*n\.\s*{result["numero"]}/{result["anno"]}\s*'
                massima_text = re.sub(pattern, '', full_text, count=1, flags=re.IGNORECASE).strip()
                result['massima'] = massima_text if massima_text else full_text
            else:
                result['massima'] = full_text

            # Only return if we have at least massima text
            if result['massima']:
                return result

        except Exception as e:
            log.warning(f"Error parsing massima: {e}")

        return None

    @cached(ttl=86400, cache=Cache.MEMORY, serializer=JsonSerializer())
    async def do_know(self, norma_visitata: NormaVisitata) -> Optional[Tuple[str, str]]:
        log.info(f"Checking if knowledge exists for norma: {norma_visitata}")

        norma_str: Optional[str] = self._build_norma_string(norma_visitata)
        if norma_str is None:
            log.error("Invalid norma format")
            raise DocumentNotFoundError(
                "Invalid norma format for Brocardi lookup",
                urn=str(norma_visitata)
            )

        search_str = norma_str.lower()
        for txt, link in self.knowledge[0].items():
            if search_str in txt.lower():
                log.info(f"Knowledge found for norma: {norma_visitata}")
                return txt, link

        log.warning(f"No knowledge found for norma: {norma_visitata}")
        return None

    @cached(ttl=86400, cache=Cache.MEMORY, serializer=JsonSerializer())
    async def look_up(self, norma_visitata: NormaVisitata) -> Optional[str]:
        log.info(f"Looking up norma: {norma_visitata}")

        norma_info = await self.do_know(norma_visitata)
        if not norma_info:
            return None

        link: str = norma_info[1]
        # Recupera il contenuto della pagina principale
        soup = await self._fetch_soup(link, cache_suffix="main", source="brocardi_main")
        if soup is None:
            log.error(f"Failed to retrieve content for norma link: {link}")
            return None

        numero_articolo: Optional[str] = (
            norma_visitata.numero_articolo.replace('-', '')
            if norma_visitata.numero_articolo else None
        )
        if numero_articolo:
            article_link = await self._find_article_link(soup, BASE_URL, numero_articolo)
            return article_link
        log.info("No article number provided")
        return None

    async def _find_article_link(self, soup: BeautifulSoup, base_url: str, numero_articolo: str) -> Optional[str]:
        # Compila il pattern una sola volta
        pattern = re.compile(rf'href=["\']([^"\']*art{re.escape(numero_articolo)}\.html)["\']')
        log.info("Searching for target link in the main page content")

        # Utilizza str(soup) invece di prettify per migliorare le performance
        matches = pattern.findall(str(soup))
        if matches:
            return requests.compat.urljoin(base_url, matches[0])

        log.info("No direct match found, searching in 'section-title' divs")
        section_titles = soup.find_all('div', class_='section-title')
        for section in section_titles:
            for a_tag in section.find_all('a', href=True):
                sub_link = requests.compat.urljoin(base_url, a_tag.get('href', ''))
                sub_soup = await self._fetch_soup(sub_link, cache_suffix="section", source="brocardi_section")
                if not sub_soup:
                    continue
                sub_matches = pattern.findall(str(sub_soup))
                if sub_matches:
                    return requests.compat.urljoin(base_url, sub_matches[0])

        log.info("No matching article found")
        return None

    async def get_info(self, norma_visitata: NormaVisitata) -> Tuple[Optional[str], Dict[str, Any], Optional[str]]:
        log.info(f"Getting info for norma: {norma_visitata}")

        norma_link = await self.look_up(norma_visitata)
        if not norma_link:
            return None, {}, None

        soup = await self._fetch_soup(norma_link, cache_suffix="article", source="brocardi_article")
        if soup is None:
            log.error(f"Failed to retrieve content for norma link: {norma_link}")
            return None, {}, None

        info: Dict[str, Any] = {}
        info['Position'] = self._extract_position(soup)
        self._extract_sections(soup, info)

        # Estrai articoli correlati (precedente/successivo)
        related = self._extract_related_articles(soup)
        if related:
            info['RelatedArticles'] = related

        return info.get('Position'), info, norma_link

    def _extract_position(self, soup: BeautifulSoup) -> Optional[str]:
        position_tag = soup.find('div', id='breadcrumb', recursive=True)
        if position_tag:
            # Mantiene la logica originale di slicing
            return position_tag.get_text(strip=False).replace('\n', '').replace('  ', '')[17:]
        log.warning("Breadcrumb position not found")
        return None

    def _extract_sections(self, soup: BeautifulSoup, info: Dict[str, Any]) -> None:
        corpo = soup.find('div', class_='panes-condensed panes-w-ads content-ext-guide content-mark', recursive=True)
        if not corpo:
            log.warning("Main content section not found")
            return

        brocardi_sections = corpo.find_all('div', class_='brocardi-content')
        if brocardi_sections:
            info['Brocardi'] = [self._clean_text(section.get_text()) for section in brocardi_sections]

        ratio_section = corpo.find('div', class_='container-ratio')
        if ratio_section:
            ratio_text = ratio_section.find('div', class_='corpoDelTesto')
            if ratio_text:
                info['Ratio'] = self._clean_text(ratio_text.get_text())

        spiegazione_header = corpo.find('h3', string=lambda text: text and "Spiegazione dell'art" in text)
        if spiegazione_header:
            spiegazione_content = spiegazione_header.find_next_sibling('div', class_='text')
            if spiegazione_content:
                info['Spiegazione'] = self._clean_text(spiegazione_content.get_text())

        # Estrazione Massime - structured parsing
        massime_header = corpo.find('h3', string=lambda text: text and "Massime relative all'art" in text)
        if massime_header:
            massime_content = massime_header.find_next_sibling('div', class_='text')
            if massime_content:
                # Find all sentenza divs for structured parsing
                sentenze_divs = massime_content.find_all('div', class_='sentenza')
                info['Massime'] = []
                for sentenza_div in sentenze_divs:
                    parsed = self._parse_massima(sentenza_div)
                    if parsed:
                        info['Massime'].append(parsed)
                log.debug(f"Extracted {len(info['Massime'])} structured massime")

        # Estrazione Relazione al Progetto della Costituzione (nell'HTML, per la Costituzione)
        relazione_cost_header = corpo.find('h3', string=lambda text: text and "Relazione al Progetto della Costituzione" in text)
        if relazione_cost_header:
            relazione_content = relazione_cost_header.find_next_sibling('div', class_='text')
            if relazione_content:
                info['RelazioneCostituzione'] = {
                    'titolo': 'Relazione al Progetto della Costituzione',
                    'autore': 'Meuccio Ruini',
                    'anno': 1947,
                    'testo': self._clean_text(relazione_content.get_text())
                }
                log.info("Extracted Relazione al Progetto della Costituzione")

        # Estrazione Relazioni storiche (Guardasigilli) direttamente dall'HTML
        try:
            relazioni = []

            # Pattern 1: Relazione al Libro delle Obbligazioni
            relazione_libro_header = corpo.find('h3', string=lambda text:
                text and "Libro delle Obbligazioni" in text)

            if relazione_libro_header:
                content = relazione_libro_header.find_next_sibling('div', class_='text')
                if content:
                    relazioni.append({
                        'tipo': 'libro_obbligazioni',
                        'titolo': 'Relazione al Libro delle Obbligazioni (1941)',
                        'testo': self._clean_text(content.get_text()),
                        'articoli_citati': self._extract_article_links(content),
                        'numero_paragrafo': None
                    })
                    log.info("[RELAZIONI] Extracted Libro delle Obbligazioni from HTML")

            # Pattern 2: Relazione al Codice Civile
            relazione_codice_header = corpo.find('h3', string=lambda text:
                text and "Codice Civile" in text and "Relazione" in text)

            if relazione_codice_header:
                content = relazione_codice_header.find_next_sibling('div', class_='text')
                if content:
                    relazioni.append({
                        'tipo': 'codice_civile',
                        'titolo': 'Relazione al Codice Civile (1942)',
                        'testo': self._clean_text(content.get_text()),
                        'articoli_citati': self._extract_article_links(content),
                        'numero_paragrafo': None
                    })
                    log.info("[RELAZIONI] Extracted Codice Civile from HTML")

            if relazioni:
                info['Relazioni'] = relazioni
                log.info(f"[RELAZIONI] Successfully extracted {len(relazioni)} relazioni from HTML")

        except Exception as e:
            log.warning(f"[RELAZIONI] Error extracting Relazioni from HTML: {e}")

        # Estrai note a piè di pagina
        footnotes = self._extract_footnotes(corpo)
        if footnotes:
            info['Footnotes'] = footnotes

        # Estrai riferimenti incrociati
        cross_refs = self._extract_cross_references(corpo)
        if cross_refs:
            info['CrossReferences'] = cross_refs

    def _build_norma_string(self, norma_visitata: Union[NormaVisitata, str]) -> Optional[str]:
        if isinstance(norma_visitata, NormaVisitata):
            norma = norma_visitata.norma
            tipo_norm = normalize_act_type(norma.tipo_atto_str, True, 'brocardi')
            components = [tipo_norm]
            if norma.data:
                components.append(f"{norma.data},")
            if norma.numero_atto:
                components.append(f"n. {norma.numero_atto}")
            return " ".join(components).strip()
        elif isinstance(norma_visitata, str):
            return norma_visitata.strip()
        return None

    async def _fetch_soup(self, url: str, *, cache_suffix: str, source: str) -> Optional[BeautifulSoup]:
        cache_key = f"{cache_suffix}:{url}"
        cached_html = await self.cache.get(cache_key)
        if cached_html:
            log.info(f"Serving cached Brocardi content for {url}")
            return BeautifulSoup(cached_html, 'html.parser')

        try:
            result = await http_client.request("GET", url, source=source)
        except Exception as exc:
            log.error(f"Failed to retrieve content for {url}: {exc}")
            return None

        await self.cache.set(cache_key, result.text)
        return BeautifulSoup(result.text, 'html.parser')
