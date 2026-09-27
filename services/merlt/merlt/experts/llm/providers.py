"""
LLM Provider Implementations.

Provides concrete implementations for:
- OpenAI (GPT-4, GPT-3.5)
- Anthropic (Claude 3)
- Ollama (local models)
"""

import asyncio
import os
import random
import time
import httpx
import structlog
from datetime import datetime
from typing import Any, Dict, List, Optional

from .base import (
    BaseLLMProvider,
    LLMResponse,
    LLMUsage,
    ProviderError,
    RateLimitError,
    AuthenticationError,
    ModelNotFoundError,
)

log = structlog.get_logger()


def _exponential_backoff(attempt: int, base_delay: float = 1.0, max_delay: float = 60.0) -> float:
    """Calculate exponential backoff with jitter."""
    delay = min(base_delay * (2 ** attempt), max_delay)
    # Add jitter (0.5 to 1.5 of delay)
    jitter = delay * (0.5 + random.random())
    return jitter


class OpenAIProvider(BaseLLMProvider):
    """
    OpenAI provider implementation.

    Supports GPT-4 and GPT-3.5 models.

    Example:
        >>> provider = OpenAIProvider(api_key="sk-...")
        >>> response = await provider.generate("Explain Article 1453...")
    """

    provider_name = "openai"

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: str = "https://api.openai.com/v1",
        default_model: str = "gpt-4-turbo-preview",
        timeout: float = 60.0,
        max_retries: int = 3,
        cost_per_1k_tokens: float = 0.01,
    ):
        """
        Initialize OpenAI provider.

        Args:
            api_key: OpenAI API key (defaults to OPENAI_API_KEY env var)
            base_url: API base URL
            default_model: Default model
            timeout: Request timeout
            max_retries: Max retries
            cost_per_1k_tokens: Cost tracking
        """
        api_key = api_key or os.getenv("OPENAI_API_KEY")
        super().__init__(
            api_key=api_key,
            base_url=base_url,
            default_model=default_model,
            timeout=timeout,
            max_retries=max_retries,
            cost_per_1k_tokens=cost_per_1k_tokens,
        )

    async def generate(
        self,
        prompt: str,
        temperature: float = 0.3,
        max_tokens: int = 2000,
        model: Optional[str] = None,
        **kwargs,
    ) -> LLMResponse:
        """Generate text using OpenAI API."""
        model = model or self.default_model
        temperature = self._validate_temperature(temperature)
        start_time = time.time()

        if not self.api_key:
            raise AuthenticationError(self.provider_name)

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            for attempt in range(self.max_retries):
                try:
                    response = await client.post(
                        f"{self.base_url}/chat/completions",
                        headers={
                            "Authorization": f"Bearer {self.api_key}",
                            "Content-Type": "application/json",
                        },
                        json={
                            "model": model,
                            "messages": [{"role": "user", "content": prompt}],
                            "temperature": temperature,
                            "max_tokens": max_tokens,
                            **kwargs,
                        },
                    )

                    if response.status_code == 429:
                        retry_after = float(response.headers.get("retry-after", 60))
                        raise RateLimitError(self.provider_name, retry_after)

                    if response.status_code == 401:
                        raise AuthenticationError(self.provider_name)

                    if response.status_code == 404:
                        raise ModelNotFoundError(self.provider_name, model)

                    response.raise_for_status()
                    data = response.json()

                    latency_ms = (time.time() - start_time) * 1000
                    usage = LLMUsage(
                        prompt_tokens=data.get("usage", {}).get("prompt_tokens", 0),
                        completion_tokens=data.get("usage", {}).get("completion_tokens", 0),
                        total_tokens=data.get("usage", {}).get("total_tokens", 0),
                    )
                    usage.estimated_cost = self._calculate_cost(usage.total_tokens)

                    self._track_usage(usage)

                    return LLMResponse(
                        content=data["choices"][0]["message"]["content"],
                        model=model,
                        provider=self.provider_name,
                        usage=usage,
                        latency_ms=latency_ms,
                        timestamp=datetime.now(),
                        metadata={"finish_reason": data["choices"][0].get("finish_reason")},
                    )

                except (RateLimitError, AuthenticationError, ModelNotFoundError):
                    raise
                except httpx.TimeoutException:
                    if attempt == self.max_retries - 1:
                        self._last_error = ProviderError(self.provider_name, "Request timeout")
                        raise self._last_error
                    # Exponential backoff before retry
                    await asyncio.sleep(_exponential_backoff(attempt))
                except Exception as e:
                    if attempt == self.max_retries - 1:
                        self._last_error = ProviderError(self.provider_name, str(e), e)
                        raise self._last_error
                    # Exponential backoff before retry
                    await asyncio.sleep(_exponential_backoff(attempt))

    async def embed(
        self,
        texts: List[str],
        model: str = "text-embedding-3-small",
    ) -> List[List[float]]:
        """Generate embeddings using OpenAI API."""
        if not self.api_key:
            raise AuthenticationError(self.provider_name)

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(
                f"{self.base_url}/embeddings",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "input": texts,
                },
            )
            response.raise_for_status()
            data = response.json()

            return [item["embedding"] for item in data["data"]]


