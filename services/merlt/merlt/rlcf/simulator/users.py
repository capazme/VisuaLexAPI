"""
Profili utente sintetici per simulazione RLCF.

Questo modulo definisce diversi profili di utenti simulati, ognuno con:
- Authority baseline basata su credenziali simulate
- Bias di valutazione per ogni dimensione
- Livello di rumore nelle valutazioni
- Evoluzione dell'authority nel tempo

I profili sono progettati per simulare una community realistica con:
- Esperti rigorosi (professori, giudici)
- Specialisti di dominio (avvocati praticanti)
- Studenti (feedback più generoso)
- Rumore casuale (utenti non qualificati)

MULTILIVELLO (v2):
- Authority per DOMINIO giuridico (civile, penale, amministrativo, etc.)
- Authority per LIVELLO pipeline (retrieval, reasoning, synthesis)
- Formula combinata: A_eff = w_g * A_general + w_d * A_domain + w_l * A_level
"""

import random
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Any, Tuple
from datetime import datetime
import numpy as np


# Domini giuridici italiani supportati
LEGAL_DOMAINS = [
    "civile",           # Diritto civile (contratti, obbligazioni, famiglia)
    "penale",           # Diritto penale
    "amministrativo",   # Diritto amministrativo
    "costituzionale",   # Diritto costituzionale
    "lavoro",           # Diritto del lavoro
    "commerciale",      # Diritto commerciale/societario
    "tributario",       # Diritto tributario
    "internazionale",   # Diritto internazionale
]

# Livelli della pipeline multi-expert
PIPELINE_LEVELS = [
    "retrieval",   # Valutazione qualità recupero fonti
    "reasoning",   # Valutazione ragionamento expert
    "synthesis",   # Valutazione sintesi finale
]

# Pesi default per authority combinata
DEFAULT_COMBINATION_WEIGHTS = {
    "general": 0.3,
    "domain": 0.4,
    "level": 0.3,
}


