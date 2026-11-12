"""Aurora's router publishes its own model ids, so the request shape follows the endpoint.

Its flagship ids answer HTTP 400 to a manual thinking budget, to ``thinking: disabled`` and to any
sampling parameter; every id accepts adaptive thinking. A request built for that endpoint therefore
carries the adaptive contract whatever the model is called.
"""

import pytest

from agent.anthropic_adapter import build_anthropic_kwargs

AURORA = "https://aurora.dtacenter.com"
MESSAGES = [{"role": "user", "content": "hi"}]


def _build(model, reasoning, base_url=AURORA):
    return build_anthropic_kwargs(
        model=model, messages=MESSAGES, tools=None, max_tokens=None, reasoning_config=reasoning,
        base_url=base_url)


@pytest.mark.parametrize("model", ["AuroraAGI", "Spark", "Itzel", "AuroraFlash", "AuroraPRO"])
def test_reasoning_is_requested_as_adaptive_thinking_with_an_effort(model):
    kwargs = _build(model, {"enabled": True, "effort": "high"})
    assert kwargs["thinking"]["type"] == "adaptive"
    assert kwargs["output_config"] == {"effort": "high"}
    assert "temperature" not in kwargs
    assert kwargs["model"] == model


def test_reasoning_off_sends_no_thinking_parameter():
    kwargs = _build("AuroraAGI", {"enabled": False})
    assert "thinking" not in kwargs and "output_config" not in kwargs


def test_the_same_id_on_another_relay_keeps_the_manual_budget():
    kwargs = _build("AuroraAGI", {"enabled": True, "effort": "high"}, base_url="https://relay.example.test")
    assert kwargs["thinking"]["type"] == "enabled"


def test_the_endpoint_mandates_the_messages_wire():
    """The router has no /v1/chat/completions, so a caller that names no API mode must not get it."""
    from aurora_cli.providers import host_mandated_api_mode

    assert host_mandated_api_mode(AURORA) == "anthropic_messages"
