import { expect, test } from 'claude-code/testing'

import { ANSWERS_TAG, answersMessage, layers, normalizePlan } from '../hooks/plan'

test('steps with no shared dependencies sit on the same level; cycles land last', () => {
  const plan = normalizePlan(
    {
      goal: 'new tab',
      clarity: 14,
      steps: [
        { id: 'a', title: 'read', tier: 'haiku' },
        { id: 'b', title: 'types', tier: 'haiku' },
        { id: 'c', title: 'design', tier: 'opus', after: ['a', 'b', 'zzz'] },
        { id: 'd', title: 'write', tier: 'sonnet', after: ['c'] },
        { id: 'e', title: 'tests', tier: 'sonnet', after: ['c'] },
        { id: 'x', title: 'cycle', tier: 'opus', after: ['y'] },
        { id: 'y', title: 'cycle', tier: 'opus', after: ['x'] },
      ],
    },
    0,
  )
  expect(plan.clarity).toBe(10)
  expect(layers(plan.steps).map(l => l.map(s => s.id).join(''))).toEqual(['ab', 'c', 'de', 'xy'])
})

test('malformed model input gets safe values', () => {
  const plan = normalizePlan({ steps: [{ title: 'x', tier: 'gpt', status: 'finished' }], questions: ['where?', { why: 'no ask' }], assumptions: [3, 'ok'] }, 5)
  expect(plan.steps[0]).toEqual({ id: '1', title: 'x', tier: 'opus', after: [], status: 'todo' })
  expect(plan.questions).toEqual([{ ask: 'where?', why: '', options: [], fallback: '' }])
  expect(plan.assumptions).toEqual(['ok'])
  expect(plan.clarity).toBe(0)
  expect(layers(normalizePlan(null, 0).steps)).toEqual([])
})

test('the question carries its options (at most 4) and the default action; the answer carries its text', () => {
  const [q] = normalizePlan({ questions: [{ ask: 'Which lists?', options: ['all', '', 'active', 'test', 'archive', 'too many'], default: 'all' }] }, 0).questions
  expect(q.options).toEqual(['all', 'active', 'test', 'archive'])
  expect(q.fallback).toBe('all')
  expect(answersMessage([])).toBe('')
  expect(answersMessage([{ ask: 'Which lists?', text: 'active' }])).toBe(`${ANSWERS_TAG}\n- Which lists?\n  → active`)
})