class AnthropicProvider(BaseLLMProvider):
    """
    Anthropic provider implementation.

    Supports Claude 3 models.

    Example:
        >>> provider = AnthropicProvider(api_key="sk-ant-...")
        >>> response = await provider.generate("Explain Article 1453...")
    """

    provider_name = "anthropic"

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: str = "https://api.anthropic.com/v1",
        default_model: str = "claude-3-sonnet-20240229",
        timeout: float = 60.0,
        max_retries: int = 3,
        cost_per_1k_tokens: float = 0.003,
    ):
        """
        Initialize Anthropic provider.

        Args:
            api_key: Anthropic API key (defaults to ANTHROPIC_API_KEY env var)
            base_url: API base URL
            default_model: Default model
            timeout: Request timeout
            max_retries: Max retries
            cost_per_1k_tokens: Cost tracking
        """
        api_key = api_key or os.getenv("ANTHROPIC_API_KEY")
        super().__init__(
            api_key=api_key,
            base_url=base_url,
            default_model=default_model,
            timeout=timeout,
            max_retries=max_retries,
            cost_per_1k_tokens=cost_per_1k_tokens,
        )

    async def generate(
        self,
        prompt: str,
        temperature: float = 0.3,
        max_tokens: int = 2000,
        model: Optional[str] = None,
        **kwargs,
    ) -> LLMResponse:
        """Generate text using Anthropic API."""
        model = model or self.default_model
        temperature = self._validate_temperature(temperature)
        start_time = time.time()

        if not self.api_key:
            raise AuthenticationError(self.provider_name)

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            for attempt in range(self.max_retries):
                try:
                    response = await client.post(
                        f"{self.base_url}/messages",
                        headers={
                            "x-api-key": self.api_key,
                            "anthropic-version": "2023-06-01",
                            "Content-Type": "application/json",
                        },
                        json={
                            "model": model,
                            "messages": [{"role": "user", "content": prompt}],
                            "temperature": temperature,
                            "max_tokens": max_tokens,
                            **kwargs,
                        },
                    )

                    if response.status_code == 429:
                        retry_after = float(response.headers.get("retry-after", 60))
                        raise RateLimitError(self.provider_name, retry_after)

                    if response.status_code == 401:
                        raise AuthenticationError(self.provider_name)

                    if response.status_code == 404:
                        raise ModelNotFoundError(self.provider_name, model)

                    response.raise_for_status()
                    data = response.json()

                    latency_ms = (time.time() - start_time) * 1000
                    usage = LLMUsage(
                        prompt_tokens=data.get("usage", {}).get("input_tokens", 0),
                        completion_tokens=data.get("usage", {}).get("output_tokens", 0),
                    )
                    usage.total_tokens = usage.prompt_tokens + usage.completion_tokens
                    usage.estimated_cost = self._calculate_cost(usage.total_tokens)

                    self._track_usage(usage)

                    content = ""
                    for block in data.get("content", []):
                        if block.get("type") == "text":
                            content += block.get("text", "")

                    return LLMResponse(
                        content=content,
                        model=model,
                        provider=self.provider_name,
                        usage=usage,
                        latency_ms=latency_ms,
                        timestamp=datetime.now(),
                        metadata={"stop_reason": data.get("stop_reason")},
                    )

                except (RateLimitError, AuthenticationError, ModelNotFoundError):
                    raise
                except httpx.TimeoutException:
                    if attempt == self.max_retries - 1:
                        self._last_error = ProviderError(self.provider_name, "Request timeout")
                        raise self._last_error
                    await asyncio.sleep(_exponential_backoff(attempt))
                except Exception as e:
                    if attempt == self.max_retries - 1:
                        self._last_error = ProviderError(self.provider_name, str(e), e)
                        raise self._last_error
                    await asyncio.sleep(_exponential_backoff(attempt))


