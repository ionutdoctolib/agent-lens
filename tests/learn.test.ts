import { expect, test } from 'claude-code/testing'

import { addMiss, costOf, escalationOf, learned, wordsOf } from '../hooks/router'

const usage = (input: number, output: number, read = 0, write = 0) => ({ input_tokens: input, output_tokens: output, cache_read_input_tokens: read, cache_creation_input_tokens: write })

const r = (n: number) => Math.round(n * 1e6) / 1e6

test('cost per model, with cache and the Haiku 100K threshold', () => {
  expect(r(costOf('opus', usage(1e6, 1e6)))).toBe(24)
  expect(r(costOf('sonnet', usage(0, 0, 1e6, 1e6)))).toBe(4.2)
  expect(r(costOf('haiku', usage(50_000, 0)))).toBe(0.005)
  expect(r(costOf('haiku', usage(150_000, 0)))).toBe(0.075)
})

test('the ESCALATE line is read, including the legacy Romanian marker with or without diacritics', () => {
  expect(escalationOf('ESCALATE: a choice between two schemas is needed')).toBe('a choice between two schemas is needed')
  expect(escalationOf('ESCALADEAZĂ: trebuie ales între două scheme')).toBe('trebuie ales între două scheme')
  expect(escalationOf('gata\nescaladeaza: ambiguu')).toBe('ambiguu')
  expect(escalationOf('ESCALATE:')).toBeUndefined()
  expect(escalationOf('all ok')).toBeUndefined()
})

test('words: no diacritics, no quotes, no filler words', () => {
  expect(wordsOf('Repară prețul pentru „ceva citat” în lista')).toEqual(['repara', 'pretul', 'lista'])
})

test('goes up only after 2 similar failures, on different texts, and never down', () => {
  const a = { words: wordsOf('repara pretul listei achizitii'), tier: 'sonnet' as const, at: 1 }
  const b = { words: wordsOf('schimba pretul listei partener'), tier: 'sonnet' as const, at: 2 }
  let list = addMiss([], a)
  list = addMiss(list, a)
  expect(list).toHaveLength(1)
  expect(learned('modifica pretul listei', 'sonnet', list)).toBeUndefined()
  list = addMiss(list, b)
  expect(learned('modifica pretul listei', 'sonnet', list)).toEqual({ tier: 'opus', why: 'learned: 2 failures' })
  expect(learned('modifica pretul listei', 'haiku', list)?.tier).toBe('opus')
  expect(learned('modifica pretul listei', 'opus', list)).toBeUndefined()
  expect(learned('redenumeste coloana', 'sonnet', list)).toBeUndefined()
  const cheap = [a, b].map(m => ({ ...m, tier: 'haiku' as const }))
  expect(learned('modifica pretul listei', 'sonnet', cheap)).toBeUndefined()
})
