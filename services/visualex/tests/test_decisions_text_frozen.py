"""A decision's text is a data contract (design 2026-10-05 §8.2 and §8.5, root rule 23).

Highlights and notes on a decision are pinned by offset and text over its projection: the blocks
in reading order (epigrafe, motivazione, dispositivo), each stripped of ASCII whitespace at its
two edges, then concatenated, then every `\\n` removed. A reader may add or move `\\n` and move a
boundary between blocks across whitespace; it may never add, drop or change another character.

`frozen_projections.json` stores, per case, the SHA-256 of the projection's UTF-8 and its length,
never the text (the repository is public). The cases here are synthetic, or open data of the
Corte costituzionale, or withheld records. The synthetic PDF carries the page-furniture rules
(a running header in the top band only, a running footer in the bottom band only, page numbers,
a stamp, an unmapped glyph), both joins, the paragraph rules and a heading 60 points in: moving
`TOP_BAND`, `BOTTOM_BAND` or `CENTER_INDENT` across them fails it (checked by mutation). Rules
the synthetic cases do not reach are covered only by the private run below. The same check on real decisions runs in `test_decisions_text_frozen_local.py`, which skips
without the git-ignored `fixtures/decisions/private/` folder. A deliberate change of characters
is not recorded over this file: it is refused (the freeze takes effect with the pull request that
first stores notes on decisions).
"""
import hashlib
import json
import pathlib

import pytest

from tests.decisions_pdf_synth import Text, make_pdf
from visualex_api.services.decisions import corte_cost
from visualex_api.services.decisions.italgiure import to_decision
from visualex_api.services.decisions.pdf_text import text_from_pdf

FIX = pathlib.Path(__file__).parent / "fixtures" / "decisions"
GOLDEN_PATH = FIX / "frozen_projections.json"
BLOCKS = ("epigrafe", "motivazione", "dispositivo")


STRIP = " \t\n\r\f\v"  # ASCII whitespace only (spec §8.2): the web's regex strips the same set


def projection(testo: dict) -> str:
    return "".join((testo.get(k) or "").strip(STRIP) for k in BLOCKS).replace("\n", "")


