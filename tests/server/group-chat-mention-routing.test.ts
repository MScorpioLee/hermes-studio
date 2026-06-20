import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ContentBlock } from '../../packages/server/src/services/hermes/run-chat/types'
import {
  isAllAgentsMentioned,
  isAgentMentioned,
  isReservedMentionName,
  parseLeadingMentionBlock,
  resolveMentionRouting,
  resolveMentionTargets,
  stripMentionAddressBlockFromInput,
  stripMentionAddressBlockFromText,
} from '../../packages/server/src/services/hermes/group-chat/mention-routing'

type TestAgent = { name: string; id?: string; agentId?: string; profile?: string }

const agents: TestAgent[] = [
  { name: 'Alice', id: 'socket-alice', agentId: 'agent-alice' },
  { name: 'Bob', id: 'socket-bob', agentId: 'agent-bob' },
  { name: 'Bobcat', id: 'socket-bobcat', agentId: 'agent-bobcat' },
  { name: 'Regex.Bot', id: 'socket-regex', agentId: 'agent-regex' },
]

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('group chat mention routing', () => {
  it('reserves @all so it cannot be confused with a literal agent name', () => {
    expect(isReservedMentionName('all')).toBe(true)
    expect(isReservedMentionName(' ALL ')).toBe(true)
    expect(isReservedMentionName('Alice')).toBe(false)
  })

  it('recognizes @all as a standalone mention with safe boundaries', () => {
    expect(isAllAgentsMentioned('@all please compare notes')).toBe(true)
    expect(isAllAgentsMentioned('please compare notes @ALL')).toBe(true)
    expect(isAllAgentsMentioned('@all, compare notes')).toBe(true)
    expect(isAllAgentsMentioned('email user@all.example')).toBe(false)
    expect(isAllAgentsMentioned('@alligator should not notify everyone')).toBe(false)
    expect(isAllAgentsMentioned('prefix@all should not notify everyone')).toBe(false)
  })

  it('keeps exact agent mentions boundary-aware and regex-safe', () => {
    expect(isAgentMentioned('@Regex.Bot please review', 'Regex.Bot')).toBe(true)
    expect(isAgentMentioned('@RegexxBot should not match', 'Regex.Bot')).toBe(false)
    expect(isAgentMentioned('@Alice, please review', 'Alice')).toBe(true)
    expect(isAgentMentioned('mailto@Alice.example', 'Alice')).toBe(false)
  })

  it('routes @all to every room agent except the sender identity', () => {
    expect(resolveMentionTargets(agents, '@all summarize the options', 'socket-alice').map(a => a.name)).toEqual(['Bob', 'Bobcat', 'Regex.Bot'])
  })

  it('keeps same-name human senders routable because sender exclusion uses identity, not display name', () => {
    const sameNameAgents: TestAgent[] = [
      { name: 'test', id: 'socket-agent-test', agentId: 'agent-test' },
      { name: 'tt', id: 'socket-agent-tt', agentId: 'agent-tt' },
    ]

    expect(resolveMentionTargets(sameNameAgents, '@all can you talk to me?', 'human-test-user').map(a => a.name)).toEqual(['test', 'tt'])
    expect(resolveMentionTargets(sameNameAgents, '@test why no response?', 'human-test-user').map(a => a.name)).toEqual(['test'])
  })

  it('still excludes an agent from routing to itself when the sender identity matches that agent', () => {
    const sameNameAgents: TestAgent[] = [
      { name: 'test', id: 'socket-agent-test', agentId: 'agent-test' },
      { name: 'tt', id: 'socket-agent-tt', agentId: 'agent-tt' },
    ]

    expect(resolveMentionTargets(sameNameAgents, '@all compare plans', 'socket-agent-test').map(a => a.name)).toEqual(['tt'])
    expect(resolveMentionTargets(sameNameAgents, '@all compare plans', 'agent-test').map(a => a.name)).toEqual(['tt'])
    expect(resolveMentionTargets(sameNameAgents, '@test check yourself', 'socket-agent-test').map(a => a.name)).toEqual([])
  })

  it('routes user messages on mentions anywhere in the message', () => {
    expect(resolveMentionTargets(agents, 'please ask @Bob and @Regex.Bot to compare plans', 'socket-alice', { senderKind: 'user' }).map(a => a.name)).toEqual(['Bob', 'Regex.Bot'])
    expect(resolveMentionTargets(agents, 'please ask @all to compare plans', 'socket-alice', { senderKind: 'user' }).map(a => a.name)).toEqual(['Bob', 'Bobcat', 'Regex.Bot'])
  })

  it('routes agent messages only from a leading address block', () => {
    expect(resolveMentionTargets(agents, '@Bob @Regex.Bot compare plans', 'socket-alice', { senderKind: 'agent' }).map(a => a.name)).toEqual(['Bob', 'Regex.Bot'])
    expect(resolveMentionTargets(agents, 'compare plans with @Bob and @Regex.Bot later', 'socket-alice', { senderKind: 'agent' })).toEqual([])
    expect(resolveMentionTargets(agents, '@all compare plans', 'socket-alice', { senderKind: 'agent' }).map(a => a.name)).toEqual(['Bob', 'Bobcat', 'Regex.Bot'])
  })

  it('supports rolling back agent-authored leading-address routing via env gate', () => {
    vi.stubEnv('HERMES_GROUP_CHAT_AGENT_LEADING_ADDRESS_ROUTING', '0')

    expect(resolveMentionTargets(agents, 'compare plans with @Bob and @Regex.Bot later', 'socket-alice', { senderKind: 'agent' }).map(a => a.name)).toEqual(['Bob', 'Regex.Bot'])
  })

  it('parses a leading address block and returns the exact consumed range', () => {
    const parsed = parseLeadingMentionBlock('@Bob @Regex.Bot: compare plans', agents)
    expect(parsed?.targetNames).toEqual(['Bob', 'Regex.Bot'])
    expect(parsed?.range).toEqual({ startIndex: 0, endIndex: 17 })
    expect(stripMentionAddressBlockFromText('@Bob @Regex.Bot: compare plans', parsed?.range)).toBe('compare plans')
  })

  it('does not route or strip prefix collisions', () => {
    const parsed = parseLeadingMentionBlock('@Bobcat compare plans', agents.filter(agent => agent.name === 'Bob'))
    expect(parsed).toBeNull()
    expect(resolveMentionTargets(agents.filter(agent => agent.name === 'Bob'), '@Bobcat compare plans', 'human-1', { senderKind: 'agent' })).toEqual([])
    expect(resolveMentionRouting(agents.filter(agent => agent.name === 'Bob'), '@Bobcat compare plans', 'human-1', { senderKind: 'agent' }).addressBlock).toBeNull()
  })

  it('suppresses self-mentions from routed targets', () => {
    expect(resolveMentionTargets(agents, '@Alice compare plans', 'socket-alice', { senderKind: 'agent' })).toEqual([])
    expect(resolveMentionTargets(agents, '@Alice @Bob compare plans', 'socket-alice', { senderKind: 'agent' }).map(a => a.name)).toEqual(['Bob'])
  })

  it('tracks and strips only the routed leading address block for multimodal ContentBlock[] input', () => {
    const input: ContentBlock[] = [
      { type: 'image', name: 'chart', path: '/tmp/chart.png', media_type: 'image/png' },
      { type: 'text', text: '@Bob @Regex.Bot compare options' },
      { type: 'text', text: 'Later prose mentions @Bob again for context.' },
    ]

    const routing = resolveMentionRouting(agents, input, 'human-1', { senderKind: 'agent' })
    expect(routing.targetNames).toEqual(['Bob', 'Regex.Bot'])
    expect(routing.addressBlock).toMatchObject({
      textBlockIndex: 1,
      range: { startIndex: 0, endIndex: 16 },
    })

    const stripped = stripMentionAddressBlockFromInput(input, routing.addressBlock) as ContentBlock[]
    expect(stripped).toEqual([
      { type: 'image', name: 'chart', path: '/tmp/chart.png', media_type: 'image/png' },
      { type: 'text', text: 'compare options' },
      { type: 'text', text: 'Later prose mentions @Bob again for context.' },
    ])
  })

  it('keeps later text-block mentions informational for agent-authored messages', () => {
    const input: ContentBlock[] = [
      { type: 'text', text: 'I think @Bob should review this later.' },
      { type: 'text', text: '@Regex.Bot compare options' },
    ]

    const routing = resolveMentionRouting(agents, input, 'socket-alice', { senderKind: 'agent' })
    expect(routing.targetNames).toEqual([])
    expect(routing.addressBlock).toBeNull()
  })
})
