"""
OpenRouter AI Service for RLCF Framework

Provides realistic AI response generation for legal tasks using OpenRouter API.
Replaces dummy placeholder responses with actual AI-generated content for
meaningful evaluation in the RLCF framework.

References:
    RLCF.md Section 3.6 - Dynamic Task Handler System
"""

import aiohttp
import asyncio
import json
import structlog
from typing import Dict, Any, Optional
from dataclasses import dataclass

log = structlog.get_logger()


@dataclass
class AIModelConfig:
    """Configuration for AI model settings."""
    name: str
    api_key: str
    temperature: float = 0.7
    max_tokens: int = 1000
    top_p: float = 0.9


class OpenRouterService:
    """
    Service for generating realistic AI responses using OpenRouter API.
    
    Implements AI response generation for legal tasks with configurable models
    and task-specific prompting strategies. Designed to replace placeholder
    responses with meaningful content for RLCF evaluation workflows.
    """
    
    OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
    
    # Task-specific system prompts optimized for legal AI
    SYSTEM_PROMPTS = {
        "STATUTORY_RULE_QA": """You are a legal AI assistant specializing in statutory interpretation. 
Provide accurate, well-reasoned answers based on the provided legal context and relevant articles. 
Structure your response with:
1. Direct answer to the question
2. Legal reasoning and analysis
3. References to relevant statutory provisions
4. Confidence level in your assessment""",
        
        "QA": """You are a legal AI assistant. Provide accurate, comprehensive answers 
to legal questions based on the provided context. Include relevant legal principles, 
precedents, and practical implications.""",
        
        "CLASSIFICATION": """You are a legal document classifier. Analyze the provided text 
and classify it into appropriate legal categories. Explain your classification reasoning 
and provide confidence scores for each category.""",
        
        "SUMMARIZATION": """You are a legal document summarizer. Create concise, accurate 
summaries that capture key legal points, obligations, and implications while maintaining 
legal precision.""",
        
        "PREDICTION": """You are a legal outcome predictor. Analyze the provided facts 
and predict likely legal outcomes based on applicable law, precedents, and legal principles. 
Provide reasoning and confidence levels.""",
        
        "DRAFTING": """You are a legal drafting assistant. Create or revise legal documents 
with attention to legal precision, completeness, and compliance with applicable standards.""",
        
        "RISK_SPOTTING": """You are a legal risk assessment specialist. Identify potential 
legal risks, compliance issues, and liability concerns in the provided content. 
Categorize risks by severity and likelihood.""",
    }
    
    def __init__(self):
        self.session: Optional[aiohttp.ClientSession] = None
        self._last_usage: Dict[str, int] = {}  # Track usage from last API call

    def get_last_usage(self) -> Dict[str, int]:
        """Get usage data from the last API call."""
        return self._last_usage.copy()
    
    async def _get_session(self) -> aiohttp.ClientSession:
        """Get or create aiohttp session."""
        if self.session is None or self.session.closed:
            self.session = aiohttp.ClientSession(
                timeout=aiohttp.ClientTimeout(total=30)
            )
        return self.session
    
    async def close(self):
        """Close the aiohttp session."""
        if self.session and not self.session.closed:
            await self.session.close()
    
    def _build_prompt(self, task_type: str, input_data: Dict[str, Any]) -> str:
        """
        Build task-specific prompt for AI generation.
        
        Args:
            task_type: Type of legal task (QA, CLASSIFICATION, etc.)
            input_data: Task input data containing question, context, etc.
            
        Returns:
            str: Formatted prompt for AI generation
        """
        if task_type == "STATUTORY_RULE_QA":
            question = input_data.get("question", "")
            context = input_data.get("context_full", "")
            articles = input_data.get("relevant_articles", "")
            
            prompt = f"""Question: {question}

Legal Context: {context}

Relevant Articles: {articles}

Please provide a comprehensive legal answer that:
1. Directly addresses the question
2. Cites relevant legal provisions
3. Explains the legal reasoning
4. Indicates your confidence level (high/medium/low)"""
            
        elif task_type == "QA":
            question = input_data.get("question", "")
            context = input_data.get("context", "")
            
            prompt = f"""Question: {question}

Context: {context}

Please provide a clear, accurate answer with legal reasoning."""
            
        elif task_type == "CLASSIFICATION":
            text = input_data.get("text", "")
            
            prompt = f"""Text to classify: {text}

Please classify this text into appropriate legal categories and explain your reasoning."""
            
        elif task_type == "SUMMARIZATION":
            document = input_data.get("document", "")
            
            prompt = f"""Document to summarize: {document}

Please provide a concise legal summary highlighting key points, obligations, and implications."""
            
        else:
            # Generic prompt for other task types
            prompt = f"Task Type: {task_type}\n\nInput: {json.dumps(input_data, indent=2)}\n\nPlease provide an appropriate response."
        
        return prompt
    
    async def generate_response(
        self, 
        task_type: str, 
        input_data: Dict[str, Any], 
        model_config: AIModelConfig
    ) -> Dict[str, Any]:
        """
        Generate AI response for a legal task using OpenRouter.
        
        Args:
            task_type: Type of legal task (STATUTORY_RULE_QA, QA, etc.)
            input_data: Task input data
            model_config: AI model configuration with API key
            
        Returns:
            Dict[str, Any]: Generated AI response with metadata
            
        Raises:
            Exception: If API request fails or returns invalid response
        """
        try:
            session = await self._get_session()
            
            system_prompt = self.SYSTEM_PROMPTS.get(
                task_type, 
                "You are a helpful legal AI assistant."
            )
            user_prompt = self._build_prompt(task_type, input_data)
            
            payload = {
                "model": model_config.name,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                "temperature": model_config.temperature,
                "max_tokens": model_config.max_tokens,
                "top_p": model_config.top_p,
            }
            
            headers = {
                "Authorization": f"Bearer {model_config.api_key}",
                "Content-Type": "application/json",
                "HTTP-Referer": "https://rlcf-framework.com",  # Replace with your domain
                "X-Title": "RLCF Framework"
            }
            
            log.info(f"Generating AI response for task_type: {task_type}, model: {model_config.name}")
            
            async with session.post(
                f"{self.OPENROUTER_BASE_URL}/chat/completions",
                json=payload,
                headers=headers
            ) as response:
                
                if response.status != 200:
                    error_text = await response.text()
                    log.error(f"OpenRouter API error {response.status}: {error_text}")
                    raise Exception(f"OpenRouter API error: {response.status} - {error_text}")
                
                data = await response.json()
                
                if "choices" not in data or not data["choices"]:
                    log.error(f"Invalid OpenRouter response: {data}")
                    raise Exception("Invalid response from OpenRouter API")
                
                ai_content = data["choices"][0]["message"]["content"]
                
                # Parse response based on task type
                parsed_response = self._parse_ai_response(task_type, ai_content, input_data)
                
                # Add metadata
                parsed_response.update({
                    "model_name": model_config.name,
                    "generated_at": data.get("created"),
                    "usage": data.get("usage", {}),
                    "raw_content": ai_content
                })
                
                log.info(f"Successfully generated AI response for task {task_type}")
                return parsed_response
                
        except Exception as e:
            log.error(f"Error generating AI response: {str(e)}")
            # Return fallback response to prevent workflow interruption
            return self._get_fallback_response(task_type, str(e))
    
    def _parse_ai_response(self, task_type: str, ai_content: str, input_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Parse AI response into structured format based on task type.
        
        Args:
            task_type: Type of legal task
            ai_content: Raw AI response content
            input_data: Original task input for context
            
        Returns:
            Dict[str, Any]: Structured response data
        """
        base_response = {
            "response_text": ai_content,
            "task_type": task_type,
            "confidence": self._extract_confidence(ai_content)
        }
        
        if task_type == "STATUTORY_RULE_QA":
            return {
                **base_response,
                "answer": ai_content,
                "legal_reasoning": self._extract_reasoning(ai_content),
                "cited_articles": self._extract_citations(ai_content),
                "question": input_data.get("question", "")
            }
        
        elif task_type == "CLASSIFICATION":
            return {
                **base_response,
                "classifications": self._extract_classifications(ai_content),
                "reasoning": self._extract_reasoning(ai_content)
            }
        
        elif task_type == "QA":
            return {
                **base_response,
                "answer": ai_content,
                "reasoning": self._extract_reasoning(ai_content)
            }
        
        else:
            return base_response
    
    def _extract_confidence(self, content: str) -> str:
        """Extract confidence level from AI response."""
        content_lower = content.lower()
        if any(phrase in content_lower for phrase in ["high confidence", "very confident", "certain"]):
            return "high"
        elif any(phrase in content_lower for phrase in ["medium confidence", "moderately confident", "likely"]):
            return "medium"
        elif any(phrase in content_lower for phrase in ["low confidence", "uncertain", "unclear"]):
            return "low"
        else:
            return "medium"  # default
    
    def _extract_reasoning(self, content: str) -> str:
        """Extract reasoning section from AI response."""
        # Simple heuristic - look for reasoning keywords
        lines = content.split('\n')
        reasoning_lines = []
        
        for line in lines:
            if any(keyword in line.lower() for keyword in ["because", "reasoning", "analysis", "based on", "according to"]):
                reasoning_lines.append(line.strip())
        
        return ' '.join(reasoning_lines) if reasoning_lines else content[:200] + "..."
    
    def _extract_citations(self, content: str) -> list:
        """Extract legal citations from AI response."""
        # Simple pattern matching for legal citations
        citations = []
        lines = content.split('\n')
        
        for line in lines:
            if any(keyword in line.lower() for keyword in ["article", "section", "§", "statute", "code"]):
                citations.append(line.strip())
        
        return citations
    
    def _extract_classifications(self, content: str) -> list:
        """Extract classifications from AI response."""
        # Simple extraction - look for categories or labels
        classifications = []
        lines = content.split('\n')
        
        for line in lines:
            if any(keyword in line.lower() for keyword in ["category", "classification", "type", "class"]):
                classifications.append(line.strip())
        
        return classifications
    
    async def generate_completion(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        model: str = "google/gemini-2.5-flash",
        temperature: float = 0.1,
        max_tokens: int = 128000,
        api_key: Optional[str] = None,
        response_format: Optional[Dict[str, Any]] = None
    ) -> str:
        """
        Generate a generic completion using OpenRouter API.

        This method provides a low-level interface for direct LLM calls,
        useful for components that need custom prompting outside the
        RLCF task framework (e.g., LLM Router, custom agents).

        Args:
            prompt: User prompt content
            system_prompt: Optional system prompt
            model: OpenRouter model ID
            temperature: Sampling temperature (0.0-1.0)
            max_tokens: Maximum tokens to generate
            api_key: Optional API key (defaults to env OPENROUTER_API_KEY)
            response_format: Optional format constraint (e.g., {"type": "json_object"})

        Returns:
            str: Generated completion text

        Raises:
            Exception: If API request fails
        """
        import os

        try:
            session = await self._get_session()

            api_key = api_key or os.getenv("OPENROUTER_API_KEY")
            if not api_key:
                raise ValueError("OpenRouter API key not provided")

            messages = []
            if system_prompt:
                messages.append({"role": "system", "content": system_prompt})
            messages.append({"role": "user", "content": prompt})

            payload = {
                "model": model,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
            }

            # Add structured output format if specified
            if response_format:
                payload["response_format"] = response_format

            headers = {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "HTTP-Referer": "https://rlcf-framework.com",
                "X-Title": "RLCF Framework"
            }

            log.info(f"Generating completion with model: {model}")

            async with session.post(
                f"{self.OPENROUTER_BASE_URL}/chat/completions",
                json=payload,
                headers=headers
            ) as response:

                if response.status != 200:
                    error_text = await response.text()
                    log.error(f"OpenRouter API error {response.status}: {error_text}")
                    raise Exception(f"OpenRouter API error: {response.status} - {error_text}")

                data = await response.json()

                if "choices" not in data or not data["choices"]:
                    log.error(f"Invalid OpenRouter response: {data}")
                    raise Exception("Invalid response from OpenRouter API")

                completion = data["choices"][0]["message"]["content"]

                # Extract usage data if available
                usage = data.get("usage", {})
                total_tokens = usage.get("total_tokens", 0)
                prompt_tokens = usage.get("prompt_tokens", 0)
                completion_tokens = usage.get("completion_tokens", 0)

                log.info(
                    f"Successfully generated completion ({len(completion)} chars, {total_tokens} tokens)"
                )

                # Store usage in a thread-safe way for later retrieval
                self._last_usage = {
                    "total_tokens": total_tokens,
                    "prompt_tokens": prompt_tokens,
                    "completion_tokens": completion_tokens
                }

                return completion

        except Exception as e:
            log.error(f"Error generating completion: {str(e)}")
            raise

    async def generate_response_async(
        self,
        prompt: str,
        model: str = "google/gemini-2.5-flash",
        temperature: float = 0.7,
        max_tokens: int = 128000,
        system_prompt: Optional[str] = None,
        response_format: Optional[Dict[str, Any]] = None
    ) -> str:
        """
        Async method for generating responses (alias for generate_completion).

        This method exists for backwards compatibility with experts that call it.

        Args:
            prompt: User prompt content
            model: OpenRouter model ID
            temperature: Sampling temperature (0.0-1.0)
            max_tokens: Maximum tokens to generate
            system_prompt: Optional system prompt
            response_format: Optional format constraint (e.g., {"type": "json_object"})

        Returns:
            str: Generated response text
        """
        # Delegate to generate_completion
        return await self.generate_completion(
            prompt=prompt,
            system_prompt=system_prompt,
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
            response_format=response_format
        )

    async def generate_json_completion(
        self,
        prompt: str,
        json_schema: Dict[str, Any],
        system_prompt: Optional[str] = None,
        model: Optional[str] = None,  # Default da LLM_PARSING_MODEL env
        temperature: float = 0.0,
        max_tokens: int = 500,
        api_key: Optional[str] = None,
        timeout: int = 30  # Timeout in secondi
    ) -> Dict[str, Any]:
        """
        Genera una completion in formato JSON strutturato usando OpenRouter.

        Usa json_object con prompt esplicito per garantire JSON valido.
        Compatibile con tutti i modelli OpenRouter.

        Args:
            prompt: Prompt utente
            json_schema: Schema JSON (usato nel prompt per guidare il modello)
            system_prompt: Prompt di sistema opzionale
            model: ID modello OpenRouter (default: gemini-2.0-flash-001)
            temperature: Temperatura sampling (0.0-1.0)
            max_tokens: Max tokens da generare
            api_key: API key opzionale (default: env OPENROUTER_API_KEY)
            timeout: Timeout in secondi per la richiesta HTTP (default: 30)

        Returns:
            Dict: Risposta JSON parsata

        Raises:
            Exception: Se la richiesta API fallisce o il JSON non è valido
        """
        import os
        import json
        import re
        import aiohttp

        try:
            session = await self._get_session()

            api_key = api_key or os.getenv("OPENROUTER_API_KEY")
            if not api_key:
                raise ValueError("OpenRouter API key not provided")

            # Usa modello da env se non specificato
            model = model or os.getenv("LLM_PARSING_MODEL", "google/gemini-2.5-flash")

            # Genera esempio JSON dallo schema
            schema_example = self._generate_json_example(json_schema)

            # Prompt esplicito per JSON
            json_prompt = f"""{prompt}

IMPORTANTE: Rispondi SOLO con un oggetto JSON valido, senza spiegazioni.
Formato richiesto: {schema_example}

JSON:"""

            messages = []
            if system_prompt:
                messages.append({"role": "system", "content": system_prompt + " Rispondi sempre in formato JSON valido."})
            messages.append({"role": "user", "content": json_prompt})

            # Usa json_object (più compatibile) invece di json_schema
            payload = {
                "model": model,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
                "response_format": {"type": "json_object"}
            }

            headers = {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "HTTP-Referer": "https://rlcf-framework.com",
                "X-Title": "RLCF Framework"
            }

            log.info(f"Generating JSON completion with model: {model}")

            # Timeout per la richiesta HTTP
            request_timeout = aiohttp.ClientTimeout(total=timeout)

            async with session.post(
                f"{self.OPENROUTER_BASE_URL}/chat/completions",
                json=payload,
                headers=headers,
                timeout=request_timeout
            ) as response:

                if response.status != 200:
                    error_text = await response.text()
                    log.error(f"OpenRouter API error {response.status}: {error_text}")
                    raise Exception(f"OpenRouter API error: {response.status} - {error_text}")

                data = await response.json()

                if "choices" not in data or not data["choices"]:
                    log.error(f"Invalid OpenRouter response: {data}")
                    raise Exception("Invalid response from OpenRouter API")

                completion = data["choices"][0]["message"]["content"]
                log.info(f"Raw completion: {completion[:200]}...")

                # Prova a parsare direttamente
                try:
                    result = json.loads(completion)
                    log.info(f"Successfully parsed JSON directly ({len(completion)} chars)")
                    return result
                except json.JSONDecodeError:
                    pass  # Prova estrazione

                # Estrai JSON dalla risposta (supporta oggetti nested)
                # Prima cerca un oggetto {...} che può contenere nested
                brace_count = 0
                start_idx = None
                for i, char in enumerate(completion):
                    if char == '{':
                        if brace_count == 0:
                            start_idx = i
                        brace_count += 1
                    elif char == '}':
                        brace_count -= 1
                        if brace_count == 0 and start_idx is not None:
                            json_str = completion[start_idx:i+1]
                            try:
                                result = json.loads(json_str)
                                log.info(f"Successfully extracted nested JSON ({len(json_str)} chars)")
                                return result
                            except json.JSONDecodeError:
                                continue

                # Fallback: prova con array [...]
                bracket_count = 0
                start_idx = None
                for i, char in enumerate(completion):
                    if char == '[':
                        if bracket_count == 0:
                            start_idx = i
                        bracket_count += 1
                    elif char == ']':
                        bracket_count -= 1
                        if bracket_count == 0 and start_idx is not None:
                            json_str = completion[start_idx:i+1]
                            try:
                                result = json.loads(json_str)
                                log.info(f"Successfully extracted array JSON ({len(json_str)} chars)")
                                return {"results": result}  # Wrap array in object
                            except json.JSONDecodeError:
                                continue

                # Se tutto fallisce, prova il vecchio regex semplice
                json_match = re.search(r'\{[^{}]*\}', completion, re.DOTALL)
                if json_match:
                    completion = json_match.group()

                log.info(f"Successfully generated JSON completion ({len(completion)} chars)")

                result = json.loads(completion)
                return result

        except json.JSONDecodeError as e:
            log.error(f"Failed to parse JSON response: {e}. Raw: {completion[:500] if 'completion' in dir() else 'N/A'}")
            raise
        except Exception as e:
            log.error(f"Error generating JSON completion: {str(e)}")
            raise

    def _generate_json_example(self, schema: Dict[str, Any]) -> str:
        """Genera un esempio JSON dallo schema per il prompt."""
        import json

        if "properties" in schema:
            example = {}
            for key, value in schema["properties"].items():
                if value.get("type") == "string":
                    example[key] = "valore"
                elif value.get("type") == "integer":
                    example[key] = 0
                elif value.get("type") == "number":
                    example[key] = 0.0
                elif value.get("type") == "boolean":
                    example[key] = True
                else:
                    example[key] = None
            return json.dumps(example, ensure_ascii=False)
        return "{}"

    def _get_fallback_response(self, task_type: str, error_msg: str) -> Dict[str, Any]:
        """
        Generate fallback response when AI generation fails.

        Args:
            task_type: Type of legal task
            error_msg: Error message from failed generation

        Returns:
            Dict[str, Any]: Fallback response structure
        """
        return {
            "response_text": f"AI response generation failed: {error_msg}. This is a fallback response.",
            "task_type": task_type,
            "confidence": "low",
            "is_fallback": True,
            "error": error_msg,
            "model_name": "fallback",
            "generated_at": None
        }


# Singleton instance for global use
openrouter_service = OpenRouterService()


async def cleanup_ai_service():
    """Cleanup function to close HTTP session."""
    await openrouter_service.close()