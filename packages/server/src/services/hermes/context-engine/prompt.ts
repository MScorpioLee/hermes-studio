// ─── Agent Identity Instructions ────────────────────────────

import type { MemberInfo } from './types'
import { getSystemPrompt } from '../../../lib/llm-prompt'

interface AgentInstructionsParams {
    agentName: string
    roomName: string
    agentDescription: string
    memberNames: string[]
    members: MemberInfo[]
}

export function buildAgentInstructions(params: AgentInstructionsParams): string {
    // Deduplicate members by name (primary key) to avoid duplicate roles
    // If multiple entries have the same name, prefer the one with description
    const uniqueMembersMap = new Map<string, MemberInfo>()

    for (const m of params.members) {
        const existing = uniqueMembersMap.get(m.name)
        // Prefer entries with description
        if (!existing || (m.description && !existing.description)) {
            uniqueMembersMap.set(m.name, m)
        }
    }

    const uniqueMembers = Array.from(uniqueMembersMap.values())

    let memberSection: string
    if (uniqueMembers.length > 0) {
        memberSection = uniqueMembers
            .map(m => m.description ? `- ${m.name}: ${m.description}` : `- ${m.name}`)
            .join('\n')
    } else if (params.memberNames.length > 0) {
        // Deduplicate member names as well
        const uniqueNames = Array.from(new Set(params.memberNames))
        memberSection = uniqueNames.map(n => `- ${n}`).join('\n')
    } else {
        memberSection = '- 未知'
    }

    // Handle empty agent description
    const roleDescription = params.agentDescription?.trim()
        ? params.agentDescription
        : '专业的 AI 助手，随时准备协助解决问题。'

    const basePrompt = `你是"${params.agentName}"，群聊房间"${params.roomName}"中的 AI 助手。

你的角色：${roleDescription}

当前房间成员：
${memberSection}

群聊规则：
- 你已被系统选中回复；请直接回应最新任务，不要因消息同时提及其他成员而空回复。
- 历史中的“[发送者]:”只是归属标记；不要复述或模仿这种前缀。
- 交接任务时，只用回复开头的连续 @名字，例如“@worker @reviewer 请…”。只有开头点名块会触发路由；正文 @名字 只是普通文本。
- 只有确需对方行动、确认或补充信息时才 @；回答完就停，避免循环。
- 简洁、有帮助；不要假装是人类。`

    return getSystemPrompt(basePrompt)
}

// ─── Summarization Prompts ─────────────────────────────────

export function buildSummarizationSystemPrompt(): string {
    return `你是一个群聊对话的摘要助手。请创建一份结构化摘要，帮助 AI 助手快速理解完整的对话上下文并智能回复。

使用以下格式：

当前话题：
- 现在在聊什么，目标是什么

已知结论：
- 已达成哪些共识，哪些问题已经回答过

待回复消息：
- 还剩谁的问题没回，下一步要做什么

关键人物：
- 人名、角色、引用关系

重要上下文：
- 不要丢时间线和立场变化
- 少写废话，多保留"可行动信息"
- 重点保留：谁说了什么、结论是什么、下一步是什么
- 关键的 URL、代码片段、错误信息、约束条件

规则：
- 基于事实，不要编造信息。
- 保持简洁（500 字以内）。
- 聚焦于帮助 AI 回复下一条消息的可行动信息。
- 对人类与 agent 成员一视同仁，用中性措辞总结，不要因为说话者是 agent 就夸大、贬低或默认继续接力。
- 使用与对话相同的语言。
- 不要回复对话内容，只输出摘要。`
}

export function buildFullSummaryPrompt(): string {
    return '请对上方对话创建一份简洁的摘要。只输出摘要内容。'
}

export function buildIncrementalUpdatePrompt(): string {
    return '对话自上次摘要后有了新的内容。请更新摘要，整合新消息。保持相同格式，更新所有部分。只输出更新后的摘要。'
}
