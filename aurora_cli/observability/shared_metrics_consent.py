"""The one shared-metrics consent answer.

Every surface reads and writes the same two keys in the profile's config.yaml:
``telemetry.shared_metrics.enabled`` (collect) and ``.send`` (upload daily). Both ship off and
nothing asks for them unprompted: the answer is given in ``aurora setup telemetry``, the dashboard
or the Desktop settings, and each answer sets both keys. The question counts as answered once
either key is written explicitly; the shipped defaults are not an answer. Every answer also writes
``offer_version``.
"""

from __future__ import annotations

from typing import Any


def _section(cfg: Any) -> dict:
    telemetry = cfg.get("telemetry") if isinstance(cfg, dict) else None
    section = telemetry.get("shared_metrics") if isinstance(telemetry, dict) else None
    return section if isinstance(section, dict) else {}


# Bumped only when every earlier answer must be asked again; 2 = after the type-ahead fix.
OFFER_VERSION = 2


def consent_state(raw_cfg: Any) -> dict:
    """``{enabled, send, decided, reask}`` from a RAW config mapping (no defaults merged). ``reask``:
    an "off" answer from before ``OFFER_VERSION`` that may never have been seen; it reads undecided.
    An opt-in was always a deliberate pick and stays, including a collect-only answer from before
    that choice was dropped."""
    section = _section(raw_cfg)
    enabled = section.get("enabled") is True
    answered = "enabled" in section or "send" in section
    reask = answered and not enabled and section.get("offer_version") != OFFER_VERSION
    return {
        "enabled": enabled,
        "send": enabled and section.get("send") is True,
        "decided": answered and not reask,
        "reask": reask,
    }


def set_answer(target: dict, enabled: bool, send: bool) -> None:
    """Write one answer into a config mapping: both opt-ins plus the offer version that settles it."""
    telemetry = target.get("telemetry")
    if not isinstance(telemetry, dict):
        telemetry = target["telemetry"] = {}
    section = telemetry.get("shared_metrics")
    if not isinstance(section, dict):
        section = telemetry["shared_metrics"] = {}
    section["enabled"], section["send"] = enabled, enabled and send
    section["offer_version"] = OFFER_VERSION


def save_consent(enabled: bool, send: bool, config: dict | None = None) -> None:
    """Write both keys into the user's raw config.yaml now. ``save_config`` strips values equal
    to the shipped defaults, so a "No thanks" (both false) saved through it vanished and the
    profile was asked again on every surface. ``config`` (a caller's in-memory copy, e.g. the
    wizard's) gets the same answer so its later save agrees. Sending cannot outlive collection."""
    from aurora_cli.config import (
        _write_user_config, get_config_path, is_managed, managed_error, require_readable_config_before_write,
    )
    from aurora_cli.setup import _record_send_consent_change

    if is_managed():
        managed_error("save configuration")
        return
    send = enabled and send
    config_path = get_config_path()
    user_config = require_readable_config_before_write(config_path)
    set_answer(user_config, enabled, send)
    _write_user_config(config_path, user_config)
    if config is not None:
        set_answer(config, enabled, send)
    # Unconditional: a send key already false may still have an open consent window.
    _record_send_consent_change(enabled=send)
    if not enabled:
        from aurora_constants import get_aurora_home

        from .shared_metrics_process import purge_pending_receipts

        purge_pending_receipts(get_aurora_home())
