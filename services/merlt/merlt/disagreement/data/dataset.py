"""
Disagreement Dataset
====================

PyTorch Dataset per training LegalDisagreementNet.

Converte DisagreementSample in tensori per il modello.

Supporta:
- Tokenizzazione expert responses
- Encoding dei labels (type, level)
- Batching con padding
- Lazy loading per grandi dataset

Esempio:
    >>> from merlt.disagreement.data import DisagreementDataset
    >>>
    >>> dataset = DisagreementDataset(samples, tokenizer=tokenizer)
    >>> dataloader = DataLoader(dataset, batch_size=16, collate_fn=dataset.collate_fn)
    >>> for batch in dataloader:
    ...     outputs = model(batch["expert_embeddings"])
"""

import structlog
from typing import Dict, List, Optional, Any, Callable
from pathlib import Path

from merlt.disagreement.types import (
    DisagreementSample,
    DisagreementType,
    DisagreementLevel,
    EXPERT_NAMES,
)

log = structlog.get_logger()

# Lazy imports
_torch = None
_Dataset = None


def _get_torch():
    """Lazy import di torch."""
    global _torch, _Dataset
    if _torch is None:
        import torch
        from torch.utils.data import Dataset
        _torch = torch
        _Dataset = Dataset
    return _torch, _Dataset


# =============================================================================
# LABEL ENCODINGS
# =============================================================================

TYPE_TO_IDX = {
    DisagreementType.ANTINOMY: 0,
    DisagreementType.INTERPRETIVE_GAP: 1,
    DisagreementType.METHODOLOGICAL: 2,
    DisagreementType.OVERRULING: 3,
    DisagreementType.HIERARCHICAL: 4,
    DisagreementType.SPECIALIZATION: 5,
}

IDX_TO_TYPE = {v: k for k, v in TYPE_TO_IDX.items()}

LEVEL_TO_IDX = {
    DisagreementLevel.SEMANTIC: 0,
    DisagreementLevel.SYSTEMIC: 1,
    DisagreementLevel.TELEOLOGICAL: 2,
    DisagreementLevel.APPLICATIVE: 3,
}

IDX_TO_LEVEL = {v: k for k, v in LEVEL_TO_IDX.items()}

EXPERT_TO_IDX = {name: idx for idx, name in enumerate(EXPERT_NAMES)}


# =============================================================================
# DATASET CLASS
# =============================================================================

