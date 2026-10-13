import { expect, test } from 'claude-code/testing'

import { tagged, verdictOf } from '../hooks/router'

test('the [haiku] tag pins the model and is stripped from the text', () => {
  expect(tagged('[Haiku] unde e X')).toEqual({ tier: 'haiku', text: 'unde e X' })
  expect(tagged('fără etichetă')).toEqual({ text: 'fără etichetă' })
})

test('the verdict is read from the last line', () => {
  expect(verdictOf('totul bine\nVERDICT: OK').isOk).toBe(true)
  expect(verdictOf('VERDICT: FAIL — lipsește testul')).toEqual({ isOk: false, line: 'VERDICT: FAIL — lipsește testul' })
  expect(verdictOf('fără verdict').line).toBe('VERDICT missing')
})
