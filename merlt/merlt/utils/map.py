"""
Legal Mapping Constants for Italian Law
=======================================

Static mappings used for:
- URN generation for Italian legal codes
- Act type normalization
- Brocardi URL mapping

Copied from visualex-api to enable local operations without HTTP calls.
"""

import re


def extract_codice_details(codice_name: str) -> dict | None:
    """
    Extracts date and act number from a codice URN in NORMATTIVA_URN_CODICI.

    Example: "codice civile" -> "regio.decreto:1942-03-16;262:2"
    Returns: {"tipo_atto_reale": "regio decreto", "data": "1942-03-16", "numero_atto": "262"}

    Returns None if codice not found or URN doesn't contain extractable details.
    """
    codice_name_lower = codice_name.lower().strip()
    urn = NORMATTIVA_URN_CODICI.get(codice_name_lower)

    if not urn:
        return None

    # Skip special cases like "costituzione" that don't have date/number
    if ':' not in urn or ';' not in urn:
        return None

    # Pattern: "tipo.atto:YYYY-MM-DD;numero" or "tipo.atto:YYYY-MM-DD;numero:allegato"
    match = re.match(r'^([^:]+):(\d{4}-\d{2}-\d{2});(\d+)(?::\d+)?$', urn)

    if match:
        tipo_atto_urn, data, numero = match.groups()
        tipo_atto_reale = tipo_atto_urn.replace('.', ' ')
        return {
            "tipo_atto_reale": tipo_atto_reale,
            "data": data,
            "numero_atto": numero
        }

    return None


# ============================================================================
# NORMATTIVA URN CODICI
# Maps Italian legal code names to their URN identifiers
# ============================================================================

NORMATTIVA_URN_CODICI = {
    "costituzione": "costituzione",
    "codice penale": "regio.decreto:1930-10-19;1398:1",
    "codice di procedura civile": "regio.decreto:1940-10-28;1443:1",
    "disposizioni per l'attuazione del Codice di procedura civile e disposizioni transitorie": "regio.decreto:1941-08-25;1368:1",
    "codici penali militari di pace e di guerra": "relazione.e.regio.decreto:1941-02-20;303",
    "disposizioni di coordinamento, transitorie e di attuazione dei Codici penali militari di pace e di guerra": "regio.decreto:1941-09-09;1023",
    "codice civile": "regio.decreto:1942-03-16;262:2",
    "preleggi": "regio.decreto:1942-03-16;262:1",
    "disposizioni per l'attuazione del Codice civile e disposizioni transitorie": "regio.decreto:1942-03-30;318:1",
    "codice della navigazione": "regio.decreto:1942-03-30;327:1",
    "approvazione del Regolamento per l'esecuzione del Codice della navigazione (Navigazione marittima)": "decreto.del.presidente.della.repubblica:1952-02-15;328",
    "codice postale e delle telecomunicazioni": "decreto.del.presidente.della.repubblica:1973-03-29;156:1",
    "codice di procedura penale": "decreto.del.presidente.della.repubblica:1988-09-22;447",
    "norme di attuazione, di coordinamento e transitorie del codice di procedura penale": "decreto.legislativo:1989-07-28;271",
    "regolamento per l'esecuzione del codice di procedura penale": "/uri-res/N2Ls?urn:nir:ministero.grazia.e.giustizia:decreto:1989-09-30;334",
    "codice della strada": "decreto.legislativo:1992-04-30;285",
    "regolamento di esecuzione e di attuazione del nuovo codice della strada.": "decreto.del.presidente.della.repubblica:1992-12-16;495",
    "codice del processo tributario": "decreto.legislativo:1992-12-31;546",
    "codice in materia di protezione dei dati personali": "decreto.legislativo:2003-06-30;196",
    "codice delle comunicazioni elettroniche": "decreto.legislativo:2003-08-01;259",
    "codice dei beni culturali e del paesaggio": "decreto.legislativo:2004-01-22;42",
    "codice della proprietà industriale": "decreto.legislativo:2005-02-10;30",
    "regolamento di attuazione del Codice della proprietà industriale": "/uri-res/N2Ls?urn:nir:ministero.sviluppo.economico:decreto:2010-01-13;33",
    "codice dell'amministrazione digitale": "decreto.legislativo:2005-03-07;82",
    "codice della nautica da diporto": "decreto.legislativo:2005-07-18;171",
    "codice del consumo": "decreto.legislativo:2005-09-06;206",
    "codice delle assicurazioni private": "decreto.legislativo:2005-09-07;209",
    "norme in materia ambientale": "decreto.legislativo:2006-04-03;152",
    "codice dei contratti pubblici": "decreto.legislativo:2023-03-31;36",
    "codice delle pari opportunità": "decreto.legislativo:2006-04-11;198",
    "codice dell'ordinamento militare": "decreto.legislativo:2010-03-15;66",
    "codice del processo amministrativo": "decreto.legislativo:2010-07-02;104:2",
    "codice del turismo": "decreto.legislativo:2011-05-23;79",
    "codice antimafia": "decreto.legislativo:2011-09-06;159",
    "codice di giustizia contabile": "decreto.legislativo:2016-08-26;174:1",
    "codice del Terzo settore": "decreto.legislativo:2017-07-03;117",
    "codice della protezione civile": "decreto.legislativo:2018-01-02;1",
    "codice della crisi d'impresa e dell'insolvenza": "decreto.legislativo:2019-01-12;14"
}

