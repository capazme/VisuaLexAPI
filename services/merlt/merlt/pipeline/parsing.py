"""
Comma Parser for VisualexAPI Output
===================================

Parses article_text from VisualexAPI into structured components:
- numero_articolo: Article number (e.g., "1453", "1453-bis")
- rubrica: Article title/heading
- commas: List of comma paragraphs with text and token count

Zero-LLM approach: Pure regex-based extraction for reproducibility.

VisualexAPI article_text format:
```
Articolo 1453
Risoluzione per inadempimento

Nei contratti con prestazioni corrispettive...

La risoluzione può essere domandata...
```

Output structure:
```python
ArticleStructure(
    numero_articolo="1453",
    rubrica="Risoluzione per inadempimento",
    commas=[
        Comma(numero=1, testo="Nei contratti...", token_count=45),
        Comma(numero=2, testo="La risoluzione...", token_count=35),
    ]
)
```
"""

import re
import structlog
from dataclasses import dataclass, field
from typing import List, Optional
import tiktoken

log = structlog.get_logger()

# Token counter - use cl100k_base (GPT-4/Claude compatible)
try:
    _tokenizer = tiktoken.get_encoding("cl100k_base")
except Exception:
    _tokenizer = None
    log.warning("tiktoken not available, using word-based approximation for token counting")


def count_tokens(text: str) -> int:
    """
    Count tokens in text using tiktoken cl100k_base encoding.
    Falls back to word-based approximation if tiktoken unavailable.

    Args:
        text: Text to count tokens for

    Returns:
        Approximate token count
    """
    if not text:
        return 0

    if _tokenizer:
        return len(_tokenizer.encode(text))
    else:
        # Fallback: ~1.3 tokens per word for Italian legal text
        words = len(text.split())
        return int(words * 1.3)


@dataclass
class Lettera:
    """
    Represents a single lettera (sub-paragraph) within a comma.

    Italian legal structure: Articolo → Comma → Lettera → Numero
    Example: Art. 117 Cost., comma 2, lettera a)

    Attributes:
        lettera: Letter identifier (e.g., "a", "b", "c")
        testo: Full text of the lettera
        token_count: Number of tokens
    """
    lettera: str
    testo: str
    token_count: int = field(default=0)

    def __post_init__(self):
        if self.token_count == 0 and self.testo:
            self.token_count = count_tokens(self.testo)


@dataclass
class Comma:
    """
    Represents a single comma (paragraph) within an article.

    Attributes:
        numero: Comma number (1-indexed)
        testo: Full text of the comma (includes lettere text)
        token_count: Number of tokens in the comma text
        lettere: List of lettere (sub-paragraphs) if present
    """
    numero: int
    testo: str
    token_count: int = field(default=0)
    lettere: List['Lettera'] = field(default_factory=list)

    def __post_init__(self):
        if self.token_count == 0 and self.testo:
            self.token_count = count_tokens(self.testo)


@dataclass
class ArticleStructure:
    """
    Parsed structure of an article from VisualexAPI.

    Attributes:
        numero_articolo: Article number (e.g., "1453", "1453-bis", "2054 bis")
        rubrica: Article title/heading (may be None for some articles)
        commas: List of comma paragraphs
        raw_text: Original unparsed text
        total_tokens: Sum of all comma tokens
    """
    numero_articolo: str
    rubrica: Optional[str]
    commas: List[Comma]
    raw_text: str = ""
    total_tokens: int = field(default=0)

    def __post_init__(self):
        if self.total_tokens == 0 and self.commas:
            self.total_tokens = sum(c.token_count for c in self.commas)


