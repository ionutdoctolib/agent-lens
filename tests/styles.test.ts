import { expect, test } from 'claude-code/testing'

import { activeStyle, buildStyle, parseStyle, slugName, withOutputStyle } from '../hooks/styles'
import '../hooks/register'

test('style: parse and build are inverse, keep-coding-instructions survives', () => {
  const text = '---\nname: teacher\ndescription: Explains the why\nkeep-coding-instructions: false\n---\n\nLine one.\n- Line two.\n'
  const s = parseStyle('teacher.md', text)
  expect(s).toEqual({ file: 'teacher.md', name: 'teacher', description: 'Explains the why', keep: false, body: 'Line one.\n- Line two.' })
  expect(buildStyle(s)).toBe(text)
  expect(parseStyle('fara.md', 'doar text').name).toBe('fara')
})

test('style: CRLF files keep their frontmatter', () => {
  expect(parseStyle('w.md', '---\r\nname: w\r\ndescription: d\r\n---\r\n\r\nbody\r\n')).toEqual({ file: 'w.md', name: 'w', description: 'd', keep: true, body: 'body' })
})

test('style: a multi-line description cannot break the frontmatter', () => {
  expect(buildStyle({ file: 'x.md', name: 'x', description: 'a\nb', keep: true, body: 'c' })).toContain('description: a b\n')
})

test('style: file name slug', () => {
  expect(slugName('  Stilul Meu: Ăsta! ')).toBe('stilul-meu-asta')
  expect(slugName('!!!')).toBe('')
})

test('settings: outputStyle is set without touching the rest, and read back', () => {
  const out = withOutputStyle('{\n  "a": 1,\n  "outputStyle": "x"\n}\n', 'teacher')
  expect(out).toBe('{\n  "a": 1,\n  "outputStyle": "teacher"\n}\n')
  expect(activeStyle(out)).toBe('teacher')
  expect(activeStyle('not json')).toBe('')
})
