// LLM client factory. Callers ask for "the configured LLM client" — they never
// import AnthropicClient directly, so switching LLM_PROVIDER later is a
// one-line change here, nowhere else (same reasoning as ../connectors/registry.ts).

import { AnthropicClient } from './anthropic-client.js'
import type { LlmClient } from './types.js'

export function getLlmClient(provider: string, apiKey: string, model: string): LlmClient {
  switch (provider) {
    case 'anthropic':
      return new AnthropicClient(apiKey, model)
    default:
      throw new Error(`Unknown LLM provider: ${provider}`)
  }
}
