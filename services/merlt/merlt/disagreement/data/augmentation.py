"""
Disagreement Data Augmentation
==============================

Tecniche di data augmentation per DisagreementSample.

Metodi implementati:
1. Paraphrase - Riformulazione con sinonimi/strutture diverse
2. Permutation - Scambio ordine expert responses
3. Dropout - Rimozione casuale di parti del testo
4. Noise Injection - Aggiunta di rumore controllato
5. Back Translation - Traduzione andata/ritorno
6. Expert Swapping - Scambio attributi tra expert

Fondamento:
    L'augmentation deve preservare il label (tipo/livello disagreement)
    mentre aumenta la diversita' lessicale e strutturale.

Esempio:
    >>> from merlt.disagreement.data import DisagreementAugmenter
    >>>
    >>> augmenter = DisagreementAugmenter(ai_service=openrouter)
    >>> augmented = await augmenter.augment(sample, methods=["paraphrase", "dropout"])
"""

import re
import uuid
import random
import structlog
from copy import deepcopy
from typing import Dict, List, Optional, Any, Callable
from datetime import datetime

from merlt.disagreement.types import (
    DisagreementSample,
    ExpertResponseData,
    EXPERT_NAMES,
)

log = structlog.get_logger()


# =============================================================================
# CONFIGURATION
# =============================================================================

class AugmentationConfig:
    """Configurazione per augmentation."""

    def __init__(
        self,
        dropout_prob: float = 0.1,
        word_dropout_prob: float = 0.05,
        synonym_prob: float = 0.15,
        max_augmentations_per_sample: int = 3,
        preserve_key_terms: bool = True,
        key_terms_file: Optional[str] = None,
    ):
        """
        Args:
            dropout_prob: Probabilita' dropout di frasi
            word_dropout_prob: Probabilita' dropout di parole
            synonym_prob: Probabilita' sostituzione con sinonimi
            max_augmentations_per_sample: Max versioni per sample
            preserve_key_terms: Non modificare termini giuridici chiave
            key_terms_file: Path a file con termini da preservare
        """
        self.dropout_prob = dropout_prob
        self.word_dropout_prob = word_dropout_prob
        self.synonym_prob = synonym_prob
        self.max_augmentations_per_sample = max_augmentations_per_sample
        self.preserve_key_terms = preserve_key_terms
        self.key_terms_file = key_terms_file

        # Termini giuridici da preservare
        self.key_terms = self._load_key_terms()

    def _load_key_terms(self) -> set:
        """Carica termini giuridici da preservare."""
        default_terms = {
            # Articoli e riferimenti
            "art.", "comma", "cpv", "c.c.", "c.p.", "c.p.c.", "c.p.p.",
            "costituzione", "disp. prel.",
            # Termini giuridici fondamentali
            "legittima difesa", "buona fede", "dolo", "colpa",
            "responsabilità", "obbligazione", "contratto", "negozio",
            "giurisdizione", "competenza", "nullità", "annullabilità",
            "prescrizione", "decadenza", "risarcimento", "indennizzo",
            "interpretazione", "analogia", "equità",
            # Latin
            "ratio legis", "lex specialis", "lex posterior", "lex superior",
            "in dubio pro reo", "ne bis in idem", "pacta sunt servanda",
        }

        if self.key_terms_file:
            try:
                with open(self.key_terms_file, "r") as f:
                    for line in f:
                        term = line.strip().lower()
                        if term:
                            default_terms.add(term)
            except Exception as e:
                log.warning(f"Could not load key terms file: {e}")

        return default_terms


# =============================================================================
# AUGMENTATION METHODS
# =============================================================================

