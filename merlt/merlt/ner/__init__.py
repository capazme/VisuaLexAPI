"""
MERL-T NER (Named Entity Recognition) Module
=============================================

Modulo per l'estrazione di citazioni giuridiche da testo usando spaCy.

Componenti:
- LegalNERModel: Wrapper per modello spaCy NER giuridico
- NERTrainer: Training loop con feedback RLCF
- data_converter: Conversione feedback in formato spaCy

Supporto per 6 tipi di entità giuridiche:
- ARTICOLO: "art. 5", "articoli 3 e 4"
- LEGGE: "legge 241/1990", "D.Lgs. 50/2016"
- CODICE: "codice civile", "c.p."
- COMMA: "comma 1", "co. 3"
- LETTERA: "lettera a)", "lett. b"
- RIFERIMENTO: Link completo articolo+fonte
"""

from merlt.ner.spacy_model import LegalNERModel, NER_LABELS, CitationMatch
from merlt.ner.training import NERTrainer
from merlt.ner.data_converter import (
    feedback_to_spacy_format,
    export_training_batch,
)

__all__ = [
    # Core
    "LegalNERModel",
    "NER_LABELS",
    "CitationMatch",
    # Training
    "NERTrainer",
    # Data conversion
    "feedback_to_spacy_format",
    "export_training_batch",
]
