// Resolves which model to use for a given AI "use" (task) from a ranked list
// of provider:model candidates, picking the first one whose API key is
// actually configured. This is deliberate: the owner controls cost purely by
// which keys are filled in — no code/config change needed to go from
// "cheapest model available" to "use Claude for this" once there's revenue.
//
// Convention: list cheapest/most-affordable candidates first for routine,
// high-volume uses; list the higher-quality provider first only for a use
// that's explicitly judged "important" enough to justify the cost (none yet
// — see ADR-0005 Amendment).

export type LlmProvider = 'anthropic' | 'openai'

export interface ModelCandidate {
  provider: LlmProvider
  model: string
}

function toCandidate(entry: string): ModelCandidate {
  const [provider, model] = entry.split(':')
  if ((provider === 'anthropic' || provider === 'openai') && model) {
    return { provider, model }
  }
  throw new Error(`Invalid model ranking entry: "${entry}" — expected "provider:model"`)
}

export function parseModelRanking(ranking: string): ModelCandidate[] {
  const candidates = ranking
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map(toCandidate)

  if (candidates.length === 0) {
    throw new Error('Model ranking is empty — at least one provider:model candidate is required')
  }
  return candidates
}

export interface ApiKeys {
  anthropic: string | undefined
  openai: string | undefined
}

export function resolveModelCandidate(ranking: ModelCandidate[], keys: ApiKeys): ModelCandidate {
  for (const candidate of ranking) {
    if (keys[candidate.provider]) return candidate
  }
  throw new Error(
    `No API key configured for any candidate in the ranking: ` +
      ranking.map((c) => `${c.provider}:${c.model}`).join(', ')
  )
}