class TextDropout:
    """
    Dropout casuale di testo.

    Rimuove frasi o parole con una certa probabilita'.
    """

    def __init__(
        self,
        sentence_dropout_prob: float = 0.1,
        word_dropout_prob: float = 0.05,
        min_sentences: int = 2,
        min_words: int = 10,
    ):
        self.sentence_dropout_prob = sentence_dropout_prob
        self.word_dropout_prob = word_dropout_prob
        self.min_sentences = min_sentences
        self.min_words = min_words

    def __call__(self, text: str, key_terms: Optional[set] = None) -> str:
        """
        Applica dropout al testo.

        Args:
            text: Testo originale
            key_terms: Set di termini da non droppare

        Returns:
            Testo con dropout applicato
        """
        if not text:
            return text

        key_terms = key_terms or set()

        # Sentence dropout
        sentences = re.split(r'(?<=[.!?])\s+', text)
        if len(sentences) > self.min_sentences:
            kept_sentences = []
            for sent in sentences:
                # Non droppare se contiene key terms
                has_key_term = any(kt in sent.lower() for kt in key_terms)
                if has_key_term or random.random() > self.sentence_dropout_prob:
                    kept_sentences.append(sent)

            # Assicura minimo
            if len(kept_sentences) < self.min_sentences:
                kept_sentences = sentences[:self.min_sentences]

            sentences = kept_sentences

        # Word dropout
        result_sentences = []
        for sent in sentences:
            words = sent.split()
            if len(words) > self.min_words:
                kept_words = []
                for word in words:
                    # Non droppare key terms
                    word_lower = word.lower().strip('.,;:!?()"\'')
                    is_key_term = word_lower in key_terms
                    if is_key_term or random.random() > self.word_dropout_prob:
                        kept_words.append(word)

                # Assicura minimo
                if len(kept_words) >= self.min_words:
                    words = kept_words

            result_sentences.append(" ".join(words))

        return " ".join(result_sentences)


class ExpertPermutation:
    """
    Permuta l'ordine delle risposte expert.

    Non cambia il contenuto, solo l'ordine in cui appaiono.
    Utile per testare invarianza all'ordine.
    """

    def __call__(self, expert_responses: Dict[str, ExpertResponseData]) -> Dict[str, ExpertResponseData]:
        """
        Permuta ordine expert (shuffla le chiavi).

        In realta' per dict Python 3.7+ l'ordine e' preservato,
        ma questo e' utile se il modello concatena in ordine fisso.

        Returns:
            Nuovo dict con ordine diverso
        """
        keys = list(expert_responses.keys())
        random.shuffle(keys)
        return {k: expert_responses[k] for k in keys}


class SynonymReplacement:
    """
    Sostituzione di parole con sinonimi giuridici.

    Usa un dizionario di sinonimi domain-specific.
    """

    # Dizionario sinonimi giuridici
    SYNONYMS = {
        "obbligazione": ["obbligo", "vincolo", "impegno"],
        "contratto": ["convenzione", "accordo", "negozio"],
        "responsabilità": ["dovere", "obbligo"],
        "risarcimento": ["indennizzo", "ristoro", "riparazione"],
        "violazione": ["infrazione", "trasgressione", "inosservanza"],
        "norma": ["disposizione", "regola", "precetto"],
        "giudice": ["magistrato", "organo giudicante"],
        "parte": ["soggetto", "contraente"],
        "diritto": ["facoltà", "prerogativa", "potestà"],
        "divieto": ["proibizione", "interdizione"],
        "permesso": ["autorizzazione", "consenso", "licenza"],
        "dovere": ["obbligo", "onere"],
        "sanzione": ["pena", "punizione"],
        "valido": ["efficace", "vincolante"],
        "nullo": ["invalido", "inefficace"],
        "secondo": ["ai sensi di", "in base a", "conformemente a"],
        "prevede": ["stabilisce", "dispone", "sancisce"],
        "quindi": ["pertanto", "conseguentemente", "dunque"],
        "tuttavia": ["nondimeno", "ciononostante", "peraltro"],
    }

    def __init__(self, replacement_prob: float = 0.15):
        self.replacement_prob = replacement_prob
        # Prepara lookup inverso
        self._word_to_syns = {}
        for word, syns in self.SYNONYMS.items():
            self._word_to_syns[word] = syns
            for syn in syns:
                if syn not in self._word_to_syns:
                    self._word_to_syns[syn] = [word] + [s for s in syns if s != syn]

    def __call__(self, text: str, key_terms: Optional[set] = None) -> str:
        """
        Applica sostituzione sinonimi.

        Args:
            text: Testo originale
            key_terms: Termini da non sostituire

        Returns:
            Testo con sinonimi
        """
        key_terms = key_terms or set()
        words = text.split()
        result = []

        for word in words:
            word_clean = word.lower().strip('.,;:!?()"\'')

            # Skip key terms
            if word_clean in key_terms:
                result.append(word)
                continue

            # Check for synonyms
            if word_clean in self._word_to_syns and random.random() < self.replacement_prob:
                synonyms = self._word_to_syns[word_clean]
                replacement = random.choice(synonyms)

                # Preserva case
                if word[0].isupper():
                    replacement = replacement.capitalize()

                # Preserva punteggiatura
                if word[-1] in '.,;:!?':
                    replacement += word[-1]

                result.append(replacement)
            else:
                result.append(word)

        return " ".join(result)


