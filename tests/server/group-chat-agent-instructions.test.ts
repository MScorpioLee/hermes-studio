import { describe, expect, it } from 'vitest'
import {
  buildAgentInstructions,
  buildSummarizationSystemPrompt,
} from '../../packages/server/src/services/hermes/context-engine/prompt'

describe('group chat agent instructions prompt contract', () => {
  it('tells agent-authored replies to route only from a leading address block', () => {
    const prompt = buildAgentInstructions({
      agentName: 'Worker',
      roomName: 'general',
      agentDescription: 'helper',
      memberNames: ['Worker', 'Manager'],
      members: [
        { userId: 'agent-1', name: 'Worker', description: 'helper' },
        { userId: 'agent-2', name: 'Manager', description: 'planner' },
      ],
    })

    expect(prompt).toContain('交接任务时，只用回复开头的连续 @名字')
    expect(prompt).toContain('只有开头点名块会触发路由；正文 @名字 只是普通文本')
    expect(prompt).toContain('回答完就停，避免循环')
  })

  it('keeps the room summary prompt agent-neutral', () => {
    const prompt = buildSummarizationSystemPrompt()
    expect(prompt).toContain('对人类与 agent 成员一视同仁')
    expect(prompt).toContain('不要因为说话者是 agent 就夸大、贬低或默认继续接力')
  })
})
