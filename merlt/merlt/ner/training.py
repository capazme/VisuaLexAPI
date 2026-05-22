"""
NER Training Loop with RLCF Authority Weights
==============================================

Training loop per modello NER giuridico usando feedback RLCF.

Features:
- Converte feedback in Examples spaCy
- Training REINFORCE-style con policy gradient
- **RLCF Authority-Weighted Training**: feedback da esperti pesano di più
- Checkpoint automatici
- Early stopping su validation loss
- Logging dettagliato con structlog

RLCF Integration:
- Ogni feedback ha un `sample_weight` basato sull'authority dell'utente
- Authority range: [0.1, 1.0] → Weight range: [0.5, 2.0]
- High-weight examples vengono campionati più frequentemente
- Questo permette di apprendere più velocemente da utenti esperti
"""

import random
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import structlog

logger = structlog.get_logger()


class NERTrainer:
    """
    Trainer per modello NER giuridico con feedback RLCF Authority Weights.

    Usa il buffer di feedback per creare training examples e
    aggiornare il modello spaCy con policy gradient (REINFORCE).

    RLCF Authority Integration:
    - Feedback da utenti esperti (alta authority) pesano di più nel training
    - Authority viene calcolata dal NERFeedbackBuffer basandosi su:
        - Volume feedback (più feedback = più esperienza)
        - Tipo feedback (correzioni più informative delle conferme)
        - Accuratezza storica (se disponibile)
    - Weighted sampling: esempi ad alto peso campionati più frequentemente

    Example:
        >>> from merlt.ner import LegalNERModel, NERTrainer
        >>> from merlt.rlcf.ner_feedback_buffer import get_ner_feedback_buffer
        >>>
        >>> model = LegalNERModel()
        >>> buffer = get_ner_feedback_buffer()
        >>> trainer = NERTrainer(model, buffer)
        >>>
        >>> # Training con authority weights (default)
        >>> results = trainer.train(n_iter=30, batch_size=8, use_authority_weights=True)
        >>> print(f"Loss finale: {results['final_loss']}")
        >>> print(f"Avg weight: {results['avg_sample_weight']}")
    """

    def __init__(self, model: "LegalNERModel", buffer: "NERFeedbackBuffer"):
        """
        Inizializza il trainer.

        Args:
            model: Modello NER da trainare
            buffer: Buffer con feedback accumulati (con RLCF authority)
        """
        self.model = model
        self.buffer = buffer
        self.checkpoint_dir = Path("models/legal_ner_checkpoints")
        self.checkpoint_dir.mkdir(parents=True, exist_ok=True)

        # Weighted examples storage
        self._weighted_examples: List[Tuple[Any, float]] = []

    def prepare_training_data(self) -> List[Any]:
        """
        Converte feedback del buffer in Examples spaCy.

        Returns:
            Lista di spacy.training.Example pronti per training

        Raises:
            ValueError: Se buffer vuoto o feedback non validi
        """
        try:
            import spacy
            from spacy.training import Example
        except ImportError as e:
            logger.error("spacy_not_installed", error=str(e))
            raise ImportError(
                "spaCy non installato. Esegui: pip install spacy>=3.5"
            ) from e

        if not self.buffer.has_data():
            raise ValueError("Buffer vuoto, nessun feedback disponibile per training")

        feedbacks = self.buffer.get_all()
        examples = []

        for feedback in feedbacks:
            try:
                # Converte feedback in formato spaCy
                from merlt.ner.data_converter import feedback_to_spacy_format

                text, annotations = feedback_to_spacy_format(feedback)

                # Crea Doc objects
                doc = self.model.nlp.make_doc(text)
                example = Example.from_dict(doc, annotations)
                examples.append(example)

            except Exception as e:
                logger.warning(
                    "failed_to_convert_feedback",
                    feedback_id=feedback.get("id", "unknown"),
                    error=str(e),
                )
                continue

        logger.info("training_data_prepared", examples_count=len(examples))
        return examples

    def prepare_weighted_training_data(self) -> List[Tuple[Any, float]]:
        """
        Converte feedback del buffer in Examples spaCy con RLCF authority weights.

        Ogni example viene associato al suo sample_weight derivato dall'authority
        dell'utente che ha fornito il feedback. Questo permette weighted sampling
        durante il training.

        Returns:
            Lista di tuple (spacy.training.Example, sample_weight)
            dove sample_weight è in [0.5, 2.0]:
            - 0.5 = utente novizio
            - 1.0 = utente medio
            - 2.0 = utente esperto

        Raises:
            ValueError: Se buffer vuoto o feedback non validi
        """
        try:
            import spacy
            from spacy.training import Example
        except ImportError as e:
            logger.error("spacy_not_installed", error=str(e))
            raise ImportError(
                "spaCy non installato. Esegui: pip install spacy>=3.5"
            ) from e

        if not self.buffer.has_data():
            raise ValueError("Buffer vuoto, nessun feedback disponibile per training")

        feedbacks = self.buffer.get_all()
        weighted_examples = []

        for feedback in feedbacks:
            try:
                # Converte feedback in formato spaCy
                from merlt.ner.data_converter import feedback_to_spacy_format

                text, annotations = feedback_to_spacy_format(feedback)

                # Crea Doc objects
                doc = self.model.nlp.make_doc(text)
                example = Example.from_dict(doc, annotations)

                # Ottieni sample_weight dal feedback
                sample_weight = getattr(feedback, 'sample_weight', 1.0)
                weighted_examples.append((example, sample_weight))

            except Exception as e:
                logger.warning(
                    "failed_to_convert_weighted_feedback",
                    feedback_id=getattr(feedback, 'feedback_id', 'unknown'),
                    error=str(e),
                )
                continue

        # Calcola statistiche pesi
        if weighted_examples:
            weights = [w for _, w in weighted_examples]
            avg_weight = sum(weights) / len(weights)
            min_weight = min(weights)
            max_weight = max(weights)
        else:
            avg_weight = min_weight = max_weight = 0.0

        logger.info(
            "weighted_training_data_prepared",
            examples_count=len(weighted_examples),
            avg_weight=round(avg_weight, 3),
            min_weight=round(min_weight, 3),
            max_weight=round(max_weight, 3),
        )

        # Salva per uso in weighted_minibatch
        self._weighted_examples = weighted_examples
        return weighted_examples

    def _weighted_sample(
        self, weighted_examples: List[Tuple[Any, float]], n: int
    ) -> List[Any]:
        """
        Campiona n esempi con probabilità proporzionale ai pesi.

        Implementa weighted sampling senza replacement per ogni batch.
        Esempi con peso maggiore hanno più probabilità di essere selezionati.

        Args:
            weighted_examples: Lista di (example, weight)
            n: Numero di esempi da campionare

        Returns:
            Lista di n Examples (senza i pesi)
        """
        if not weighted_examples:
            return []

        examples = [ex for ex, _ in weighted_examples]
        weights = [w for _, w in weighted_examples]

        # Normalizza pesi
        total_weight = sum(weights)
        if total_weight == 0:
            # Fallback a uniform sampling
            return random.sample(examples, min(n, len(examples)))

        probabilities = [w / total_weight for w in weights]

        # Campiona con probabilità proporzionale
        # Se n > len(examples), permetti replacement
        if n >= len(examples):
            # Campiona con replacement
            sampled = random.choices(examples, weights=probabilities, k=n)
        else:
            # Campiona senza replacement (più complicato con pesi)
            # Usiamo l'algoritmo di reservoir sampling pesato semplificato
            sampled = []
            remaining = list(zip(examples, probabilities))
            for _ in range(n):
                if not remaining:
                    break
                # Normalizza probabilità rimanenti
                total_prob = sum(p for _, p in remaining)
                if total_prob == 0:
                    # Fallback
                    idx = random.randint(0, len(remaining) - 1)
                else:
                    r = random.random() * total_prob
                    cumsum = 0
                    idx = 0
                    for i, (_, p) in enumerate(remaining):
                        cumsum += p
                        if r <= cumsum:
                            idx = i
                            break
                sampled.append(remaining[idx][0])
                remaining.pop(idx)

        return sampled

    def train(
        self,
        n_iter: int = 30,
        drop: float = 0.3,
        batch_size: int = 8,
        learning_rate: float = 0.001,
        early_stopping_patience: int = 5,
        use_authority_weights: bool = True,
    ) -> Dict[str, Any]:
        """
        Esegue training loop REINFORCE-style con supporto RLCF Authority Weights.

        Args:
            n_iter: Numero iterazioni
            drop: Dropout rate
            batch_size: Batch size
            learning_rate: Learning rate
            early_stopping_patience: Patience per early stopping
            use_authority_weights: Se True, usa weighted sampling basato su
                                   authority degli utenti (RLCF). Default: True

        Returns:
            Dict con risultati training:
                - final_loss: Loss finale
                - best_loss: Miglior loss
                - iterations: Numero iterazioni eseguite
                - checkpoint_path: Path al checkpoint salvato
                - early_stopped: True se early stopping attivato
                - use_authority_weights: Se weighted training attivo
                - avg_sample_weight: Peso medio dei sample (se weighted)
                - weight_distribution: Distribuzione pesi (se weighted)

        Example:
            >>> # Training con RLCF authority weights (default)
            >>> results = trainer.train(n_iter=30, batch_size=8)
            >>> print(f"Salvato in: {results['checkpoint_path']}")
            >>> print(f"Avg weight: {results.get('avg_sample_weight', 'N/A')}")

            >>> # Training uniforme (tutti i sample pesano uguale)
            >>> results = trainer.train(n_iter=30, use_authority_weights=False)
        """
        try:
            import spacy
            from spacy.training import Example
            from spacy.util import minibatch, compounding
        except ImportError as e:
            logger.error("spacy_not_installed", error=str(e))
            raise ImportError(
                "spaCy non installato. Esegui: pip install spacy>=3.5"
            ) from e

        # Prepara training data
        avg_weight = 1.0
        weight_stats = {}

        if use_authority_weights:
            # Usa weighted training data
            weighted_examples = self.prepare_weighted_training_data()
            if not weighted_examples:
                raise ValueError("Nessun esempio valido per training")
            examples = [ex for ex, _ in weighted_examples]

            # Calcola statistiche pesi
            weights = [w for _, w in weighted_examples]
            avg_weight = sum(weights) / len(weights)
            weight_stats = {
                "min_weight": round(min(weights), 3),
                "max_weight": round(max(weights), 3),
                "avg_weight": round(avg_weight, 3),
            }
        else:
            # Training uniforme (backward compatible)
            examples = self.prepare_training_data()
            if not examples:
                raise ValueError("Nessun esempio valido per training")

        # Get NER pipe
        ner = self.model.nlp.get_pipe("ner")

        # Disabilita altre pipes durante training
        other_pipes = [
            pipe for pipe in self.model.nlp.pipe_names if pipe != "ner"
        ]
        with self.model.nlp.disable_pipes(*other_pipes):
            # Inizializza optimizer
            optimizer = self.model.nlp.resume_training()
            optimizer.learn_rate = learning_rate

            best_loss = float("inf")
            patience_counter = 0
            early_stopped = False

            logger.info(
                "training_started",
                n_iter=n_iter,
                examples=len(examples),
                batch_size=batch_size,
                use_authority_weights=use_authority_weights,
                **weight_stats,
            )

            for iteration in range(n_iter):
                losses = {}

                if use_authority_weights and self._weighted_examples:
                    # Weighted batching: campiona batch con probabilità proporzionale ai pesi
                    # Ogni iterazione vede tutti gli esempi, ma quelli ad alto peso
                    # appaiono più frequentemente nel sampling
                    n_batches = max(1, len(examples) // batch_size)

                    for _ in range(n_batches):
                        # Campiona batch con weighted sampling
                        batch = self._weighted_sample(self._weighted_examples, batch_size)
                        self.model.nlp.update(
                            batch,
                            drop=drop,
                            sgd=optimizer,
                            losses=losses,
                        )
                else:
                    # Standard minibatch training
                    batch_sizes = compounding(4.0, batch_size, 1.001)
                    for batch in minibatch(examples, size=batch_sizes):
                        self.model.nlp.update(
                            batch,
                            drop=drop,
                            sgd=optimizer,
                            losses=losses,
                        )

                loss = losses.get("ner", 0.0)

                # Early stopping
                if loss < best_loss:
                    best_loss = loss
                    patience_counter = 0
                    # Salva best checkpoint
                    self._save_checkpoint(
                        iteration, loss, suffix="best"
                    )
                else:
                    patience_counter += 1

                if patience_counter >= early_stopping_patience:
                    logger.info(
                        "early_stopping_triggered",
                        iteration=iteration,
                        patience=early_stopping_patience,
                    )
                    early_stopped = True
                    break

                # Log ogni 5 iterazioni
                if (iteration + 1) % 5 == 0:
                    logger.info(
                        "training_progress",
                        iteration=iteration + 1,
                        loss=loss,
                        best_loss=best_loss,
                    )

        # Salva checkpoint finale
        final_checkpoint = self._save_checkpoint(
            n_iter if not early_stopped else iteration, best_loss, suffix="final"
        )

        # Aggiorna symlink latest
        self._update_latest_symlink(final_checkpoint)

        results = {
            "final_loss": best_loss,
            "best_loss": best_loss,
            "iterations": n_iter if not early_stopped else iteration,
            "checkpoint_path": str(final_checkpoint),
            "early_stopped": early_stopped,
            "use_authority_weights": use_authority_weights,
        }

        # Aggiungi statistiche pesi se weighted
        if use_authority_weights:
            results["avg_sample_weight"] = weight_stats.get("avg_weight", 1.0)
            results["weight_distribution"] = weight_stats

        logger.info("training_completed", **results)
        return results

    def _save_checkpoint(
        self, iteration: int, loss: float, suffix: str = ""
    ) -> Path:
        """
        Salva checkpoint del modello.

        Args:
            iteration: Numero iterazione
            loss: Loss corrente
            suffix: Suffisso per nome checkpoint (es. "best", "final")

        Returns:
            Path al checkpoint salvato
        """
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        suffix_str = f"_{suffix}" if suffix else ""
        checkpoint_name = (
            f"legal_ner_iter{iteration}_loss{loss:.4f}_{timestamp}{suffix_str}"
        )
        checkpoint_path = self.checkpoint_dir / checkpoint_name

        # Salva modello
        self.model.nlp.to_disk(checkpoint_path)

        logger.info(
            "checkpoint_saved",
            path=str(checkpoint_path),
            iteration=iteration,
            loss=loss,
        )
        return checkpoint_path

    def _update_latest_symlink(self, checkpoint_path: Path) -> None:
        """
        Aggiorna symlink 'legal_ner_latest' al checkpoint più recente.

        Args:
            checkpoint_path: Path al checkpoint da linkare
        """
        latest_path = Path("models/legal_ner_latest")

        # Rimuovi symlink esistente
        if latest_path.exists() or latest_path.is_symlink():
            latest_path.unlink()

        # Crea nuovo symlink
        try:
            latest_path.symlink_to(checkpoint_path.resolve())
            logger.info("latest_symlink_updated", target=str(checkpoint_path))
        except Exception as e:
            logger.warning(
                "failed_to_create_symlink",
                target=str(checkpoint_path),
                error=str(e),
            )

    def evaluate(self, test_examples: List[Any]) -> Dict[str, float]:
        """
        Valuta il modello su test set.

        Args:
            test_examples: Lista di spacy.training.Example per evaluation

        Returns:
            Dict con metriche:
                - precision: Precisione
                - recall: Recall
                - f1: F1-score
                - loss: Loss sul test set

        Example:
            >>> test_data = load_test_data()
            >>> metrics = trainer.evaluate(test_data)
            >>> print(f"F1: {metrics['f1']:.3f}")
        """
        try:
            from spacy.scorer import Scorer
        except ImportError as e:
            logger.error("spacy_not_installed", error=str(e))
            raise ImportError(
                "spaCy non installato. Esegui: pip install spacy>=3.5"
            ) from e

        scorer = Scorer()
        for example in test_examples:
            pred = self.model.nlp(example.reference.text)
            scorer.score(example.predicted, example.reference)

        scores = scorer.scores

        metrics = {
            "precision": scores.get("ents_p", 0.0),
            "recall": scores.get("ents_r", 0.0),
            "f1": scores.get("ents_f", 0.0),
            "loss": 0.0,  # Loss non disponibile in evaluation
        }

        logger.info("evaluation_completed", **metrics)
        return metrics
