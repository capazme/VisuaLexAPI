"""ASGI entry point for a production server: ``hypercorn asgi:app``.

``app.py`` builds the application inside ``main()`` for ``python app.py``, which runs
Quart's development server. A production server needs a module-level object. The
fetch queue and the browser pool are started and stopped by the application's own
``before_serving`` and ``after_serving`` hooks, which Hypercorn runs too.

Run it with ONE worker: the rate limiter, the circuit breaker and the fetch queue
keep their state in memory, per process.
"""
from app import NormaController

app = NormaController().app
