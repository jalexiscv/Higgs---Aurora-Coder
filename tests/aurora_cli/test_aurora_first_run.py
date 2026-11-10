"""The Aurora key prompt a blank install starts with.

Driven with real imports against the isolated ``AURORA_HOME``; only the terminal prompt and the
remote model listing are replaced (the listing by a local HTTP server speaking Aurora's contract).
"""

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from aurora_cli import aurora_first_run

GOOD_KEY = "sk-hr-good"


class _Listing(BaseHTTPRequestHandler):
    def do_GET(self):
        ok = self.headers.get("x-api-key") == GOOD_KEY
        body = json.dumps({"data": []} if ok else {
            "type": "error", "error": {"type": "authentication_error", "message": "invalid x-api-key"}}).encode()
        self.send_response(200 if ok else 401)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


@pytest.fixture
def listing_url():
    server = ThreadingHTTPServer(("127.0.0.1", 0), _Listing)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_port}/v1/models"
    server.shutdown()
    server.server_close()


@pytest.fixture
def answers(monkeypatch, listing_url):
    """Queue the prompt's answers and point the provider's listing at the local server."""
    from providers import get_provider_profile

    monkeypatch.setattr(get_provider_profile("aurora"), "models_url", listing_url)
    queue: list = []
    monkeypatch.setattr("aurora_cli.model_setup_flows_common._ask", lambda *a, **k: queue.pop(0))
    return queue


def _saved_state():
    from aurora_cli.config import get_env_value, read_raw_config

    return get_env_value("AURORA_API_KEY"), read_raw_config().get("model")


def test_check_key_tells_an_accepted_key_from_a_rejected_one(listing_url):
    assert aurora_first_run.check_key(GOOD_KEY, listing_url) == (True, "")
    assert aurora_first_run.check_key("sk-hr-bad", listing_url) == (False, "invalid x-api-key")


def test_check_key_does_not_condemn_a_key_it_could_not_ask_about():
    accepted, reason = aurora_first_run.check_key(GOOD_KEY, "http://127.0.0.1:9/v1/models", timeout=2)
    assert accepted is None and reason


def test_an_accepted_key_makes_aurora_the_provider_on_its_default_model(answers):
    answers.append(GOOD_KEY)

    assert aurora_first_run.offer_aurora_key() == aurora_first_run.CONFIGURED
    key, model = _saved_state()
    assert key == GOOD_KEY
    assert (model["provider"], model["default"]) == ("aurora", "Spark")


def test_a_rejected_key_is_asked_again_and_never_saved(answers, capsys):
    answers.extend(["sk-hr-bad", ""])

    assert aurora_first_run.offer_aurora_key() == aurora_first_run.OTHER_PROVIDER
    assert "invalid x-api-key" in capsys.readouterr().out
    key, model = _saved_state()
    assert not key and not (model or {}).get("provider")


def test_cancelling_the_prompt_changes_nothing(answers):
    answers.append(None)

    assert aurora_first_run.offer_aurora_key() == aurora_first_run.CANCELLED
    key, model = _saved_state()
    assert not key and not (model or {}).get("provider")


@pytest.fixture
def guard(monkeypatch):
    """Run the classic-CLI guard on a TTY with a canned prompt outcome; returns whether the launch
    carries on to the chat, and the wizard calls."""
    wizard: list = []

    def run(outcome, *, tty=True):
        monkeypatch.setattr("aurora_cli.setup.is_interactive_stdin", lambda: tty)
        monkeypatch.setattr(aurora_first_run, "offer_aurora_key", lambda: outcome)
        return aurora_first_run.first_run_setup_guard(object(), wizard.append), wizard

    return run


def test_guard_goes_on_to_the_chat_once_a_key_is_configured(guard):
    assert guard(aurora_first_run.CONFIGURED) == (True, [])


def test_guard_runs_the_setup_wizard_when_no_key_is_given(guard):
    carry_on, wizard = guard(aurora_first_run.OTHER_PROVIDER)
    assert not carry_on and len(wizard) == 1


def test_guard_exits_when_the_prompt_is_cancelled(guard):
    with pytest.raises(SystemExit) as stop:
        guard(aurora_first_run.CANCELLED)
    assert stop.value.code == 1


def test_guard_without_a_terminal_names_the_key_variable_and_exits(guard, capsys):
    with pytest.raises(SystemExit) as stop:
        guard(aurora_first_run.CONFIGURED, tty=False)
    assert stop.value.code == 1
    assert "AURORA_API_KEY" in capsys.readouterr().out


def test_aurora_leads_the_provider_picker():
    from aurora_cli.models_catalog_static import listed_canonical_providers

    assert listed_canonical_providers()[0].slug == aurora_first_run.PROVIDER


@pytest.mark.parametrize("tty, asked", [(True, 1), (False, 0)])
def test_tui_start_asks_for_the_key_only_on_a_terminal(monkeypatch, tty, asked):
    calls: list = []
    monkeypatch.setattr("aurora_cli.setup.is_interactive_stdin", lambda: tty)
    monkeypatch.setattr(aurora_first_run, "offer_aurora_key", lambda: calls.append("ask") or aurora_first_run.CANCELLED)
    aurora_first_run.offer_key_before_tui()
    assert len(calls) == asked
