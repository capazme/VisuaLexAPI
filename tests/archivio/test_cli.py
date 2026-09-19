"""The command line, end to end against the fake VisuaLex.

`--rate 0` disables pacing: without it every call waits its second."""
import yaml

from archivio_normativo.cli import async_main
from archivio_normativo.store import Store
from tests.archivio.fake_visualex import FakeVisuaLex

CC_URL = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262"


def write_manifest(tmp_path, base_url, acts=None):
    data = {
        "version": 1,
        "providers": {"visualex": {"base_url": base_url}},
        "acts": acts or [{
            "id": "cc", "area": "civile", "label": "Codice civile", "source": "normattiva",
            "act_type": "codice civile", "cite": "c.c.",
        }],
    }
    path = tmp_path / "manifest.yaml"
    path.write_text(yaml.safe_dump(data, allow_unicode=True, sort_keys=False), encoding="utf-8")
    return path


def add_cc(fake: FakeVisuaLex):
    fake.add_act(
        act_type="codice civile", url=CC_URL, annex="2",
        tree=["LIBRO QUARTO Delle obbligazioni", {"numero": "2043", "allegato": "2"}, {"numero": "2044", "allegato": "2"}],
        rubriche={"2043": "Risarcimento per fatto illecito"},
        fingerprints={"2043": {"fingerprint": "a" * 64, "date": None}, "2044": {"fingerprint": "b" * 64, "date": None}},
        articles={"2043": "Qualunque fatto doloso o colposo che cagiona ad altri un danno ingiusto…",
                  "2044": "Non è responsabile chi ha commesso il fatto per esservi stato costretto…"},
    )


async def test_dry_run_prints_the_plan_and_writes_nothing(fake_visualex, tmp_path, capsys):
    add_cc(fake_visualex)
    manifest = write_manifest(tmp_path, fake_visualex.base_url)
    out = tmp_path / "out"
    code = await async_main(["build", "--manifest", str(manifest), "--out", str(out), "--dry-run", "--rate", "0"])
    assert code == 0
    assert "PROVA (dry-run)" in capsys.readouterr().out
    assert not out.exists()


async def test_build_then_rebuild(fake_visualex, tmp_path, capsys):
    add_cc(fake_visualex)
    manifest = write_manifest(tmp_path, fake_visualex.base_url)
    out = tmp_path / "out"
    code = await async_main(["build", "--manifest", str(manifest), "--out", str(out), "--rate", "0"])
    assert code == 0
    text = capsys.readouterr().out
    assert "Run 1" in text and "nuovi 2" in text and "Verifica: nessuna anomalia." in text
    assert (out / "archivio.sqlite").exists()
    assert (out / "civile" / "cc.md").exists() and (out / "INDICE.md").exists()
    assert list((out / "logs").glob("build-*.log"))
    md = (out / "civile" / "cc.md").read_text(encoding="utf-8")
    assert "## Art. 2043 — Risarcimento per fatto illecito" in md

    code = await async_main(["build", "--manifest", str(manifest), "--out", str(out), "--rate", "0"])
    assert code == 0
    assert "invariati 2" in capsys.readouterr().out


async def test_indice_shows_done_not_running_after_a_build(fake_visualex, tmp_path, capsys):
    add_cc(fake_visualex)
    manifest = write_manifest(tmp_path, fake_visualex.base_url)
    out = tmp_path / "out"
    code = await async_main(["build", "--manifest", str(manifest), "--out", str(out), "--rate", "0"])
    assert code == 0
    capsys.readouterr()
    indice = (out / "INDICE.md").read_text(encoding="utf-8")
    assert "(done)" in indice
    assert "(running)" not in indice