class CommaParser:
    """
    Parser for extracting structured article components from VisualexAPI text.

    Design principles:
    - Zero-LLM: Pure regex-based for reproducibility
    - Handles edge cases: bis/ter/quater articles, missing rubrica
    - Consistent comma extraction via double-newline splitting

    Usage:
        parser = CommaParser()
        structure = parser.parse("Articolo 1453\\nRisoluzione...\\n\\nNei contratti...")
    """

    # Regex patterns for article number extraction
    # Handles: "Articolo 1453", "Art. 1453", "1453.", "Articolo 1453 bis", "Art. 2054-bis"
    ARTICLE_NUM_PATTERN = re.compile(
        r'^(?:Articolo|Art\.?)\s*'  # Prefix
        r'(\d+(?:\s*[-]?\s*(?:bis|ter|quater|quinquies|sexies|septies|octies|novies|decies))?)',  # Number + suffix
        re.IGNORECASE | re.MULTILINE
    )

    # Alternative pattern for just number at start
    ARTICLE_NUM_FALLBACK = re.compile(
        r'^(\d+(?:\s*[-]?\s*(?:bis|ter|quater|quinquies|sexies|septies|octies|novies|decies))?)\s*[.\s]',
        re.IGNORECASE | re.MULTILINE
    )

    # Minimum comma length to filter noise
    MIN_COMMA_LENGTH = 15

    # Maximum gap between paragraphs (more than 2 newlines = new comma)
    COMMA_SEPARATOR = re.compile(r'\n\s*\n+')

    # Pattern for lettere (sub-paragraphs): a), b), c)... or a., b., c....
    # Matches: "a) testo" or "a. testo" at beginning of line or after newline
    # Letters can be a-z, including bis/ter variants: a-bis), a-ter)
    LETTERA_PATTERN = re.compile(
        r'(?:^|\n)\s*([a-z](?:-(?:bis|ter|quater|quinquies|sexies|septies|octies|novies|decies))?)\s*[).]\s*',
        re.IGNORECASE
    )

    def __init__(self, min_comma_length: int = MIN_COMMA_LENGTH):
        """
        Initialize parser.

        Args:
            min_comma_length: Minimum character length for a valid comma
        """
        self.min_comma_length = min_comma_length

    def parse(self, article_text: str) -> ArticleStructure:
        """
        Parse article text into structured components.

        Args:
            article_text: Raw text from VisualexAPI article_text field

        Returns:
            ArticleStructure with extracted components

        Raises:
            ValueError: If article_text is empty or invalid
        """
        if not article_text or not article_text.strip():
            raise ValueError("article_text cannot be empty")

        text = article_text.strip()
        lines = text.split('\n')

        # Step 1: Extract numero_articolo from first line
        numero_articolo = self._extract_numero_articolo(lines[0])

        # Step 2: Find rubrica (usually second non-empty line)
        rubrica, content_start_idx = self._extract_rubrica(lines)

        # Step 3: Extract commas from remaining text
        content_text = '\n'.join(lines[content_start_idx:])
        commas = self._extract_commas(content_text)

        log.debug(
            f"Parsed article {numero_articolo}: rubrica='{rubrica}', "
            f"{len(commas)} commas, {sum(c.token_count for c in commas)} tokens"
        )

        return ArticleStructure(
            numero_articolo=numero_articolo,
            rubrica=rubrica,
            commas=commas,
            raw_text=text
        )

    def _extract_numero_articolo(self, first_line: str) -> str:
        """
        Extract article number from first line.

        Handles various formats:
        - "Articolo 1453"
        - "Art. 1453"
        - "Art. 1453-bis"
        - "Articolo 2054 bis"

        Args:
            first_line: First line of article text

        Returns:
            Extracted article number as string
        """
        # Try main pattern first
        match = self.ARTICLE_NUM_PATTERN.search(first_line)
        if match:
            # Normalize: remove extra spaces, standardize hyphen
            num = match.group(1).strip()
            num = re.sub(r'\s+', ' ', num)  # Normalize spaces
            num = re.sub(r'\s*-\s*', '-', num)  # "1453 - bis" -> "1453-bis"
            return num

        # Try fallback pattern
        match = self.ARTICLE_NUM_FALLBACK.search(first_line)
        if match:
            num = match.group(1).strip()
            num = re.sub(r'\s+', ' ', num)
            num = re.sub(r'\s*-\s*', '-', num)
            return num

        # Last resort: extract any number from first line
        numbers = re.findall(r'\d+', first_line)
        if numbers:
            log.warning(f"Used fallback number extraction for: {first_line[:50]}")
            return numbers[0]

        raise ValueError(f"Cannot extract article number from: {first_line[:100]}")

    def _extract_rubrica(self, lines: List[str]) -> tuple[Optional[str], int]:
        """
        Extract rubrica (article title) from lines.

        The rubrica is typically the second non-empty line after the article number.
        Some articles may not have a rubrica.

        Args:
            lines: All lines of the article text

        Returns:
            Tuple of (rubrica text or None, index where content starts)
        """
        if len(lines) < 2:
            return None, 1

        # Skip first line (article number), find next non-empty line
        rubrica = None
        content_start = 1

        for i, line in enumerate(lines[1:], start=1):
            stripped = line.strip()
            if stripped:
                # Check if this looks like a rubrica (title-like)
                # Rubrica is typically short (< 100 chars), no period at end, capitalized
                if self._is_rubrica(stripped):
                    rubrica = stripped
                    content_start = i + 1
                else:
                    # This is content, not rubrica
                    content_start = i
                break

        return rubrica, content_start

    def _is_rubrica(self, text: str) -> bool:
        """
        Determine if a line is likely a rubrica (article title).

        Heuristics:
        - Relatively short (< 150 chars)
        - Doesn't end with period (titles usually don't)
        - BUT: text in parentheses IS a rubrica (Codice Civile style)
        - Doesn't start with lowercase (content usually starts with "La", "Il", etc.)
        - Not a full sentence structure

        Args:
            text: Line to check

        Returns:
            True if likely a rubrica

        Examples:
            "(Fonti delle obbligazioni)." -> True (rubrica tra parentesi)
            "(Carattere patrimoniale della prestazione)." -> True
            "Le obbligazioni derivano da contratto..." -> False (contenuto)
        """
        # Too long for a title
        if len(text) > 150:
            return False

        # Check for rubrica in parentheses (Codice Civile style)
        # Pattern: (Titolo). or (Titolo)
        # Questo cattura le rubriche del tipo "(Fonti delle obbligazioni)."
        if re.match(r'^\([^)]+\)\.?$', text):
            return True

        # Ends with period = likely content (but not if it's in parentheses - handled above)
        if text.endswith('.'):
            return False

        # Contains "comma" reference = likely content
        if re.search(r'\bcomma\b', text, re.IGNORECASE):
            return False

        # Starts with article/preposition = likely content
        content_starters = ['il ', 'la ', 'lo ', 'i ', 'le ', 'gli ', 'un ', 'una ',
                          'nel ', 'nella ', 'nei ', 'nelle ', 'quando ', 'se ',
                          'chi ', 'chiunque ', 'qualora ']
        text_lower = text.lower()
        if any(text_lower.startswith(s) for s in content_starters):
            return False

        return True

    # Pattern per identificare inizio di una lettera: a), b), c)... o a., b., c....
    # Include anche bis/ter variants
    LETTERA_START_PATTERN = re.compile(
        r'^\s*([a-z](?:-(?:bis|ter|quater|quinquies|sexies|septies|octies|novies|decies))?)\s*[).]\s*',
        re.IGNORECASE
    )

    def _merge_lettere_paragraphs(self, content_text: str) -> str:
        """
        Merge consecutive paragraphs that are lettere (a), b), c)...) into single comma.

        Normattiva often separates each lettera with double newlines, but they should
        be part of the same comma. This method detects consecutive lettere and merges
        them with single newlines to keep them together.

        Example:
            Input:
                "materie:\\n\\na) politica estera;\\n\\nb) immigrazione;\\n\\nc) difesa;"
            Output:
                "materie:\\na) politica estera;\\nb) immigrazione;\\nc) difesa;"

        Args:
            content_text: Raw article text

        Returns:
            Text with consecutive lettere merged into same paragraph
        """
        # Split on double newlines
        paragraphs = self.COMMA_SEPARATOR.split(content_text.strip())

        if len(paragraphs) < 2:
            return content_text

        merged = []
        i = 0

        while i < len(paragraphs):
            current = paragraphs[i].strip()

            # Check if this is a lettera
            is_lettera = bool(self.LETTERA_START_PATTERN.match(current))

            if is_lettera:
                # Start collecting consecutive lettere
                lettera_group = [current]
                j = i + 1

                while j < len(paragraphs):
                    next_para = paragraphs[j].strip()
                    if self.LETTERA_START_PATTERN.match(next_para):
                        lettera_group.append(next_para)
                        j += 1
                    else:
                        break

                # If we found multiple consecutive lettere, merge them
                if len(lettera_group) > 1:
                    # Check if the paragraph before the lettere introduces them
                    # (e.g., "Lo Stato ha legislazione esclusiva nelle seguenti materie:")
                    if merged and merged[-1].strip().endswith(':'):
                        # Merge intro + lettere
                        intro = merged.pop()
                        merged.append(intro + '\n' + '\n'.join(lettera_group))
                    else:
                        # Just merge the lettere together
                        merged.append('\n'.join(lettera_group))
                    i = j
                    continue

            # Not a lettera or single lettera - keep as is
            merged.append(current)
            i += 1

        # Rejoin with double newlines
        return '\n\n'.join(merged)

    def _extract_commas(self, content_text: str) -> List[Comma]:
        """
        Extract comma paragraphs from content text.

        Commas are separated by double newlines (blank lines).
        Each comma is numbered sequentially.
        Lettere within commas are also extracted.

        Special handling for lettere: consecutive paragraphs that start with
        letter patterns (a), b), c)...) are merged into a single comma.

        Args:
            content_text: Article content after numero and rubrica

        Returns:
            List of Comma objects with optional lettere
        """
        if not content_text.strip():
            return []

        # Pre-process: merge consecutive lettere into single comma
        content_text = self._merge_lettere_paragraphs(content_text)

        # Split on double newlines (one or more blank lines)
        raw_paragraphs = self.COMMA_SEPARATOR.split(content_text.strip())

        commas = []
        comma_num = 0

        for para in raw_paragraphs:
            # Clean up the paragraph
            cleaned = para.strip()

            # Skip if too short (noise, artifacts)
            if len(cleaned) < self.min_comma_length:
                continue

            # Skip if it looks like metadata or noise
            if self._is_metadata(cleaned):
                continue

            comma_num += 1

            # Extract lettere from this comma
            lettere = self._extract_lettere(cleaned)

            commas.append(Comma(
                numero=comma_num,
                testo=cleaned,
                lettere=lettere
            ))

        return commas

    def _extract_lettere(self, comma_text: str) -> List[Lettera]:
        """
        Extract lettere (sub-paragraphs) from a comma text.

        Lettere are identified by patterns like:
        - a) testo della lettera
        - b) altro testo
        - a-bis) variante

        Args:
            comma_text: Full text of a comma paragraph

        Returns:
            List of Lettera objects, empty if no lettere found
        """
        lettere = []

        # Find all lettera markers
        matches = list(self.LETTERA_PATTERN.finditer(comma_text))

        if not matches:
            return lettere

        # Check if this looks like a list of lettere (at least 2)
        # Single match might be a false positive
        if len(matches) < 2:
            return lettere

        for i, match in enumerate(matches):
            letter = match.group(1).lower()
            start = match.end()

            # Find end: either next lettera or end of text
            if i + 1 < len(matches):
                end = matches[i + 1].start()
            else:
                end = len(comma_text)

            # Extract lettera text
            lettera_text = comma_text[start:end].strip()

            # Clean trailing semicolon/period if present
            lettera_text = lettera_text.rstrip(';.')

            if lettera_text:  # Only add if there's actual content
                lettere.append(Lettera(
                    lettera=letter,
                    testo=lettera_text
                ))

        return lettere

    def _is_metadata(self, text: str) -> bool:
        """
        Check if text is metadata/noise rather than actual comma content.

        Args:
            text: Text to check

        Returns:
            True if likely metadata
        """
        # Check for common metadata patterns
        metadata_patterns = [
            r'^Note:',
            r'^\[.*\]$',  # [ABROGATO], [VIGENTE], etc.
            r'^Vedi anche',
            r'^Cfr\.',
            r'^V\.',
        ]

        for pattern in metadata_patterns:
            if re.match(pattern, text, re.IGNORECASE):
                return True

        return False


def parse_article(article_text: str, min_comma_length: int = 15) -> ArticleStructure:
    """
    Convenience function to parse an article.

    Args:
        article_text: Raw text from VisualexAPI
        min_comma_length: Minimum comma length (default 15)

    Returns:
        ArticleStructure with parsed components
    """
    parser = CommaParser(min_comma_length=min_comma_length)
    return parser.parse(article_text)


# Exports
__all__ = [
    'Lettera',
    'Comma',
    'ArticleStructure',
    'CommaParser',
    'parse_article',
    'count_tokens',
]
