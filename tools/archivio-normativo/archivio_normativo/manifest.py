"""The corpus, as the owner writes it.

Every act the archive knows comes from `manifest.yaml`; nothing is hardcoded
in the pipeline. Loading is strict on purpose: an unknown key, an unknown
enrichment kind or a malformed slug is an error at start-up, never a
silently ignored option.
"""
from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

import yaml

# The one ordinal table of the repo (a leaf module: importing it pulls in
# nothing else). A third private copy is exactly what CLAUDE.md forbids.
from visualex_api.tools.article_suffixes import ARTICLE_SUFFIX_ALTERNATION


class ManifestError(ValueError):
    """The manifest cannot be used as written."""


AREAS: tuple[str, ...] = (
    "costituzionale", "civile", "penale", "amministrativo",
    "tributario", "lavoro", "privacy-digitale", "ue",
)
SOURCES: tuple[str, ...] = ("normattiva", "eurlex")
UNITS: tuple[str, ...] = ("articles", "recitals")
EU_ACT_TYPES: tuple[str, ...] = ("regolamento ue", "direttiva ue")

_SLUG = re.compile(r"^[a-z0-9][a-z0-9-]*$")
_CONSOLIDATED_CELEX = re.compile(r"^0\d{4}[A-Z]\d{4}-\d{8}$")
_SELECTION_ITEM = re.compile(r"^(\d+)(?:-(\d+))?$")
_SUFFIXED_ITEM = re.compile(rf"^\d+-(?:{ARTICLE_SUFFIX_ALTERNATION})$")


@dataclass(frozen=True)
class EnrichKind:
    name: str
    level: str  # "unit" (one call per article) or "act" (one per act)


KINDS: dict[str, EnrichKind] = {
    "brocardi": EnrichKind("brocardi", "unit"),
    "cassazione": EnrichKind("cassazione", "unit"),
    "cassazione_massime": EnrichKind("cassazione_massime", "unit"),
    "amministrativa": EnrichKind("amministrativa", "unit"),
    "tributaria": EnrichKind("tributaria", "unit"),
    "cgue": EnrichKind("cgue", "unit"),
    "costituzionale": EnrichKind("costituzionale", "unit"),
    "garante": EnrichKind("garante", "unit"),
    "attuazione": EnrichKind("attuazione", "act"),
    "base_ue": EnrichKind("base_ue", "act"),
}
KIND_ALIASES: dict[str, str] = {"annotazioni": "brocardi"}
KIND_GROUPS: dict[str, tuple[str, ...]] = {
    "giurisprudenza": ("cassazione", "amministrativa", "tributaria", "cgue", "costituzionale"),
}


def expand_kinds(names: Iterable[str]) -> tuple[str, ...]:
    """Resolve aliases and groups into concrete kinds, order kept, no repeats."""
    out: list[str] = []
    for raw in names:
        name = str(raw).strip().lower()
        name = KIND_ALIASES.get(name, name)
        expanded = KIND_GROUPS.get(name, (name,))
        for kind in expanded:
            if kind not in KINDS:
                raise ManifestError(f"unknown enrichment kind {raw!r}; known: {', '.join(KINDS)}")
            if kind not in out:
                out.append(kind)
    return tuple(out)


@dataclass(frozen=True)
class ArticleSelection:
    ranges: tuple[tuple[int, int], ...]
    explicit: frozenset[str]

    def contains(self, number: str) -> bool:
        if number in self.explicit:
            return True
        head = re.match(r"^(\d+)", number)
        if not head:
            return False
        value = int(head.group(1))
        return any(lo <= value <= hi for lo, hi in self.ranges)


def parse_article_selection(spec: str) -> ArticleSelection:
    """"1173-2059, 2643, 2-bis" -> ranges by numeric part, explicit keys otherwise."""
    ranges: list[tuple[int, int]] = []
    explicit: set[str] = set()
    for item in str(spec).split(","):
        item = item.strip().lower().replace(" ", "-")
        if not item:
            continue
        match = _SELECTION_ITEM.match(item)
        if match and match.group(2):
            lo, hi = int(match.group(1)), int(match.group(2))
            if lo > hi:
                raise ManifestError(f"enrich_articles: empty range {item!r}")
            ranges.append((lo, hi))
        elif match:
            explicit.add(item)
        elif _SUFFIXED_ITEM.match(item):
            explicit.add(item)
        else:
            raise ManifestError(f"enrich_articles: cannot read {item!r}")
    return ArticleSelection(tuple(ranges), frozenset(explicit))


@dataclass(frozen=True)
class Providers:
    visualex_base_url: str = "http://localhost:5000"
    legalit_command: tuple[str, ...] = ()