class OllamaProvider(BaseLLMProvider):
    """
    Ollama provider for local models.

    Supports any model available via Ollama.

    Example:
        >>> provider = OllamaProvider(base_url="http://localhost:11434")
        >>> response = await provider.generate("Explain Article 1453...")
    """

    provider_name = "ollama"

    def __init__(
        self,
        api_key: Optional[str] = None,  # Not used for Ollama
        base_url: str = "http://localhost:11434",
        default_model: str = "llama3",
        timeout: float = 120.0,
        max_retries: int = 2,
        cost_per_1k_tokens: float = 0.0,  # Free for local
    ):
        """
        Initialize Ollama provider.

        Args:
            api_key: Not used for Ollama
            base_url: Ollama server URL
            default_model: Default model
            timeout: Request timeout (longer for local models)
            max_retries: Max retries
            cost_per_1k_tokens: Always 0 for local
        """
        super().__init__(
            api_key=None,
            base_url=base_url,
            default_model=default_model,
            timeout=timeout,
            max_retries=max_retries,
            cost_per_1k_tokens=0.0,
        )

    async def generate(
        self,
        prompt: str,
        temperature: float = 0.3,
        max_tokens: int = 2000,
        model: Optional[str] = None,
        **kwargs,
    ) -> LLMResponse:
        """Generate text using Ollama API."""
        model = model or self.default_model
        temperature = self._validate_temperature(temperature)
        start_time = time.time()

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            for attempt in range(self.max_retries):
                try:
                    response = await client.post(
                        f"{self.base_url}/api/generate",
                        json={
                            "model": model,
                            "prompt": prompt,
                            "options": {
                                "temperature": temperature,
                                "num_predict": max_tokens,
                            },
                            "stream": False,
                            **kwargs,
                        },
                    )

                    if response.status_code == 404:
                        raise ModelNotFoundError(self.provider_name, model)

                    response.raise_for_status()
                    data = response.json()

                    latency_ms = (time.time() - start_time) * 1000

                    # Ollama provides different token info
                    prompt_tokens = data.get("prompt_eval_count", 0)
                    completion_tokens = data.get("eval_count", 0)
                    usage = LLMUsage(
                        prompt_tokens=prompt_tokens,
                        completion_tokens=completion_tokens,
                        total_tokens=prompt_tokens + completion_tokens,
                        estimated_cost=0.0,  # Free for local
                    )

                    self._track_usage(usage)

                    return LLMResponse(
                        content=data.get("response", ""),
                        model=model,
                        provider=self.provider_name,
                        usage=usage,
                        latency_ms=latency_ms,
                        timestamp=datetime.now(),
                        metadata={
                            "done": data.get("done"),
                            "context": data.get("context"),
                        },
                    )

                except ModelNotFoundError:
                    raise
                except httpx.TimeoutException:
                    if attempt == self.max_retries - 1:
                        self._last_error = ProviderError(self.provider_name, "Request timeout")
                        raise self._last_error
                    await asyncio.sleep(_exponential_backoff(attempt))
                except httpx.ConnectError:
                    self._last_error = ProviderError(
                        self.provider_name,
                        f"Cannot connect to Ollama at {self.base_url}"
                    )
                    raise self._last_error
                except Exception as e:
                    if attempt == self.max_retries - 1:
                        self._last_error = ProviderError(self.provider_name, str(e), e)
                        raise self._last_error
                    await asyncio.sleep(_exponential_backoff(attempt))

    async def embed(
        self,
        texts: List[str],
        model: str = "nomic-embed-text",
    ) -> List[List[float]]:
        """Generate embeddings using Ollama API."""
        embeddings = []

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            for text in texts:
                response = await client.post(
                    f"{self.base_url}/api/embeddings",
                    json={
                        "model": model,
                        "prompt": text,
                    },
                )
                response.raise_for_status()
                data = response.json()
                embeddings.append(data.get("embedding", []))

        return embeddings

    async def health_check(self) -> bool:
        """Check if Ollama is running and responsive."""
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(f"{self.base_url}/api/tags")
                return response.status_code == 200
        except Exception as e:
            log.debug("ollama_health_check_failed", error=str(e))
            return False