@dataclass
class DomainAuthority:
    """
    Authority specifica per dominio giuridico.

    Attributes:
        domain: Dominio giuridico (civile, penale, etc.)
        baseline: Authority baseline per questo dominio
        track_record: Track record evolutivo per dominio
        current: Authority corrente (calcolata)
        feedback_count: Numero feedback ricevuti in questo dominio
    """
    domain: str
    baseline: float = 0.5
    track_record: float = 0.5
    current: float = 0.5
    feedback_count: int = 0

    def to_dict(self) -> Dict[str, Any]:
        """Serializza in dizionario."""
        return {
            "domain": self.domain,
            "baseline": self.baseline,
            "track_record": self.track_record,
            "current": self.current,
            "feedback_count": self.feedback_count,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "DomainAuthority":
        """Deserializza da dizionario."""
        return cls(
            domain=data["domain"],
            baseline=data.get("baseline", 0.5),
            track_record=data.get("track_record", 0.5),
            current=data.get("current", 0.5),
            feedback_count=data.get("feedback_count", 0),
        )


@dataclass
class PipelineLevelAuthority:
    """
    Authority specifica per livello pipeline.

    Livelli:
    - retrieval: Valutazione qualità recupero fonti
    - reasoning: Valutazione ragionamento expert
    - synthesis: Valutazione sintesi finale

    Attributes:
        level: Livello pipeline
        baseline: Authority baseline per questo livello
        track_record: Track record per livello
        current: Authority corrente
        feedback_count: Numero feedback per livello
    """
    level: str
    baseline: float = 0.5
    track_record: float = 0.5
    current: float = 0.5
    feedback_count: int = 0

    def to_dict(self) -> Dict[str, Any]:
        """Serializza in dizionario."""
        return {
            "level": self.level,
            "baseline": self.baseline,
            "track_record": self.track_record,
            "current": self.current,
            "feedback_count": self.feedback_count,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "PipelineLevelAuthority":
        """Deserializza da dizionario."""
        return cls(
            level=data["level"],
            baseline=data.get("baseline", 0.5),
            track_record=data.get("track_record", 0.5),
            current=data.get("current", 0.5),
            feedback_count=data.get("feedback_count", 0),
        )


# Profili utente predefiniti basati su archetipi realistici
PROFILES: Dict[str, Dict[str, Any]] = {
    "strict_expert": {
        "baseline_authority": 0.85,
        "credentials": {
            "academic_degree": "PhD",
            "years_experience": 15,
            "specialization": "diritto civile",
            "publications": 25,
        },
        "evaluation_bias": {
            "accuracy": 0.0,      # Nessun bias, valutazione oggettiva
            "clarity": -0.1,      # Leggermente critico sulla chiarezza
            "utility": 0.0,
            "reasoning": -0.05,   # Standard elevati sul ragionamento
        },
        "noise_level": 0.05,      # Valutazioni molto consistenti
        "description": "Professore universitario, valutazione rigorosa e precisa",
        "feedback_rate": 0.9,     # Alta partecipazione
    },
    "lenient_student": {
        "baseline_authority": 0.25,
        "credentials": {
            "academic_degree": "Bachelor",
            "years_experience": 0,
            "specialization": None,
            "publications": 0,
        },
        "evaluation_bias": {
            "accuracy": 0.2,      # Tende a sovrastimare l'accuratezza
            "clarity": 0.15,      # Apprezza risposte chiare
            "utility": 0.1,
            "reasoning": 0.1,
        },
        "noise_level": 0.20,      # Valutazioni più variabili
        "description": "Studente di giurisprudenza, tende a sovrastimare",
        "feedback_rate": 0.7,
    },
    "domain_specialist": {
        "baseline_authority": 0.70,
        "credentials": {
            "academic_degree": "Master",
            "years_experience": 8,
            "specialization": "contratti",
            "bar_admission": True,
        },
        "evaluation_bias": {
            "accuracy": 0.0,
            "clarity": 0.0,
            "utility": -0.05,     # Esigente sull'utilità pratica
            "reasoning": 0.0,
        },
        "noise_level": 0.08,
        "description": "Avvocato specializzato, preciso nel suo dominio",
        "feedback_rate": 0.6,     # Partecipazione moderata (impegnato)
    },
    "random_noise": {
        "baseline_authority": 0.10,
        "credentials": {},
        "evaluation_bias": {
            "accuracy": 0.0,
            "clarity": 0.0,
            "utility": 0.0,
            "reasoning": 0.0,
        },
        "noise_level": 0.40,      # Alta variabilità (feedback inaffidabile)
        "description": "Utente casuale, feedback inaffidabile",
        "feedback_rate": 0.3,
    },
    "senior_magistrate": {
        "baseline_authority": 0.90,
        "credentials": {
            "academic_degree": "PhD",
            "years_experience": 25,
            "specialization": "procedura civile",
            "judicial_role": "Consigliere Cassazione",
        },
        "evaluation_bias": {
            "accuracy": -0.05,    # Molto esigente
            "clarity": 0.0,
            "utility": 0.0,
            "reasoning": -0.1,    # Standard altissimi sul ragionamento
        },
        "noise_level": 0.03,
        "description": "Magistrato senior, valutazione autorevole",
        "feedback_rate": 0.4,     # Bassa partecipazione (molto impegnato)
    },
}


@dataclass
class SyntheticUser:
    """
    Rappresenta un utente simulato con caratteristiche specifiche.

    Attributes:
        user_id: Identificatore univoco dell'utente
        profile_type: Tipo di profilo (da PROFILES)
        baseline_authority: Authority iniziale basata su credenziali
        current_authority: Authority attuale (evolve con feedback)
        evaluation_bias: Bias per dimensione di valutazione
        noise_level: Deviazione standard del rumore gaussiano
        credentials: Credenziali simulate
        feedback_history: Storico dei feedback forniti
        track_record: Punteggio track record (evolve nel tempo)
        _parent_pool: Riferimento al pool genitore (per RNG isolato)

    MULTILIVELLO (v2):
        domain_authorities: Authority per dominio giuridico
        level_authorities: Authority per livello pipeline
    """

    user_id: int
    profile_type: str
    baseline_authority: float
    current_authority: float
    evaluation_bias: Dict[str, float]
    noise_level: float
    credentials: Dict[str, Any]
    description: str
    feedback_rate: float = 0.7
    feedback_history: List[Dict[str, Any]] = field(default_factory=list)
    track_record: float = field(init=False)  # Inizializzato a baseline_authority
    quality_scores: List[float] = field(default_factory=list)
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())
    # Riferimento al pool genitore (per RNG isolato)
    _parent_pool: Optional["UserPool"] = field(default=None, repr=False)

    # MULTILIVELLO v2: Authority per dominio e livello
    domain_authorities: Dict[str, DomainAuthority] = field(default_factory=dict)
    level_authorities: Dict[str, PipelineLevelAuthority] = field(default_factory=dict)

    def __post_init__(self):
        """Inizializza track_record e authority multilivello."""
        self.track_record = self.baseline_authority
        self._init_multilevel_authorities()

    def _init_multilevel_authorities(self):
        """Inizializza authority multilivello se non presenti."""
        # Inizializza domain authorities
        if not self.domain_authorities:
            spec_raw = self.credentials.get("specialization", "") if self.credentials else ""
            specialization = (spec_raw or "").lower()
            for domain in LEGAL_DOMAINS:
                # Se specializzato in questo dominio, baseline più alta
                if specialization and domain in specialization:
                    baseline = min(self.baseline_authority * 1.3, 1.0)
                else:
                    # Baseline generica più bassa
                    baseline = max(self.baseline_authority * 0.6, 0.2)

                self.domain_authorities[domain] = DomainAuthority(
                    domain=domain,
                    baseline=baseline,
                    track_record=baseline,
                    current=baseline,
                )

        # Inizializza level authorities
        if not self.level_authorities:
            for level in PIPELINE_LEVELS:
                self.level_authorities[level] = PipelineLevelAuthority(
                    level=level,
                    baseline=self.baseline_authority,
                    track_record=self.baseline_authority,
                    current=self.baseline_authority,
                )

    def apply_bias(self, base_score: float, dimension: str) -> float:
        """
        Applica il bias del profilo a un punteggio base.

        Args:
            base_score: Punteggio oggettivo (0-1 o 1-5)
            dimension: Dimensione di valutazione (accuracy, clarity, etc.)

        Returns:
            Punteggio con bias applicato
        """
        bias = self.evaluation_bias.get(dimension, 0.0)
        return base_score + bias

    def add_noise(self, score: float, scale: float = 1.0) -> float:
        """
        Aggiunge rumore gaussiano al punteggio.

        Args:
            score: Punteggio da perturbare
            scale: Moltiplicatore per il noise_level

        Returns:
            Punteggio con rumore
        """
        noise = np.random.normal(0, self.noise_level * scale)
        return score + noise

    def should_provide_feedback(self) -> bool:
        """
        Determina se l'utente fornirà feedback (basato su feedback_rate).

        Usa il RNG isolato del pool per evitare "zone morte" del generatore
        globale quando il seed viene consumato sequenzialmente.
        """
        if self._parent_pool is not None and hasattr(self._parent_pool, '_feedback_rng'):
            return self._parent_pool._feedback_rng.random() < self.feedback_rate
        # Fallback a RNG globale (retrocompatibilità)
        return random.random() < self.feedback_rate

    def record_feedback(
        self,
        feedback: Dict[str, Any],
        quality_score: float,
        feedback_accuracy: Optional[float] = None,
        authority_config: Optional["AuthorityModelConfig"] = None
    ):
        """
        Registra un feedback fornito e aggiorna il track record.

        Args:
            feedback: Dati del feedback
            quality_score: Qualità della risposta (0-1) - usato per metriche sistema
            feedback_accuracy: Accuratezza del feedback utente (0-1) - usato per authority.
                              Se None, usa quality_score per retrocompatibilità.
            authority_config: Configurazione modello authority (opzionale).
                            Se None, usa valori di default.

        Note:
            - quality_score: misura quanto era buona la RISPOSTA del sistema
            - feedback_accuracy: misura quanto era ACCURATO il feedback dell'utente
              (cioè quanto il rating utente era vicino al ground truth)

            Separare queste metriche permette di premiare gli esperti che danno
            feedback accurati, anche quando valutano negativamente risposte scadenti.
        """
        # Import locale per evitare dipendenza circolare
        from merlt.rlcf.simulator.config import AuthorityModelConfig

        # Se feedback_accuracy non fornito, usa quality_score (retrocompatibilità)
        accuracy_for_authority = feedback_accuracy if feedback_accuracy is not None else quality_score

        self.feedback_history.append({
            **feedback,
            "quality_score": quality_score,
            "feedback_accuracy": accuracy_for_authority,
            "timestamp": datetime.now().isoformat(),
        })
        self.quality_scores.append(quality_score)

        # Usa config passata o defaults
        cfg = authority_config or AuthorityModelConfig()

        # Aggiorna track record con exponential smoothing
        # IMPORTANTE: usa feedback_accuracy, NON quality_score!
        # Questo premia utenti che danno feedback accurati.
        self.track_record = (
            (1 - cfg.lambda_factor) * self.track_record +
            cfg.lambda_factor * accuracy_for_authority
        )

        # Aggiorna authority con formula configurabile:
        # A = w_b*Baseline + w_t*TrackRecord + w_a*FeedbackAccuracy
        self.current_authority = (
            cfg.weight_baseline * self.baseline_authority +
            cfg.weight_track_record * self.track_record +
            cfg.weight_quality * accuracy_for_authority  # Rinominare in config?
        )

    # =========================================================================
    # MULTILIVELLO v2 - Metodi per authority per dominio e livello
    # =========================================================================

    def get_domain_authority(self, domain: str) -> float:
        """
        Ottiene authority corrente per un dominio giuridico.

        Args:
            domain: Dominio giuridico (civile, penale, etc.)

        Returns:
            Authority score [0-1], default 0.5 se dominio non riconosciuto
        """
        if domain not in self.domain_authorities:
            return 0.5
        return self.domain_authorities[domain].current

    def get_level_authority(self, level: str) -> float:
        """
        Ottiene authority corrente per un livello pipeline.

        Args:
            level: Livello pipeline (retrieval, reasoning, synthesis)

        Returns:
            Authority score [0-1], default 0.5 se livello non riconosciuto
        """
        if level not in self.level_authorities:
            return 0.5
        return self.level_authorities[level].current

    def get_combined_authority(
        self,
        domain: str,
        level: str,
        weights: Optional[Dict[str, float]] = None
    ) -> float:
        """
        Authority combinata per dominio × livello.

        Formula: A_combined = w_g * A_general + w_d * A_domain + w_l * A_level

        Args:
            domain: Dominio giuridico
            level: Livello pipeline
            weights: Pesi custom (default 0.3, 0.4, 0.3)

        Returns:
            Authority combinata [0-1]
        """
        w = weights or DEFAULT_COMBINATION_WEIGHTS

        return (
            w["general"] * self.current_authority +
            w["domain"] * self.get_domain_authority(domain) +
            w["level"] * self.get_level_authority(level)
        )

    def record_feedback_multilevel(
        self,
        feedback: Dict[str, Any],
        quality_score: float,
        domain: str,
        level: str,
        feedback_accuracy: Optional[float] = None,
        authority_config: Optional["AuthorityModelConfig"] = None
    ) -> Dict[str, float]:
        """
        Registra feedback multilivello, aggiornando:
        1. Authority generale (retrocompatibilità)
        2. Authority per dominio specifico
        3. Authority per livello pipeline

        Args:
            feedback: Dati del feedback
            quality_score: Qualità risposta sistema
            domain: Dominio giuridico (civile, penale, etc.)
            level: Livello pipeline (retrieval, reasoning, synthesis)
            feedback_accuracy: Accuratezza feedback utente
            authority_config: Config modello authority

        Returns:
            Dict con authority aggiornate per ogni livello
        """
        from merlt.rlcf.simulator.config import AuthorityModelConfig

        accuracy = feedback_accuracy if feedback_accuracy is not None else quality_score
        cfg = authority_config or AuthorityModelConfig()

        # 1. Aggiorna authority generale (metodo esistente)
        self.record_feedback(feedback, quality_score, feedback_accuracy, authority_config)

        # Lambda differenziato: decay più rapido per specializzazioni
        lambda_domain = cfg.lambda_factor * 1.5  # Decay più rapido per dominio
        lambda_level = cfg.lambda_factor * 2.0   # Decay ancora più rapido per livello

        # 2. Aggiorna authority dominio
        if domain in self.domain_authorities:
            dom_auth = self.domain_authorities[domain]

            # Exponential smoothing track record
            dom_auth.track_record = (
                (1 - lambda_domain) * dom_auth.track_record +
                lambda_domain * accuracy
            )

            # Ricalcola authority corrente
            dom_auth.current = (
                cfg.weight_baseline * dom_auth.baseline +
                cfg.weight_track_record * dom_auth.track_record +
                cfg.weight_quality * accuracy
            )
            dom_auth.current = max(0.0, min(1.0, dom_auth.current))  # Clamp

            dom_auth.feedback_count += 1

        # 3. Aggiorna authority livello
        if level in self.level_authorities:
            lvl_auth = self.level_authorities[level]

            # Exponential smoothing track record
            lvl_auth.track_record = (
                (1 - lambda_level) * lvl_auth.track_record +
                lambda_level * accuracy
            )

            # Ricalcola authority corrente
            lvl_auth.current = (
                cfg.weight_baseline * lvl_auth.baseline +
                cfg.weight_track_record * lvl_auth.track_record +
                cfg.weight_quality * accuracy
            )
            lvl_auth.current = max(0.0, min(1.0, lvl_auth.current))  # Clamp

            lvl_auth.feedback_count += 1

        # Aggiungi info multilivello al feedback history
        if self.feedback_history:
            self.feedback_history[-1]["domain"] = domain
            self.feedback_history[-1]["level"] = level

        return {
            "general": self.current_authority,
            "domain": self.get_domain_authority(domain),
            "level": self.get_level_authority(level),
            "combined": self.get_combined_authority(domain, level),
        }

    def get_stats(self) -> Dict[str, Any]:
        """Restituisce statistiche dell'utente."""
        return {
            "user_id": self.user_id,
            "profile_type": self.profile_type,
            "baseline_authority": self.baseline_authority,
            "current_authority": self.current_authority,
            "track_record": self.track_record,
            "feedback_count": len(self.feedback_history),
            "avg_quality": np.mean(self.quality_scores) if self.quality_scores else 0.0,
            "authority_delta": self.current_authority - self.baseline_authority,
        }

    def to_dict(self) -> Dict[str, Any]:
        """Serializza l'utente in dizionario."""
        return {
            "user_id": self.user_id,
            "profile_type": self.profile_type,
            "baseline_authority": self.baseline_authority,
            "current_authority": self.current_authority,
            "evaluation_bias": self.evaluation_bias,
            "noise_level": self.noise_level,
            "credentials": self.credentials,
            "description": self.description,
            "feedback_rate": self.feedback_rate,
            "track_record": self.track_record,
            "feedback_count": len(self.feedback_history),
            "created_at": self.created_at,
            # MULTILIVELLO v2
            "domain_authorities": {
                d: auth.to_dict() for d, auth in self.domain_authorities.items()
            },
            "level_authorities": {
                l: auth.to_dict() for l, auth in self.level_authorities.items()
            },
        }


@dataclass
class UserPool:
    """
    Pool di utenti sintetici per la simulazione.

    Gestisce la creazione, selezione e tracking degli utenti.

    Utilizza un RNG isolato per le decisioni di feedback per evitare
    che il consumo sequenziale del seed globale causi "zone morte"
    dove tutti i valori random sono alti.
    """

    users: List[SyntheticUser] = field(default_factory=list)
    distribution: Dict[str, int] = field(default_factory=dict)
    random_seed: Optional[int] = None
    # RNG indipendente per decisioni feedback (evita zone morte)
    _feedback_rng: random.Random = field(init=False, repr=False, default=None)

    def __post_init__(self):
        if self.random_seed is not None:
            random.seed(self.random_seed)
            np.random.seed(self.random_seed)

        # Crea RNG isolato con seed derivato (offset +1000 per separazione)
        feedback_seed = (self.random_seed + 1000) if self.random_seed else None
        self._feedback_rng = random.Random(feedback_seed)

        # Collega ogni utente esistente al pool
        for user in self.users:
            user._parent_pool = self

    def add_user(self, user: SyntheticUser):
        """Aggiunge un utente al pool e lo collega al RNG isolato."""
        user._parent_pool = self  # Collega utente al pool per RNG isolato
        self.users.append(user)
        profile = user.profile_type
        self.distribution[profile] = self.distribution.get(profile, 0) + 1

    def get_random_user(self) -> SyntheticUser:
        """Seleziona un utente casuale dal pool."""
        return random.choice(self.users)

    def get_users_by_profile(self, profile_type: str) -> List[SyntheticUser]:
        """Restituisce tutti gli utenti di un certo profilo."""
        return [u for u in self.users if u.profile_type == profile_type]

    def get_available_evaluators(self) -> List[SyntheticUser]:
        """
        Restituisce utenti che forniranno feedback (basato su feedback_rate).
        """
        return [u for u in self.users if u.should_provide_feedback()]

    def get_pool_stats(self) -> Dict[str, Any]:
        """Statistiche aggregate del pool."""
        if not self.users:
            return {"total_users": 0}

        authorities = [u.current_authority for u in self.users]
        track_records = [u.track_record for u in self.users]
        feedback_counts = [len(u.feedback_history) for u in self.users]

        return {
            "total_users": len(self.users),
            "distribution": self.distribution,
            "authority": {
                "mean": np.mean(authorities),
                "std": np.std(authorities),
                "min": np.min(authorities),
                "max": np.max(authorities),
            },
            "track_record": {
                "mean": np.mean(track_records),
                "std": np.std(track_records),
            },
            "feedback": {
                "total": sum(feedback_counts),
                "per_user_mean": np.mean(feedback_counts),
            },
            "by_profile": {
                profile: {
                    "count": len(users := self.get_users_by_profile(profile)),
                    "avg_authority": np.mean([u.current_authority for u in users]) if users else 0,
                }
                for profile in self.distribution.keys()
            },
        }

    def to_dict(self) -> Dict[str, Any]:
        """Serializza il pool in dizionario."""
        return {
            "users": [u.to_dict() for u in self.users],
            "distribution": self.distribution,
            "stats": self.get_pool_stats(),
        }


def create_user_pool(
    distribution: Dict[str, int],
    random_seed: Optional[int] = 42
) -> UserPool:
    """
    Crea un pool di utenti sintetici secondo la distribuzione specificata.

    Args:
        distribution: Dizionario {profile_type: count}
                     Es: {"strict_expert": 3, "lenient_student": 8}
        random_seed: Seed per riproducibilità

    Returns:
        UserPool con gli utenti creati

    Example:
        >>> pool = create_user_pool({
        ...     "strict_expert": 3,
        ...     "domain_specialist": 5,
        ...     "lenient_student": 8,
        ...     "random_noise": 4
        ... })
        >>> print(f"Total users: {len(pool.users)}")
        Total users: 20
    """
    pool = UserPool(random_seed=random_seed)
    user_id = 1

    for profile_type, count in distribution.items():
        if profile_type not in PROFILES:
            raise ValueError(f"Profilo sconosciuto: {profile_type}. "
                           f"Profili validi: {list(PROFILES.keys())}")

        profile = PROFILES[profile_type]

        for _ in range(count):
            # Aggiungi leggera variazione all'authority baseline
            authority_variation = np.random.normal(0, 0.05)
            baseline_authority = np.clip(
                profile["baseline_authority"] + authority_variation,
                0.0, 1.0
            )

            user = SyntheticUser(
                user_id=user_id,
                profile_type=profile_type,
                baseline_authority=baseline_authority,
                current_authority=baseline_authority,  # Inizialmente uguale
                evaluation_bias=profile["evaluation_bias"].copy(),
                noise_level=profile["noise_level"],
                credentials=profile["credentials"].copy(),
                description=profile["description"],
                feedback_rate=profile.get("feedback_rate", 0.7),
            )

            pool.add_user(user)
            user_id += 1

    return pool


def create_user_from_profile(
    profile_type: str,
    user_id: int,
    override: Optional[Dict[str, Any]] = None
) -> SyntheticUser:
    """
    Crea un singolo utente da un profilo con possibili override.

    Args:
        profile_type: Tipo di profilo
        user_id: ID da assegnare
        override: Valori da sovrascrivere

    Returns:
        SyntheticUser configurato
    """
    if profile_type not in PROFILES:
        raise ValueError(f"Profilo sconosciuto: {profile_type}")

    profile = PROFILES[profile_type].copy()
    if override:
        profile.update(override)

    return SyntheticUser(
        user_id=user_id,
        profile_type=profile_type,
        baseline_authority=profile["baseline_authority"],
        current_authority=profile["baseline_authority"],
        evaluation_bias=profile["evaluation_bias"].copy(),
        noise_level=profile["noise_level"],
        credentials=profile.get("credentials", {}),
        description=profile.get("description", ""),
        feedback_rate=profile.get("feedback_rate", 0.7),
    )


def create_domain_specialist_user(
    user_id: int,
    domain: str,
    baseline_authority: float = 0.75,
    profile_type: str = "domain_specialist"
) -> SyntheticUser:
    """
    Crea un utente specializzato in un dominio giuridico specifico.

    L'utente avrà authority elevata nel dominio specificato
    e più bassa negli altri domini.

    Args:
        user_id: ID utente
        domain: Dominio di specializzazione (civile, penale, etc.)
        baseline_authority: Authority baseline generale
        profile_type: Tipo profilo base

    Returns:
        SyntheticUser con authority elevata nel dominio specifico

    Example:
        >>> penalista = create_domain_specialist_user(1, "penale", 0.85)
        >>> print(penalista.get_domain_authority("penale"))
        0.85
        >>> print(penalista.get_domain_authority("civile"))
        0.51  # Più basso
    """
    if domain not in LEGAL_DOMAINS:
        raise ValueError(f"Dominio sconosciuto: {domain}. Validi: {LEGAL_DOMAINS}")

    if profile_type not in PROFILES:
        profile_type = "domain_specialist"

    profile = PROFILES[profile_type]

    # Crea credentials con specializzazione
    credentials = profile.get("credentials", {}).copy()
    credentials["specialization"] = domain

    user = SyntheticUser(
        user_id=user_id,
        profile_type=f"{profile_type}_{domain}",
        baseline_authority=baseline_authority,
        current_authority=baseline_authority,
        evaluation_bias=profile["evaluation_bias"].copy(),
        noise_level=profile["noise_level"],
        credentials=credentials,
        description=f"{profile['description']} - Specialista {domain}",
        feedback_rate=profile.get("feedback_rate", 0.7),
    )

    return user