@dataclass(frozen=True)
class Defaults:
    version: str = "vigente"
    rate_per_second: float = 1.0
    enrich_rate_per_second: float = 0.5
    enrich_ttl_days: int = 90
    enrich: tuple[str, ...] = ()
    batch_size: int = 25


@dataclass(frozen=True)
class ActSpec:
    id: str
    area: str
    label: str
    source: str
    act_type: str
    cite: str
    date: str | None = None
    act_number: str | None = None
    annex: str | None = None
    celex: str | None = None
    celex_consolidated: str | None = None
    units: tuple[str, ...] = ("articles",)
    enrich: tuple[str, ...] = ()
    enrich_articles: str | None = None
    version: str = "vigente"

    def wants_recitals(self) -> bool:
        return "recitals" in self.units

    def is_eu(self) -> bool:
        return self.source == "eurlex"

    def enrich_selection(self) -> ArticleSelection | None:
        return parse_article_selection(self.enrich_articles) if self.enrich_articles else None

    def text_status(self) -> str:
        """Normattiva serves the consolidated text; EUR-Lex only when asked."""
        if not self.is_eu():
            return "consolidated"
        return "consolidated" if self.celex_consolidated else "oj"


@dataclass(frozen=True)
class Manifest:
    providers: Providers
    defaults: Defaults
    acts: tuple[ActSpec, ...]
    _by_id: dict = field(default_factory=dict, repr=False, compare=False)

    def act(self, act_id: str) -> ActSpec:
        try:
            return self._by_id[act_id]
        except KeyError:
            raise ManifestError(f"unknown act id {act_id!r}") from None

    def select(self, only: Iterable[str] | None, area: str | None) -> tuple[ActSpec, ...]:
        chosen = list(self.acts)
        if only is not None:
            wanted = [o.strip() for o in only if o.strip()]
            for act_id in wanted:
                self.act(act_id)  # raises on an unknown id
            chosen = [a for a in chosen if a.id in wanted]
        if area is not None:
            if area not in AREAS:
                raise ManifestError(f"unknown area {area!r}; known: {', '.join(AREAS)}")
            chosen = [a for a in chosen if a.area == area]
        return tuple(chosen)


_ACT_KEYS = {
    "id", "area", "label", "source", "act_type", "cite", "date", "act_number", "annex",
    "celex", "celex_consolidated", "units", "enrich", "enrich_articles", "version",
}
_TOP_KEYS = {"version", "providers", "defaults", "acts"}
_DEFAULT_KEYS = {"version", "rate_per_second", "enrich_rate_per_second", "enrich_ttl_days", "enrich", "batch_size"}


def _reject_unknown(mapping: dict, allowed: set[str], where: str) -> None:
    unknown = sorted(set(mapping) - allowed)
    if unknown:
        raise ManifestError(f"{where}: unknown key(s) {', '.join(unknown)}")


def _optional_str(value) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _parse_act(raw: dict, defaults: Defaults) -> ActSpec:
    if not isinstance(raw, dict):
        raise ManifestError(f"acts: each entry must be a mapping, got {type(raw).__name__}")
    where = f"act {raw.get('id', '?')!r}"
    _reject_unknown(raw, _ACT_KEYS, where)
    for key in ("id", "area", "label", "source", "act_type", "cite"):
        if not _optional_str(raw.get(key)):
            raise ManifestError(f"{where}: missing or empty {key!r}"
                                + (" (cite is how the act is written in a citation)" if key == "cite" else ""))
    act_id = str(raw["id"]).strip()
    if not _SLUG.match(act_id):
        raise ManifestError(f"{where}: id must be a slug [a-z0-9-], got {act_id!r}")
    area = str(raw["area"]).strip()
    if area not in AREAS:
        raise ManifestError(f"{where}: area must be one of {', '.join(AREAS)}, got {area!r}")
    source = str(raw["source"]).strip()
    if source not in SOURCES:
        raise ManifestError(f"{where}: source must be one of {', '.join(SOURCES)}, got {source!r}")
    units = tuple(str(u) for u in (raw.get("units") or ["articles"]))
    for unit in units:
        if unit not in UNITS:
            raise ManifestError(f"{where}: units must be among {', '.join(UNITS)}, got {unit!r}")
    if "recitals" in units and source != "eurlex":
        raise ManifestError(f"{where}: recitals exist only for EUR-Lex acts")
    enrich = expand_kinds(raw["enrich"]) if raw.get("enrich") is not None else defaults.enrich
    if "attuazione" in enrich and source != "eurlex":
        raise ManifestError(f"{where}: enrichment kind 'attuazione' (national implementation of a directive) "
                            f"applies to EUR-Lex acts only")
    if "base_ue" in enrich and source == "eurlex":
        raise ManifestError(f"{where}: enrichment kind 'base_ue' (the EU basis of a national act) "
                            f"applies to Normattiva acts only")
    celex = _optional_str(raw.get("celex"))
    if source == "eurlex" and not celex:
        raise ManifestError(f"{where}: an EUR-Lex act needs its 'celex' (e.g. 32016R0679)")
    enrich_articles = _optional_str(raw.get("enrich_articles"))
    if enrich_articles:
        try:
            parse_article_selection(enrich_articles)
        except ManifestError as exc:
            raise ManifestError(f"{where}: {exc}") from None
    celex_consolidated = _optional_str(raw.get("celex_consolidated"))
    if celex_consolidated and not _CONSOLIDATED_CELEX.match(celex_consolidated):
        raise ManifestError(
            f"{where}: celex_consolidated must be a sector-0 CELEX like 02002L0058-20091219, got {celex_consolidated!r}"
        )
    if celex_consolidated and source != "eurlex":
        raise ManifestError(f"{where}: celex_consolidated applies to EUR-Lex acts only")
    version = _optional_str(raw.get("version")) or defaults.version
    return ActSpec(
        id=act_id,
        area=area,
        label=str(raw["label"]).strip(),
        source=source,
        act_type=str(raw["act_type"]).strip(),
        cite=str(raw["cite"]).strip(),
        date=_optional_str(raw.get("date")),
        act_number=_optional_str(raw.get("act_number")),
        annex=_optional_str(raw.get("annex")),
        celex=celex,
        celex_consolidated=celex_consolidated,
        units=units,
        enrich=enrich,
        enrich_articles=enrich_articles,
        version=version,
    )


