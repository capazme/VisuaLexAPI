"""
Data Converter per NER Training
================================

Converte feedback RLCF in formato spaCy per training.

Supporta:
- Conversione NERFeedbackRequest → (text, annotations)
- Export batch training set in DocBin
- Validazione format annotations
"""

from typing import Any, Dict, List, Tuple

import structlog

logger = structlog.get_logger()


def feedback_to_spacy_format(feedback: Dict[str, Any]) -> Tuple[str, Dict]:
    """
    Converte feedback NER in formato spaCy.

    Args:
        feedback: Dict con chiavi:
            - text: Testo originale
            - citations: Lista citazioni con start, end, label
            - user_corrections: Correzioni utente (opzionale)

    Returns:
        Tuple (text, annotations) dove annotations è:
            {
                "entities": [(start, end, label), ...]
            }

    Example:
        >>> feedback = {
        ...     "text": "L'art. 1453 del codice civile regola...",
        ...     "citations": [
        ...         {"start": 2, "end": 11, "label": "ARTICOLO"},
        ...         {"start": 16, "end": 29, "label": "CODICE"}
        ...     ]
        ... }
        >>> text, annotations = feedback_to_spacy_format(feedback)
        >>> print(annotations)
        {'entities': [(2, 11, 'ARTICOLO'), (16, 29, 'CODICE')]}
    """
    text = feedback.get("text", "")
    citations = feedback.get("citations", [])
    user_corrections = feedback.get("user_corrections", {})

    # Applica correzioni utente se presenti
    if user_corrections:
        citations = _apply_corrections(citations, user_corrections)

    # Converti in formato spaCy
    entities = []
    for citation in citations:
        start = citation.get("start")
        end = citation.get("end")
        label = citation.get("label")

        # Validazione
        if start is None or end is None or not label:
            logger.warning(
                "invalid_citation_skipped",
                citation=citation,
            )
            continue

        # Validazione span
        if start >= end or start < 0 or end > len(text):
            logger.warning(
                "invalid_span_skipped",
                start=start,
                end=end,
                text_length=len(text),
            )
            continue

        entities.append((start, end, label))

    # Ordina per start position (richiesto da spaCy)
    entities.sort(key=lambda x: x[0])

    # Verifica overlap (non permesso da spaCy)
    entities = _remove_overlapping_entities(entities)

    annotations = {"entities": entities}

    logger.debug(
        "feedback_converted",
        text_length=len(text),
        entities_count=len(entities),
    )

    return text, annotations


def _apply_corrections(
    citations: List[Dict], corrections: Dict[str, Any]
) -> List[Dict]:
    """
    Applica correzioni utente alle citazioni estratte.

    Args:
        citations: Citazioni originali
        corrections: Correzioni dall'utente:
            - add: Lista entità da aggiungere
            - remove: Lista ID entità da rimuovere
            - modify: Dict ID → nuova entità

    Returns:
        Lista citazioni corretta
    """
    # Rimuovi entità
    remove_ids = set(corrections.get("remove", []))
    citations = [
        c for c in citations if c.get("id") not in remove_ids
    ]

    # Modifica entità
    modify_map = corrections.get("modify", {})
    for citation in citations:
        citation_id = citation.get("id")
        if citation_id in modify_map:
            citation.update(modify_map[citation_id])

    # Aggiungi nuove entità
    add_entities = corrections.get("add", [])
    citations.extend(add_entities)

    return citations


def _remove_overlapping_entities(entities: List[Tuple[int, int, str]]) -> List[Tuple[int, int, str]]:
    """
    Rimuove entità overlapping (spaCy non le permette).

    Strategy: Mantiene l'entità più lunga in caso di overlap.

    Args:
        entities: Lista (start, end, label) ordinata per start

    Returns:
        Lista senza overlap
    """
    if not entities:
        return []

    cleaned = [entities[0]]

    for current in entities[1:]:
        prev = cleaned[-1]
        current_start, current_end, current_label = current
        prev_start, prev_end, prev_label = prev

        # Check overlap
        if current_start < prev_end:
            # Overlap: mantieni la più lunga
            prev_length = prev_end - prev_start
            current_length = current_end - current_start

            if current_length > prev_length:
                # Sostituisci con current
                cleaned[-1] = current
                logger.debug(
                    "overlap_resolved_keeping_longer",
                    removed=(prev_start, prev_end, prev_label),
                    kept=current,
                )
        else:
            # No overlap, aggiungi
            cleaned.append(current)

    return cleaned


def export_training_batch(feedbacks: List[Dict[str, Any]]) -> Any:
    """
    Export batch di feedback in DocBin per training offline.

    Args:
        feedbacks: Lista feedback da esportare

    Returns:
        spacy.tokens.DocBin con tutti i documenti annotati

    Example:
        >>> feedbacks = load_feedbacks_from_db()
        >>> doc_bin = export_training_batch(feedbacks)
        >>> doc_bin.to_disk("training_data/legal_ner_batch_001.spacy")
    """
    try:
        import spacy
        from spacy.tokens import DocBin
    except ImportError as e:
        logger.error("spacy_not_installed", error=str(e))
        raise ImportError(
            "spaCy non installato. Esegui: pip install spacy>=3.5"
        ) from e

    # Carica modello per creare Doc objects
    try:
        nlp = spacy.load("it_core_news_lg")
    except OSError as e:
        logger.error("base_model_not_found", error=str(e))
        raise RuntimeError(
            "Modello base it_core_news_lg non trovato. "
            "Esegui: python -m spacy download it_core_news_lg"
        ) from e

    doc_bin = DocBin()

    for feedback in feedbacks:
        try:
            text, annotations = feedback_to_spacy_format(feedback)
            doc = nlp.make_doc(text)

            # Aggiungi entities
            ents = []
            for start, end, label in annotations["entities"]:
                span = doc.char_span(start, end, label=label)
                if span:
                    ents.append(span)
                else:
                    logger.warning(
                        "span_creation_failed",
                        start=start,
                        end=end,
                        label=label,
                    )

            doc.ents = ents
            doc_bin.add(doc)

        except Exception as e:
            logger.warning(
                "failed_to_export_feedback",
                feedback_id=feedback.get("id", "unknown"),
                error=str(e),
            )
            continue

    logger.info(
        "batch_exported",
        docs_count=len(doc_bin),
        feedbacks_count=len(feedbacks),
    )

    return doc_bin


def validate_annotations(text: str, entities: List[Tuple[int, int, str]]) -> bool:
    """
    Valida che le annotations siano consistenti con il testo.

    Args:
        text: Testo originale
        entities: Lista (start, end, label)

    Returns:
        True se valide, False altrimenti

    Example:
        >>> text = "L'art. 1453 del codice civile"
        >>> entities = [(2, 11, "ARTICOLO"), (16, 29, "CODICE")]
        >>> validate_annotations(text, entities)
        True
    """
    for start, end, label in entities:
        # Check bounds
        if start < 0 or end > len(text) or start >= end:
            logger.warning(
                "invalid_entity_bounds",
                start=start,
                end=end,
                text_length=len(text),
            )
            return False

        # Check span text non vuoto
        span_text = text[start:end].strip()
        if not span_text:
            logger.warning("empty_entity_span", start=start, end=end)
            return False

    # Check overlap
    sorted_entities = sorted(entities, key=lambda x: x[0])
    for i in range(len(sorted_entities) - 1):
        current = sorted_entities[i]
        next_ent = sorted_entities[i + 1]
        if current[1] > next_ent[0]:
            logger.warning(
                "overlapping_entities",
                entity1=current,
                entity2=next_ent,
            )
            return False

    return True