# ============================================================================
# BROCARDI CODICI
# Maps legal code display names to Brocardi.it URLs
# ============================================================================

BROCARDI_CODICI = {
    "Costituzione": "https://www.brocardi.it/costituzione/",
    "Regolamento generale sulla protezione dei dati(Reg. UE 27 aprile 2016, n. 679)": "https://www.brocardi.it/regolamento-privacy-ue/",
    "Nuovo Codice Appalti (D. Lgs. 31 Marzo 2023, n. 36)(D.lgs. 31 marzo 2023, n. 36), Codice dei Contratti pubblici": "https://www.brocardi.it/nuovo-codice-appalti/",
    "Codice Civile (R.D. 16 marzo 1942, n. 262)": "https://www.brocardi.it/codice-civile/",
    "Preleggi": "https://www.brocardi.it/preleggi/",
    "Disposizioni per l'attuazione del codice civile e disposizioni transitorie(R.D. 30 marzo 1942, n. 318)": "https://www.brocardi.it/disposizioni-per-attuazione-del-codice-civile/",
    "Codice di procedura civile(R.D. 28 ottobre 1940, n. 1443)": "https://www.brocardi.it/codice-di-procedura-civile/",
    "Disposizioni di attuazione del codice di procedura civile(R.D. 18 dicembre 1941, n. 1368)": "https://www.brocardi.it/disposizioni-per-attuazione-codice-procedura-civile/",
    "Codice Penale(R.D. 19 ottobre 1930, n. 1398)": "https://www.brocardi.it/codice-penale/",
    "Disposizioni di coordinamento e transitorie per il codice penale(R.D. 28 maggio 1931, n. 601)": "https://www.brocardi.it/disposizioni-transitorie-codice-penale/",
    "Codice di procedura penale(D.P.R. 22 settembre 1988, n. 477)": "https://www.brocardi.it/codice-di-procedura-penale/",
    "Disposizioni di attuazione del codice di procedura penale(D.lgs. 28 luglio 1989, n. 271)": "https://www.brocardi.it/disposizioni-per-attuazione-codice-procedura-penale/",
    "Codice Processo Penale Minorile(D.P.R. 22 settembre 1988, n. 448)": "https://www.brocardi.it/processo-penale-minorile/",
    "Codice della strada(D.lgs. 30 aprile 1992, n. 285)": "https://www.brocardi.it/codice-della-strada/",
    "Codice del processo tributario(D.lgs. 31 dicembre 1992, n. 546)": "https://www.brocardi.it/codice-del-processo-tributario/",
    "Codice della privacy(D.lgs. 30 giugno 2003, n. 196)": "https://www.brocardi.it/codice-della-privacy/",
    "Codice del consumo(D.lgs. 6 settembre 2005, n. 206)": "https://www.brocardi.it/codice-del-consumo/",
    "Codice delle assicurazioni private(D.lgs. 7 settembre 2005, n. 209)": "https://www.brocardi.it/codice-delle-assicurazioni-private/",
    "Codice dei beni culturali e del paesaggio(D.lgs. 22 gennaio 2004, n. 42)": "https://www.brocardi.it/codice-dei-beni-culturali-e-del-paesaggio/",
    "Codice del processo amministrativo(D.lgs. 2 luglio 2010, n. 104)": "https://www.brocardi.it/codice-del-processo-amministrativo/",
    "Codice del turismo(D.lgs. 23 maggio 2011, n. 79)": "https://www.brocardi.it/codice-del-turismo/",
    "Codice dell'ambiente(D.lgs. 3 aprile 2006, n. 152)": "https://www.brocardi.it/codice-dell-ambiente/",
    "Codice delle comunicazioni elettroniche(D.lgs. 1 agosto 2003, n. 259)": "https://www.brocardi.it/codice-delle-comunicazioni-elettroniche/",
    "Codice delle pari opportunità(D.lgs. 11 aprile 2006, n. 198)": "https://www.brocardi.it/codice-delle-pari-opportunita/",
    "Codice di giustizia contabile(D.lgs. 26 agosto 2016, n. 174)": "https://www.brocardi.it/codice-di-giustizia-contabile/",
    "Codice della nautica da diporto(D.lgs. 18 luglio 2005, n. 171)": "https://www.brocardi.it/codice-della-nautica-da-diporto/",
    "Codice della proprietà industriale(D.lgs. 10 febbraio 2005, n. 30)": "https://www.brocardi.it/codice-della-proprieta-industriale/",
    "Codice dell'amministrazione digitale(D.lgs. 7 marzo 2005, n. 82)": "https://www.brocardi.it/codice-dell-amministrazione-digitale/",
    "Codice antimafia(D.lgs. 6 settembre 2011, n. 159)": "https://www.brocardi.it/codice-antimafia/",
    "Codice del terzo settore(D.lgs. 3 luglio 2017, n. 117)": "https://www.brocardi.it/codice-terzo-settore/",
    "Codice della protezione civile(D.lgs. 2 gennaio 2018, n. 1)": "https://www.brocardi.it/codice-protezione-civile/",
    "Codice della crisi d'impresa e dell'insolvenza(D.lgs. 12 gennaio 2019, n. 14)": "https://www.brocardi.it/codice-crisi-impresa/",
    "Codice degli appalti [ABROGATO](D.lgs. 12 aprile 2006, n. 163)": "https://www.brocardi.it/codice-degli-appalti/",
}

