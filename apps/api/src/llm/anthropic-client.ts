// Real Anthropic implementation of LlmClient. The only file in this directory
// allowed to know about Anthropic's specific request/response shape — routes,
// services, and tests depend on the LlmClient interface (./types.ts), never
// this class directly (mirrors ../connectors' provider-abstraction pattern).

import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type { FollowUpDraftInput, FollowUpDraftResult, LlmClient } from './types.js'
import { FollowUpDraftSchema, FOLLOW_UP_DRAFT_SYSTEM_PROMPT } from './prompts.js'

export class AnthropicClient implements LlmClient {
  readonly provider = 'anthropic'
  private readonly client: Anthropic

  constructor(
    apiKey: string,
    readonly model: string
  ) {
    this.client = new Anthropic({ apiKey })
  }

  async generateFollowUpDraft(input: FollowUpDraftInput): Promise<FollowUpDraftResult> {
    const message = await this.client.messages.parse({
      model: this.model,
      max_tokens: 256,
      system: FOLLOW_UP_DRAFT_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: JSON.stringify(input),
        },
      ],
      output_config: { format: zodOutputFormat(FollowUpDraftSchema) },
    })

    if (!message.parsed_output) {
      throw new Error('Anthropic response had no parsed_output')
    }

    return {
      message_text: message.parsed_output.message_text,
      model: this.model,
      input_tokens: message.usage.input_tokens,
      output_tokens: message.usage.output_tokens,
    }
  }
}
