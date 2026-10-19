"""Loop β F.0 — grounding-aware confidence.

The synthesizer already α-blends expert confidence with disagreement; this adds
a grounding damp so a poorly-grounded answer can't keep a high confidence.
"""

from merlt.experts.synthesizer import AdaptiveSynthesizer


def test_zero_sources_caps_confidence():
    s = AdaptiveSynthesizer()
    assert s._apply_grounding_factor(0.9, n_sources=0) <= 0.4


def test_one_source_damps_confidence():
    s = AdaptiveSynthesizer()
    damped = s._apply_grounding_factor(0.9, n_sources=1)
    assert 0.4 < damped < 0.9


def test_well_grounded_keeps_confidence():
    s = AdaptiveSynthesizer()
    assert s._apply_grounding_factor(0.85, n_sources=6) == 0.85