# ============================================================================
# NORMATTIVA_SEARCH
# Maps abbreviations to full act type names for search
# ============================================================================

NORMATTIVA_SEARCH = {
    "d.lgs.": "decreto legislativo",
    "decreto legge": "decreto legge",
    "decreto legislativo": "decreto legislativo",
    "decreto.legge": "decreto legge",
    "decreto.legislativo": "decreto legislativo",
    "rd": "regio decreto",
    "r.d.": "regio decreto",
    "regio decreto": "regio decreto",
    "dpr": "decreto del presidente della repubblica",
    "d.p.r.": "decreto del presidente della repubblica",
    "decreto.del.presidente.della.repubblica": "decreto del presidente della repubblica",
    "dl": "decreto legge",
    "dlgs": "decreto legislativo",
    "l": "legge",
    "l.": "legge",
    "legge": "legge",
    "c.c.": "codice civile",
    "c.p.": "codice penale",
    "c.p.c": "codice di procedura civile",
    "c.p.p.": "codice di procedura penale",
    "cad": "codice dell'amministrazione digitale",
    "cam": "codice antimafia",
    "camb": "norme in materia ambientale",
    "cap": "codice delle assicurazioni private",
    "cbc": "codice dei beni culturali e del paesaggio",
    "cc": "codice civile",
    "cce": "codice delle comunicazioni elettroniche",
    "cci": "codice della crisi d'impresa e dell'insolvenza",
    "ccp": "codice dei contratti pubblici",
    "cdc": "codice del consumo",
    "cdpc": "codice della protezione civile",
    "cds": "codice della strada",
    "cgco": "codice di giustizia contabile",
    "cn": "codice della navigazione",
    "cnd": "codice della nautica da diporto",
    "cod. amm. dig.": "codice dell'amministrazione digitale",
    "cod. antimafia": "codice antimafia",
    "cod. ass. priv.": "codice delle assicurazioni private",
    "cod. beni cult.": "codice dei beni culturali e del paesaggio",
    "cod. civ.": "codice civile",
    "cod. com. elet.": "codice delle comunicazioni elettroniche",
    "cod. consumo": "codice del consumo",
    "cod. contr. pubb.": "codice dei contratti pubblici",
    "cod. crisi imp.": "codice della crisi d'impresa e dell'insolvenza",
    "cod. giust. cont.": "codice di giustizia contabile",
    "cod. naut. diport.": "codice della nautica da diporto",
    "cod. nav.": "codice della navigazione",
    "cod. ord. mil.": "codice dell'ordinamento militare",
    "cod. pari opp.": "codice delle pari opportunità",
    "cod. pen.": "codice penale",
    "cod. post. telecom.": "codice postale e delle telecomunicazioni",
    "cod. proc. amm.": "codice del processo amministrativo",
    "cod. proc. civ": "codice di procedura civile",
    "cod. proc. pen.": "codice di procedura penale",
    "cod. proc. trib.": "codice del processo tributario",
    "cod. prop. ind.": "codice della proprietà industriale",
    "cod. prot. civ.": "codice della protezione civile",
    "cod. prot. dati": "codice in materia di protezione dei dati personali",
    "cod. strada": "codice della strada",
    "cod. ter. sett.": "codice del Terzo settore",
    "cod. turismo": "codice del turismo",
    "codice antimafia": "codice antimafia",
    "codice civile": "codice civile",
    "codice dei beni culturali e del paesaggio": "codice dei beni culturali e del paesaggio",
    "codice dei contratti pubblici": "codice dei contratti pubblici",
    "codice del Terzo settore": "codice del Terzo settore",
    "codice del consumo": "codice del consumo",
    "codice del processo amministrativo": "codice del processo amministrativo",
    "codice del processo tributario": "codice del processo tributario",
    "codice del turismo": "codice del turismo",
    "codice dell'amministrazione digitale": "codice dell'amministrazione digitale",
    "codice dell'ordinamento militare": "codice dell'ordinamento militare",
    "codice della crisi d'impresa e dell'insolvenza": "codice della crisi d'impresa e dell'insolvenza",
    "codice della nautica da diporto": "codice della nautica da diporto",
    "codice della navigazione": "codice della navigazione",
    "codice della proprietà industriale": "codice della proprietà industriale",
    "codice della protezione civile": "codice della protezione civile",
    "codice della strada": "codice della strada",
    "codice delle assicurazioni private": "codice delle assicurazioni private",
    "codice delle comunicazioni elettroniche": "codice delle comunicazioni elettroniche",
    "codice delle pari opportunità": "codice delle pari opportunità",
    "codice di giustizia contabile": "codice di giustizia contabile",
    "codice di procedura civile": "codice di procedura civile",
    "codice di procedura penale": "codice di procedura penale",
    "codice in materia di protezione dei dati personali": "codice in materia di protezione dei dati personali",
    "codice penale": "codice penale",
    "codice postale e delle telecomunicazioni": "codice postale e delle telecomunicazioni",
    "com": "codice dell'ordinamento militare",
    "cost": "costituzione",
    "cost.": "costituzione",
    "costituzione": "costituzione",
    "cp": "codice penale",
    "cpa": "codice del processo amministrativo",
    "cpc": "codice di procedura civile",
    "cpd": "codice in materia di protezione dei dati personali",
    "cpet": "codice postale e delle telecomunicazioni",
    "cpi": "codice della proprietà industriale",
    "cpo": "codice delle pari opportunità",
    "cpp": "codice di procedura penale",
    "cpt": "codice del processo tributario",
    "cts": "codice del Terzo settore",
    "ctu": "codice del turismo",
    "disp. att. c.c.": "disposizioni per l'attuazione del Codice civile e disposizioni transitorie",
    "disp. att. c.p.c.": "disposizioni per l'attuazione del Codice di procedura civile e disposizioni transitorie",
    "disp. prel.": "preleggi",
    "disposizioni per l'attuazione del Codice civile e disposizioni transitorie": "disposizioni per l'attuazione del Codice civile e disposizioni transitorie",
    "disposizioni per l'attuazione del Codice di procedura civile e disposizioni transitorie": "disposizioni per l'attuazione del Codice di procedura civile e disposizioni transitorie",
    "norme amb.": "norme in materia ambientale",
    "norme in materia ambientale": "norme in materia ambientale",
    "prel.": "preleggi",
    "preleggi": "preleggi"
}

