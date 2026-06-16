import { describe, it, expect } from 'vitest'
import { parseModelRanking, resolveModelCandidate } from '../model-ranking.js'

describe('parseModelRanking', () => {
  it('parses a comma-separated provider:model list in order', () => {
    const ranking = parseModelRanking('openai:gpt-5-nano,anthropic:claude-haiku-4-5-20251001')
    expect(ranking).toEqual([
      { provider: 'openai', model: 'gpt-5-nano' },
      { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
    ])
  })

  it('trims whitespace around entries', () => {
    const ranking = parseModelRanking(' openai:gpt-5-nano , anthropic:claude-haiku-4-5-20251001 ')
    expect(ranking).toHaveLength(2)
  })

  it('throws on an unknown provider', () => {
    expect(() => parseModelRanking('cohere:command-r')).toThrow(/Invalid model ranking entry/)
  })

  it('throws on a malformed entry missing a model', () => {
    expect(() => parseModelRanking('openai:')).toThrow(/Invalid model ranking entry/)
  })

  it('throws on an empty ranking', () => {
    expect(() => parseModelRanking('')).toThrow(/empty/)
  })
})

describe('resolveModelCandidate', () => {
  const ranking = parseModelRanking(
    'openai:gpt-5-nano,openai:gpt-5-mini,anthropic:claude-haiku-4-5-20251001'
  )

  it('picks the first candidate whose key is present', () => {
    const candidate = resolveModelCandidate(ranking, { anthropic: 'sk-ant-x', openai: undefined })
    expect(candidate).toEqual({ provider: 'anthropic', model: 'claude-haiku-4-5-20251001' })
  })

  it('prefers an earlier-ranked candidate over a later one when both have keys', () => {
    const candidate = resolveModelCandidate(ranking, { anthropic: 'sk-ant-x', openai: 'sk-oa-x' })
    expect(candidate).toEqual({ provider: 'openai', model: 'gpt-5-nano' })
  })

  it('throws when no candidate has a key configured', () => {
    expect(() =>
      resolveModelCandidate(ranking, { anthropic: undefined, openai: undefined })
    ).toThrow(/No API key configured/)
  })

  it('treats an empty-string key as not configured', () => {
    expect(() => resolveModelCandidate(ranking, { anthropic: '', openai: '' })).toThrow(
      /No API key configured/
    )
  })
})
