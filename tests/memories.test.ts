import { expect, test } from 'claude-code/testing'

import { backlinks, isolated, namesIn, parseIndex, parseMemory, projectSlug } from '../hooks/memories'
import '../hooks/register'

test('project slug: same as the engine, only the open project memory', () => {
  expect(projectSlug('/home/user/code/app')).toBe('-home-user-code-app')
})

test('frontmatter with type under metadata and unique [[name]] links', () => {
  const text = '---\nname: a\ndescription: "Despre \\"x\\""\nmetadata:\n  node_type: memory\n  type: feedback\n---\n\nVezi [[b]] și [[c|alias]], iar [[b]] încă o dată.'
  expect(parseMemory('a.md', text)).toEqual({ name: 'a', type: 'feedback', description: 'Despre "x"', links: ['b', 'c'], body: 'Vezi [[b]] și [[c|alias]], iar [[b]] încă o dată.' })
  expect(parseMemory('fara.md', 'doar text').name).toBe('fara')
})

test('MEMORY.md index: title and hook per file', () => {
  expect(parseIndex('- [Titlu A](a.md) — cârligul lui a\n- [B](b.md)\nalt rând')).toEqual({ 'a.md': { title: 'Titlu A', hook: 'cârligul lui a' }, 'b.md': { title: 'B', hook: '' } })
})

test('graph: incoming links and isolated nodes', () => {
  const list = [
    { name: 'a', links: ['b'] },
    { name: 'b', links: [] },
    { name: 'c', links: [] },
  ]
  expect(backlinks(list)).toEqual({ b: ['a'] })
  expect(isolated(list)).toEqual(['c'])
})

test('names in text: by whole file, not as a suffix', () => {
  const list = [
    { name: 'data', file: 'data.md' },
    { name: 'big-data', file: 'big-data.md' },
  ]
  expect(namesIn('cat /m/big-data.md', list)).toEqual(['big-data'])
  expect(namesIn('cat /m/data.md /m/big-data.md', list)).toEqual(['data', 'big-data'])
})

const PANE = {
  component: 'Pane',
  requestId: 'agent-lens',
  props: { title: 'Agent Lens', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  viewport: { columns: 160, rows: 50 },
} as const

test('Memories tab: the graph, the index in context and memory neighbors', async ($, on) => {
  const files: Record<string, string> = {
    '/m/MEMORY.md': '- [A](a.md) — cârligul lui a\n',
    '/m/a.md': '---\nname: a\ndescription: prima\nmetadata:\n  type: feedback\n---\nVezi [[b]] și [[lipsa]].',
    '/m/b.md': '---\nname: b\ndescription: a doua\nmetadata:\n  type: project\n---\nNimic.',
  }
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.root', () => ({ value: '/p' }))
  on('clock.now', () => ({ value: 0 }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { tokens: 1, window: 1000000, percent: 0, breakdown: { memoryFiles: [{ path: '/m/MEMORY.md', type: 'AutoMem', tokens: 1200 }] } },
      rateLimits: [],
    },
  }) as never)
  on('fs.list', ($, e) => ({
    value: e.path === '/m' ? Object.keys(files).map(f => ({ name: f.slice(3), kind: 'file' as const, size: files[f]?.length ?? 0, mtimeMs: 0, isLink: false })) : [],
  }))
  on('fs.read', ($, e) => ({ value: files[e.path] ?? '' }))

  const ui = await $.ui.mount({ plugin: 'agent-lens', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-memories' })
  expect(await ui.find({ type: 'Text', text: /HOW THEY REACH THE MODEL/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /AutoMem · 1\.2k tok/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /outside the index/ })).toBeDefined()
  await ui.press({ key: 'mo-a' })
  expect(await ui.find({ type: 'Text', text: /cârligul lui a/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /lipsa \(does not exist yet\)/ })).toBeDefined()
  await ui.press({ key: 'go-out-b' })
  expect(await ui.find({ type: 'Text', text: /missing from the index/ })).toBeDefined()
  await ui.unmount()
})
