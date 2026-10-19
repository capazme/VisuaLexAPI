"""Loop β #3 — error / empty live-tool bodies must not be sedimented as sources."""

from merlt.experts.base import _is_unusable_live_result


def test_error_markdown_is_detected():
    assert _is_unusable_live_result("**Errore**: atto 'xyz' non riconosciuto. Prova con…")
    assert _is_unusable_live_result("  **errore**: ...")
    assert _is_unusable_live_result("atto 'https://...' non riconosciuto")
    assert _is_unusable_live_result("")


def test_empty_result_is_detected():
    assert _is_unusable_live_result("Nessuna decisione trovata per il riferimento: …")
    assert _is_unusable_live_result("Nessuna sentenza CGUE trovata per: …")
    assert _is_unusable_live_result("Nessun risultato trovato")


def test_real_source_passes():
    assert not _is_unusable_live_result("Art. 1453 c.c. — Risoluzione per inadempimento. Nei contratti…")
    assert not _is_unusable_live_result("**Trovate 21 decisioni** per: risoluzione…")
    assert not _is_unusable_live_result("Cass. civ. Sez. II, 12345/2022: la risoluzione presuppone…")