class NoiseInjection:
    """
    Inietta rumore controllato nel testo.

    Tipi di rumore:
    - Typos (scambio caratteri adiacenti)
    - Duplicazione parole
    - Inserimento filler words
    """

    FILLER_WORDS = [
        "infatti", "in effetti", "peraltro", "invero",
        "come noto", "si ritiene", "va osservato che",
    ]

    def __init__(
        self,
        typo_prob: float = 0.01,
        duplicate_prob: float = 0.02,
        filler_prob: float = 0.03,
    ):
        self.typo_prob = typo_prob
        self.duplicate_prob = duplicate_prob
        self.filler_prob = filler_prob

    def __call__(self, text: str, key_terms: Optional[set] = None) -> str:
        """Applica rumore al testo."""
        key_terms = key_terms or set()
        words = text.split()
        result = []

        for i, word in enumerate(words):
            word_clean = word.lower().strip('.,;:!?()"\'')

            # Skip key terms
            if word_clean in key_terms:
                result.append(word)
                continue

            # Typo
            if len(word) > 3 and random.random() < self.typo_prob:
                chars = list(word)
                pos = random.randint(1, len(chars) - 2)
                chars[pos], chars[pos + 1] = chars[pos + 1], chars[pos]
                word = "".join(chars)

            # Duplicate
            if random.random() < self.duplicate_prob:
                result.append(word)

            result.append(word)

            # Filler insertion
            if random.random() < self.filler_prob:
                filler = random.choice(self.FILLER_WORDS)
                result.append(filler)

        return " ".join(result)


# =============================================================================
# MAIN AUGMENTER CLASS
# =============================================================================

