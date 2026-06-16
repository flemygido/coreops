// Real Anthropic implementation of LlmClient. The only file in this directory
// allowed to know about Anthropic's specific request/response shape — routes,
// services, and tests depend on the LlmClient interface (./types.ts), never
// this class directly (mirrors ../connectors' provider-abstraction pattern).

import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import type { FollowUpDraftInput, FollowUpDraftResult, LlmClient } from './types.js'

const FollowUpDraftSchema = z.object({
  message_text: z.string(),
})

const SYSTEM_PROMPT = `You draft short WhatsApp payment-reminder messages on behalf of a small business owner, sent to their own customer about their own overdue invoice.

Rules:
- Polite, brief, professional — never threatening or apologetic.
- Always mention the customer's name, the invoice number, and the amount outstanding.
- Never include a URL, link, or payment instructions — those are added separately.
- One short message, no greeting/signature boilerplate beyond what fits naturally.
- Output language: English.`

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
      system: SYSTEM_PROMPT,
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
