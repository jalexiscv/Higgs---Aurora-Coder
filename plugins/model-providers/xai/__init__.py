"""xAI (Grok) provider profile."""

from aurora_cli.version_info import aurora_user_agent
from providers import register_provider
from providers.base import LazyHeaders, ProviderProfile

xai = ProviderProfile(
    name="xai", aliases=("grok", "x-ai", "x.ai"), api_mode="codex_responses", env_vars=("XAI_API_KEY",),
    base_url="https://api.x.ai/v1", auth_type="api_key",
    default_headers=LazyHeaders({"User-Agent": lambda: aurora_user_agent("Aurora-Agent")}),
)

register_provider(xai)
