import type { ContentBlock } from '../run-chat/types'

export const ALL_AGENTS_MENTION = 'all'

export type MentionSenderKind = 'user' | 'agent'
export type MentionRoutingScope = 'anywhere' | 'leading'

export type MentionableAgent = {
    name: string
    id?: string
    agentId?: string
}

export type MentionRange = {
    startIndex: number
    endIndex: number
}

export type ParsedLeadingMentionBlock<T extends MentionableAgent = MentionableAgent> = {
    targets: T[]
    targetNames: string[]
    hasAll: boolean
    range: MentionRange
}

export type MentionAddressBlock<T extends MentionableAgent = MentionableAgent> = ParsedLeadingMentionBlock<T> & {
    textBlockIndex?: number
}

export type MentionRoutingResult<T extends MentionableAgent = MentionableAgent> = {
    targets: T[]
    targetNames: string[]
    scope: 'all' | 'explicit' | 'none'
    addressBlock: MentionAddressBlock<T> | null
}

const BEFORE_BOUNDARY = new Set(['(', '[', '{', '<'])
const AFTER_BOUNDARY = new Set(['.', ',', '!', '?', ';', ':', '，', '。', '！', '？', '；', '：', ')', ']', '}', '>'])
const ADDRESS_SEPARATOR = new Set([' ', '\t', '\n', '\r', ',', '，', ':', '：', ';', '；', '.', '!', '?', '。', '！', '？'])

