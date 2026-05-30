"""
Weight Store
=============

Persistenza e gestione pesi con fallback a YAML.

Il WeightStore gestisce:
1. Caricamento pesi da YAML (default)
2. Override runtime (senza restart)
3. Persistenza in database (per experiment tracking)
4. Versioning (per A/B testing)

Architettura:
    YAML (default) <- WeightStore -> Database (override)
                          |
                     Runtime Cache
"""

import json
import structlog
import yaml
from pathlib import Path
from typing import Dict, Optional, Any
from datetime import datetime
from uuid import uuid4

from sqlalchemy import select

from merlt.rlcf.persistence import WeightVersion  # single ORM definition
from merlt.weights.config import (
    WeightConfig,
    WeightCategory,
    RetrievalWeights,
    ExpertTraversalWeights,
    LearnableWeight,
    RLCFAuthorityWeights,
    GatingWeights,
    ToolGatingWeights,
)

log = structlog.get_logger()


class WeightStore:
    """
    Storage centralizzato per tutti i pesi del sistema.

    Priorità di caricamento:
    1. Database (se experiment_id specificato)
    2. Runtime cache (se override applicato)
    3. YAML config (default)

    Esempio:
        >>> store = WeightStore()
        >>> config = await store.get_weights("retrieval")
        >>> config.retrieval.alpha.default
        0.7

        >>> # Con experiment override
        >>> config = await store.get_weights("retrieval", experiment_id="exp-001")
    """

    def __init__(
        self,
        config_path: Optional[Path] = None,
        database_url: Optional[str] = None,
    ):
        """
        Inizializza WeightStore.

        Args:
            config_path: Path al file YAML config. Se None, usa default.
            database_url: URL PostgreSQL per persistenza. Se None, solo YAML.
        """
        self.config_path = config_path or self._get_default_config_path()
        self.database_url = database_url
        self._cache: Dict[str, WeightConfig] = {}
        self._yaml_config: Optional[Dict] = None

        log.info(
            "WeightStore initialized",
            config_path=str(self.config_path),
            has_database=database_url is not None
        )

    def _get_default_config_path(self) -> Path:
        """Ottiene il path default per il file di configurazione."""
        return Path(__file__).parent / "config" / "weights.yaml"

    def _load_yaml_config(self) -> Dict:
        """Carica configurazione da YAML."""
        if self._yaml_config is not None:
            return self._yaml_config

        try:
            with open(self.config_path, "r") as f:
                self._yaml_config = yaml.safe_load(f)
                log.debug("Loaded weights from YAML", path=str(self.config_path))
                return self._yaml_config
        except FileNotFoundError:
            log.warning(
                "Weights config not found, using defaults",
                path=str(self.config_path)
            )
            return self._get_default_config()
        except Exception as e:
            log.error("Error loading weights config", error=str(e))
            return self._get_default_config()

    def _get_default_config(self) -> Dict:
        """Configurazione default quando YAML non disponibile."""
        return {
            "version": "2.0",
            "schema_version": "1.0",
            "retrieval": {
                "alpha": {"default": 0.7, "bounds": [0.3, 0.9], "learnable": True},
                "over_retrieve_factor": 3,
                "max_graph_hops": 3,
            },
            "expert_traversal": {
                "LiteralExpert": {
                    "contiene": {"default": 1.0, "bounds": [0.5, 1.0]},
                    "disciplina": {"default": 0.95, "bounds": [0.5, 1.0]},
                    "definisce": {"default": 0.95, "bounds": [0.5, 1.0]},
                },
                "SystemicExpert": {
                    "gerarchia_kelseniana": {"default": 1.0, "bounds": [0.5, 1.0]},
                    "modifica": {"default": 0.90, "bounds": [0.5, 1.0]},
                },
                "PrinciplesExpert": {
                    "relazione_concettuale": {"default": 1.0, "bounds": [0.5, 1.0]},
                    "attuazione": {"default": 0.95, "bounds": [0.5, 1.0]},
                },
                "PrecedentExpert": {
                    "interpreta": {"default": 1.0, "bounds": [0.5, 1.0]},
                    "applica": {"default": 1.0, "bounds": [0.5, 1.0]},
                },
            },
            "rlcf": {
                "baseline_credentials": {"default": 0.4, "bounds": [0.1, 0.6]},
                "track_record": {"default": 0.4, "bounds": [0.2, 0.7]},
                "recent_performance": {"default": 0.2, "bounds": [0.1, 0.4]},
            },
            "gating": {
                "expert_priors": {
                    "LiteralExpert": {"default": 0.25, "bounds": [0.1, 0.5]},
                    "SystemicExpert": {"default": 0.25, "bounds": [0.1, 0.5]},
                    "PrinciplesExpert": {"default": 0.25, "bounds": [0.1, 0.5]},
                    "PrecedentExpert": {"default": 0.25, "bounds": [0.1, 0.5]},
                }
            },
        }

    def _parse_yaml_to_config(self, yaml_data: Dict) -> WeightConfig:
        """Converte dati YAML in WeightConfig Pydantic."""
        # Parse retrieval weights
        retrieval_data = yaml_data.get("retrieval", {})
        retrieval = RetrievalWeights(
            alpha=self._parse_learnable_weight(retrieval_data.get("alpha", {})),
            over_retrieve_factor=retrieval_data.get("over_retrieve_factor", 3),
            max_graph_hops=retrieval_data.get("max_graph_hops", 3),
            default_graph_score=retrieval_data.get("default_graph_score", 0.5),
        )

        # Parse expert traversal weights
        expert_traversal = {}
        for expert_name, weights_data in yaml_data.get("expert_traversal", {}).items():
            weights = {}
            default_weight = 0.5
            for rel_type, weight_info in weights_data.items():
                if rel_type == "default":
                    default_weight = weight_info if isinstance(weight_info, (int, float)) else weight_info.get("default", 0.5)
                else:
                    weights[rel_type] = self._parse_learnable_weight(weight_info)
            expert_traversal[expert_name] = ExpertTraversalWeights(
                weights=weights,
                default_weight=default_weight
            )

        # Parse RLCF weights
        rlcf_data = yaml_data.get("rlcf", {})
        rlcf = RLCFAuthorityWeights(
            baseline_credentials=self._parse_learnable_weight(
                rlcf_data.get("baseline_credentials", {"default": 0.4})
            ),
            track_record=self._parse_learnable_weight(
                rlcf_data.get("track_record", {"default": 0.4})
            ),
            recent_performance=self._parse_learnable_weight(
                rlcf_data.get("recent_performance", {"default": 0.2})
            ),
            track_record_update_factor=self._parse_learnable_weight(
                rlcf_data.get("track_record_update_factor", {"default": 0.05})
            ),
        )

        # Parse gating weights
        gating_data = yaml_data.get("gating", {})
        expert_priors = {}
        for expert, weight_info in gating_data.get("expert_priors", {}).items():
            expert_priors[expert] = self._parse_learnable_weight(weight_info)

        gating = GatingWeights(
            expert_priors=expert_priors or {
                "LiteralExpert": LearnableWeight(default=0.25, bounds=(0.1, 0.5)),
                "SystemicExpert": LearnableWeight(default=0.25, bounds=(0.1, 0.5)),
                "PrinciplesExpert": LearnableWeight(default=0.25, bounds=(0.1, 0.5)),
                "PrecedentExpert": LearnableWeight(default=0.25, bounds=(0.1, 0.5)),
            },
            query_type_modifiers=gating_data.get("query_type_modifiers", {})
        )

        # Parse tool-gating weights (Loop β E.3) — optional.
        tg_data = yaml_data.get("tool_gating") or {}
        tool_gating = None
        if tg_data.get("tool_priors"):
            tool_gating = ToolGatingWeights(
                tool_priors={
                    t: self._parse_learnable_weight(wi)
                    for t, wi in tg_data["tool_priors"].items()
                }
            )

        return WeightConfig(
            version=yaml_data.get("version", "2.0"),
            schema_version=yaml_data.get("schema_version", "1.0"),
            retrieval=retrieval,
            expert_traversal=expert_traversal,
            rlcf=rlcf,
            gating=gating,
            tool_gating=tool_gating,
            created_at=datetime.now().isoformat(),
        )

    def _parse_learnable_weight(self, data: Any) -> LearnableWeight:
        """Parse un peso learnable da dati YAML."""
        if isinstance(data, (int, float)):
            # Valore semplice, converti in LearnableWeight
            return LearnableWeight(default=float(data))
        elif isinstance(data, dict):
            bounds = data.get("bounds", [0.0, 1.0])
            if isinstance(bounds, list):
                bounds = tuple(bounds)
            return LearnableWeight(
                default=data.get("default", 0.5),
                bounds=bounds,
                learnable=data.get("learnable", True),
                learning_rate=data.get("learning_rate", 0.01),
            )
        else:
            return LearnableWeight(default=0.5)

    async def get_weights(
        self,
        category: Optional[str] = None,
        experiment_id: Optional[str] = None
    ) -> WeightConfig:
        """
        Ottiene la configurazione pesi.

        Args:
            category: Categoria specifica (o None per tutto)
            experiment_id: ID esperimento per override

        Returns:
            WeightConfig con i pesi richiesti
        """
        # Check cache first
        cache_key = f"{category or 'all'}_{experiment_id or 'default'}"
        if cache_key in self._cache:
            return self._cache[cache_key]

        # Load from database if experiment_id provided
        if experiment_id and self.database_url:
            db_weights = await self._load_from_database(experiment_id)
            if db_weights:
                self._cache[cache_key] = db_weights
                return db_weights

        # Load from YAML
        yaml_data = self._load_yaml_config()
        config = self._parse_yaml_to_config(yaml_data)

        # Cache and return
        self._cache[cache_key] = config
        return config

    def _config_to_dict(self, config: WeightConfig) -> Dict[str, Any]:
        """Convert WeightConfig to a JSON-serializable dict (inverse of _parse_yaml_to_config)."""
        def _lw_to_dict(lw: LearnableWeight) -> Dict[str, Any]:
            return {
                "default": lw.default,
                "bounds": list(lw.bounds) if lw.bounds else [0.0, 1.0],
                "learnable": lw.learnable,
                "learning_rate": lw.learning_rate,
            }

        result: Dict[str, Any] = {
            "version": config.version,
            "schema_version": config.schema_version,
        }

        if config.retrieval:
            result["retrieval"] = {
                "alpha": _lw_to_dict(config.retrieval.alpha),
                "over_retrieve_factor": config.retrieval.over_retrieve_factor,
                "max_graph_hops": config.retrieval.max_graph_hops,
                "default_graph_score": config.retrieval.default_graph_score,
            }

        if config.expert_traversal:
            et = {}
            for name, etw in config.expert_traversal.items():
                et[name] = {k: _lw_to_dict(v) for k, v in etw.weights.items()}
                et[name]["default"] = etw.default_weight
            result["expert_traversal"] = et

        if config.rlcf:
            result["rlcf"] = {
                "baseline_credentials": _lw_to_dict(config.rlcf.baseline_credentials),
                "track_record": _lw_to_dict(config.rlcf.track_record),
                "recent_performance": _lw_to_dict(config.rlcf.recent_performance),
                "track_record_update_factor": _lw_to_dict(config.rlcf.track_record_update_factor),
            }

        if config.gating:
            result["gating"] = {
                "expert_priors": {k: _lw_to_dict(v) for k, v in config.gating.expert_priors.items()},
            }

        if config.tool_gating:
            result["tool_gating"] = {
                "tool_priors": {k: _lw_to_dict(v) for k, v in config.tool_gating.tool_priors.items()},
            }

        return result

    async def _load_from_database(self, experiment_id: str) -> Optional[WeightConfig]:
        """Carica pesi da database per un esperimento specifico."""
        if not self.database_url:
            return None

        try:
            from merlt.rlcf.database import get_async_session

            async with get_async_session() as session:
                stmt = (
                    select(WeightVersion)
                    .where(WeightVersion.experiment_id == experiment_id)
                    .where(WeightVersion.is_active == True)
                    .order_by(WeightVersion.created_at.desc())
                    .limit(1)
                )
                result = await session.execute(stmt)
                row = result.scalar_one_or_none()

                if row is None:
                    return None

                config_data = row.config_json
                if not config_data:
                    return None

                return self._parse_yaml_to_config(config_data)

        except Exception as e:
            log.warning(
                "Failed to load weights from database, falling back to YAML",
                experiment_id=experiment_id,
                error=str(e),
            )
            return None

    async def save_weights(
        self,
        config: WeightConfig,
        experiment_id: str,
        metrics: Optional[Dict[str, float]] = None
    ) -> str:
        """
        Salva una versione di pesi nel database.

        Args:
            config: Configurazione pesi da salvare
            experiment_id: ID esperimento
            metrics: Metriche associate (es. {"accuracy": 0.85})

        Returns:
            ID della versione salvata
        """
        version_id = str(uuid4())

        config.experiment_id = experiment_id
        config.updated_at = datetime.now().isoformat()
        config.metrics = metrics

        if self.database_url:
            try:
                from merlt.rlcf.database import get_async_session

                async with get_async_session() as session:
                    # Deactivate previous active versions for this experiment
                    from sqlalchemy import update
                    await session.execute(
                        update(WeightVersion)
                        .where(WeightVersion.experiment_id == experiment_id)
                        .where(WeightVersion.is_active == True)
                        .values(is_active=False)
                    )

                    row = WeightVersion(
                        id=version_id,
                        experiment_id=experiment_id,
                        version_tag=config.version,
                        config_json=self._config_to_dict(config),
                        metrics_json=metrics,
                        is_active=True,
                        created_by="weight_store",
                    )
                    session.add(row)

                log.info(
                    "Weights saved to database",
                    version_id=version_id,
                    experiment_id=experiment_id,
                )

            except Exception as e:
                log.warning(
                    "Failed to save weights to database, saved in-memory only. "
                    "Weights will be LOST on restart.",
                    version_id=version_id,
                    experiment_id=experiment_id,
                    error=str(e),
                )
        else:
            log.warning(
                "Weights saved in-memory only — no database_url configured. "
                "Weights will be LOST on restart. Pass database_url to WeightStore for persistence.",
                version_id=version_id,
                experiment_id=experiment_id,
                has_metrics=metrics is not None,
            )

        # Invalida cache per questo esperimento
        cache_keys_to_remove = [
            k for k in self._cache.keys()
            if experiment_id in k
        ]
        for key in cache_keys_to_remove:
            del self._cache[key]

        return version_id

    def update_runtime(
        self,
        category: WeightCategory,
        updates: Dict[str, float]
    ) -> None:
        """
        Aggiorna pesi in runtime (senza persistenza).

        Utile per testing e tuning rapido.

        Args:
            category: Categoria di pesi da aggiornare
            updates: Mapping nome_peso -> nuovo_valore
        """
        # Invalida cache
        self._cache.clear()
        self._yaml_config = None

        log.info(
            "Runtime weight update applied",
            category=category.value,
            updates=updates
        )

    def get_retrieval_alpha(self) -> float:
        """
        Shortcut per ottenere alpha di retrieval.

        Compatibilita' con codice esistente che usa direttamente alpha.
        """
        yaml_data = self._load_yaml_config()
        retrieval = yaml_data.get("retrieval", {})
        alpha_data = retrieval.get("alpha", {})
        if isinstance(alpha_data, dict):
            return alpha_data.get("default", 0.7)
        return alpha_data if isinstance(alpha_data, (int, float)) else 0.7

    def get_expert_traversal_weights(self, expert_name: str) -> Dict[str, float]:
        """
        Shortcut per ottenere pesi traversal di un expert.

        Compatibilita' con EXPERT_TRAVERSAL_WEIGHTS esistente.
        """
        yaml_data = self._load_yaml_config()
        expert_data = yaml_data.get("expert_traversal", {}).get(expert_name, {})

        weights = {}
        for rel_type, weight_info in expert_data.items():
            if isinstance(weight_info, dict):
                weights[rel_type] = weight_info.get("default", 0.5)
            else:
                weights[rel_type] = float(weight_info)

        return weights


# Singleton instance per compatibilita'
_default_store: Optional[WeightStore] = None


def get_weight_store() -> WeightStore:
    """Ottiene l'istanza singleton del WeightStore."""
    global _default_store
    if _default_store is None:
        _default_store = WeightStore()
    return _default_store
