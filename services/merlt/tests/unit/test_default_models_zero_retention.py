"""Every model MERL-T can pick by itself has a zero-retention provider (G-575).

Every call carries the provider rule `data_collection: deny, zdr: true` (G-456): a model with no
zero-retention endpoint on OpenRouter is refused. So the defaults, the fallbacks and the models the
admin can pick must all be on `ZERO_RETENTION_MODELS` (merlt/config/llm_models.py), and no other
model id may be written anywhere in the package or its scripts: a stale id would sit in a fallback
until the day it is used, and fail then.

No network: the list is the one kept in the code, read from OpenRouter's public list on the date it
names. The app is not started (merlt.config and its runtime settings are read on their own).
"""

import pathlib
import re

import yaml

from merlt.config import llm_models
from merlt.config.llm_models import DEFAULT_EXPERT_MODEL, DEFAULT_FAST_MODEL, ZERO_RETENTION_MODELS
from merlt.config.runtime_config import RuntimeConfig

SERVICE = pathlib.Path(__file__).resolve().parents[2]
WHERE = [SERVICE / "merlt", SERVICE / "scripts"]

# A model id as OpenRouter names it: «provider/model», in any case, also as a shell-style default
# (`${VAR:-provider/model}`). Not inside a URL or a path (preceded by a word character, `.` or `/`).
# A model name always has a digit or a hyphen, which keeps prose such as «OpenAI/Anthropic» out.
MODEL_ID = re.compile(
    r"(?<![\w./])(google|anthropic|openai|openrouter|mistralai|meta-llama|deepseek|x-ai|z-ai|qwen|cohere|"
    r"microsoft|nousresearch|perplexity|amazon|nvidia|moonshotai)/(?=[-a-z0-9.:]*[-0-9])[a-z0-9][-a-z0-9.:]*[a-z0-9]",
    re.IGNORECASE,
)


def test_the_defaults_have_a_zero_retention_provider():
    assert DEFAULT_FAST_MODEL in ZERO_RETENTION_MODELS
    assert DEFAULT_EXPERT_MODEL in ZERO_RETENTION_MODELS
    # The experts' model is the one G-575 keeps.
    assert DEFAULT_EXPERT_MODEL == "anthropic/claude-sonnet-4.5"


def test_the_admin_can_pick_only_zero_retention_models(monkeypatch):
    for variable in ("MERLT_EXPERT_MODEL", "MERLT_REACT_DECISION_MODEL"):
        monkeypatch.delenv(variable, raising=False)
    config = RuntimeConfig()
    for key in ("expert_model", "react_decision_model"):
        spec = config._specs[key]
        assert spec.default in ZERO_RETENTION_MODELS, key
        assert set(spec.choices) <= ZERO_RETENTION_MODELS, key
    assert config._specs["expert_model"].default == DEFAULT_EXPERT_MODEL
    assert config._specs["react_decision_model"].default == DEFAULT_FAST_MODEL


def test_no_model_id_in_the_package_is_off_the_list():
    stale = []
    for root in WHERE:
        for path in sorted(root.rglob("*")):
            if path.suffix not in {".py", ".yaml", ".yml"} or path == pathlib.Path(llm_models.__file__).resolve():
                continue
            for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
                for match in MODEL_ID.finditer(line):
                    if match.group(0) not in ZERO_RETENTION_MODELS:
                        stale.append(f"{path.relative_to(SERVICE)}:{number} {match.group(0)}")
    assert stale == []


def test_the_yaml_fallbacks_are_the_real_defaults():
    experts = yaml.safe_load((SERVICE / "merlt/experts/config/experts.yaml").read_text(encoding="utf-8"))
    found = []

    def walk(node):
        if isinstance(node, dict):
            for key, value in node.items():
                if key in {"model", "default_model"} and isinstance(value, str):
                    found.append(value)
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(experts)
    assert found and all(model == DEFAULT_EXPERT_MODEL for model in found), found
    extractors = yaml.safe_load(
        (SERVICE / "merlt/pipeline/enrichment/config/extractors.yaml").read_text(encoding="utf-8"))
    assert extractors["llm"]["default_model"] == DEFAULT_FAST_MODEL


def test_the_check_sees_a_stale_id():
    assert MODEL_ID.search('model = "google/gemini-2.5-flash"').group(0) == "google/gemini-2.5-flash"
    assert MODEL_ID.search("model: ${X:-google/gemini-2.5-flash}").group(0) == "google/gemini-2.5-flash"
    assert MODEL_ID.search("'openrouter/claude-3-sonnet'").group(0) == "openrouter/claude-3-sonnet"
    assert MODEL_ID.search('"Google/Gemini-2.5-Pro"')
    assert not MODEL_ID.search("https://example.org/google/x")
    assert not MODEL_ID.search("Compatibile con OpenAI/Anthropic function calling")
