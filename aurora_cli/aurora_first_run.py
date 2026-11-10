"""First-run setup for Aurora, the built-in provider: one question, an API key.

A blank install is asked for an Aurora key instead of being walked through the provider picker.
The key is checked against the model listing, stored with the other provider credentials, and the
provider's first catalog id becomes the default model. An empty answer hands over to the picker,
so every other provider stays one keypress away.
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request

PROVIDER = "aurora"
CONFIGURED, OTHER_PROVIDER, CANCELLED = "configured", "other", "cancelled"


def check_key(api_key: str, models_url: str, *, timeout: float = 10.0) -> tuple[bool | None, str]:
    """``(accepted, reason)`` for *api_key*: True when the listing answers, False when the service
    rejects the key, None when it could not be asked (offline, server error) and nothing is known."""
    request = urllib.request.Request(models_url, headers={"x-api-key": api_key, "accept": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=timeout):
            return True, ""
    except urllib.error.HTTPError as exc:
        reason = _error_message(exc) or f"HTTP {exc.code}"
        return (False if exc.code in (401, 403) else None), reason
    except (OSError, ValueError) as exc:
        return None, str(exc)


def _error_message(exc: urllib.error.HTTPError) -> str:
    try:
        return str(json.loads(exc.read().decode("utf-8", "replace"))["error"]["message"])
    except (KeyError, TypeError, ValueError):
        return ""


def offer_aurora_key() -> str:
    """Ask for an Aurora API key and make Aurora the active provider. Returns ``CONFIGURED``,
    ``OTHER_PROVIDER`` (empty answer: the caller opens the provider picker) or ``CANCELLED``."""
    from agent.i18n import t
    from aurora_cli.config import save_env_value
    from aurora_cli.model_setup_flows_common import _ask, _persist_model, _say
    from providers import get_provider_profile

    profile = get_provider_profile(PROVIDER)
    if profile is None or not profile.env_vars or not profile.static_models:
        return OTHER_PROVIDER
    model = profile.static_models[0]
    _say("", t("cli.startup.first_run_aurora_intro"),
         f"  {t('cli.startup.first_run_aurora_keys_url', url=profile.signup_url)}")
    while True:
        key = _ask(f"  {t('cli.startup.first_run_aurora_prompt')} ", secret=True, cancel_msg=None)
        if key is None:
            return CANCELLED
        if not key:
            return OTHER_PROVIDER
        accepted, reason = check_key(key, profile.models_url)
        if accepted is False:
            _say(f"  {t('cli.startup.first_run_aurora_rejected', reason=reason)}")
            continue
        save_env_value(profile.env_vars[0], key)
        _persist_model(model, PROVIDER, drop_base_url=True, drop_api_mode=True)
        if accepted is None:
            _say(f"  {t('cli.startup.first_run_aurora_unchecked', reason=reason)}")
        _say(f"  {t('cli.startup.first_run_aurora_ready', model=model)}")
        return CONFIGURED


def first_run_setup_guard(args, run_setup) -> None:
    """Classic-CLI gate for a blank install. An Aurora key goes straight on to the chat; an empty
    answer runs the full setup wizard (*run_setup*); without a TTY, or on a cancel, exit 1 with
    guidance."""
    from aurora_cli.setup import is_interactive_stdin, print_noninteractive_setup_guidance

    if not is_interactive_stdin():
        print("\nIt looks like Aurora isn't configured yet -- no API keys or providers found.\n")
        print(f"  Set {_key_env_var()} to an Aurora API key, or run:  aurora setup\n")
        print_noninteractive_setup_guidance("No interactive TTY detected for the first-run setup prompt.")
        sys.exit(1)
    outcome = offer_aurora_key()
    if outcome == CONFIGURED:
        return
    if outcome == OTHER_PROVIDER:
        run_setup(args)
        return
    print("\nYou can run 'aurora setup' at any time to configure.")
    sys.exit(1)


def _key_env_var() -> str:
    from providers import get_provider_profile

    profile = get_provider_profile(PROVIDER)
    return profile.env_vars[0] if profile is not None and profile.env_vars else "AURORA_API_KEY"