async def test_verify_report_and_export(fake_visualex, tmp_path, capsys):
    add_cc(fake_visualex)
    manifest = write_manifest(tmp_path, fake_visualex.base_url)
    out = tmp_path / "out"
    await async_main(["build", "--manifest", str(manifest), "--out", str(out), "--rate", "0"])
    capsys.readouterr()
    assert await async_main(["verify", "--manifest", str(manifest), "--out", str(out)]) == 0
    assert "Verifica" in capsys.readouterr().out
    assert await async_main(["report", "--manifest", str(manifest), "--out", str(out)]) == 0
    assert "run 1: done" in capsys.readouterr().out
    target = tmp_path / "units.jsonl"
    assert await async_main(["export", "--manifest", str(manifest), "--out", str(out), "--jsonl", str(target)]) == 0
    lines = target.read_text(encoding="utf-8").splitlines()
    assert len(lines) == 2 and '"id": "cc:art:2043"' in lines[0]
    assert await async_main(["render", "--manifest", str(manifest), "--out", str(out)]) == 0


async def test_failures_make_the_exit_code_one(fake_visualex, tmp_path, capsys):
    fake_visualex.add_act(act_type="codice civile", url=CC_URL, annex="2",
                          tree=[{"numero": "2043", "allegato": "2"}], fingerprints=None,
                          articles={"2043": {"error": "ParsingError"}})
    manifest = write_manifest(tmp_path, fake_visualex.base_url)
    code = await async_main(["build", "--manifest", str(manifest), "--out", str(tmp_path / "out"), "--rate", "0"])
    assert code == 1
    assert "ParsingError" in capsys.readouterr().out


async def test_bad_kind_and_missing_resume_are_usage_errors(fake_visualex, tmp_path, capsys):
    add_cc(fake_visualex)
    manifest = write_manifest(tmp_path, fake_visualex.base_url)
    out = tmp_path / "out"
    assert await async_main(["build", "--manifest", str(manifest), "--out", str(out), "--rate", "0", "--enrich", "oracolo"]) == 2
    assert "oracolo" in capsys.readouterr().err
    assert await async_main(["build", "--manifest", str(manifest), "--out", str(out), "--rate", "0", "--resume"]) == 2


async def test_commands_without_an_archive_say_so(fake_visualex, tmp_path, capsys):
    manifest = write_manifest(tmp_path, fake_visualex.base_url)
    assert await async_main(["verify", "--manifest", str(manifest), "--out", str(tmp_path / "nowhere")]) == 2
    assert "run `build` first" in capsys.readouterr().err


async def test_dry_run_counts_enrichment_on_a_fresh_archive(fake_visualex, tmp_path, capsys):
    fake_visualex.add_act(
        act_type="codice civile", url=CC_URL, annex="2",
        tree=["LIBRO QUARTO Delle obbligazioni", {"numero": "2043", "allegato": "2"},
              {"numero": "2044", "allegato": "2"}, {"numero": "2045", "allegato": "2"}],
        rubriche={"2043": "Risarcimento per fatto illecito"},
        fingerprints={"2043": {"fingerprint": "a" * 64, "date": None}, "2044": {"fingerprint": "b" * 64, "date": None},
                      "2045": {"fingerprint": "c" * 64, "date": None}},
        articles={"2043": "Qualunque fatto…", "2044": "Non è responsabile…", "2045": "Chiunque cagiona…"},
    )
    manifest = write_manifest(tmp_path, fake_visualex.base_url)
    out = tmp_path / "out"  # fresh: no archivio.sqlite yet, so the store is None
    code = await async_main(["build", "--manifest", str(manifest), "--out", str(out), "--dry-run", "--rate", "0",
                             "--enrich", "cassazione"])
    assert code == 0
    assert "3 previste" in capsys.readouterr().out


async def test_resume_continues_the_interrupted_run(fake_visualex, tmp_path, capsys):
    add_cc(fake_visualex)
    manifest = write_manifest(tmp_path, fake_visualex.base_url)
    out = tmp_path / "out"
    with Store(out / "archivio.sqlite") as store:
        run_id = store.start_run({}, "t")
    code = await async_main(["build", "--manifest", str(manifest), "--out", str(out), "--rate", "0", "--resume"])
    assert code == 0
    assert f"Run {run_id}" in capsys.readouterr().out
    with Store(out / "archivio.sqlite") as store:
        assert store.get_run(run_id)["status"] == "done"
