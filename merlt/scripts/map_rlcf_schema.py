"""Parse rlcf-schema.sql and emit a structured map of the 36 RLCF tables,
grouped by logical area, with key columns and FK relationships.

Logical groups are defined manually below — they reflect the architecture of
the RLCF system as documented in `merlt/CLAUDE.md` (the 4 pilastri) and the
table names themselves.
"""

from __future__ import annotations

import re
from pathlib import Path

SCHEMA = Path(__file__).resolve().parents[1] / "data" / "seeds" / "postgres-dumps" / "rlcf-schema.sql"

GROUPS: list[tuple[str, str, list[str]]] = [
    (
        "PROPOSAL LAYER",
        "Edit proposte dagli utenti, in attesa di review (cuore del Laboratorio).",
        ["pending_entities", "pending_relations", "pending_amendments"],
    ),
    (
        "VOTING / CONSENSUS",
        "Voti pesati per authority sulle proposte; alimentano la soglia di merge.",
        ["entity_votes", "relation_votes", "amendment_votes"],
    ),
    (
        "ISSUE REPORTING",
        "Segnalazione di errori/dubbi su entità o relazioni già nel grafo.",
        ["entity_issue_reports", "entity_issue_votes",
         "relation_issue_reports", "relation_issue_votes"],
    ),
    (
        "DEVIL'S ADVOCATE (4° pilastro RLCF)",
        "Assegnazione automatica di sfidanti per evitare conformismo.",
        ["devils_advocate_assignments", "devils_advocate_log"],
    ),
    (
        "AUTHORITY",
        "Punteggio di autorità per dominio (gating delle soglie).",
        ["user_domain_authority"],
    ),
    (
        "FEEDBACK / RATINGS",
        "Feedback strutturato sulle risposte (Slice 3+ ma schema già pronto).",
        ["feedback", "feedback_ratings", "aggregated_feedback", "rlcf_feedback"],
    ),
    (
        "QA TRACES",
        "Tracce di Q&A multi-expert con risposte e fonti.",
        ["qa_traces", "qa_feedback", "responses"],
    ),
    (
        "TRAINING / POLICY",
        "Loop di reinforcement learning offline.",
        ["rlcf_traces", "rlcf_training_sessions", "rlcf_policy_checkpoints"],
    ),
    (
        "GOVERNANCE / ACCOUNTABILITY",
        "Audit, bias detection, accountability reports.",
        ["audit_log", "bias_reports", "accountability_reports"],
    ),
    (
        "LEGAL TASK SYSTEM",
        "Coda di task giuridici assegnabili a esperti.",
        ["legal_tasks", "task_assignments"],
    ),
    (
        "BRIDGE / INGESTION",
        "Mapping chunk testuale → nodo grafo + scheduling ingestion.",
        ["bridge_table", "ingestion_schedules"],
    ),
    (
        "AUTH / USERS (legacy MERL-T, NON riusare — abbiamo VisuaLex auth)",
        "Tabelle utente del sistema standalone MERL-T.",
        ["users", "credentials", "api_keys", "user_documents"],
    ),
    (
        "MISC / META",
        "Tabelle di servizio.",
        ["alembic_version", "bridge_test_8371020c"],
    ),
]


def parse_tables(sql: str) -> dict[str, dict]:
    """Return {table_name: {"columns": [(name, type, nullable, default)], "fks": [...]} }."""
    out: dict[str, dict] = {}

    # CREATE TABLE blocks
    create_re = re.compile(
        r"CREATE TABLE public\.(\w+) \((.*?)\n\);",
        re.DOTALL,
    )
    for m in create_re.finditer(sql):
        name = m.group(1)
        body = m.group(2)
        cols: list[tuple[str, str, bool, str | None]] = []
        for line in body.split("\n"):
            line = line.strip().rstrip(",")
            if not line or line.startswith("CONSTRAINT"):
                continue
            # match "name TYPE [NOT NULL] [DEFAULT ...]"
            mcol = re.match(r"(\w+)\s+([^,]+)", line)
            if not mcol:
                continue
            col_name = mcol.group(1)
            rest = mcol.group(2).strip()
            nullable = "NOT NULL" not in rest
            default = None
            mdef = re.search(r"DEFAULT\s+(.+?)(?:\s+NOT NULL|\s*$)", rest)
            if mdef:
                default = mdef.group(1).strip()
            # strip NOT NULL / DEFAULT for the type
            col_type = re.sub(r"\s*NOT NULL", "", rest)
            col_type = re.sub(r"\s*DEFAULT\s+.+", "", col_type)
            cols.append((col_name, col_type.strip(), nullable, default))
        out[name] = {"columns": cols, "fks": []}

    # ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY ...
    fk_re = re.compile(
        r"ALTER TABLE ONLY public\.(\w+)\s+ADD CONSTRAINT \w+ FOREIGN KEY \(([^)]+)\) REFERENCES public\.(\w+)\(([^)]+)\)",
    )
    for m in fk_re.finditer(sql):
        table = m.group(1)
        col = m.group(2).strip()
        ref_table = m.group(3)
        ref_col = m.group(4).strip()
        if table in out:
            out[table]["fks"].append(f"{col} → {ref_table}.{ref_col}")

    return out


def main() -> None:
    sql = SCHEMA.read_text()
    tables = parse_tables(sql)
    seen: set[str] = set()
    print(f"# RLCF Schema Map — {len(tables)} tables\n")
    for title, summary, names in GROUPS:
        print(f"## {title}")
        print(f"_{summary}_\n")
        for name in names:
            if name not in tables:
                print(f"  - **{name}** (NOT FOUND)\n")
                continue
            seen.add(name)
            t = tables[name]
            cols = t["columns"]
            fks = t["fks"]
            print(f"### `{name}`  ({len(cols)} cols)")
            # Print only the most relevant columns: id, key business cols, fk cols
            for col_name, col_type, nullable, default in cols:
                nn = "" if nullable else " NOT NULL"
                df = f" DEFAULT {default}" if default else ""
                print(f"    {col_name:30} {col_type:35}{nn}{df}")
            if fks:
                print("    --- FK ---")
                for fk in fks:
                    print(f"    {fk}")
            print()
    leftover = set(tables.keys()) - seen
    if leftover:
        print("## UNGROUPED")
        for name in sorted(leftover):
            print(f"  - {name}")


if __name__ == "__main__":
    main()
