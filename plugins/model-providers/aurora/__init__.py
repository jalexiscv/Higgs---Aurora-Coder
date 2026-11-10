"""Aurora provider profile: the default inference route of Aurora Coder.

Aurora (https://aurora.dtacenter.com) serves the Anthropic Messages API under its own model
ids. Keys (``sk-hr-...``) are issued from its developer panel and sent as ``x-api-key``; the
endpoint also accepts ``Authorization: Bearer``, which the model listing below uses.
"""

from providers import register_provider
from providers.base import OMIT_TEMPERATURE, ProviderProfile

AURORA_BASE_URL = "https://aurora.dtacenter.com"
AURORA_KEYS_URL = "https://aurora.dtacenter.com/developers"
AURORA_DEFAULT_MODEL = "Spark"

# The router's published catalog (GET /v1/models) with each model's context window; the live
# listing replaces the ids when reachable.
_CATALOG = {
    "AuroraAGI": 1_000_000, "AuroraPRO": 1_048_576, "AuroraFlash": 1_048_576, "Spark": 1_000_000,
    "Itzel": 1_000_000,
}

aurora = ProviderProfile(
    name="aurora",
    aliases=("aurora-ai", "higgs", "iarouter"),
    api_mode="anthropic_messages",
    display_name="Aurora",
    description="Aurora — the built-in AI of Aurora Coder (API key from aurora.dtacenter.com)",
    signup_url=AURORA_KEYS_URL,
    env_vars=("AURORA_API_KEY",),
    base_url=AURORA_BASE_URL,
    # The Messages base URL carries no /v1 (the SDK appends it); the listing lives under it.
    models_url=f"{AURORA_BASE_URL}/v1/models",
    auth_type="api_key",
    supports_vision=True,
    # The flagship ids answer HTTP 400 to any sampling parameter.
    fixed_temperature=OMIT_TEMPERATURE,
    # The cheapest id that still reads images, which auxiliary vision calls need.
    default_aux_model="Itzel",
    fallback_models=tuple(_CATALOG),
    static_models=tuple(_CATALOG),
    model_capabilities={
        # AuroraPRO drops image blocks before the model sees them.
        model: {"context_window": context, "supports_tools": True, "supports_vision": model != "AuroraPRO",
                "supports_reasoning": True}
        for model, context in _CATALOG.items()
    },
)

register_provider(aurora)