class DisagreementDataset:
    """
    PyTorch Dataset per DisagreementSample.

    Tokenizza le risposte degli expert e prepara tensori per il modello.
    """

    def __init__(
        self,
        samples: List[DisagreementSample],
        tokenizer: Optional[Any] = None,
        max_length: int = 512,
        embedding_fn: Optional[Callable] = None,
        cache_embeddings: bool = True,
    ):
        """
        Inizializza dataset.

        Args:
            samples: Lista di DisagreementSample
            tokenizer: HuggingFace tokenizer (opzionale)
            max_length: Lunghezza massima per tokenizzazione
            embedding_fn: Funzione per pre-computare embeddings (opzionale)
            cache_embeddings: Se True, cache embeddings in memoria
        """
        torch, Dataset = _get_torch()

        self.samples = samples
        self.tokenizer = tokenizer
        self.max_length = max_length
        self.embedding_fn = embedding_fn
        self.cache_embeddings = cache_embeddings

        # Cache per embeddings pre-computati
        self._embedding_cache: Dict[str, Any] = {}

        # Filtra solo samples labeled
        self.labeled_samples = [s for s in samples if s.is_labeled]

        log.info(
            "DisagreementDataset initialized",
            total_samples=len(samples),
            labeled_samples=len(self.labeled_samples),
            has_tokenizer=tokenizer is not None,
            has_embedding_fn=embedding_fn is not None,
        )

    def __len__(self) -> int:
        """Numero di samples labeled."""
        return len(self.labeled_samples)

    def __getitem__(self, idx: int) -> Dict[str, Any]:
        """
        Restituisce un sample come dict di tensori.

        Returns:
            Dict con:
                - sample_id: str
                - query_text: str
                - expert_texts: List[str] (4 testi)
                - expert_input_ids: Tensor [4, max_length] (se tokenizer)
                - expert_attention_mask: Tensor [4, max_length] (se tokenizer)
                - expert_embeddings: Tensor [4, hidden_size] (se embedding_fn)
                - binary_target: int (0 o 1)
                - type_target: int (0-5 o -1 se None)
                - level_target: int (0-3 o -1 se None)
                - intensity_target: float
                - resolvability_target: float
                - conflicting_pairs: List[Tuple[int, int]]
        """
        torch, _ = _get_torch()

        sample = self.labeled_samples[idx]

        item = {
            "sample_id": sample.sample_id,
            "query_text": sample.query,
        }

        # Expert texts (ordinati per EXPERT_NAMES)
        expert_texts = []
        for expert_name in EXPERT_NAMES:
            if expert_name in sample.expert_responses:
                text = sample.expert_responses[expert_name].interpretation
            else:
                text = ""
            expert_texts.append(text)

        item["expert_texts"] = expert_texts

        # Tokenize se abbiamo tokenizer
        if self.tokenizer is not None:
            input_ids_list = []
            attention_mask_list = []

            for text in expert_texts:
                encoded = self.tokenizer(
                    text,
                    max_length=self.max_length,
                    padding="max_length",
                    truncation=True,
                    return_tensors="pt",
                )
                input_ids_list.append(encoded["input_ids"].squeeze(0))
                attention_mask_list.append(encoded["attention_mask"].squeeze(0))

            item["expert_input_ids"] = torch.stack(input_ids_list)  # [4, max_length]
            item["expert_attention_mask"] = torch.stack(attention_mask_list)

        # Embeddings pre-computati
        if self.embedding_fn is not None:
            if self.cache_embeddings and sample.sample_id in self._embedding_cache:
                item["expert_embeddings"] = self._embedding_cache[sample.sample_id]
            else:
                embeddings = []
                for text in expert_texts:
                    emb = self.embedding_fn(text)
                    if not isinstance(emb, torch.Tensor):
                        emb = torch.tensor(emb)
                    embeddings.append(emb)
                emb_tensor = torch.stack(embeddings)  # [4, hidden_size]

                if self.cache_embeddings:
                    self._embedding_cache[sample.sample_id] = emb_tensor

                item["expert_embeddings"] = emb_tensor

        # Labels
        item["binary_target"] = 1 if sample.has_disagreement else 0

        # Type (solo se disagreement presente)
        if sample.disagreement_type is not None:
            item["type_target"] = TYPE_TO_IDX.get(sample.disagreement_type, -1)
        else:
            item["type_target"] = -1  # Ignore index

        # Level
        if sample.disagreement_level is not None:
            item["level_target"] = LEVEL_TO_IDX.get(sample.disagreement_level, -1)
        else:
            item["level_target"] = -1

        # Regression targets
        item["intensity_target"] = sample.intensity if sample.intensity is not None else 0.0
        item["resolvability_target"] = sample.resolvability if sample.resolvability is not None else 0.5

        # Conflicting pairs come indici
        if sample.conflicting_pairs:
            pairs_indices = []
            for pair in sample.conflicting_pairs:
                if len(pair) == 2:
                    i = EXPERT_TO_IDX.get(pair[0], -1)
                    j = EXPERT_TO_IDX.get(pair[1], -1)
                    if i >= 0 and j >= 0:
                        pairs_indices.append((i, j))
            item["conflicting_pairs"] = pairs_indices
        else:
            item["conflicting_pairs"] = []

        return item

    @staticmethod
    def collate_fn(batch: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Collate function per DataLoader.

        Combina lista di items in batch tensors.

        Args:
            batch: Lista di dict da __getitem__

        Returns:
            Dict con tensori batched
        """
        torch, _ = _get_torch()

        collated = {
            "sample_ids": [item["sample_id"] for item in batch],
            "query_texts": [item["query_text"] for item in batch],
            "expert_texts": [item["expert_texts"] for item in batch],
        }

        # Stack tensori se presenti
        if "expert_input_ids" in batch[0]:
            collated["expert_input_ids"] = torch.stack([
                item["expert_input_ids"] for item in batch
            ])  # [batch, 4, max_length]
            collated["expert_attention_mask"] = torch.stack([
                item["expert_attention_mask"] for item in batch
            ])

        if "expert_embeddings" in batch[0]:
            collated["expert_embeddings"] = torch.stack([
                item["expert_embeddings"] for item in batch
            ])  # [batch, 4, hidden_size]

        # Labels
        collated["binary_target"] = torch.tensor([
            item["binary_target"] for item in batch
        ], dtype=torch.long)

        collated["type_target"] = torch.tensor([
            item["type_target"] for item in batch
        ], dtype=torch.long)

        collated["level_target"] = torch.tensor([
            item["level_target"] for item in batch
        ], dtype=torch.long)

        collated["intensity_target"] = torch.tensor([
            item["intensity_target"] for item in batch
        ], dtype=torch.float)

        collated["resolvability_target"] = torch.tensor([
            item["resolvability_target"] for item in batch
        ], dtype=torch.float)

        # Conflicting pairs (lista di liste)
        collated["conflicting_pairs"] = [item["conflicting_pairs"] for item in batch]

        # Maschere per task condizionali
        collated["type_mask"] = collated["type_target"] >= 0
        collated["level_mask"] = collated["level_target"] >= 0

        return collated

    def get_class_weights(self) -> Dict[str, List[float]]:
        """
        Calcola pesi per class balancing.

        Returns:
            Dict con pesi per binary, type, level
        """
        torch, _ = _get_torch()

        # Binary
        binary_counts = [0, 0]
        for s in self.labeled_samples:
            binary_counts[1 if s.has_disagreement else 0] += 1

        total = sum(binary_counts)
        binary_weights = [total / (2 * c) if c > 0 else 1.0 for c in binary_counts]

        # Type
        type_counts = [0] * 6
        for s in self.labeled_samples:
            if s.disagreement_type:
                idx = TYPE_TO_IDX.get(s.disagreement_type, -1)
                if idx >= 0:
                    type_counts[idx] += 1

        type_total = sum(type_counts)
        type_weights = [
            type_total / (6 * c) if c > 0 else 1.0
            for c in type_counts
        ]

        # Level
        level_counts = [0] * 4
        for s in self.labeled_samples:
            if s.disagreement_level:
                idx = LEVEL_TO_IDX.get(s.disagreement_level, -1)
                if idx >= 0:
                    level_counts[idx] += 1

        level_total = sum(level_counts)
        level_weights = [
            level_total / (4 * c) if c > 0 else 1.0
            for c in level_counts
        ]

        return {
            "binary": binary_weights,
            "type": type_weights,
            "level": level_weights,
        }

    def split(
        self,
        train_ratio: float = 0.8,
        val_ratio: float = 0.1,
        seed: int = 42
    ) -> tuple:
        """
        Split dataset in train/val/test.

        Args:
            train_ratio: Proporzione training set
            val_ratio: Proporzione validation set
            seed: Random seed

        Returns:
            Tuple di (train_dataset, val_dataset, test_dataset)
        """
        import random
        random.seed(seed)

        indices = list(range(len(self.labeled_samples)))
        random.shuffle(indices)

        n = len(indices)
        train_end = int(n * train_ratio)
        val_end = train_end + int(n * val_ratio)

        train_indices = indices[:train_end]
        val_indices = indices[train_end:val_end]
        test_indices = indices[val_end:]

        train_samples = [self.labeled_samples[i] for i in train_indices]
        val_samples = [self.labeled_samples[i] for i in val_indices]
        test_samples = [self.labeled_samples[i] for i in test_indices]

        return (
            DisagreementDataset(
                train_samples,
                tokenizer=self.tokenizer,
                max_length=self.max_length,
                embedding_fn=self.embedding_fn,
                cache_embeddings=self.cache_embeddings,
            ),
            DisagreementDataset(
                val_samples,
                tokenizer=self.tokenizer,
                max_length=self.max_length,
                embedding_fn=self.embedding_fn,
                cache_embeddings=self.cache_embeddings,
            ),
            DisagreementDataset(
                test_samples,
                tokenizer=self.tokenizer,
                max_length=self.max_length,
                embedding_fn=self.embedding_fn,
                cache_embeddings=self.cache_embeddings,
            ),
        )

    def get_stats(self) -> Dict[str, Any]:
        """
        Statistiche del dataset.

        Returns:
            Dict con conteggi per classe, distribuzione, etc.
        """
        stats = {
            "total_samples": len(self.samples),
            "labeled_samples": len(self.labeled_samples),
            "unlabeled_samples": len(self.samples) - len(self.labeled_samples),
        }

        # Binary distribution
        has_dis = sum(1 for s in self.labeled_samples if s.has_disagreement)
        no_dis = len(self.labeled_samples) - has_dis
        stats["binary_distribution"] = {
            "has_disagreement": has_dis,
            "no_disagreement": no_dis,
        }

        # Type distribution
        type_dist = {}
        for s in self.labeled_samples:
            if s.disagreement_type:
                key = s.disagreement_type.value
                type_dist[key] = type_dist.get(key, 0) + 1
        stats["type_distribution"] = type_dist

        # Level distribution
        level_dist = {}
        for s in self.labeled_samples:
            if s.disagreement_level:
                key = s.disagreement_level.value
                level_dist[key] = level_dist.get(key, 0) + 1
        stats["level_distribution"] = level_dist

        # Source distribution
        source_dist = {}
        for s in self.labeled_samples:
            source_dist[s.source] = source_dist.get(s.source, 0) + 1
        stats["source_distribution"] = source_dist

        return stats


# =============================================================================
# STREAMING DATASET
# =============================================================================

class StreamingDisagreementDataset:
    """
    Dataset che carica samples da file JSONL in streaming.

    Utile per dataset troppo grandi per stare in memoria.
    """

    def __init__(
        self,
        jsonl_path: str,
        tokenizer: Optional[Any] = None,
        max_length: int = 512,
        buffer_size: int = 1000,
    ):
        """
        Args:
            jsonl_path: Path al file JSONL
            tokenizer: HuggingFace tokenizer
            max_length: Lunghezza massima
            buffer_size: Dimensione buffer per shuffling
        """
        self.jsonl_path = Path(jsonl_path)
        self.tokenizer = tokenizer
        self.max_length = max_length
        self.buffer_size = buffer_size

        # Count lines
        self._length = None

    def __len__(self) -> int:
        """Conta righe nel file (cached)."""
        if self._length is None:
            with open(self.jsonl_path, "r") as f:
                self._length = sum(1 for _ in f)
        return self._length

    def __iter__(self):
        """Itera su samples dal file."""
        import json

        with open(self.jsonl_path, "r", encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    data = json.loads(line)
                    sample = DisagreementSample.from_dict(data)

                    if sample.is_labeled:
                        # Usa stessa logica di __getitem__
                        yield self._sample_to_item(sample)

    def _sample_to_item(self, sample: DisagreementSample) -> Dict[str, Any]:
        """Converte sample in item dict."""
        torch, _ = _get_torch()

        item = {
            "sample_id": sample.sample_id,
            "query_text": sample.query,
        }

        expert_texts = []
        for expert_name in EXPERT_NAMES:
            if expert_name in sample.expert_responses:
                text = sample.expert_responses[expert_name].interpretation
            else:
                text = ""
            expert_texts.append(text)

        item["expert_texts"] = expert_texts

        if self.tokenizer is not None:
            input_ids_list = []
            attention_mask_list = []

            for text in expert_texts:
                encoded = self.tokenizer(
                    text,
                    max_length=self.max_length,
                    padding="max_length",
                    truncation=True,
                    return_tensors="pt",
                )
                input_ids_list.append(encoded["input_ids"].squeeze(0))
                attention_mask_list.append(encoded["attention_mask"].squeeze(0))

            item["expert_input_ids"] = torch.stack(input_ids_list)
            item["expert_attention_mask"] = torch.stack(attention_mask_list)

        item["binary_target"] = 1 if sample.has_disagreement else 0
        item["type_target"] = TYPE_TO_IDX.get(sample.disagreement_type, -1) if sample.disagreement_type else -1
        item["level_target"] = LEVEL_TO_IDX.get(sample.disagreement_level, -1) if sample.disagreement_level else -1
        item["intensity_target"] = sample.intensity if sample.intensity is not None else 0.0
        item["resolvability_target"] = sample.resolvability if sample.resolvability is not None else 0.5

        return item
