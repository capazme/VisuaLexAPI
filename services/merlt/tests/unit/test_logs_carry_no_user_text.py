"""No log call in merlt/ carries a person's text or a model's text, only its length.

A question, a search a contributor typed, a proposed entity, the search strings an expert builds
from the question, and the model's own «thought» are personal or derived from what a person
wrote. Logs keep their length. services/merlt/CLAUDE.md: never log the user id next to a payload.

The check reads the source (no import): in a call to log/logger .debug/.info/.warning/.error/
.exception/.critical, a name or attribute called like a text (TEXT below), or a keyword argument
with such a name, may appear only inside len(...), or as an id (`query.query_id`, `content.id`).

ALLOWED lists the few lines that keep a text on purpose, each with its reason.
"""

import ast
import pathlib

PACKAGE = pathlib.Path(__file__).resolve().parents[2] / "merlt"

TEXT = {
    "query", "query_text", "text", "question", "completion", "content", "raw", "raw_content", "answer",
    "response_text", "error_text", "thought", "entity_text", "follow_up", "follow_up_query", "prompt",
    "llm_response", "q",
}
METHODS = {"debug", "info", "warning", "warn", "error", "exception", "critical"}
LOGGERS = {"log", "logger", "logging", "_log", "_logger"}

# (file relative to merlt/, name) → why that file's log lines may keep that text. Left as they are
# on purpose: the law's own first line (pipeline/parsing.py), URNs and Cypher are not called like a
# text, so they never reach the check.
ALLOWED = {
    # The VisuaLex server's own short answer to a refused callback (`resp.text[:300]`): the
    # server's error, never a person's text.
    ("worker/tasks.py", "text"): "the server's callback answer",
    ("worker/extraction_tasks.py", "text"): "the server's callback answer",
}


def _is_log_call(call: ast.Call) -> bool:
    func = call.func
    if not (isinstance(func, ast.Attribute) and func.attr in METHODS):
        return False
    owner = func.value
    if isinstance(owner, ast.Name):
        return owner.id in LOGGERS
    return isinstance(owner, ast.Attribute) and owner.attr in LOGGERS


def _name(node) -> str | None:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return node.attr
    return None


def _is_length_or_number(node) -> bool:
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "len":
        return True
    return isinstance(node, ast.Constant) and isinstance(node.value, (int, float, bool, type(None)))


def _leaks(call: ast.Call) -> list[str]:
    safe: set[int] = set()
    for sub in ast.walk(call):
        if isinstance(sub, ast.Call) and isinstance(sub.func, ast.Name) and sub.func.id == "len":
            safe.update(id(n) for n in ast.walk(sub))
        if isinstance(sub, ast.Attribute) and (sub.attr == "id" or sub.attr.endswith("_id")):
            safe.update(id(n) for n in ast.walk(sub))
    found = []
    for keyword in call.keywords:
        if keyword.arg in TEXT and not _is_length_or_number(keyword.value):
            found.append(f"{keyword.arg}=")
            safe.update(id(n) for n in ast.walk(keyword.value))
    for sub in ast.walk(call):
        if isinstance(sub, (ast.Name, ast.Attribute)) and id(sub) not in safe and _name(sub) in TEXT:
            found.append(_name(sub))
            safe.update(id(n) for n in ast.walk(sub))
    return found


def _scan() -> list[str]:
    hits = []
    for path in sorted(PACKAGE.rglob("*.py")):
        relative = path.relative_to(PACKAGE).as_posix()
        for call in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if isinstance(call, ast.Call) and _is_log_call(call):
                for leak in _leaks(call):
                    if (relative, leak.rstrip("=")) not in ALLOWED:
                        hits.append(f"{relative}:{call.lineno} {leak}")
    return hits


def test_no_log_call_carries_a_text():
    assert _scan() == []


def test_the_check_sees_a_leak():
    """The check itself: these lines must be caught, and a length must not."""
    caught = [
        'log.info("q", query=request.query[:50])',
        'log.info(f"query={query}")',
        'logger.debug("x", thought=decision.get("thought", "")[:100])',
        'log.error("e", entity_text=entity_text)',
        'self.logger.warning("w", text=text[:80])',
    ]
    for line in caught:
        assert _leaks(ast.parse(line).body[0].value), line
    for line in ['log.info("q", chars=len(query))', 'log.info("q", query_id=query.query_id)',
                 'log.info("q", query=len(request.query))']:
        assert not _leaks(ast.parse(line).body[0].value), line