# ============================================================================
# NORMATTIVA
# Maps abbreviations to URN-compatible act type identifiers
# ============================================================================

NORMATTIVA = {
    "d.lgs.": "decreto.legislativo",
    "dpr": "decreto.del.presidente.della.repubblica",
    "rd": "regio.decreto",
    "r.d.": "regio.decreto",
    "regio decreto": "regio.decreto",
    "d.p.r.": "decreto.del.presidente.della.repubblica",
    "decreto legge": "decreto.legge",
    "decreto legislativo": "decreto.legislativo",
    "decreto.legge": "decreto.legge",
    "decreto.legislativo": "decreto.legislativo",
    "dl": "decreto.legge",
    "dlgs": "decreto.legislativo",
    "l": "legge",
    "l.": "legge",
    "legge": "legge",
    "c.c.": "codice civile",
    "c.p.": "codice penale",
    "c.p.c": "codice di procedura civile",
    "c.p.p.": "codice di procedura penale",
    "c.c.p": "codice dei contratti pubblici",
    "cad": "codice dell'amministrazione digitale",
    "cam": "codice antimafia",
    "camb": "norme in materia ambientale",
    "cap": "codice delle assicurazioni private",
    "cbc": "codice dei beni culturali e del paesaggio",
    "cc": "codice civile",
    "cce": "codice delle comunicazioni elettroniche",
    "cci": "codice della crisi d'impresa e dell'insolvenza",
    "ccp": "codice dei contratti pubblici",
    "cdc": "codice del consumo",
    "cdpc": "codice della protezione civile",
    "cds": "codice della strada",
    "cgco": "codice di giustizia contabile",
    "cn": "codice della navigazione",
    "cnd": "codice della nautica da diporto",
    "cod. amm. dig.": "codice dell'amministrazione digitale",
    "cod. antimafia": "codice antimafia",
    "cod. ass. priv.": "codice delle assicurazioni private",
    "cod. beni cult.": "codice dei beni culturali e del paesaggio",
    "cod. civ.": "codice civile",
    "cod. com. elet.": "codice delle comunicazioni elettroniche",
    "cod. consumo": "codice del consumo",
    "cod. contr. pubb.": "codice dei contratti pubblici",
    "cod. crisi imp.": "codice della crisi d'impresa e dell'insolvenza",
    "cod. giust. cont.": "codice di giustizia contabile",
    "cod. naut. diport.": "codice della nautica da diporto",
    "cod. nav.": "codice della navigazione",
    "cod. ord. mil.": "codice dell'ordinamento militare",
    "cod. pari opp.": "codice delle pari opportunità",
    "cod. pen.": "codice penale",
    "cod. post. telecom.": "codice postale e delle telecomunicazioni",
    "cod. proc. amm.": "codice del processo amministrativo",
    "cod. proc. civ": "codice di procedura civile",
    "cod. proc. pen.": "codice di procedura penale",
    "cod. proc. trib.": "codice del processo tributario",
    "cod. prop. ind.": "codice della proprietà industriale",
    "cod. prot. civ.": "codice della protezione civile",
    "cod. prot. dati": "codice in materia di protezione dei dati personali",
    "cod. strada": "codice della strada",
    "cod. ter. sett.": "codice del Terzo settore",
    "cod. turismo": "codice del turismo",
    "codice antimafia": "codice antimafia",
    "codice civile": "codice civile",
    "codice dei beni culturali e del paesaggio": "codice dei beni culturali e del paesaggio",
    "codice dei contratti pubblici": "codice dei contratti pubblici",
    "codice del Terzo settore": "codice del Terzo settore",
    "codice del consumo": "codice del consumo",
    "codice del processo amministrativo": "codice del processo amministrativo",
    "codice del processo tributario": "codice del processo tributario",
    "codice del turismo": "codice del turismo",
    "codice dell'amministrazione digitale": "codice dell'amministrazione digitale",
    "codice dell'ordinamento militare": "codice dell'ordinamento militare",
    "codice della crisi d'impresa e dell'insolvenza": "codice della crisi d'impresa e dell'insolvenza",
    "codice della nautica da diporto": "codice della nautica da diporto",
    "codice della navigazione": "codice della navigazione",
    "codice della proprietà industriale": "codice della proprietà industriale",
    "codice della protezione civile": "codice della protezione civile",
    "codice della strada": "codice della strada",
    "codice delle assicurazioni private": "codice delle assicurazioni private",
    "codice delle comunicazioni elettroniche": "codice delle comunicazioni elettroniche",
    "codice delle pari opportunità": "codice delle pari opportunità",
    "codice di giustizia contabile": "codice di giustizia contabile",
    "codice di procedura civile": "codice di procedura civile",
    "codice di procedura penale": "codice di procedura penale",
    "codice in materia di protezione dei dati personali": "codice in materia di protezione dei dati personali",
    "codice penale": "codice penale",
    "codice postale e delle telecomunicazioni": "codice postale e delle telecomunicazioni",
    "com": "codice dell'ordinamento militare",
    "cost": "costituzione",
    "cost.": "costituzione",
    "costituzione": "costituzione",
    "cp": "codice penale",
    "cpa": "codice del processo amministrativo",
    "cpc": "codice di procedura civile",
    "cpd": "codice in materia di protezione dei dati personali",
    "cpet": "codice postale e delle telecomunicazioni",
    "cpi": "codice della proprietà industriale",
    "cpo": "codice delle pari opportunità",
    "cpp": "codice di procedura penale",
    "cpt": "codice del processo tributario",
    "cts": "codice del Terzo settore",
    "ctu": "codice del turismo",
    "disp. att. c.c.": "disposizioni per l'attuazione del Codice civile e disposizioni transitorie",
    "disp. att. c.p.c.": "disposizioni per l'attuazione del Codice di procedura civile e disposizioni transitorie",
    "disp. prel.": "preleggi",
    "disposizioni per l'attuazione del Codice civile e disposizioni transitorie": "disposizioni per l'attuazione del Codice civile e disposizioni transitorie",
    "disposizioni per l'attuazione del Codice di procedura civile e disposizioni transitorie": "disposizioni per l'attuazione del Codice di procedura civile e disposizioni transitorie",
    "norme amb.": "norme in materia ambientale",
    "norme in materia ambientale": "norme in materia ambientale",
    "prel.": "preleggi",
    "preleggi": "preleggi"
}

