import { expect, test } from 'claude-code/testing'

import { brief, pairUses, tally } from '../hooks/register'

const PANE = {
  component: 'Pane',
  requestId: 'agent-lens',
  props: {
    title: 'Agent Lens',
    isFocused: true,
    bodyColumns: 48,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
  viewport: { columns: 160, rows: 40 },
} as const

test('tally groups repeated tools', () => {
  expect(tally(['Read', 'Read', 'Bash', 'Read'])).toBe('Read×3 Bash')
  expect(tally([])).toBe('')
})

test('opened step: short input and the matching output from the transcript', () => {
  expect(brief({ command: 'git status', description: 'x' })).toBe('git status')
  expect(brief({ a: 1 })).toBe('{"a":1}')
  const uses = [{ tool: 'Read', brief: 'a.rb' }, { tool: 'Read', brief: 'a.rb' }, { tool: 'Bash', brief: 'ls' }]
  const done = [{ tool: 'Read', brief: 'a.rb', output: 'one' }, { tool: 'Read', brief: 'a.rb', output: 'two' }]
  expect(pairUses(uses, done).map(u => u.output)).toEqual(['one', 'two', undefined])
})

test('the sidebar renders and the tabs switch', async ($, on) => {
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('clock.now', () => ({ value: Date.parse('2026-10-08T22:00:00Z') }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { tokens: 60000, window: 1000000, percent: 6 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 42, resetsAt: '2026-10-09T01:00:00Z' }],
      cost: { usd: 1.5 },
    },
  }))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'agent-lens', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /AGENT LENS/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /opus-5-5/ })).toBeDefined()
    await ui.press({ key: 'tab-changes' })
    expect(await ui.find({ type: 'Text', text: /Not a git repository|Reading status|nothing to commit|staged/ })).toBeDefined()
    await ui.press({ key: 'tab-workers' })
    expect(await ui.find({ type: 'Text', text: /No subagents invoked in this session\./ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /42%/ })).toBeDefined()
    await ui.press({ key: 'tab-think' })
    expect(await ui.find({ type: 'Button', key: 'fold-exec' })).toBeDefined()
    await ui.unmount()
  }
})

test('Git tab: clicking a file opens its diff, "haiku message" fills the field', async ($, on) => {
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('clock.now', () => ({ value: 0 }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 1, window: 1000000, percent: 0 }, rateLimits: [], cost: { usd: 0 } } }))
  on('session.root', () => ({ value: '/repo' }))
  on('process.run', (_$, e) => {
    const args = e.argv.slice(4)
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '' } })
    if (args[0] === 'rev-parse') return out('/repo\n')
    if (args[0] === 'status') return out(['## master', 'M  a.rb'].join('\0') + '\0')
    if (args[0] === 'diff' && args[1] === 'HEAD' && args[2] === '--numstat') return out('1\t1\ta.rb\0')
    if (args[0] === 'diff' && args[1] === 'HEAD') return out('@@ -1 +1 @@\n-old\n+new\n')
    if (args[0] === 'log') return out('Add thing\n')
    return out('a.rb | 2 +-\n')
  })
  on('model.complete', () => ({ value: { isAnswered: true, text: '"Update a.rb"', usage: {} } }))
  const ui = await $.ui.mount({ plugin: 'agent-lens', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-changes' })
  await ui.press({ key: 'draft-msg' })
  expect(await ui.find({ type: 'Input', value: 'Update a.rb' })).toBeDefined()
  await ui.press({ key: 'df-a.rb' })
  expect(await ui.find({ type: 'Code', source: /\+new/ })).toBeDefined()
  await ui.press({ key: 'diff-back' })
  expect(await ui.find({ type: 'Button', key: 'df-a.rb' })).toBeDefined()
  await ui.unmount()
})

test('Flow tab: the plan published through the tool renders by level', async ($, on) => {
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('clock.now', () => ({ value: 0 }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 1, window: 1000000, percent: 0 }, rateLimits: [], cost: { usd: 0 } } }))
  const res = await $.tool.call({
    tool: 'mcp__agent-lens__plan',
    goal: 'New tab that shows how I think',
    clarity: 6,
    assumptions: ['in agent-lens, not in Rails'],
    questions: [{ ask: 'Static or live?', why: 'live needs re-calls' }],
    better_prompt: 'Add a Flow tab to agent-lens…',
    steps: [
      { id: 'a', title: 'read the mod', tier: 'haiku', status: 'done' },
      { id: 'b', title: 'read the API', tier: 'haiku', status: 'run' },
      { id: 'c', title: 'design', tier: 'opus', after: ['a', 'b'] },
    ],
    savings: ['reads in parallel'],
  } as never)
  expect(String(res.result)).toMatch(/3 steps/)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'agent-lens', surface, ...PANE })
    await ui.press({ key: 'tab-think' })
    expect(await ui.find({ type: 'Text', text: /New tab that shows/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'fold-plan' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /┬─/ })).toBeDefined()
    // Only the active step (b, "run") is open by default; a click closes it.
    expect(await ui.find({ type: 'Text', text: /in parallel with: read the mod/ })).toBeDefined()
    await ui.press({ key: 'fold-p-b' })
    expect(await ui.find({ type: 'Text', text: /in parallel with: read the mod/ })).toBeUndefined()
    await ui.press({ key: 'fold-p-b' })
    expect(await ui.find({ type: 'Text', text: /Static or live/ })).toBeDefined()
    await ui.unmount()
  }
})
