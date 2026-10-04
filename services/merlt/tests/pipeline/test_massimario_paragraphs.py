# services/merlt/tests/pipeline/test_massimario_paragraphs.py
"""Section HTML → plain paragraphs with link spans (spec §5.1)."""
from merlt.pipeline.massimario.paragraphs import extract_paragraphs, split_for_vectors

LINK = "http://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:codice.civile:1942-03-16;262~art2043"


def test_paragraphs_and_link_spans():
    html = (
        f'<p> Secondo l\'<a href="{LINK}" target="_blank">art. 2043 c.c.</a> il danno&nbsp;deve\n'
        "essere ingiusto.</p><p></p><p>Secondo paragrafo &egrave; qui.</p>"
    )
    first, second = extract_paragraphs(html)
    assert first.text == "Secondo l'art. 2043 c.c. il danno deve essere ingiusto."
    (link,) = first.links
    assert first.text[link.start:link.end] == "art. 2043 c.c." == link.text
    assert link.href == LINK
    assert second.text == "Secondo paragrafo è qui." and second.links == []


def test_links_to_other_sites_are_not_spans():
    (p,) = extract_paragraphs('<p>Vedi <a href="https://example.org/x">qui</a>.</p>')
    assert p.text == "Vedi qui." and p.links == []


def test_markup_never_survives():
    html = (
        '<p>Testo<script>alert(1)</script> <img src=x onerror="alert(2)">sicuro '
        "<b>grassetto</b><style>p{}</style>.</p>"
    )
    (p,) = extract_paragraphs(html)
    assert p.text == "Testo sicuro grassetto."
    assert "<" not in p.text and "alert" not in p.text


def test_text_outside_paragraphs_and_line_breaks():
    (a, b) = extract_paragraphs("Prima riga<br>stessa<p>Dopo</p>")
    assert (a.text, b.text) == ("Prima riga stessa", "Dopo")


def test_split_for_vectors_covers_the_text_at_sentence_ends():
    text = ("Frase numero uno abbastanza lunga. " * 120).strip()
    pieces = split_for_vectors(text, max_len=500)
    assert pieces[0][0] == 0 and pieces[-1][1] == len(text)
    assert all(end - start <= 500 for start, end in pieces)
    assert all(text[end - 1] == "." for _, end in pieces[:-1])
    assert split_for_vectors("breve") == [(0, 5)]


def test_quotes_written_as_angle_brackets_are_text():
    # the portal writes «…» as << and >> inside the HTML
    html = (
        "<p>Tra le <<forme di tutela>> rientra la <<i fatti>> e <<a norma>>; "
        f'il <<danno di cui all\'<a href="{LINK}">art. 2043 c.c.</a>>> resta. 3 < 4.</p>'
    )
    (p,) = extract_paragraphs(html)
    assert p.text == (
        "Tra le <<forme di tutela>> rientra la <<i fatti>> e <<a norma>>; "
        "il <<danno di cui all'art. 2043 c.c.>> resta. 3 < 4."
    )
    (link,) = p.links
    assert p.text[link.start:link.end] == "art. 2043 c.c."
