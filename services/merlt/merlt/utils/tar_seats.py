"""The 29 seats of the Tribunali amministrativi regionali: a copy of `conventions/sources/tar-seats.json`
(MERL-T does not import the API), pinned by `tests/unit/test_sources_golden.py`.

slug → (seat, region, main seat of its region, body: «TAR» or «TRGA»)."""
from __future__ import annotations

SEATS: dict[str, tuple[str, str, bool, str]] = {
    "ancona": ("Ancona", "Marche", True, "TAR"), "aosta": ("Aosta", "Valle d'Aosta", True, "TAR"),
    "bari": ("Bari", "Puglia", True, "TAR"), "lecce": ("Lecce", "Puglia", False, "TAR"),
    "bologna": ("Bologna", "Emilia-Romagna", True, "TAR"), "parma": ("Parma", "Emilia-Romagna", False, "TAR"),
    "trento": ("Trento", "Trentino-Alto Adige", True, "TRGA"), "bolzano": ("Bolzano", "Trentino-Alto Adige", False, "TRGA"),
    "milano": ("Milano", "Lombardia", True, "TAR"), "brescia": ("Brescia", "Lombardia", False, "TAR"),
    "cagliari": ("Cagliari", "Sardegna", True, "TAR"), "campobasso": ("Campobasso", "Molise", True, "TAR"),
    "palermo": ("Palermo", "Sicilia", True, "TAR"), "catania": ("Catania", "Sicilia", False, "TAR"),
    "catanzaro": ("Catanzaro", "Calabria", True, "TAR"), "reggio-calabria": ("Reggio Calabria", "Calabria", False, "TAR"),
    "firenze": ("Firenze", "Toscana", True, "TAR"), "genova": ("Genova", "Liguria", True, "TAR"),
    "l-aquila": ("L'Aquila", "Abruzzo", True, "TAR"), "pescara": ("Pescara", "Abruzzo", False, "TAR"),
    "roma": ("Roma", "Lazio", True, "TAR"), "latina": ("Latina", "Lazio", False, "TAR"),
    "napoli": ("Napoli", "Campania", True, "TAR"), "salerno": ("Salerno", "Campania", False, "TAR"),
    "perugia": ("Perugia", "Umbria", True, "TAR"), "potenza": ("Potenza", "Basilicata", True, "TAR"),
    "torino": ("Torino", "Piemonte", True, "TAR"), "trieste": ("Trieste", "Friuli Venezia Giulia", True, "TAR"),
    "venezia": ("Venezia", "Veneto", True, "TAR"),
}
