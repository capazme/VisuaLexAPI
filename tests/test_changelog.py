"""Tests for the user-facing changelog built from the git first-parent log."""

from visualex_api.tools.changelog import build_changelog, changelog_range

DATE = "2026-08-20 10:00:00 +0200"


def line(commit_hash: str, subject: str) -> str:
    return f"{commit_hash}|{subject}|{DATE}|capazme"


def subjects(entries):
    return [e["summary"] for e in entries]


def test_parses_a_log_line_into_its_fields():
    entries = build_changelog(line("abc1234", "feat(reading): inline case law"))

    assert len(entries) == 1
    entry = entries[0]
    assert entry["hash"] == "abc1234"
    assert entry["message"] == "feat(reading): inline case law"
    assert entry["summary"] == "inline case law"
    assert entry["type"] == "feat"
    assert entry["scope"] == "reading"
    assert entry["date"] == DATE
    assert entry["author"] == "capazme"


def test_a_summary_without_a_prefix_keeps_the_whole_subject():
    entries = build_changelog(line("abc1234", "primo push API"))

    assert entries[0]["summary"] == "primo push API"
    assert entries[0]["type"] is None
    assert entries[0]["scope"] is None


def test_drops_a_revert_together_with_the_work_it_undid():
    raw = "\n".join([
        line("0845090", 'Revert "merge: live case law from four courts"'),
        line("b849acc", "merge: live case law from four courts"),
        line("d3bb80b", "merge: accessible names for the sidebar controls"),
    ])

    assert subjects(build_changelog(raw)) == ["accessible names for the sidebar controls"]


def test_a_revert_of_a_revert_restores_the_work():
    raw = "\n".join([
        line("aaaaaaa", 'Revert "Revert "merge: live case law""'),
        line("0845090", 'Revert "merge: live case law"'),
        line("b849acc", "merge: live case law"),
    ])

    assert subjects(build_changelog(raw)) == ["live case law"]


def test_drops_housekeeping_commit_types():
    raw = "\n".join([
        line("1111111", "chore: bump version to 1.3.0"),
        line("2222222", "docs: implementation plan for the case-law backend"),
        line("3333333", "ci: run the Node jobs on 24"),
        line("4444444", "test(palette): give the second wait the same budget"),
        line("5555555", "build: drop the unused rollup plugin"),
        line("6666666", "style: reformat the store"),
        line("7777777", "refactor(store): split the tab actions"),
        line("8888888", "fix(sidebar): lift hover tooltips above page content"),
    ])

    assert subjects(build_changelog(raw)) == ["lift hover tooltips above page content"]


def test_drops_fixes_scoped_to_the_toolchain():
    raw = "\n".join([
        line("1111111", "fix(tests): skip live tests on source unreachability"),
        line("2222222", "fix(deploy): stop each deploy from breaking the next one"),
        line("3333333", "fix(palette): reach the act resolver instead of a stale copy"),
    ])

    assert subjects(build_changelog(raw)) == [
        "reach the act resolver instead of a stale copy"
    ]


def test_drops_a_bare_branch_merge_that_names_no_change():
    raw = "\n".join([
        line("4e8e739", "Merge branch 'claude/reading-navigation-round2a' into main"),
        line("1234567", "Merge pull request #12 from capazme/fix-dates"),
        line("f72f945", "merge: case law as an inline section"),
    ])

    assert subjects(build_changelog(raw)) == ["case law as an inline section"]


def test_a_descriptive_merge_keeps_its_subject_and_carries_no_scope():
    entries = build_changelog(line("d3bb80b", "merge: accessible names for the sidebar"))

    assert entries[0]["summary"] == "accessible names for the sidebar"
    assert entries[0]["type"] == "merge"
    assert entries[0]["scope"] is None


def test_a_breaking_change_marker_does_not_hide_the_summary():
    entries = build_changelog(line("abc1234", "feat(api)!: drop the legacy route"))

    assert entries[0]["summary"] == "drop the legacy route"
    assert entries[0]["type"] == "feat"
    assert entries[0]["scope"] == "api"


def test_keeps_only_the_most_recent_entries_up_to_the_limit():
    raw = "\n".join(line(f"{i:07d}", f"fix: change number {i}") for i in range(5))

    assert subjects(build_changelog(raw, limit=2)) == ["change number 0", "change number 1"]


def test_ignores_malformed_and_empty_lines():
    raw = "\n".join([
        "",
        "not-a-log-line",
        "abc1234|missing the trailing fields",
        line("d3bb80b", "fix: a real one"),
    ])

    assert subjects(build_changelog(raw)) == ["a real one"]


def test_no_output_from_git_yields_no_entries():
    assert build_changelog("") == []


def test_the_window_starts_at_the_bump_before_the_current_one():
    version_log = "2be0468aaa\n79b4d1dbbb\ncf93c8eccc"

    assert changelog_range(version_log) == "79b4d1dbbb..HEAD"


def test_a_first_ever_release_has_no_earlier_bump_to_start_from():
    assert changelog_range("2be0468aaa") is None
    assert changelog_range("") is None