class OpenRouterProvider(BaseLLMProvider):
    """
    OpenRouter provider implementation.

    OpenRouter provides access to multiple models (OpenAI, Anthropic, Meta, etc.)
    through a unified API compatible with OpenAI format.

    Example:
        >>> provider = OpenRouterProvider(api_key="sk-or-...")
        >>> response = await provider.generate(
        ...     "Explain Article 1453...",
        ...     model="anthropic/claude-3.5-sonnet"
        ... )

    Available models include:
        - openai/gpt-4-turbo
        - anthropic/claude-3.5-sonnet
        - anthropic/claude-3-opus
        - meta-llama/llama-3.1-70b-instruct
        - google/gemini-pro-1.5
        - mistralai/mistral-large
    """

    provider_name = "openrouter"

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: str = "https://openrouter.ai/api/v1",
        default_model: Optional[str] = None,
        timeout: float = 120.0,
        max_retries: int = 3,
        cost_per_1k_tokens: float = 0.003,
        site_url: Optional[str] = None,
        site_name: Optional[str] = None,
    ):
        """
        Initialize OpenRouter provider.

        Args:
            api_key: OpenRouter API key (defaults to OPENROUTER_API_KEY env var)
            base_url: API base URL
            default_model: Default model (defaults to OPENROUTER_DEFAULT_MODEL env var)
            timeout: Request timeout
            max_retries: Max retries
            cost_per_1k_tokens: Cost tracking (varies by model)
            site_url: Your site URL for OpenRouter rankings
            site_name: Your app name for OpenRouter rankings
        """
        api_key = api_key or os.getenv("OPENROUTER_API_KEY")
        default_model = default_model or os.getenv("OPENROUTER_DEFAULT_MODEL", "anthropic/claude-3.5-sonnet")
        super().__init__(
            api_key=api_key,
            base_url=base_url,
            default_model=default_model,
            timeout=timeout,
            max_retries=max_retries,
            cost_per_1k_tokens=cost_per_1k_tokens,
        )
        self.site_url = site_url or os.getenv("OPENROUTER_SITE_URL", "")
        self.site_name = site_name or os.getenv("OPENROUTER_SITE_NAME", "MERL-T")

    async def generate(
        self,
        prompt: str,
        temperature: float = 0.3,
        max_tokens: int = 2000,
        model: Optional[str] = None,
        **kwargs,
    ) -> LLMResponse:
        """Generate text using OpenRouter API."""
        model = model or self.default_model
        temperature = self._validate_temperature(temperature)
        start_time = time.time()

        if not self.api_key:
            raise AuthenticationError(self.provider_name)

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        # Optional headers for OpenRouter rankings
        if self.site_url:
            headers["HTTP-Referer"] = self.site_url
        if self.site_name:
            headers["X-Title"] = self.site_name

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            for attempt in range(self.max_retries):
                try:
                    response = await client.post(
                        f"{self.base_url}/chat/completions",
                        headers=headers,
                        json={
                            "model": model,
                            "messages": [{"role": "user", "content": prompt}],
                            "temperature": temperature,
                            "max_tokens": max_tokens,
                            **kwargs,
                        },
                    )

                    if response.status_code == 429:
                        retry_after = float(response.headers.get("retry-after", 60))
                        raise RateLimitError(self.provider_name, retry_after)

                    if response.status_code == 401:
                        raise AuthenticationError(self.provider_name)

                    if response.status_code == 404:
                        raise ModelNotFoundError(self.provider_name, model)

                    response.raise_for_status()
                    data = response.json()

                    latency_ms = (time.time() - start_time) * 1000

                    usage = LLMUsage(
                        prompt_tokens=data.get("usage", {}).get("prompt_tokens", 0),
                        completion_tokens=data.get("usage", {}).get("completion_tokens", 0),
                        total_tokens=data.get("usage", {}).get("total_tokens", 0),
                    )
                    usage.estimated_cost = self._calculate_cost(usage.total_tokens)

                    self._track_usage(usage)

                    return LLMResponse(
                        content=data["choices"][0]["message"]["content"],
                        model=model,
                        provider=self.provider_name,
                        usage=usage,
                        latency_ms=latency_ms,
                        timestamp=datetime.now(),
                        metadata={
                            "finish_reason": data["choices"][0].get("finish_reason"),
                            "openrouter_id": data.get("id"),
                        },
                    )

                except (RateLimitError, AuthenticationError, ModelNotFoundError):
                    raise
                except httpx.TimeoutException:
                    if attempt == self.max_retries - 1:
                        self._last_error = ProviderError(self.provider_name, "Request timeout")
                        raise self._last_error
                    await asyncio.sleep(_exponential_backoff(attempt))
                except Exception as e:
                    if attempt == self.max_retries - 1:
                        self._last_error = ProviderError(self.provider_name, str(e), e)
                        raise self._last_error
                    await asyncio.sleep(_exponential_backoff(attempt))

    async def list_models(self) -> List[Dict[str, Any]]:
        """List available models from OpenRouter."""
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                f"{self.base_url}/models",
                headers={"Authorization": f"Bearer {self.api_key}"},
            )
            response.raise_for_status()
            data = response.json()
            return data.get("data", [])
