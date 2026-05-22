"""
LLM Provider Factory.

Creates and configures LLM providers from configuration.
"""

import os
import structlog
from typing import Dict, Optional, Type

from .base import BaseLLMProvider
from .config import (
    LLMConfig,
    ProviderConfig,
    DEFAULT_PROVIDER_CONFIGS,
)
from .providers import (
    OpenAIProvider,
    AnthropicProvider,
    OllamaProvider,
    OpenRouterProvider,
)

log = structlog.get_logger()


# Provider registry
PROVIDER_CLASSES: Dict[str, Type[BaseLLMProvider]] = {
    "openai": OpenAIProvider,
    "anthropic": AnthropicProvider,
    "ollama": OllamaProvider,
    "openrouter": OpenRouterProvider,
}


class LLMProviderFactory:
    """
    Factory for creating LLM providers.

    Creates providers from configuration or explicit parameters.

    Example:
        >>> factory = LLMProviderFactory()
        >>> openai = factory.create("openai", model="gpt-4")
        >>> anthropic = factory.create("anthropic")

        >>> # From config
        >>> factory = LLMProviderFactory(config=my_config)
        >>> provider = factory.create_from_config("openai")
    """

    def __init__(self, config: Optional[LLMConfig] = None):
        """
        Initialize factory.

        Args:
            config: LLM configuration (optional)
        """
        self.config = config or LLMConfig()
        self._providers: Dict[str, BaseLLMProvider] = {}

    def create(
        self,
        provider_name: str,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        base_url: Optional[str] = None,
        **kwargs,
    ) -> BaseLLMProvider:
        """
        Create a provider instance.

        Args:
            provider_name: Provider name (openai, anthropic, ollama)
            api_key: API key (defaults to env var)
            model: Default model (defaults to provider default)
            base_url: API base URL (defaults to provider default)
            **kwargs: Additional provider parameters

        Returns:
            Configured provider instance

        Raises:
            ValueError: If provider name is unknown
        """
        if provider_name not in PROVIDER_CLASSES:
            raise ValueError(
                f"Unknown provider: {provider_name}. "
                f"Available: {list(PROVIDER_CLASSES.keys())}"
            )

        # Get default config for provider
        default_config = DEFAULT_PROVIDER_CONFIGS.get(provider_name)
        if default_config is None:
            raise ValueError(f"No default configuration for provider: {provider_name}")

        # Override with custom config if available
        custom_config = self.config.get_provider_config(provider_name)
        if custom_config:
            default_config = custom_config

        # Get API key from env if not provided
        if api_key is None and default_config.api_key_env:
            api_key = os.getenv(default_config.api_key_env)

        provider_class = PROVIDER_CLASSES[provider_name]
        provider = provider_class(
            api_key=api_key,
            base_url=base_url or default_config.base_url,
            default_model=model or default_config.default_model,
            timeout=kwargs.pop("timeout", default_config.timeout_seconds),
            max_retries=kwargs.pop("max_retries", default_config.max_retries),
            cost_per_1k_tokens=kwargs.pop("cost_per_1k_tokens", default_config.cost_per_1k_tokens),
            **kwargs,
        )

        log.info(
            "llm_provider_created",
            provider=provider_name,
            model=provider.default_model,
        )

        return provider

    def create_from_config(self, provider_name: str) -> BaseLLMProvider:
        """
        Create provider entirely from configuration.

        Args:
            provider_name: Provider name

        Returns:
            Configured provider instance
        """
        return self.create(provider_name)

    def get_or_create(self, provider_name: str) -> BaseLLMProvider:
        """
        Get existing or create new provider (singleton per name).

        Args:
            provider_name: Provider name

        Returns:
            Provider instance
        """
        if provider_name not in self._providers:
            self._providers[provider_name] = self.create(provider_name)
        return self._providers[provider_name]

    def get_provider_for_expert(
        self,
        expert_type: str,
        default_provider: str = "openai",
    ) -> BaseLLMProvider:
        """
        Get provider configured for a specific expert type.

        Args:
            expert_type: Expert type (literal, systemic, etc.)
            default_provider: Default provider if not configured

        Returns:
            Provider instance with expert-specific model
        """
        # Get preferred model for expert from config
        preferred_model = self.config.expert_model_preferences.get(expert_type)

        provider = self.get_or_create(default_provider)

        if preferred_model and preferred_model != provider.default_model:
            # Create new instance with expert-specific model
            return self.create(
                default_provider,
                model=preferred_model,
            )

        return provider

    @classmethod
    def register_provider(cls, name: str, provider_class: Type[BaseLLMProvider]):
        """
        Register a custom provider class.

        Args:
            name: Provider name
            provider_class: Provider class
        """
        PROVIDER_CLASSES[name] = provider_class
        log.info("custom_llm_provider_registered", name=name)

    @classmethod
    def get_available_providers(cls) -> list:
        """Get list of available provider names."""
        return list(PROVIDER_CLASSES.keys())
