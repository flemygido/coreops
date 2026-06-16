// LLM client factory. Callers ask for "the configured LLM client" — they
// never import AnthropicClient/OpenAIClient directly, so adding a provider
// or changing which one answers a given use-case is a change here, nowhere
// else (same reasoning as ../connectors/registry.ts).

import { AnthropicClient } from './anthropic-client.js'
import { OpenAIClient } from './openai-client.js'
import { resolveModelCandidate } from './model-ranking.js'
import type { ApiKeys, ModelCandidate, LlmProvider } from './model-ranking.js'
import type { LlmClient } from './types.js'

export function getLlmClient(provider: LlmProvider, apiKey: string, model: string): LlmClient {
  switch (provider) {
    case 'anthropic':
      return new AnthropicClient(apiKey, model)
    case 'openai':
      return new OpenAIClient(apiKey, model)
  }
}

// Picks the first candidate in `ranking` whose API key is configured in
// `keys`, then returns a ready-to-use client for it. Throws if none have a
// key — callers should treat that as a config error, not a runtime fallback.
export function getLlmClientForRanking(ranking: ModelCandidate[], keys: ApiKeys): LlmClient {
  const candidate = resolveModelCandidate(ranking, keys)
  const apiKey = keys[candidate.provider]
  if (!apiKey) {
    throw new Error(`Resolved candidate ${candidate.provider}:${candidate.model} has no API key`)
  }
  return getLlmClient(candidate.provider, apiKey, candidate.model)
}