def fingerprint(testo: dict) -> dict:
    text = projection(testo)
    return {"sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(), "length": len(text)}


def _flow(x, y, lines, step=14):
    return [Text(x, y - i * step, t) for i, t in enumerate(lines)]


def _pdf_with_dispositivo() -> bytes:
    """Furniture of every kind, both joins, every paragraph rule, and a P.Q.M. split."""
    p0 = [Text(85, 800, "Civile Ord. Sez. 1 Num. 12345 Anno 2026"),
          Text(85, 786, "Presidente: PRIMO PRESIDENTE"),
          Text(85, 772, "Relatore: CONSIGLIERE ESTENSORE"),
          Text(85, 758, "Data pubblicazione: 01/01/2026"),
          Text(407, 735, "Oggetto: appalti"),
          Text(560, 300, "copia non ufficiale", rotate=True),
          Text(255, 700, "ORDINANZA")]
    p0 += _flow(85, 640, ["sul ricorso proposto da una societa di costruzioni contro il",
                          "Ministero competente, avverso la sentenza della Corte di appello,",
                          "visti gli atti della CORTE DEI CONTI -",
                          "SEZIONI RIUNITE, depositati il giorno stabilito."])        # space joins
    p0 += [Text(85, 584, "Il giudice del (cid:9)rinvio ha deciso la causa."),             # an unmapped glyph
           Text(85, 570, "la parte ricorrente nei confronti dell'"),                      # one baseline,
           Text(330, 570, "ASSESSORATO COMPETENTE"),                                       # two pieces
           Text(540, 560, "(A,", size=18)]                                                # margin debris
    p0 += _flow(85, 536, ["Udita la relazione svolta dal consigliere, si osserva che il",
                          "territorio dell'Emilia-", "Romagna era compreso nell'appalto."])  # a gap, a hyphen
    p0 += [Text(255, 490, "FATTI DI CAUSA"),                                              # a heading
           Text(85, 476, "La societa ricorrente ha agito in giudizio contro l'amministrazione."),
           Text(100, 462, "La Corte di appello ha rigettato la domanda,"),                # an indent
           Text(85, 448, "ritenendo il contratto privo dei requisiti di forma.")]
    p0 += [Text(85, 74, "Il Presidente estensore"),
           Text(85, 51, "Ric. 2020 n. 12345 sez. SU - ud. 14-12-2021")]
    p1 = [Text(85, 800, "r.g. n. 27512/2022"),
          Text(85, 768, "Ufficio del ruolo generale"),                                   # a running header in TOP_BAND only
          Text(255, 720, "CONSIDERATO CHE"),
          Text(85, 704, "il ricorso si articola nei motivi che seguono, esaminati insieme."),
          Text(65, 690, "7. va premessa la questione di giurisdizione, rilevabile"),     # an outdented point
          Text(85, 676, "anche d'ufficio in ogni stato e grado del giudizio."),
          Text(65, 652, "612.000,00 subordinatamente alla prova della somma."),            # not a point
          Text(85, 95, "Documento riservato alle parti"),                                # a running footer in BOTTOM_BAND only
          Text(85, 76, "Il Presidente estensore"),
          Text(85, 51, "2"), Text(140, 51, "Ric. 2021 n. 09083 sez. SU - ud. 08-02-2022"),
          Text(290, 32, "-2-"), Text(250, 20, "Pag. 2 di 3")]
    p2 = [Text(85, 800, "r.g. n. 27512/2022"),
          Text(85, 768, "Ufficio del ruolo generale"),
          Text(85, 700, "Il secondo motivo e' fondato e la sentenza va cassata."),
          Text(145, 686, "SVOLGIMENTO DEL PROCESSO"),                                    # a heading, 60 pt in
          Text(85, 672, "Le parti hanno svolto le difese nei termini."),
          Text(255, 660, "P.Q.M."),
          Text(85, 646, "La Corte accoglie il ricorso, cassa la sentenza impugnata e rinvia."),
          Text(100, 618, "Cosi deciso in Roma, nella camera di consiglio."),
          Text(85, 95, "Documento riservato alle parti"),
          Text(85, 51, "3"), Text(140, 51, "Ric. 2021 n. 09083 sez. SU - ud. 08-02-2022")]
    return make_pdf([p0, p1, p2])


def _pdf_without_dispositivo() -> bytes:
    """No P.Q.M.: the whole text is the motivazione; the spelled-out heading is not a split here."""
    p0 = [Text(85, 700, "il ricorso e' inammissibile perche' privo di specificita',"),
          Text(85, 686, "e la questione non puo' essere esaminata nel merito."),
          Text(85, 640, "Segue la condanna alle spese del giudizio di legittimita'."),
          Text(85, 51, "1")]
    return make_pdf([p0])


def _record(**fields) -> dict:
    return {"numdec": "12345", "anno": "2024", "kind": "snciv", "szdec": "1", "tipoprov": "Ordinanza",
            "datdep": ["20240422"], "id": "snciv2024112345O", **fields}


_OCR = ("CORTE SUPREMA DI CASSAZIONE   RILEVATO CHE con ricorso il debitore ha impugnato la "
        "sentenza. 1. Il primo motivo denuncia la violazione dell'art. 5 c.c. 2. Il secondo motivo e' "
        "infondato; Considerato che il ricorso va rigettato. RITENUTO IN FATTO E CONSIDERATO IN DIRITTO "
        "che le spese seguono la soccombenza. P.Q.M. La Corte rigetta il ricorso.  ")
_DISPOSITIVO = "P.Q.M.  La Corte   rigetta il ricorso."

_CORTE_COST_RECORDS = {
    # testo present: entities, carriage returns, runs of spaces, a typewriter wrap
    "full": {
        "numero_pronuncia": "7", "anno_pronuncia": "2014",
        "epigrafe": "  LA CORTE COSTITUZIONALE&#13;ha pronunciato la seguente  \n",
        "testo": ("Ritenuto in fatto&#13;che il giudice   rimettente&#13;dubita della legittimit&agrave; "
                  "dell’art. 1,\r\ncomma 2, della legge.\r\n\r\nConsiderato in diritto"),
        "dispositivo": "  per questi motivi\nLA CORTE\ndichiara l’illegittimità.\n\n",
        "tipologia_pronuncia": "S",
    },
    # the open data leave testo empty and put the reasoning in the epigrafe: split at «Ritenuto»
    "epigrafe_split": {
        "numero_pronuncia": "8", "anno_pronuncia": "2014",
        "epigrafe": ("composta dai signori&#13;ha pronunciato la seguente&#13;ORDINANZA&#13;"
                     "nel giudizio di legittimità costituzionale.\n  Ritenuto che il giudice "
                     "dubita;\nche la questione e' manifestamente inammissibile.\n"
                     "Considerato che nulla osta."),
        "testo": "", "dispositivo": "per questi motivi la Corte dichiara inammissibile.",
        "tipologia_pronuncia": "O",
    },
    # no reasoning marker: the epigrafe stays whole
    "epigrafe_whole": {
        "numero_pronuncia": "9", "anno_pronuncia": "2014",
        "epigrafe": "ha pronunciato la seguente ordinanza\nsul ricorso.", "testo": "",
    },
}


def synthetic_cases() -> dict:
    cases = {
        "synthetic_pdf_with_dispositivo": text_from_pdf(_pdf_with_dispositivo()),
        "synthetic_pdf_without_dispositivo": text_from_pdf(_pdf_without_dispositivo()),
        "synthetic_field_full": to_decision(_record(ocr=[_OCR], ocrdis=[_DISPOSITIVO]), "civile").testo,
        "synthetic_field_without_dispositivo": to_decision(_record(ocr=[_OCR]), "civile").testo,
        "synthetic_field_multivalued": to_decision(
            _record(ocr=["  RILEVATO CHE primo.  ", "  CONSIDERATO CHE secondo.  "]), "civile").testo,
        # a character outside the BMP: Python counts one code point, a JS string two units
        "synthetic_field_astral": to_decision(
            _record(ocr=["RILEVATO CHE la massima \U0001D49C vale per la sezione \U0001D49D. P.Q.M. Rigetta."]),
            "civile").testo,
        "synthetic_field_withheld": to_decision(
            _record(ocr=["CORTE SUPREMA DI CASSAZIONE ITALGIUREWEB La sentenza richiesta e' in fase di "
                         "oscuramento"]), "civile").testo,
    }
    for name in ("italgiure_snciv_10787_2024.json", "italgiure_snpen_10787_2024.json"):
        doc = json.loads((FIX / name).read_text())["response"]["docs"][0]
        cases[name] = to_decision(doc, "civile" if "snciv" in name else "penale").testo
    for name, record in _CORTE_COST_RECORDS.items():
        cases[f"synthetic_corte_cost_{name}"] = corte_cost.to_decision(record).testo
    for record in json.loads((FIX / "corte_cost_2014_sample.json").read_text()):
        key = f"corte_cost_{record['anno_pronuncia']}_{int(record['numero_pronuncia']):04d}"
        cases[key] = corte_cost.to_decision(record).testo
    return cases


CASES = synthetic_cases()
GOLDEN = json.loads(GOLDEN_PATH.read_text())


@pytest.mark.parametrize("key", sorted(CASES))
def test_the_projection_of_each_reader_is_frozen(key):
    assert key in GOLDEN, f"{key} has no golden entry"
    assert fingerprint(CASES[key]) == GOLDEN[key]


def test_the_projection_strips_each_block_and_drops_only_newlines():
    testo = {"epigrafe": " a b \n", "motivazione": "\n\nc\nd\n\n", "dispositivo": "  e  f\t"}
    assert projection(testo) == "a bcde  f"
    assert projection({"motivazione": "x"}) == "x" and projection({}) == ""


def test_the_cases_exercise_what_they_claim():
    # a golden of empty strings would freeze nothing: every case but the withheld ones has text
    empty = {k for k, v in CASES.items() if not projection(v)}
    assert empty == {"synthetic_field_withheld", "italgiure_snciv_10787_2024.json"}
    assert "dispositivo" in CASES["synthetic_pdf_with_dispositivo"]
    assert "dispositivo" not in CASES["synthetic_pdf_without_dispositivo"]
    assert CASES["synthetic_corte_cost_epigrafe_split"]["motivazione"].startswith("Ritenuto")
    assert "Emilia-Romagna" in projection(CASES["synthetic_pdf_with_dispositivo"])
    pdf = projection(CASES["synthetic_pdf_with_dispositivo"])
    assert "CONTI - SEZIONI" in pdf
    assert "del rinvio ha deciso" in pdf and "cid:" not in pdf
    assert "dell'ASSESSORATO" not in pdf and "dell' ASSESSORATO COMPETENTE" in pdf
    assert "(A," not in pdf and "Pag. 2 di 3" not in pdf and "Pag." not in pdf
