import structlog
import re
import os
from typing import Optional, Tuple, Union, Dict, Any, List
from dataclasses import dataclass

import aiohttp
import asyncio
import requests
from bs4 import BeautifulSoup
from aiocache import cached, Cache
from aiocache.serializers import JsonSerializer

from merlt.sources.utils.map import BROCARDI_CODICI
from merlt.sources.utils.norma import NormaVisitata
from merlt.sources.utils.text import normalize_act_type
from merlt.sources.base import BaseScraper
from merlt.sources.utils.http import http_client

# Configurazione del logger di modulo
log = structlog.get_logger()


# Costanti per la configurazione
BASE_URL: str = "https://brocardi.it"
MAX_CONCURRENT_REQUESTS = 3  # Limitiamo le richieste concorrenti
REQUEST_TIMEOUT = 10  # Timeout per le richieste HTTP
RETRY_ATTEMPTS = 2  # Numero di retry per richiesta fallita
RETRY_DELAY = 1.0  # Delay tra i retry in secondi


# Autorità giudiziarie italiane per parsing massime
# Pattern regex per riconoscere le varie autorità
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

# Pattern combinato per tutte le autorità (per il parsing)
AUTORITA_PATTERN = '|'.join(f'({pattern})' for pattern in AUTORITA_GIUDIZIARIE.values())


