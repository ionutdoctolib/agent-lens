import { expect, test } from 'claude-code/testing'

import { kindOf, retroMessage, retroOf } from '../hooks/retro'

const step = (index: number, uses: [string, string][], model = 'claude-opus-5-5', agentId?: string) => ({
  id: `t:${agentId ?? 'main'}:${index}`, turnId: 't', index, model, agentId, isDone: true,
  tools: uses.map(([tool]) => tool), tokensIn: 80_000, tokensOut: 400, cacheRead: 75_000, cost: 0.05, stop: 'tool_use',
  answer: '', uses: uses.map(([tool, brief]) => ({ tool, brief })),
})
const worker = { id: 'w', agentId: 'a1', type: 'Explore', description: 'search', model: 'claude-opus-5-5', parentModel: 'claude-opus-5-5', isBackground: false, status: 'done' as const, startedAt: 0, tools: 2 }

test('step kind: read, edit, other; Bash only with read commands', () => {
  expect(kindOf(step(1, [['Read', 'a'], ['mcp__codegraph__codegraph_explore', 'x'], ['mcp__agent-lens__plan', '']]))).toBe('read')
  expect(kindOf(step(1, [['Bash', 'grep -n foo a.ts']]))).toBe('read')
  expect(kindOf(step(1, [['Bash', 'rm -rf x']]))).toBe('other')
  expect(kindOf(step(1, [['Edit', 'a'], ['Write', 'b']]))).toBe('edit')
  expect(kindOf(step(1, []))).toBe('other')
})

test('retrospective: 3 reads in a row on opus, opus read-only worker, escalation, plan not followed', () => {
  const main = [step(1, [['Read', 'a']]), step(2, [['Grep', 'b']]), step(3, [['Read', 'c']]), step(4, [['Edit', 'a']]), step(5, [])]
  const w = [worker, { ...worker, id: 'w2', agentId: 'a2', model: 'claude-haiku-5-5', escalated: 'ambiguous' }]
  const ws = [step(1, [['Read', 'x']], 'claude-opus-5-5', 'a1'), step(1, [['Read', 'y']], 'claude-haiku-5-5', 'a2')]
  const plan = { goal: '', approach: '', clarity: 5, assumptions: [], questions: [], betterPrompt: '', savings: [], revision: 0, at: 0, steps: [{ id: 's', title: 'edit', tier: 'sonnet' as const, after: [], status: 'done' as const }] }
  const r = retroOf('t', 0, main, w, ws, plan)
  expect(r.findings.map(f => f.kind)).toEqual(['read', 'worker', 'escalated', 'plan'])
  expect(r.findings[0]?.text).toMatch(/#1–#3/)
  expect(r.findings[0]?.saving).toBeGreaterThan(0)
  expect(r.saving).toBeGreaterThan(0)
  expect(r.steps).toBe(7)
})

test('nothing to delegate: two reads do not reach the threshold', () => {
  const r = retroOf('t', 0, [step(1, [['Read', 'a']]), step(2, [['Read', 'b']]), step(3, [])], [], [], null)
  expect(r.findings).toEqual([])
})

test('message to the model: only with findings, with the tag and the lesson', () => {
  const r = retroOf('t', 0, [step(1, [['Read', 'a']]), step(2, [['Read', 'b']]), step(3, [['Grep', 'c']])], [], [], null)
  expect(retroMessage(r)).toMatch(/^\[Agent Lens · turn retrospective\]\n.*\n- steps #1–#3/)
  expect(retroMessage({ ...r, findings: [] })).toBe('')
})