class DisagreementAugmenter:
    """
    Augmenter principale per DisagreementSample.

    Combina multiple tecniche di augmentation.
    """

    def __init__(
        self,
        config: Optional[AugmentationConfig] = None,
        ai_service: Optional[Any] = None,
    ):
        """
        Inizializza augmenter.

        Args:
            config: Configurazione augmentation
            ai_service: AIService per paraphrase LLM-based (opzionale)
        """
        self.config = config or AugmentationConfig()
        self.ai_service = ai_service

        # Inizializza metodi
        self.dropout = TextDropout(
            sentence_dropout_prob=self.config.dropout_prob,
            word_dropout_prob=self.config.word_dropout_prob,
        )
        self.permutation = ExpertPermutation()
        self.synonym = SynonymReplacement(
            replacement_prob=self.config.synonym_prob
        )
        self.noise = NoiseInjection()

        log.info(
            "DisagreementAugmenter initialized",
            has_ai_service=ai_service is not None,
        )

    def augment_by_dropout(
        self,
        sample: DisagreementSample
    ) -> DisagreementSample:
        """
        Augmenta con dropout di testo.

        Args:
            sample: Sample originale

        Returns:
            Nuovo sample con dropout applicato
        """
        new_sample = deepcopy(sample)
        new_sample.sample_id = f"{sample.sample_id}_dropout_{uuid.uuid4().hex[:6]}"
        new_sample.source = f"{sample.source}_augmented"

        for expert_name, response in new_sample.expert_responses.items():
            response.interpretation = self.dropout(
                response.interpretation,
                key_terms=self.config.key_terms if self.config.preserve_key_terms else None
            )

        return new_sample

    def augment_by_permutation(
        self,
        sample: DisagreementSample
    ) -> DisagreementSample:
        """
        Augmenta permutando ordine expert.

        Args:
            sample: Sample originale

        Returns:
            Nuovo sample con ordine permutato
        """
        new_sample = deepcopy(sample)
        new_sample.sample_id = f"{sample.sample_id}_perm_{uuid.uuid4().hex[:6]}"
        new_sample.source = f"{sample.source}_augmented"
        new_sample.expert_responses = self.permutation(sample.expert_responses)
        return new_sample

    def augment_by_synonym(
        self,
        sample: DisagreementSample
    ) -> DisagreementSample:
        """
        Augmenta sostituendo sinonimi.

        Args:
            sample: Sample originale

        Returns:
            Nuovo sample con sinonimi
        """
        new_sample = deepcopy(sample)
        new_sample.sample_id = f"{sample.sample_id}_syn_{uuid.uuid4().hex[:6]}"
        new_sample.source = f"{sample.source}_augmented"

        for expert_name, response in new_sample.expert_responses.items():
            response.interpretation = self.synonym(
                response.interpretation,
                key_terms=self.config.key_terms if self.config.preserve_key_terms else None
            )

        return new_sample

    def augment_by_noise(
        self,
        sample: DisagreementSample
    ) -> DisagreementSample:
        """
        Augmenta con noise injection.

        Args:
            sample: Sample originale

        Returns:
            Nuovo sample con rumore
        """
        new_sample = deepcopy(sample)
        new_sample.sample_id = f"{sample.sample_id}_noise_{uuid.uuid4().hex[:6]}"
        new_sample.source = f"{sample.source}_augmented"

        for expert_name, response in new_sample.expert_responses.items():
            response.interpretation = self.noise(
                response.interpretation,
                key_terms=self.config.key_terms if self.config.preserve_key_terms else None
            )

        return new_sample

    async def augment_by_paraphrase(
        self,
        sample: DisagreementSample
    ) -> Optional[DisagreementSample]:
        """
        Augmenta con paraphrase LLM-based.

        Richiede ai_service configurato.

        Args:
            sample: Sample originale

        Returns:
            Nuovo sample parafrasato, o None se AI non disponibile
        """
        if self.ai_service is None:
            log.warning("Paraphrase augmentation requires ai_service")
            return None

        new_sample = deepcopy(sample)
        new_sample.sample_id = f"{sample.sample_id}_para_{uuid.uuid4().hex[:6]}"
        new_sample.source = f"{sample.source}_augmented"

        prompt_template = """Parafrasa il seguente testo giuridico mantenendo esattamente lo stesso significato e tutte le informazioni legali. Non aggiungere ne' rimuovere contenuti.

Testo originale:
{text}

Testo parafrasato:"""

        for expert_name, response in new_sample.expert_responses.items():
            try:
                prompt = prompt_template.format(text=response.interpretation)
                paraphrased = await self.ai_service.complete(
                    prompt=prompt,
                    max_tokens=len(response.interpretation) * 2,
                    temperature=0.7,
                )
                response.interpretation = paraphrased.strip()
            except Exception as e:
                log.warning(f"Paraphrase failed for {expert_name}: {e}")
                # Mantieni testo originale

        return new_sample

    def augment(
        self,
        sample: DisagreementSample,
        methods: Optional[List[str]] = None,
        count: int = 1,
    ) -> List[DisagreementSample]:
        """
        Applica augmentation con metodi specificati.

        Args:
            sample: Sample originale
            methods: Lista di metodi ["dropout", "synonym", "noise", "permutation"]
                     Default: tutti tranne paraphrase
            count: Numero di versioni augmentate per metodo

        Returns:
            Lista di samples augmentati
        """
        if methods is None:
            methods = ["dropout", "synonym", "noise"]

        method_map = {
            "dropout": self.augment_by_dropout,
            "synonym": self.augment_by_synonym,
            "noise": self.augment_by_noise,
            "permutation": self.augment_by_permutation,
        }

        augmented = []
        for method_name in methods:
            if method_name not in method_map:
                log.warning(f"Unknown augmentation method: {method_name}")
                continue

            method_fn = method_map[method_name]
            for _ in range(count):
                try:
                    aug_sample = method_fn(sample)
                    augmented.append(aug_sample)
                except Exception as e:
                    log.warning(f"Augmentation {method_name} failed: {e}")

            # Limit total
            if len(augmented) >= self.config.max_augmentations_per_sample:
                break

        return augmented[:self.config.max_augmentations_per_sample]

    def augment_dataset(
        self,
        samples: List[DisagreementSample],
        methods: Optional[List[str]] = None,
        augmentation_factor: float = 1.0,
    ) -> List[DisagreementSample]:
        """
        Augmenta intero dataset.

        Args:
            samples: Lista di samples originali
            methods: Metodi di augmentation
            augmentation_factor: Moltiplicatore (1.0 = raddoppia, 0.5 = +50%)

        Returns:
            Lista con samples originali + augmentati
        """
        all_samples = list(samples)  # Copia originali

        num_to_augment = int(len(samples) * augmentation_factor)
        samples_to_augment = random.sample(samples, min(num_to_augment, len(samples)))

        for sample in samples_to_augment:
            augmented = self.augment(sample, methods=methods, count=1)
            all_samples.extend(augmented)

        log.info(
            "Dataset augmentation complete",
            original_count=len(samples),
            augmented_count=len(all_samples) - len(samples),
            total_count=len(all_samples),
        )

        return all_samples
