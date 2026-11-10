/**
 * Provider-agnostic model access (SCOPE.md §9). Any OpenAI-compatible endpoint:
 * OpenRouter (recommended start, ZDR enforced at account level), Together, Fireworks,
 * DeepInfra, Groq, or a Bedrock/Vertex gateway.
 *
 * Use `generateText` with an `output` setting (generateObject is deprecated in this AI SDK).
 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export function languageModel(modelId = process.env.LLM_MODEL) {
  if (!modelId || !process.env.LLM_BASE_URL) {
    throw new Error("[shiplog] LLM_MODEL and LLM_BASE_URL must be set");
  }
  const provider = createOpenAICompatible({
    name: process.env.LLM_PROVIDER_NAME ?? "openrouter",
    baseURL: process.env.LLM_BASE_URL,
    apiKey: process.env.LLM_API_KEY,
  });
  return provider(modelId);
}
