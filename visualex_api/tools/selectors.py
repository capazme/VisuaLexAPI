"""
Centralized HTML selectors for all scrapers.

Makes it easier to maintain when external sites change their HTML structure.
All CSS selectors for Normattiva, EUR-Lex, and Brocardi are defined here.

Example:
    from visualex_api.tools.selectors import NormattivaSelectors

    selectors = NormattivaSelectors()
    corpo = soup.find('div', class_=selectors.BODY_TESTO)
"""

from dataclasses import dataclass


@dataclass
class NormattivaSelectors:
    """CSS selectors for Normattiva.it HTML structure."""

    # Main document structure
    BODY_TESTO = "bodyTesto"

    # AKN Detailed format
    AKN_ARTICLE_NUMBER = "article-num-akn"
    AKN_ARTICLE_TITLE = "article-heading-akn"
    AKN_COMMA_DIV = "art-comma-div-akn"

    # AKN Simple format
    AKN_JUST_TEXT = "art-just-text-akn"

    # Attachment format
    ATTACHMENT_TEXT = "attachment-just-text"

    # Modifications/Updates
    AGGIORNAMENTI_BUTTON_ID = "aggiornamenti_atto_button"
    AGGIORNAMENTO_DIV = "art_aggiornamento-akn"

    # Attributes
    DATA_HREF = "data-href"


@dataclass
class EURLexSelectors:
    """CSS selectors for EUR-Lex HTML structure."""

    # Article structure
    ARTICLE_PARAGRAPH = "p"
    ARTICLE_CLASS = "ti-art"
    ARTICLE_DIV = "div"

    # Content
    SUBDIVISION = "eli-subdivision"
    NORMAL_PARAGRAPH = "oj-normal"

    # Canonical link
    CANONICAL_LINK_REL = "canonical"


@dataclass
class BrocardiSelectors:
    """CSS selectors for Brocardi.it HTML structure."""

    # Navigation
    BREADCRUMB_ID = "breadcrumb"
    SECTION_TITLE_CLASS = "section-title"

    # Content sections
    MAIN_CONTENT_CLASS = "panes-condensed panes-w-ads content-ext-guide content-mark"
    BROCARDI_CONTENT_CLASS = "brocardi-content"
    RATIO_CONTAINER_CLASS = "container-ratio"
    SPIEGAZIONE_CLASS = "spiegazione-articolo"

    # Massime
    MASSIME_CONTAINER_CLASS = "massime"
    MASSIMA_ITEM_CLASS = "massima-item"
