# services/merlt/tests/pipeline/massimario_fixture.py
"""A synthetic volume in the portal's format. Invented text, names and numbers:
no text of the reviews may enter the repository (spec §9)."""

N = "http://www.normattiva.it/uri-res/N2Ls?urn:nir:"


def link(urn, text):
    return f'<a href="{N}{urn}" target="_blank">{text}</a>'


CC_2043 = "stato:codice.civile:1942-03-16;262~art2043"
CPC_360 = "stato:codice.procedura.civile:1940-10-28;1443~art360-com1-num5"
L_184 = "stato:legge:1983;184"
COST_3 = "stato:costituzione:1947-12-27~art3"
CC_1453 = "stato:codice.civile:1942-03-16;262~art1453"


def volume_9001():
    index = {"items": [{
        "deep": 0, "text": "Massimario 2024 CIVILE Vol. 1", "title": "", "elementId": None, "nodes": [
            {"deep": 1, "text": "PARTE PRIMA", "title": "I DIRITTI", "elementId": 9001,
             "functionName": "refreshParte", "nodes": [
                 {"deep": 2, "text": "CAPITOLO I", "title": "LA RESPONSABILITÀ", "elementId": 9101,
                  "elementType": "capitolo", "functionName": "refreshCapitolo", "nodes": [
                      {"deep": 3, "text": "1", "title": "Il danno.", "elementId": 9111, "elementType": "sezione", "nodes": [
                          {"deep": 4, "text": "1.1", "title": "Il nesso.", "elementId": 9112, "elementType": "sezione", "nodes": []},
                      ]},
                  ]},
             ]},
            {"deep": 1, "text": "PARTE SECONDA", "title": "I CONTRATTI", "elementId": 9002,
             "functionName": "refreshParte", "nodes": [
                 {"deep": 2, "text": "CAPITOLO II", "title": "LA RISOLUZIONE", "elementId": 9102,
                  "elementType": "capitolo", "functionName": "refreshCapitolo", "nodes": [
                      {"deep": 3, "text": "1", "title": "L'inadempimento.", "elementId": 9121, "elementType": "sezione", "nodes": []},
                  ]},
             ]},
            {"deep": 1, "text": "1", "title": "Una sezione sciolta.", "elementId": 9201, "elementType": "sezione", "nodes": []},
        ]}]}
    capitolo_9101 = {
        "id": 9101, "nome": "CAPITOLO I", "titolo": "LA RESPONSABILITÀ",
        "autori": [{"nome": "Anna", "cognome": "Rossi"}, {"nome": "Bruno", "cognome": "Verdi"}],
        "materie": [{"nome": "danno"}, {"nome": "responsabilità civile"}],
        "sezioni": [{
            "id": 9111, "numeroSezioneVis": "1", "titolo": "Il danno.", "note": None,
            "testo": (
                f"<p>In tema di danno, Sez. U, n. 1234/2024, Bianchi, Rv. 670001-01, ha affermato che "
                f"l'{link(CC_2043, 'art. 2043 c.c.')} richiede un danno ingiusto.</p>"
                f"<p>Lo stesso vale per l'{link(CPC_360, 'art. 360, comma 1, n. 5, c.p.c.')} "
                f"(Sez. 3, n. 567/2023, Neri, Rv. 668001-02; Sez. 1, n. 89/2022, Rv. 664001-01).</p>"
            ),
            "sottoSezioni": [{
                "id": 9112, "numeroSezioneVis": "1.1", "titolo": "Il nesso.", "note": None,
                "testo": f"<p>La {link(L_184, 'l. n. 184 del 1983')} resta ferma.<script>alert(1)</script></p>"
                         f"<p>Si veda la {link('stato:decreto.legislativo:2006-02-23;109~sez2', 'sezione II')}.</p>",
                "sottoSezioni": [],
            }],
        }],
    }
    capitolo_9102 = {
        "id": 9102, "nome": "CAPITOLO II", "titolo": "LA RISOLUZIONE",
        "autori": [{"nome": "Carla", "cognome": "Gialli"}], "materie": [{"nome": "contratti"}],
        "sezioni": [{
            "id": 9121, "numeroSezioneVis": "1", "titolo": "L'inadempimento.", "note": None,
            "testo": f"<p>Sez. 2, n. 4321 (Rv. 670500-01) richiama l'{link(CC_1453, 'art. 1453 c.c.')} "
                     f"e l'{link(CC_2043, 'art. 2043 c.c.')}; Sez. U, n. 1234/2024, Bianchi, Rv. 670001-02.</p>",
            "sottoSezioni": [],
        }],
    }
    sezione_9201 = {
        "id": 9201, "numeroSezioneVis": "1", "titolo": "Una sezione sciolta.", "note": None,
        "testo": f"<p>Corte cost., sent. n. 12 del 2024, ha dichiarato illegittimo l'{link(COST_3, 'art. 3 Cost.')}.</p>",
        "sottoSezioni": [],
    }
    return {
        "volume_id": 9001,
        "index": index,
        "capitoli": {9101: capitolo_9101, 9102: capitolo_9102},
        "sezioni": {9201: sezione_9201},
    }
