"""The 29 seats of the Tribunali amministrativi regionali (design 2026-10-12-administrative-courts §2).

A copy of `conventions/sources/tar-seats.json`, which the container image does not carry:
`tests/test_decisions_admin_model.py` fails when the two differ.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass


@dataclass(frozen=True)
class Seat:
    slug: str        # in keys and paths: «roma», «reggio-calabria»
    sede: str        # as the portal's search names it: «Roma», «Reggio Calabria»
    regione: str     # «Lazio»
    principale: bool  # the region's main seat
    organo: str = "TAR"  # «TRGA» for Trentino-Alto Adige's Tribunale regionale di giustizia amministrativa


SEATS: tuple[Seat, ...] = tuple(Seat(*row) for row in (
    ("ancona", "Ancona", "Marche", True), ("aosta", "Aosta", "Valle d'Aosta", True),
    ("bari", "Bari", "Puglia", True), ("lecce", "Lecce", "Puglia", False),
    ("bologna", "Bologna", "Emilia-Romagna", True), ("parma", "Parma", "Emilia-Romagna", False),
    ("trento", "Trento", "Trentino-Alto Adige", True, "TRGA"), ("bolzano", "Bolzano", "Trentino-Alto Adige", False, "TRGA"),
    ("milano", "Milano", "Lombardia", True), ("brescia", "Brescia", "Lombardia", False),
    ("cagliari", "Cagliari", "Sardegna", True), ("campobasso", "Campobasso", "Molise", True),
    ("palermo", "Palermo", "Sicilia", True), ("catania", "Catania", "Sicilia", False),
    ("catanzaro", "Catanzaro", "Calabria", True), ("reggio-calabria", "Reggio Calabria", "Calabria", False),
    ("firenze", "Firenze", "Toscana", True), ("genova", "Genova", "Liguria", True),
    ("l-aquila", "L'Aquila", "Abruzzo", True), ("pescara", "Pescara", "Abruzzo", False),
    ("roma", "Roma", "Lazio", True), ("latina", "Latina", "Lazio", False),
    ("napoli", "Napoli", "Campania", True), ("salerno", "Salerno", "Campania", False),
    ("perugia", "Perugia", "Umbria", True), ("potenza", "Potenza", "Basilicata", True),
    ("torino", "Torino", "Piemonte", True), ("trieste", "Trieste", "Friuli Venezia Giulia", True),
    ("venezia", "Venezia", "Veneto", True),
))
BY_SLUG: dict[str, Seat] = {s.slug: s for s in SEATS}


def fold(name: str) -> str:
    """«Valle d’Aosta» → «valle d aosta»: a name compared without case, accents or punctuation."""
    # every non-letter is a space first: «L’Aquila» and «L'Aquila» are one name
    spaced = "".join(c if c.isalpha() or unicodedata.combining(c) else " " for c in unicodedata.normalize("NFKD", name))
    text = spaced.encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z]+", " ", text).strip()


_BY_SEAT_NAME = {fold(s.sede): s for s in SEATS}
REGIONS: dict[str, str] = {fold(s.regione): s.regione for s in SEATS}


def seat_named(name: str) -> Seat | None:
    return _BY_SEAT_NAME.get(fold(name))


def region_named(name: str) -> str | None:
    return REGIONS.get(fold(name))


def seats_of(regione: str) -> list[Seat]:
    """The region's seats, its main seat first."""
    return sorted((s for s in SEATS if s.regione == regione), key=lambda s: not s.principale)
