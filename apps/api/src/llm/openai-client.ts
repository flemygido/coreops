// Real OpenAI implementation of LlmClient. The only file allowed to know
// about OpenAI's specific request/response shape — see anthropic-client.ts
// for the equivalent. Both implement the same interface so registry.ts can
// pick between them per-call based on the cost-ranked model resolution
// (see model-ranking.ts) without any other file knowing which one answered.

import OpenAI from 'openai'
import { zodResponseFormat } from 'openai/helpers/zod'
import type { FollowUpDraftInput, FollowUpDraftResult, LlmClient } from './types.js'
import { FollowUpDraftSchema, FOLLOW_UP_DRAFT_SYSTEM_PROMPT } from './prompts.js'

export class OpenAIClient implements LlmClient {
  readonly provider = 'openai'
  private readonly client: OpenAI

  constructor(
    apiKey: string,
    readonly model: string
  ) {
    this.client = new OpenAI({ apiKey })
  }

  async generateFollowUpDraft(input: FollowUpDraftInput): Promise<FollowUpDraftResult> {
    const completion = await this.client.chat.completions.parse({
      model: this.model,
      messages: [
        { role: 'system', content: FOLLOW_UP_DRAFT_SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(input) },
      ],
      response_format: zodResponseFormat(FollowUpDraftSchema, 'follow_up_draft'),
    })

    const parsed = completion.choices[0]?.message.parsed
    if (!parsed) {
      throw new Error('OpenAI response had no parsed output')
    }
    if (!completion.usage) {
      // Under-reporting cost is worse than a loud failure — same principle
      // as cost-tracker.ts refusing to silently treat an unknown model as free.
      throw new Error('OpenAI response had no usage data — cannot log cost')
    }

    return {
      message_text: parsed.message_text,
      model: this.model,
      input_tokens: completion.usage.prompt_tokens,
      output_tokens: completion.usage.completion_tokens,
    }
  }
}