export function escapeMentionName(name: string): string {
    return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function isReservedMentionName(name: string): boolean {
    return name.trim().toLowerCase() === ALL_AGENTS_MENTION
}

function isBeforeBoundary(char: string | undefined): boolean {
    return char === undefined || /\s/.test(char) || BEFORE_BOUNDARY.has(char)
}

function isAfterBoundary(char: string | undefined): boolean {
    return char === undefined || /\s/.test(char) || AFTER_BOUNDARY.has(char)
}

function normalizeMentionRange(startIndex: number, endIndex: number): MentionRange {
    return { startIndex, endIndex }
}

function findMentionRanges(content: string, mentionName: string): MentionRange[] {
    if (!content || !mentionName) return []

    const contentLower = content.toLowerCase()
    const mentionLower = mentionName.toLowerCase()
    const ranges: MentionRange[] = []
    let fromIndex = 0

    while (fromIndex < content.length) {
        const atIndex = contentLower.indexOf(`@${mentionLower}`, fromIndex)
        if (atIndex === -1) break

        const endIndex = atIndex + mentionName.length + 1
        if (isBeforeBoundary(content[atIndex - 1]) && isAfterBoundary(content[endIndex])) {
            ranges.push(normalizeMentionRange(atIndex, endIndex))
        }
        fromIndex = atIndex + 1
    }

    return ranges
}

function matchMentionAt(content: string, startIndex: number, mentionName: string): MentionRange | null {
    if (!content || !mentionName || content[startIndex] !== '@') return null
    const mention = `@${mentionName}`
    if (content.slice(startIndex, startIndex + mention.length).toLowerCase() !== mention.toLowerCase()) {
        return null
    }
    const endIndex = startIndex + mention.length
    return isAfterBoundary(content[endIndex]) ? normalizeMentionRange(startIndex, endIndex) : null
}

function envFlagEnabled(name: string, defaultValue: boolean): boolean {
    const raw = process.env[name]
    if (raw == null || raw.trim() === '') return defaultValue
    return !['0', 'false', 'off', 'no'].includes(raw.trim().toLowerCase())
}

export function defaultMentionRoutingScope(options?: { senderKind?: MentionSenderKind; scope?: MentionRoutingScope }): MentionRoutingScope {
    if (options?.scope) return options.scope
    if (options?.senderKind === 'agent') {
        return envFlagEnabled('HERMES_GROUP_CHAT_AGENT_LEADING_ADDRESS_ROUTING', true)
            ? 'leading'
            : 'anywhere'
    }
    return 'anywhere'
}

function isSenderAgent(agent: MentionableAgent, senderId: string): boolean {
    return Boolean(senderId && (agent.id === senderId || agent.agentId === senderId))
}

function dedupeAgents<T extends MentionableAgent>(agents: T[]): T[] {
    const seen = new Set<string>()
    const result: T[] = []
    for (const agent of agents) {
        const key = `${agent.id || ''}:${agent.agentId || ''}:${agent.name.toLowerCase()}`
        if (seen.has(key)) continue
        seen.add(key)
        result.push(agent)
    }
    return result
}

function filterSenderTargets<T extends MentionableAgent>(agents: T[], senderId: string): T[] {
    return agents.filter((agent) => !isSenderAgent(agent, senderId))
}

function resolveParsedTargets<T extends MentionableAgent>(
    parsed: ParsedLeadingMentionBlock<T> | null,
    agents: T[],
    senderId: string,
): T[] {
    if (!parsed) return []
    const candidates = filterSenderTargets(agents, senderId)
    if (parsed.hasAll) return candidates
    const wanted = new Set(parsed.targetNames.map(name => name.toLowerCase()))
    return candidates.filter((agent) => wanted.has(agent.name.toLowerCase()))
}

export function isAgentMentioned(content: string, agentName: string): boolean {
    return findMentionRanges(content, agentName).length > 0
}

export function isAllAgentsMentioned(content: string): boolean {
    return isAgentMentioned(content, ALL_AGENTS_MENTION)
}

export function parseLeadingMentionBlock<T extends MentionableAgent>(
    content: string,
    agents: T[],
): ParsedLeadingMentionBlock<T> | null {
    const text = String(content || '')
    let cursor = 0
    while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1
    if (cursor >= text.length || text[cursor] !== '@') return null

    const explicitAgents: T[] = []
    let hasAll = false
    let matchedAny = false

    while (cursor < text.length && text[cursor] === '@') {
        const allRange = matchMentionAt(text, cursor, ALL_AGENTS_MENTION)
        if (allRange) {
            matchedAny = true
            hasAll = true
            cursor = allRange.endIndex
        } else {
            const agentMatch = agents.find((agent) => matchMentionAt(text, cursor, agent.name))
            if (!agentMatch) break
            matchedAny = true
            explicitAgents.push(agentMatch)
            cursor += agentMatch.name.length + 1
        }

        const separatorStart = cursor
        while (cursor < text.length && ADDRESS_SEPARATOR.has(text[cursor])) cursor += 1
        if (cursor >= text.length || text[cursor] !== '@') {
            if (cursor === separatorStart) {
                // No separator means any following non-mention text begins immediately after the token.
                // That still counts as a finished leading block because the mention boundary already matched.
            }
            break
        }
    }

    if (!matchedAny) return null

    const targets = dedupeAgents(hasAll ? agents : explicitAgents)
    return {
        targets,
        targetNames: targets.map((agent) => agent.name),
        hasAll,
        range: normalizeMentionRange(0, cursor),
    }
}

export function resolveMentionTargets<T extends MentionableAgent>(
    agents: T[],
    content: string,
    senderId: string,
    options?: { senderKind?: MentionSenderKind; scope?: MentionRoutingScope },
): T[] {
    const scope = defaultMentionRoutingScope(options)
    const candidates = filterSenderTargets(agents, senderId)

    if (scope === 'leading') {
        const parsed = parseLeadingMentionBlock(content, agents)
        if (!parsed) return []
        if (parsed.hasAll) return candidates
        const wanted = new Set(parsed.targetNames.map((name) => name.toLowerCase()))
        return candidates.filter((agent) => wanted.has(agent.name.toLowerCase()))
    }

    if (isAllAgentsMentioned(content)) {
        return candidates
    }

    return candidates.filter((agent) => isAgentMentioned(content, agent.name))
}

function resolveTargetsForTextBlocks<T extends MentionableAgent>(
    agents: T[],
    blocks: ContentBlock[],
    senderId: string,
    senderKind: MentionSenderKind,
): MentionRoutingResult<T> {
    const textBlocks = blocks
        .map((block, index) => ({ block, index }))
        .filter(({ block }) => block.type === 'text') as Array<{ block: Extract<ContentBlock, { type: 'text' }>; index: number }>

    if (textBlocks.length === 0) {
        return { targets: [], targetNames: [], scope: 'none', addressBlock: null }
    }

    if (senderKind === 'agent') {
        const firstTextBlock = textBlocks[0]
        const parsed = parseLeadingMentionBlock(firstTextBlock.block.text || '', agents)
        const targets = resolveParsedTargets(parsed, agents, senderId)
        return {
            targets,
            targetNames: targets.map((agent) => agent.name),
            scope: parsed?.hasAll ? 'all' : targets.length > 0 ? 'explicit' : 'none',
            addressBlock: parsed ? { ...parsed, textBlockIndex: firstTextBlock.index } : null,
        }
    }

    let hasAll = false
    const explicitTargets: T[] = []
    let addressBlock: MentionAddressBlock<T> | null = null

    for (const { block, index } of textBlocks) {
        const text = String(block.text || '')
        if (!addressBlock) {
            const parsed = parseLeadingMentionBlock(text, agents)
            if (parsed) addressBlock = { ...parsed, textBlockIndex: index }
        }
        if (isAllAgentsMentioned(text)) hasAll = true
        for (const agent of agents) {
            if (isAgentMentioned(text, agent.name)) explicitTargets.push(agent)
        }
    }

    const targets = hasAll
        ? filterSenderTargets(agents, senderId)
        : filterSenderTargets(dedupeAgents(explicitTargets), senderId)

    return {
        targets,
        targetNames: targets.map((agent) => agent.name),
        scope: hasAll ? 'all' : targets.length > 0 ? 'explicit' : 'none',
        addressBlock,
    }
}

export function resolveMentionRouting<T extends MentionableAgent>(
    agents: T[],
    input: string | ContentBlock[] | undefined,
    senderId: string,
    options?: { senderKind?: MentionSenderKind; scope?: MentionRoutingScope },
): MentionRoutingResult<T> {
    const senderKind = options?.senderKind || 'user'
    const scope = defaultMentionRoutingScope(options)

    if (Array.isArray(input)) {
        return resolveTargetsForTextBlocks(agents, input, senderId, senderKind)
    }

    const text = typeof input === 'string' ? input : String(input || '')
    const targets = resolveMentionTargets(agents, text, senderId, { senderKind, scope })
    const parsed = parseLeadingMentionBlock(text, agents)

    return {
        targets,
        targetNames: targets.map((agent) => agent.name),
        scope: scope === 'leading'
            ? (parsed?.hasAll ? 'all' : targets.length > 0 ? 'explicit' : 'none')
            : (isAllAgentsMentioned(text) ? 'all' : targets.length > 0 ? 'explicit' : 'none'),
        addressBlock: parsed,
    }
}

export function stripMentionAddressBlockFromText(content: string, range?: MentionRange | null): string {
    const text = String(content || '')
    if (!range) return text
    const startIndex = Math.max(0, Math.min(text.length, range.startIndex))
    const endIndex = Math.max(startIndex, Math.min(text.length, range.endIndex))
    return `${text.slice(0, startIndex)}${text.slice(endIndex)}`
}

export function stripMentionAddressBlockFromInput(
    input: string | ContentBlock[] | undefined,
    addressBlock?: { range: MentionRange; textBlockIndex?: number } | null,
): string | ContentBlock[] | undefined {
    if (!addressBlock) return input

    if (typeof input === 'string') {
        return stripMentionAddressBlockFromText(input, addressBlock.range)
    }

    if (!Array.isArray(input)) return input

    return input.map((block, index) => {
        if (block.type !== 'text') return block
        if (index !== addressBlock.textBlockIndex) return block
        return {
            ...block,
            text: stripMentionAddressBlockFromText(String(block.text || ''), addressBlock.range),
        }
    })
}

export function stripMentionRoutingTokens(content: string, ownAgentName: string | string[]): string {
    const names = Array.isArray(ownAgentName) ? ownAgentName : [ownAgentName]
    const parsed = parseLeadingMentionBlock(content, names.filter(Boolean).map((name) => ({ name })))
    return stripMentionAddressBlockFromText(content, parsed?.range)
}
