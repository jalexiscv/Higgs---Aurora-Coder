"""Regression tests for #71047 (Problem A): per-platform display settings.

`aurora config set platforms.<name>.<display_setting> <value>` must write to
`display.platforms.<name>.<display_setting>` — the path the gateway actually
reads (gateway/display_config.py::resolve_display_setting). Writing to the
top-level `platforms.<name>` block is silently ignored by the runtime, so the
edit appeared to succeed while having no effect.
"""

from pathlib import Path

import pytest
import aurora_yaml as yaml


def _write_config(aurora_home: Path, data: dict) -> Path:
    aurora_home.mkdir(parents=True, exist_ok=True)
    config_path = aurora_home / "config.yaml"
    config_path.write_text(yaml.safe_dump(data))
    return config_path


def _set(monkeypatch, aurora_home, key, value, force=False):
    """Isolated call to set_config_value against a temp AURORA_HOME."""
    monkeypatch.setenv("AURORA_HOME", str(aurora_home))
    # set_config_value resolves the home live via get_config_path()/get_aurora_home()
    from aurora_cli.config import set_config_value
    set_config_value(key, value, force=force)


@pytest.fixture
def aurora_home(tmp_path, monkeypatch):
    home = tmp_path / ".aurora"
    # A config that already has a top-level platforms block (connection keys)
    # AND a display.platforms block, mirroring the real-world report.
    cfg = {
        "model": {"default": "test-model", "provider": "openrouter"},
        "platforms": {
            "telegram": {"token": "secret-bot-token"},
        },
        "display": {
            "skin": "default",
            "platforms": {
                "telegram": {"show_reasoning": True},
            },
        },
    }
    _write_config(home, cfg)
    return home


class TestPerPlatformDisplayRedirect:
    def test_streaming_redirects_to_display_platforms(self, aurora_home, monkeypatch):
        """platforms.telegram.streaming must land under display.platforms."""
        _set(monkeypatch, aurora_home, "platforms.telegram.streaming", "false")

        result = yaml.safe_load((aurora_home / "config.yaml").read_text())
        # Redirected target exists and is correct
        assert result["display"]["platforms"]["telegram"]["streaming"] is False
        # Top-level platforms.telegram must NOT gain a streaming key
        assert "streaming" not in result["platforms"]["telegram"]
        # Connection key untouched
        assert result["platforms"]["telegram"]["token"] == "secret-bot-token"



    def test_connection_key_not_redirected(self, aurora_home, monkeypatch):
        """A real connection key (token) stays in top-level platforms.<name>."""
        _set(monkeypatch, aurora_home, "platforms.telegram.token", "new-token")
        result = yaml.safe_load((aurora_home / "config.yaml").read_text())
        assert result["platforms"]["telegram"]["token"] == "new-token"
        # Nothing leaked into display.platforms.telegram.token
        assert "token" not in result["display"]["platforms"]["telegram"]

    def test_no_top_level_platforms_created_when_missing(self, tmp_path, monkeypatch):
        """When there is no pre-existing top-level platforms block, a display
        setting write must not invent one."""
        home = tmp_path / ".aurora"
        _write_config(home, {"model": {"default": "m"}})
        _set(monkeypatch, home, "platforms.telegram.streaming", "true")
        result = yaml.safe_load((home / "config.yaml").read_text())
        assert result["display"]["platforms"]["telegram"]["streaming"] is True
        assert "platforms" not in result  # no stray top-level platforms block


class TestRedirectSiblingSurfaces:
    """The canonicalization must hold for every CLI surface that takes a dotted
    key — set, get, unset — and the written value must be what the gateway's
    resolver actually reads (the #71047 symptom was CLI and runtime disagreeing).
    """

    def test_get_mirrors_gateway_resolution_after_set(self, aurora_home, monkeypatch, capsys):
        from gateway.display_config import resolve_display_setting
        from aurora_cli.config import get_config_value

        _set(monkeypatch, aurora_home, "platforms.telegram.streaming", "false")
        capsys.readouterr()
        get_config_value("platforms.telegram.streaming")
        assert capsys.readouterr().out.strip() == "false"

        raw = yaml.safe_load((aurora_home / "config.yaml").read_text())
        assert resolve_display_setting(raw, "telegram", "streaming") is False

    def test_unset_removes_the_redirected_leaf(self, aurora_home, monkeypatch):
        from aurora_cli.config import unset_config_value

        _set(monkeypatch, aurora_home, "platforms.telegram.streaming", "false")
        unset_config_value("platforms.telegram.streaming")
        result = yaml.safe_load((aurora_home / "config.yaml").read_text())
        assert "streaming" not in result["display"]["platforms"]["telegram"]
        # Sibling display override and connection block untouched.
        assert result["display"]["platforms"]["telegram"]["show_reasoning"] is True
        assert result["platforms"]["telegram"] == {"token": "secret-bot-token"}

    def test_unset_missing_redirected_leaf_exits_nonzero(self, aurora_home, monkeypatch):
        from aurora_cli.config import unset_config_value

        monkeypatch.setenv("AURORA_HOME", str(aurora_home))
        with pytest.raises(SystemExit) as exc:
            unset_config_value("platforms.telegram.streaming")
        assert exc.value.code == 1


    def test_redirect_helper_only_touches_known_display_keys(self):
        from gateway.display_config import OVERRIDEABLE_KEYS
        from aurora_cli.config import _redirect_platform_display_key

        for setting in OVERRIDEABLE_KEYS:
            canonical, note = _redirect_platform_display_key(f"platforms.discord.{setting}")
            assert canonical == f"display.platforms.discord.{setting}"
            assert note
        for key in (
            "platforms.telegram.token",
            "platforms.telegram.reply_to_mode",
            "platforms.telegram.extra.foo",  # 4 segments — not a display leaf
            "platforms.telegram",
            "display.platforms.telegram.streaming",  # already canonical
            "streaming.enabled",
        ):
            assert _redirect_platform_display_key(key) == (key, None)
