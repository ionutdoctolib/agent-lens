import { expect, test } from 'claude-code/testing'

import { normalizePlan } from '../hooks/plan'
import { outcomeOf, whyOf } from '../hooks/workers-tab'

const worker = { id: 'w', agentId: 'a1', type: 'Explore', description: 'x', model: 'haiku', parentModel: 'claude-opus-5-5', isBackground: false, status: 'done' as const, startedAt: 0, tools: 0 }

test('subagent branch: escalation, verdict, learned upgrade', () => {
  expect(outcomeOf({ ...worker, escalated: 'ambiguous' })?.mark).toBe('⇡')
  expect(outcomeOf(worker, { agentId: 'a1', files: [], status: 'fail', summary: 'VERDICT: FAIL — missing test' })?.text).toBe('FAIL — missing test → failure recorded')
  expect(outcomeOf({ ...worker, route: 'opus: learned: 2 failures' })?.mark).toBe('↑')
  expect(outcomeOf(worker)).toBeUndefined()
})

test('the mini-plan carries "how I act"; its absence does not break the plan', () => {
  expect(normalizePlan({ goal: 'g', approach: 'delegate the search to haiku', steps: [] }, 0).approach).toBe('delegate the search to haiku')
  expect(normalizePlan({ goal: 'g', steps: [] }, 0).approach).toBe('')
})

test('where the subagent model comes from', () => {
  expect(whyOf({ ...worker, route: 'claude-haiku-5-5: short lookup' })).toBe('short lookup')
  expect(whyOf({ ...worker, asked: 'sonnet' })).toBe('requested by the main model (sonnet)')
  expect(whyOf({ ...worker, model: 'claude-opus-5-5' })).toBe('inherited from the main turn')
  expect(whyOf(worker)).toBe('from the agent definition')
})
