"""Tests for shared-metrics configuration discovery and setup."""

from __future__ import annotations

import argparse

from aurora_cli.config import DEFAULT_CONFIG
from aurora_cli.setup import setup_telemetry
from aurora_cli.subcommands.setup import build_setup_parser


def test_shared_metrics_are_registered_disabled_by_default():
    assert DEFAULT_CONFIG["telemetry"]["shared_metrics"]["enabled"] is False


def test_setup_telemetry_one_answer_sets_both_keys(monkeypatch):
    """One question: yes collects and sends, no turns both off. Collect-only is not offered."""
    asked = []
    monkeypatch.setattr(
        "aurora_cli.setup.prompt_yes_no",
        lambda question, default: asked.append(question) or not default,
    )
    config = {}

    setup_telemetry(config)
    assert config["telemetry"]["shared_metrics"]["enabled"] is True
    assert config["telemetry"]["shared_metrics"]["send"] is True

    setup_telemetry(config)
    assert config["telemetry"]["shared_metrics"]["enabled"] is False
    assert config["telemetry"]["shared_metrics"]["send"] is False
    assert asked == ["Send shared metrics to Nous?"] * 2


def test_setup_telemetry_defaults_a_collect_only_profile_to_no(monkeypatch):
    """A retired collect-only answer is not sharing: the question defaults to no, and no turns
    collection off too."""
    defaults = []
    monkeypatch.setattr(
        "aurora_cli.setup.prompt_yes_no",
        lambda _question, default: defaults.append(default) or default,
    )
    config = {"telemetry": {"shared_metrics": {"enabled": True, "send": False}}}

    setup_telemetry(config)

    assert defaults == [False]
    assert config["telemetry"]["shared_metrics"]["enabled"] is False


def test_disabling_collection_closes_the_send_consent_window(monkeypatch, tmp_path):
    """`aurora tools` -> disable shared metrics must withdraw send consent.

    The not-enabled branch returned early without recording anything, so the
    consent window stayed open and re-enabling later would release every
    package collected in between.
    """
    from aurora_cli.observability.shared_metrics import SharedMetricsStore
    from aurora_cli.observability.shared_metrics_sender import (
        reconcile_send_consent,
    )
    from aurora_cli.sqlite_util import write_txn

    store = SharedMetricsStore(
        database_path=tmp_path / "m.db", outbox_directory=tmp_path / "o"
    )
    monkeypatch.setattr(
        "aurora_cli.observability.shared_metrics.SharedMetricsStore",
        lambda *a, **k: store,
    )

    # The user had consented; now they turn collection off entirely.
    monkeypatch.setattr(
        "aurora_cli.setup.prompt_yes_no", lambda _question, default: False
    )
    config = {"telemetry": {"shared_metrics": {"enabled": True, "send": True}}}
    # Consent was granted earlier, so a window is open — that is precisely
    # the state whose closure must be recorded.
    with store._connection() as connection:
        with write_txn(connection):
            reconcile_send_consent(connection, True)

    setup_telemetry(config)

    assert config["telemetry"]["shared_metrics"]["enabled"] is False
    assert config["telemetry"]["shared_metrics"]["send"] is False
    with store._connection() as connection:
        open_windows = connection.execute(
            "SELECT COUNT(*) FROM send_consent_windows WHERE closed_at IS NULL"
        ).fetchone()[0]
    assert open_windows == 0, (
        "disabling collection left the send consent window open"
    )


def test_setup_parser_accepts_telemetry_section():
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command")
    handler = object()
    build_setup_parser(subparsers, cmd_setup=handler)

    args = parser.parse_args(["setup", "telemetry"])

    assert args.section == "telemetry"
    assert args.func is handler


def test_no_answer_survives_the_callers_later_config_save(monkeypatch):
    """A "no" equals the shipped defaults; saved only through ``save_config`` it was stripped, so
    the profile read undecided on every surface."""
    from aurora_cli.config import load_config, read_raw_config, save_config

    monkeypatch.setattr("aurora_cli.setup.prompt_yes_no", lambda _question, default: False)
    config = load_config()
    setup_telemetry(config)
    save_config(config)  # what the wizard and `aurora tools` do afterwards

    assert read_raw_config()["telemetry"]["shared_metrics"] == {"enabled": False, "send": False, "offer_version": 2}


def test_the_cli_promise_that_pre_opt_in_data_stays_local_names_the_install_note():
    """Invariant: the fresh-install note is the one record kept from before the consent answer and
    counted after it, so the CLI explainer stating the pre-opt-in promise names that exception, and
    it still fits an 80-column terminal (print_info indents by two)."""
    from aurora_cli.setup import _SEND_CONSENT_EXPLAINER

    text = " ".join(_SEND_CONSENT_EXPLAINER)
    assert "before you opt in" in text and "install note" in text.split("before you opt in")[0], text
    assert max(len(line) for line in _SEND_CONSENT_EXPLAINER) + 2 <= 80