# ============================================================================
# BROCARDI_SEARCH
# Maps act type identifiers to Brocardi display abbreviations
# ============================================================================

BROCARDI_SEARCH = {
    'regio decreto': 'R.D.',
    'regio.decreto': 'R.D.',
    'legge': 'L.',
    'decreto del presidente della repubblica': 'D.P.R.',
    'decreto legislativo': 'D.lgs.',
    'decreto legge': 'D.L.',
    'decreto.del.presidente.della.repubblica': 'D.P.R.',
    'decreto.legislativo': 'D.lgs.',
    'decreto.legge': 'D.L.',
}

# ============================================================================
# EURLEX
# European law sources
# ============================================================================

EURLEX = {
    'tue': 'https://eur-lex.europa.eu/legal-content/IT/TXT/HTML/?uri=CELEX:12016M/TXT',
    'tfue': 'https://eur-lex.europa.eu/legal-content/IT/TXT/HTML/?uri=CELEX:12016E/TXT',
    'cdfue': 'https://eur-lex.europa.eu/legal-content/IT/TXT/HTML/?uri=CELEX:12016P/TXT',
    'regolamento ue': 'reg',
    'direttiva ue': 'dir',
}

# ============================================================================
# FONTI_PRINCIPALI
# Main legal sources for Italian law
# ============================================================================

