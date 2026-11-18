"""The language models MERL-T may pick by itself, and the defaults (G-575).

Every call to a model carries the provider rule `data_collection: deny, zdr: true`
(rlcf/ai_service.py, G-456): OpenRouter refuses a model that has no zero-retention endpoint. So
every default, every fallback and every model the admin can pick must be one that has such an
endpoint. `tests/unit/test_default_models_zero_retention.py` checks that, and that no other model id
is written anywhere in merlt/ or scripts/.

`ZERO_RETENTION_MODELS` is read from OpenRouter's public list of zero-retention endpoints
(`GET https://openrouter.ai/api/v1/endpoints/zdr`) on 18 November 2026 at 20:34 UTC. Zero retention
can be lost without notice (google/gemini-2.5-flash had none on that date): when an id leaves the
public list, remove it here and pick another. This module imports nothing from the app, so a
periodic check can read it on its own.
"""

ZERO_RETENTION_MODELS = frozenset({
    # Google Vertex (global), JSON mode on every zero-retention endpoint.
    "google/gemini-3.5-flash-lite",
    "google/gemini-3.8-flash",
    # Amazon Bedrock and Google Vertex. JSON mode: haiku-4.5 and sonnet-4.5 on Bedrock only.
    "anthropic/claude-haiku-4.5",
    "anthropic/claude-sonnet-4.5",
    "anthropic/claude-sonnet-5",
    "anthropic/claude-opus-4.8",
})

# The cheap role: the ReAct decisions, the question classifier, entity and relation extraction,
# parsing, and the default of the AI service's calls when a caller names no model.
DEFAULT_FAST_MODEL = "google/gemini-3.5-flash-lite"

# The experts' analyses and the synthesis: the quality of the answer. Unchanged by G-575.
DEFAULT_EXPERT_MODEL = "anthropic/claude-sonnet-4.5"

# What the admin can pick from the panel (config/runtime_config.py), in the panel's order.
ADMIN_MODEL_CHOICES = (
    "google/gemini-3.5-flash-lite",
    "google/gemini-3.8-flash",
    "anthropic/claude-haiku-4.5",
    "anthropic/claude-sonnet-4.5",
    "anthropic/claude-sonnet-5",
    "anthropic/claude-opus-4.8",
)