def _parse_providers(raw: dict | None) -> Providers:
    raw = raw or {}
    _reject_unknown(raw, {"visualex", "legalit"}, "providers")
    visualex = raw.get("visualex") or {}
    legalit = raw.get("legalit") or {}
    _reject_unknown(visualex, {"base_url"}, "providers.visualex")
    _reject_unknown(legalit, {"command"}, "providers.legalit")
    base_url = str(visualex.get("base_url") or "http://localhost:5000").rstrip("/")
    command = legalit.get("command") or []
    env_command = os.environ.get("LEGALIT_MCP_COMMAND")
    if env_command:
        try:
            command = json.loads(env_command)
        except json.JSONDecodeError as exc:
            raise ManifestError(f"LEGALIT_MCP_COMMAND must be a JSON list: {exc}") from None
    if not isinstance(command, list) or not all(isinstance(c, str) for c in command):
        raise ManifestError("providers.legalit.command must be a list of strings")
    command = tuple(os.path.expanduser(c) for c in command)
    return Providers(visualex_base_url=base_url, legalit_command=command)


def _parse_defaults(raw: dict | None) -> Defaults:
    raw = raw or {}
    _reject_unknown(raw, _DEFAULT_KEYS, "defaults")
    base = Defaults()
    try:
        return Defaults(
            version=str(raw.get("version") or base.version),
            rate_per_second=float(raw.get("rate_per_second", base.rate_per_second)),
            enrich_rate_per_second=float(raw.get("enrich_rate_per_second", base.enrich_rate_per_second)),
            enrich_ttl_days=int(raw.get("enrich_ttl_days", base.enrich_ttl_days)),
            enrich=expand_kinds(raw.get("enrich") or ()),
            batch_size=int(raw.get("batch_size", base.batch_size)),
        )
    except (TypeError, ValueError) as exc:
        raise ManifestError(f"defaults: {exc}") from None


def load_manifest(path: Path) -> Manifest:
    path = Path(path)
    if not path.is_file():
        raise ManifestError(f"manifest not found: {path}")
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        raise ManifestError(f"{path}: not valid YAML: {exc}") from None
    if not isinstance(data, dict):
        raise ManifestError(f"{path}: the manifest must be a mapping")
    _reject_unknown(data, _TOP_KEYS, "manifest")
    if data.get("version") != 1:
        raise ManifestError(f"{path}: version must be 1")
    providers = _parse_providers(data.get("providers"))
    defaults = _parse_defaults(data.get("defaults"))
    raw_acts = data.get("acts")
    if not isinstance(raw_acts, list) or not raw_acts:
        raise ManifestError(f"{path}: acts must be a non-empty list")
    acts = tuple(_parse_act(raw, defaults) for raw in raw_acts)
    seen: set[str] = set()
    for act in acts:
        if act.id in seen:
            raise ManifestError(f"duplicate act id {act.id!r}")
        seen.add(act.id)
    return Manifest(providers=providers, defaults=defaults, acts=acts, _by_id={a.id: a for a in acts})