FONTI_PRINCIPALI = [
    'legge', 'decreto legge', 'decreto legislativo', 'costituzione', 'd.p.r.',
    'TUE', 'TFUE', 'CDFUE', 'Regolamento UE', 'Direttiva UE', 'regio decreto',
    'codice civile', 'preleggi', 'codice penale', 'codice di procedura civile',
    'codice di procedura penale', 'codice della navigazione',
    'codice postale e delle telecomunicazioni', 'codice della strada',
    'codice del processo tributario', 'codice in materia di protezione dei dati personali',
    'codice delle comunicazioni elettroniche', 'codice dei beni culturali e del paesaggio',
    'codice della proprietà industriale', "codice dell'amministrazione digitale",
    'codice della nautica da diporto', 'codice del consumo', 'codice delle assicurazioni private',
    'norme in materia ambientale', 'codice dei contratti pubblici', 'codice delle pari opportunità',
    "codice dell'ordinamento militare", 'codice del processo amministrativo', 'codice del turismo',
    'codice antimafia', 'codice di giustizia contabile', 'codice del terzo settore',
    'codice della protezione civile', "codice della crisi d'impresa e dell'insolvenza"
]


# ============================================================================
# EXPORTS
# ============================================================================

__all__ = [
    "extract_codice_details",
    "NORMATTIVA_URN_CODICI",
    "BROCARDI_CODICI",
    "NORMATTIVA_SEARCH",
    "NORMATTIVA",
    "BROCARDI_SEARCH",
    "EURLEX",
    "FONTI_PRINCIPALI",
]