@dataclass
class RequestConfig:
    """Configurazione per le richieste HTTP"""
    timeout: int = REQUEST_TIMEOUT
    retry_attempts: int = RETRY_ATTEMPTS
    retry_delay: float = RETRY_DELAY


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
        self.request_config = RequestConfig()
        # Semaforo per limitare le richieste concorrenti
        self.semaphore = asyncio.Semaphore(MAX_CONCURRENT_REQUESTS)

    @staticmethod
    def _clean_text(text: str) -> str:
        """
        Pulisce il testo estratto dall'HTML.

        - Normalizza whitespace (newlines, spazi multipli → spazio singolo)
        - Rimuove spazi iniziali/finali
        - Gestisce encoding UTF-8
        """
        if not text:
            return ""
        # Normalizza newlines e whitespace
        cleaned = re.sub(r'\s+', ' ', text)
        # Strip e ritorna
        return cleaned.strip()

    def _parse_massima(self, sentenza_div) -> Optional[Dict[str, Any]]:
        """
        Parsa una singola massima giurisprudenziale dalla struttura HTML Brocardi.

        Supporta tutte le autorità giudiziarie italiane:
        - Corte Costituzionale (Corte cost., C. cost.)
        - Corte di Cassazione (Cass. civ., Cass. pen., Cass. lav., Cass. sez. un.)
        - Consiglio di Stato (Cons. St., Cons. Stato)
        - TAR (TAR Lazio, TAR Lombardia, etc.)
        - Corte dei Conti (Corte conti, C. conti)
        - Corte d'Appello (App., C. App.)
        - Tribunale (Trib.)
        - CGUE (Corte giust. UE)
        - CEDU (Corte EDU)

        HTML structure:
        <div class="sentenza corpoDelTesto">
            <p><strong>Corte cost. n. 123/2021</strong></p>
            <p>Testo della massima...</p>
        </div>

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

                # Pattern generico: (Autorita) n. (Numero)/(Anno)
                # Supporta tutte le autorità definite in AUTORITA_GIUDIZIARIE
                match = re.match(
                    rf'^({AUTORITA_PATTERN})\s*n\.\s*(\d+)/(\d{{4}})',
                    header_text,
                    re.IGNORECASE
                )
                if match:
                    # Trova il primo gruppo non-None (l'autorità matchata)
                    groups = match.groups()
                    # I primi N gruppi sono le autorità, poi numero e anno
                    num_autorita = len(AUTORITA_GIUDIZIARIE)
                    for i in range(num_autorita):
                        if groups[i]:
                            result['autorita'] = groups[i].strip()
                            break
                    # Numero e anno sono gli ultimi due gruppi
                    result['numero'] = groups[-2]
                    result['anno'] = groups[-1]
                else:
                    # Fallback: try to extract any number/year pattern
                    num_match = re.search(r'n\.\s*(\d+)/(\d{4})', header_text)
                    if num_match:
                        result['numero'] = num_match.group(1)
                        result['anno'] = num_match.group(2)

                    # Extract autorita from beginning usando pattern generico
                    auth_match = re.match(rf'^({AUTORITA_PATTERN})', header_text, re.IGNORECASE)
                    if auth_match:
                        # Trova il primo gruppo non-None
                        for g in auth_match.groups():
                            if g:
                                result['autorita'] = g.strip().rstrip('.')
                                break
                    elif not result['autorita']:
                        # Ultimo fallback: prendi tutto prima di "n."
                        fallback_match = re.match(r'^([^n]+?)(?:\s*n\.|\s*$)', header_text)
                        if fallback_match:
                            result['autorita'] = fallback_match.group(1).strip().rstrip('.')

            # Get full text (excluding the header)
            full_text = self._clean_text(sentenza_div.get_text())

            # Remove the header part from the text to get just the massima
            if result['numero'] and result['anno']:
                # Pattern generico per rimuovere l'header
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

    async def _make_request_with_retry(self, session: aiohttp.ClientSession, url: str, 
                                       config: RequestConfig = None) -> Optional[str]:
        """
        Effettua una richiesta HTTP con retry automatico e gestione errori migliorata.
        """
        if config is None:
            config = self.request_config
            
        for attempt in range(config.retry_attempts + 1):
            try:
                # Acquisisce il semaforo per limitare le richieste concorrenti
                async with self.semaphore:
                    timeout = aiohttp.ClientTimeout(total=config.timeout)
                    log.debug(f"Attempting request {attempt + 1}/{config.retry_attempts + 1} to: {url}")
                    
                    async with session.get(url, timeout=timeout) as response:
                        response.raise_for_status()
                        return await response.text()
                        
            except asyncio.TimeoutError:
                log.warning(f"Timeout for URL {url} on attempt {attempt + 1}")
            except aiohttp.ClientError as e:
                log.warning(f"HTTP error for URL {url} on attempt {attempt + 1}: {e}")
            except Exception as e:
                log.error(f"Unexpected error for URL {url} on attempt {attempt + 1}: {e}")
            
            # Se non è l'ultimo tentativo, aspetta prima di riprovare
            if attempt < config.retry_attempts:
                wait_time = config.retry_delay * (2 ** attempt)  # Exponential backoff
                log.debug(f"Waiting {wait_time}s before retry...")
                await asyncio.sleep(wait_time)
        
        log.error(f"Failed to fetch {url} after {config.retry_attempts + 1} attempts")
        return None

    @cached(ttl=86400, cache=Cache.MEMORY, serializer=JsonSerializer())
    async def do_know(self, norma_visitata: NormaVisitata) -> Optional[Tuple[str, str]]:
        log.info(f"Checking if knowledge exists for norma: {norma_visitata}")

        norma_str: Optional[str] = self._build_norma_string(norma_visitata)
        if norma_str is None:
            log.error("Invalid norma format")
            raise ValueError("Invalid norma format")

        search_str = norma_str.lower()

        # Prima prova: ricerca esatta
        for txt, link in self.knowledge[0].items():
            if search_str in txt.lower():
                log.info(f"Knowledge found (exact) for norma: {norma_visitata}")
                return txt, link

        # Seconda prova: ricerca per tipo_atto (es. "codice civile")
        # Utile quando il formato data non matcha (ISO vs italiano)
        if hasattr(norma_visitata, 'norma') and norma_visitata.norma:
            tipo_atto = norma_visitata.norma.tipo_atto_str.lower()
            for txt, link in self.knowledge[0].items():
                txt_lower = txt.lower()
                # Match per tipo_atto + numero_atto
                if tipo_atto in txt_lower:
                    # Verifica anche numero_atto se presente
                    if norma_visitata.norma.numero_atto:
                        if f"n. {norma_visitata.norma.numero_atto}" in txt_lower:
                            log.info(f"Knowledge found (fuzzy) for norma: {norma_visitata}")
                            return txt, link
                    else:
                        # Solo tipo_atto (es. "costituzione")
                        log.info(f"Knowledge found (tipo_atto) for norma: {norma_visitata}")
                        return txt, link

        log.warning(f"No knowledge found for norma: {norma_visitata}")
        return None

    @cached(ttl=86400, cache=Cache.MEMORY, serializer=JsonSerializer())
    async def look_up(self, norma_visitata: NormaVisitata) -> Optional[str]:
        log.info(f"Looking up norma: {norma_visitata}")

        norma_info = await self.do_know(norma_visitata)
        if not norma_info:
            log.info("No norma info found in knowledge base")
            return None

        link: str = norma_info[1]
        
        session = await http_client.get_session()
        log.info(f"Requesting main link: {link}")
        html_text = await self._make_request_with_retry(session, link)
        if not html_text:
            log.error(f"Failed to retrieve content for norma link: {link}")
            return None
            
        soup: BeautifulSoup = BeautifulSoup(html_text, 'html.parser')

        numero_articolo: Optional[str] = (
            norma_visitata.numero_articolo.replace('-', '')
            if norma_visitata.numero_articolo else None
        )
        
        if numero_articolo:
            article_link = await self._find_article_link(soup, BASE_URL, numero_articolo, session)
            return article_link
            
        log.info("No article number provided")
        return None

    async def _find_article_link(self, soup: BeautifulSoup, base_url: str, numero_articolo: str, 
                                 session: aiohttp.ClientSession) -> Optional[str]:
        """
        Trova il link dell'articolo con logica migliorata per ridurre le richieste.
        """
        # Compila il pattern una sola volta
        pattern = re.compile(rf'href=["\']([^"\']*art{re.escape(numero_articolo)}\.html)["\']')
        log.info(f"Searching for article {numero_articolo} in the main page content")

        # Prima ricerca: nella pagina principale
        matches = pattern.findall(str(soup))
        if matches:
            found_url = requests.compat.urljoin(base_url, matches[0])
            log.info(f"Direct match found: {found_url}")
            return found_url

        # Seconda ricerca: nelle sezioni, ma con limit e strategia migliorata
        log.info("No direct match found, searching in section links with rate limiting")
        section_titles = soup.find_all('div', class_='section-title')
        
        if not section_titles:
            log.warning("No section-title divs found")
            return None

        # Raccogliamo tutti i link delle sezioni
        section_links = []
        for section in section_titles:
            for a_tag in section.find_all('a', href=True):
                href = a_tag.get('href', '')
                if href:  # Solo link validi
                    full_link = requests.compat.urljoin(base_url, href)
                    section_links.append(full_link)

        # Limitiamo il numero di sezioni da controllare per evitare troppe richieste
        max_sections_to_check = min(len(section_links), 10)  # Massimo 10 sezioni
        section_links = section_links[:max_sections_to_check]
        
        log.info(f"Checking {len(section_links)} section links for article {numero_articolo}")

        # Processiamo le richieste in batch per controllare il carico
        batch_size = 3
        for i in range(0, len(section_links), batch_size):
            batch = section_links[i:i + batch_size]
            tasks = [self._check_section_for_article(session, link, pattern, base_url) 
                    for link in batch]
            
            try:
                # Usiamo timeout per evitare che si blocchi indefinitamente
                results = await asyncio.wait_for(
                    asyncio.gather(*tasks, return_exceptions=True), 
                    timeout=30.0
                )
                
                # Controlliamo i risultati
                for result in results:
                    if isinstance(result, str) and result:  # Link trovato
                        log.info(f"Article link found in section: {result}")
                        return result
                    elif isinstance(result, Exception):
                        log.debug(f"Exception in section check: {result}")
                        
            except asyncio.TimeoutError:
                log.warning(f"Timeout while checking batch {i//batch_size + 1}")
                continue
            except Exception as e:
                log.error(f"Unexpected error in batch {i//batch_size + 1}: {e}")
                continue

            # Piccola pausa tra i batch per essere rispettosi verso il server
            if i + batch_size < len(section_links):
                await asyncio.sleep(0.5)

        log.info(f"No matching article found for {numero_articolo} after checking sections")
        return None

    async def _check_section_for_article(self, session: aiohttp.ClientSession, section_url: str, 
                                         pattern: re.Pattern, base_url: str) -> Optional[str]:
        """
        Controlla una singola sezione per l'articolo cercato.
        """
        try:
            log.debug(f"Checking section: {section_url}")
            html_content = await self._make_request_with_retry(session, section_url)
            
            if html_content:
                matches = pattern.findall(html_content)
                if matches:
                    found_url = requests.compat.urljoin(base_url, matches[0])
                    log.debug(f"Article found in section {section_url}: {found_url}")
                    return found_url
                    
        except Exception as e:
            log.debug(f"Error checking section {section_url}: {e}")
            
        return None

    async def get_info(self, norma_visitata: NormaVisitata) -> Tuple[Optional[str], Dict[str, Any], Optional[str]]:
        """
        Ottiene le informazioni della norma con gestione errori migliorata.

        Returns:
            Tuple con:
            - Position (breadcrumb)
            - Dict con: Brocardi, Ratio, Spiegazione, Massime, Relazioni
            - URL della pagina Brocardi
        """
        log.info(f"Getting info for norma: {norma_visitata}")

        try:
            norma_link = await self.look_up(norma_visitata)
            if not norma_link:
                log.info("No norma link found")
                return None, {}, None

            session = await http_client.get_session()
            html_text = await self._make_request_with_retry(session, norma_link)

            if not html_text:
                log.error(f"Failed to retrieve content for norma link: {norma_link}")
                return None, {}, None

            soup = BeautifulSoup(html_text, 'html.parser')

            info: Dict[str, Any] = {}
            info['Position'] = self._extract_position(soup)
            self._extract_sections(soup, info)

            # Estrai Relazioni storiche (Guardasigilli)
            relazioni = await self._extract_relazioni(soup, session)
            if relazioni:
                info['Relazioni'] = [
                    {
                        'tipo': r.tipo,
                        'titolo': r.titolo,
                        'numero_paragrafo': r.numero_paragrafo,
                        'testo': r.testo,
                        'articoli_citati': r.articoli_citati
                    }
                    for r in relazioni
                ]
                log.info(f"Extracted {len(relazioni)} relazioni for {norma_visitata}")

            log.info(f"Successfully extracted info for norma: {norma_visitata}")
            return info.get('Position'), info, norma_link

        except Exception as e:
            log.error(f"Unexpected error in get_info for {norma_visitata}: {e}")
            return None, {}, None

    def _extract_position(self, soup: BeautifulSoup) -> Optional[str]:
        """Estrae la posizione dal breadcrumb."""
        try:
            position_tag = soup.find('div', id='breadcrumb', recursive=True)
            if position_tag:
                # Pulisci e normalizza il breadcrumb
                position = self._clean_text(position_tag.get_text())
                # Rimuovi prefisso "Brocardi.it > "
                if position.startswith("Brocardi.it"):
                    position = position[17:].strip(" >")
                return position if position else None
        except Exception as e:
            log.warning(f"Error extracting position: {e}")

        log.warning("Breadcrumb position not found")
        return None

    def _extract_sections(self, soup: BeautifulSoup, info: Dict[str, Any]) -> None:
        """Estrae le sezioni del contenuto con gestione errori migliorata."""
        try:
            corpo = soup.find('div', class_='panes-condensed panes-w-ads content-ext-guide content-mark', recursive=True)
            if not corpo:
                log.warning("Main content section not found")
                return

            # Estrazione Brocardi
            try:
                brocardi_sections = corpo.find_all('div', class_='brocardi-content')
                if brocardi_sections:
                    info['Brocardi'] = [
                        self._clean_text(section.get_text())
                        for section in brocardi_sections
                    ]
            except Exception as e:
                log.warning(f"Error extracting Brocardi sections: {e}")

            # Estrazione Ratio
            try:
                ratio_section = corpo.find('div', class_='container-ratio')
                if ratio_section:
                    ratio_text = ratio_section.find('div', class_='corpoDelTesto')
                    if ratio_text:
                        info['Ratio'] = self._clean_text(ratio_text.get_text())
            except Exception as e:
                log.warning(f"Error extracting Ratio section: {e}")

            # Estrazione Spiegazione
            try:
                spiegazione_header = corpo.find('h3', string=lambda text: text and "Spiegazione dell'art" in text)
                if spiegazione_header:
                    spiegazione_content = spiegazione_header.find_next_sibling('div', class_='text')
                    if spiegazione_content:
                        info['Spiegazione'] = self._clean_text(spiegazione_content.get_text())
            except Exception as e:
                log.warning(f"Error extracting Spiegazione section: {e}")

            # Estrazione Massime - FIXED: parse structured sentenze
            try:
                massime_header = corpo.find('h3', string=lambda text: text and "Massime relative all'art" in text)
                if massime_header:
                    massime_content = massime_header.find_next_sibling('div', class_='text')
                    if massime_content:
                        # Find all sentenza divs (not iterate over all children!)
                        sentenze_divs = massime_content.find_all('div', class_='sentenza')
                        info['Massime'] = []
                        for sentenza_div in sentenze_divs:
                            parsed = self._parse_massima(sentenza_div)
                            if parsed:
                                info['Massime'].append(parsed)
                        log.debug(f"Extracted {len(info['Massime'])} massime")
            except Exception as e:
                log.warning(f"Error extracting Massime section: {e}")

            # Estrazione Relazione al Progetto della Costituzione (direttamente nell'HTML)
            # Usato per la Costituzione - diverso dalle Relazioni del Guardasigilli (AJAX)
            try:
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
            except Exception as e:
                log.warning(f"Error extracting Relazione Costituzione: {e}")
                
        except Exception as e:
            log.error(f"Unexpected error in _extract_sections: {e}")

    def _build_norma_string(self, norma_visitata: Union[NormaVisitata, str]) -> Optional[str]:
        """Costruisce la stringa della norma per la ricerca."""
        try:
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
        except Exception as e:
            log.error(f"Error building norma string: {e}")

        return None

    def _extract_object_id(self, soup: BeautifulSoup) -> Optional[str]:
        """Estrae l'object_id dalla pagina (usato per chiamate AJAX)."""
        try:
            # Cerca data-object-id nel button di download PDF
            button = soup.find('button', class_='button-download-pdf')
            if button and button.get('data-object-id'):
                return button.get('data-object-id')

            # Fallback: cerca nel pattern hierarchy-paragraphs
            html_str = str(soup)
            match = re.search(r'hierarchy-paragraphs:(\d+):', html_str)
            if match:
                return match.group(1)

        except Exception as e:
            log.warning(f"Error extracting object_id: {e}")

        return None

    async def _fetch_relazione(self, session: aiohttp.ClientSession, object_id: str,
                               content_type: int) -> Optional[str]:
        """
        Recupera il contenuto della Relazione via AJAX.

        Args:
            object_id: ID dell'articolo su Brocardi
            content_type: 1 = Relazione al Codice Civile, 3 = Relazione al Libro delle Obbligazioni
        """
        url = f"{BASE_URL}/ws.php?action=articolo:hierarchy-paragraphs:{object_id}:{content_type}"

        try:
            headers = {
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': BASE_URL
            }
            async with self.semaphore:
                timeout = aiohttp.ClientTimeout(total=self.request_config.timeout)
                async with session.get(url, timeout=timeout, headers=headers) as response:
                    if response.status == 200:
                        return await response.text()
        except Exception as e:
            log.warning(f"Error fetching relazione (type={content_type}): {e}")

        return None

    def _parse_relazione_content(self, html: str, tipo: str) -> Optional[RelazioneContent]:
        """
        Parsa il contenuto HTML della Relazione.

        Args:
            html: HTML restituito dall'endpoint AJAX
            tipo: "libro_obbligazioni" o "codice_civile"
        """
        try:
            soup = BeautifulSoup(html, 'html.parser')
            corpo = soup.find('div', class_='corpoDelTesto')

            if not corpo:
                return None

            # Estrai numero paragrafo
            numero_span = corpo.find('span', class_='paragrafo-numero')
            numero_paragrafo = numero_span.get_text(strip=True) if numero_span else None

            # Estrai articoli citati (link interni)
            articoli_citati = []
            for link in corpo.find_all('a', href=True):
                href = link.get('href', '')
                if '/art' in href and '.html' in href:
                    # Estrai numero articolo dal link
                    match = re.search(r'/art(\d+[a-z]*)\.html', href)
                    if match:
                        articoli_citati.append({
                            'numero': match.group(1),
                            'titolo': link.get('title', ''),
                            'url': href if href.startswith('http') else f"{BASE_URL}{href}"
                        })

            # Estrai testo completo (rimuovendo il numero paragrafo)
            if numero_span:
                numero_span.decompose()
            testo = self._clean_text(corpo.get_text())

            # Determina titolo
            titolo = ("Relazione al Libro delle Obbligazioni (1941)"
                     if tipo == "libro_obbligazioni"
                     else "Relazione al Codice Civile (1942)")

            return RelazioneContent(
                tipo=tipo,
                titolo=titolo,
                numero_paragrafo=numero_paragrafo,
                testo=testo,
                articoli_citati=articoli_citati
            )

        except Exception as e:
            log.warning(f"Error parsing relazione content: {e}")

        return None

    async def _extract_relazioni(self, soup: BeautifulSoup,
                                  session: aiohttp.ClientSession) -> List[RelazioneContent]:
        """
        Estrae le Relazioni storiche (Guardasigilli) dalla pagina.

        Returns:
            Lista di RelazioneContent con i testi delle relazioni e gli articoli citati
        """
        relazioni = []

        try:
            object_id = self._extract_object_id(soup)
            if not object_id:
                log.debug("No object_id found, skipping relazioni extraction")
                return relazioni

            # Relazione al Libro delle Obbligazioni (content_type=3)
            html_libro = await self._fetch_relazione(session, object_id, 3)
            if html_libro:
                relazione = self._parse_relazione_content(html_libro, "libro_obbligazioni")
                if relazione and relazione.testo:
                    relazioni.append(relazione)
                    log.debug(f"Extracted Relazione Libro Obbligazioni (§{relazione.numero_paragrafo})")

            # Relazione al Codice Civile (content_type=1)
            html_codice = await self._fetch_relazione(session, object_id, 1)
            if html_codice:
                relazione = self._parse_relazione_content(html_codice, "codice_civile")
                if relazione and relazione.testo:
                    relazioni.append(relazione)
                    log.debug(f"Extracted Relazione Codice Civile (§{relazione.numero_paragrafo})")

        except Exception as e:
            log.warning(f"Error extracting relazioni: {e}")

        return relazioni
