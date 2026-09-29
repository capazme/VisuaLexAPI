"""The module-level ASGI object a production server runs (`hypercorn asgi:app`)."""
from asgi import app


async def test_the_asgi_app_answers_health():
    response = await app.test_client().get("/health")
    assert response.status_code == 200
    body = await response.get_json()
    assert body["status"] == "ok"


def test_start_and_stop_hooks_are_registered():
    # The fetch queue and the browser pool are started and cleaned up by these
    # hooks: an ASGI server that skipped them would serve without either.
    assert app.before_serving_funcs
    assert app.after_serving_funcs
