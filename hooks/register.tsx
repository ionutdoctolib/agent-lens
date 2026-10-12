import { atom, read, update } from 'claude-code'
import type { Engine, HookFor, Register, RenderChildren } from 'claude-code'

import type { Answer, Change, Diff, GitNote, Memory, MemoryMeta, MemoryUse, MemoryView, Miss, Plan, PlanStep, Repo, Retro, Step, StepView, Tab, Totals, Validation, Worker } from '../types'
import { branchLabel, cleanMessage, clip, outcomeOf, parseNumstat, parseStatus, syncSteps, withCounts } from './changes'
import { PLAN_DESCRIPTION, PLAN_RULE, PLAN_SCHEMA, PLAN_TOOL, PLAN_TOOL_ID, answersMessage, layers, normalizePlan } from './plan'
import { INDEX, memoriesView } from './memories-tab'
import { workersView } from './workers-tab'
import { retroMessage, retroOf } from './retro'
import { namesIn, parseIndex, parseMemory, projectSlug } from './memories'
import { ESCALATE, ESCALATE_RULE, MODEL_IDS, VALIDATOR, VALIDATOR_PROMPT, addMiss, classify, costOf, escalationOf, learned, pickSubagentModel, tagged, tierOf, verdictOf, wordsOf } from './router'
import type { Tier } from './router'

const PANE = 'agent-lens'

const steps = atom({ plugin: 'agent-lens', key: 'steps' } as const, [])
const workers = atom({ plugin: 'agent-lens', key: 'workers' } as const, [])
const skillsUsed = atom({ plugin: 'agent-lens', key: 'skillsUsed' } as const, {})
const toolCounts = atom({ plugin: 'agent-lens', key: 'toolCounts' } as const, {})
const prompt = atom({ plugin: 'agent-lens', key: 'prompt' } as const, '')
const tab = atom({ plugin: 'agent-lens', key: 'tab' } as const, 'think' as Tab)
// What is open/closed in Flow and Workers, by key; a missing key = the row's default state.
const retro = atom({ plugin: 'agent-lens', key: 'retro' } as const, null as Retro | null)
const folds = atom({ plugin: 'agent-lens', key: 'fold' } as const, {} as Record<string, boolean>)
const routing = atom({ plugin: 'agent-lens', key: 'routing' } as const, true)
const edited = atom({ plugin: 'agent-lens', key: 'edited' } as const, [])
const validations = atom({ plugin: 'agent-lens', key: 'validations' } as const, [])
const totals = atom({ plugin: 'agent-lens', key: 'totals' } as const, { steps: 0, tokensIn: 0, tokensOut: 0, cacheRead: 0 } as Totals)
const turnTier = atom({ plugin: 'agent-lens', key: 'turnTier' } as const, { tier: 'opus', why: 'default' } as { tier: Tier; why: string })
const hasGraph = atom({ plugin: 'agent-lens', key: 'hasGraph' } as const, false)
const graphFirst = atom({ plugin: 'agent-lens', key: 'graphFirst' } as const, true)
const graphSeen = atom({ plugin: 'agent-lens', key: 'graphSeen' } as const, false)
const changes = atom({ plugin: 'agent-lens', key: 'changes' } as const, [] as Change[])
const repo = atom({ plugin: 'agent-lens', key: 'repo' } as const, { top: '', branch: '', loaded: false } as Repo)
const commitMsg = atom({ plugin: 'agent-lens', key: 'commitMsg' } as const, '')
const gitNote = atom({ plugin: 'agent-lens', key: 'gitNote' } as const, null as GitNote | null)
const diff = atom({ plugin: 'agent-lens', key: 'diff' } as const, null as Diff | null)
const drafting = atom({ plugin: 'agent-lens', key: 'drafting' } as const, false)
const syncing = atom({ plugin: 'agent-lens', key: 'syncing' } as const, false)
const stepView = atom({ plugin: 'agent-lens', key: 'stepView' } as const, null as StepView | null)
const memories = atom({ plugin: 'agent-lens', key: 'memories' } as const, [] as Memory[])
const memMeta = atom({ plugin: 'agent-lens', key: 'memMeta' } as const, { dir: '', loaded: false, context: [], remember: [], recalls: [] } as MemoryMeta)
const memUse = atom({ plugin: 'agent-lens', key: 'memUse' } as const, {} as Record<string, MemoryUse>)
const memView = atom({ plugin: 'agent-lens', key: 'memView' } as const, null as MemoryView | null)
const memType = atom({ plugin: 'agent-lens', key: 'memType' } as const, 'all')
const plan = atom({ plugin: 'agent-lens', key: 'plan' } as const, null as Plan | null)
const answers = atom({ plugin: 'agent-lens', key: 'answers' } as const, {} as Record<string, Answer>)
const busy = atom({ plugin: 'agent-lens', key: 'busy' } as const, false)
const misses = atom({ plugin: 'agent-lens', key: 'misses' } as const, [] as Miss[])
const planFirst = atom({ plugin: 'agent-lens', key: 'planFirst' } as const, true)
const planAsked = atom({ plugin: 'agent-lens', key: 'planAsked' } as const, false)
const turnAt = atom({ plugin: 'agent-lens', key: 'turnAt' } as const, 0)

const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])

// ANSI colors by name: Omarchy writes the terminal's 16-color palette
// (ghostty/alacritty/kitty) on every theme change, so the sidebar follows it on its own.
const C = {
  accent: 'green',
  model: 'cyan',
  ok: 'green',
  run: 'yellow',
  bad: 'red',
  info: 'blue',
  graph: 'cyan',
} as const

// Opus in the terminal's default color (bold), no pink.
const TIER_COLOR: Record<Tier, string | undefined> = { opus: undefined, sonnet: 'blue', haiku: 'green' }
const modelColor = (model: string) => TIER_COLOR[tierOf(model) ?? 'opus']

const short = (model: string) => model.replace(/^claude-/, '').replace(/-\d{8}$/, '')

const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n))

// "2h13m" until the limit window resets
const until = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60000))

  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m` : `${m}m`
}

const WINDOWS: Record<string, string> = { five_hour: '5h', seven_day: '7 days', spend_limit: 'budget' }

// green, yellow 20 points before the threshold, red from the threshold
const pctColor = (pct: number, bad: number) => (pct >= bad ? C.bad : pct >= bad - 20 ? C.run : C.ok)

const secs = (ms: number) => (ms >= 60000 ? `${Math.floor(ms / 60000)}m${Math.round((ms % 60000) / 1000)}s` : `${Math.round(ms / 1000)}s`)

// "Read, Read, Read, Bash" → "Read×3 Bash"
export const tally = (names: readonly string[]) => {
  const counts = new Map<string, number>()
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1)

  return [...counts].map(([name, n]) => (n > 1 ? `${name}×${n}` : name)).join(' ')
}

// What a tool does, briefly: the main input field (command, file, search), otherwise JSON.
export const brief = (input: unknown) => {
  const o = (input ?? {}) as Record<string, unknown>
  const main = ['command', 'file_path', 'pattern', 'query', 'description', 'prompt', 'url', 'skill'].map(key => o[key]).find(v => typeof v === 'string')

  return String(main ?? JSON.stringify(input) ?? '').slice(0, 400)
}

// Each tool of the step gets the output of the first unconsumed transcript call with the same tool + input.
export const pairUses = <U extends { tool: string; brief: string }, D extends U & { output?: string; isError?: boolean }>(uses: U[], done: D[]) => {
  const taken = new Set<number>()

  return uses.map(u => {
    const i = done.findIndex((d, n) => !taken.has(n) && d.tool === u.tool && d.brief === u.brief)
    if (i < 0) return { ...u }
    taken.add(i)

    return { ...u, output: done[i]?.output ? clip(done[i].output, 3000) : undefined, isError: done[i]?.isError }
  })
}

// Learned failures belong to the project and carry over from one session to the next.
const missKey = async ($: Engine) => `misses:${await $.session.root()}`

const recordMiss = async ($: Engine, words: string[] | undefined, tier: Tier | undefined) => {
  if (!words?.length || !tier || tier === 'opus') return
  const list = addMiss(await read($, misses), { words, tier, at: await $.clock.now() })
  await update($, misses, () => list)
  await $.store.set(await missKey($), list)
}

const usd = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`

const toolLabel = (tool: string) => tool.replace(/^mcp__(?:plugin_)?([^_]+(?:_[^_]+)*?)__/, '$1:')

const git = ($: Engine, top: string, args: string[], timeoutMs = 20_000) =>
  $.process.run(['git', '--no-optional-locks', '-C', top, ...args], { timeoutMs, env: { GIT_TERMINAL_PROMPT: '0' } })

// Rendering doesn't run processes: the status is read here and lands in atoms.
const refreshChanges = async ($: Engine) => {
  let snap: { top: string; branch: string; list: Change[] } | null = null
  try {
    const found = await git($, await $.session.root(), ['rev-parse', '--show-toplevel'])
    const top = found.stdout.trim()
    const status = found.exitCode === 0 ? await git($, top, ['status', '--porcelain=v1', '-b', '-z', '--untracked-files=all']) : null
    if (status?.exitCode === 0) {
      const parsed = parseStatus(status.stdout)
      const diff = await git($, top, ['diff', 'HEAD', '--numstat', '-z'])
      snap = { top, branch: parsed.branch, list: withCounts(parsed.changes, diff.exitCode === 0 ? parseNumstat(diff.stdout) : {}) }
    }
  } catch {
    snap = null
  }
  await update($, repo, () => ({ top: snap?.top ?? '', branch: snap?.branch ?? '', loaded: true }))
  await update($, changes, () => snap?.list ?? [])
}

const stage = async ($: Engine, top: string, paths: string[] | 'all') =>
  outcomeOf(await git($, top, paths === 'all' ? ['add', '-A'] : ['add', '--', ...paths]))

// ponytail: `restore --staged` needs a HEAD; it fails before the repo's first commit
const unstage = async ($: Engine, top: string, paths: string[] | 'all') =>
  outcomeOf(await git($, top, ['restore', '--staged', '--', ...(paths === 'all' ? ['.'] : paths)]))

// No --no-verify: the repo's hooks run, and their failure shows in the note.
const commit = async ($: Engine, top: string, message: string) => outcomeOf(await git($, top, ['commit', '-m', message]))

// Any git action of the tab: runs, keeps the result note, then re-reads the status.
const gitAct = async ($: Engine, run: (top: string) => Promise<GitNote>) => {
  const { top } = await read($, repo)
  if (!top) return
  const note = await run(top)
  await update($, gitNote, () => note)
  await refreshChanges($)
}

// Fetch, then only the missing steps (pull --ff-only / push) on the current branch. A timeout (network, SSH key
// with a passphrase) throws: it ends up in the note as a failure and doesn't block the button.
const syncRepo = async ($: Engine) => {
  const { top } = await read($, repo)
  if (!top || (await read($, syncing))) return
  await update($, syncing, () => true)
  let note: GitNote
  try {
    const fetched = outcomeOf(await git($, top, ['fetch', '--prune'], 120_000))
    await refreshChanges($)
    const branch = branchLabel((await read($, repo)).branch)
    const steps = fetched.ok ? syncSteps(branch) : []
    note = !fetched.ok ? fetched : branch.gone ? { ok: false, text: 'branch is gone from the remote (deleted after merge?)' } : { ok: true, text: 'up to date with the remote' }
    for (const step of steps) {
      const res = await git($, top, step, 120_000)
      note = res.exitCode === 0 ? { ok: true, text: `${step[0]} ✓` } : outcomeOf(res)
      if (!note.ok) break
    }
    if (steps.length > 1 && note.ok) note = { ok: true, text: 'pull + push ✓' }
  } catch (err) {
    note = { ok: false, text: `sync: ${err instanceof Error ? err.message : String(err)}` }
  } finally {
    await update($, syncing, () => false)
  }
  await update($, gitNote, () => note)
  await refreshChanges($)
}

// An opened step: tool outputs don't exist at the end of the step (they arrive later), so they are looked up
// in the transcript on open, by tool + input.
const openStep = async ($: Engine, s: Step) => {
  const messages = await $.session.messages(s.agentId ? { agentId: s.agentId } : {})
  const done = messages.flatMap(m => m.toolUses).map(u => ({ tool: u.tool, brief: brief(u.input), output: u.text, isError: u.isError }))
  await update($, stepView, () => ({ id: s.id, title: `${short(s.model)} #${s.index}`, answer: s.answer, uses: pairUses(s.uses ?? [], done) }))
}

// A file's diff against HEAD (index + working tree). A new, untracked file is compared with /dev/null;
// `diff --no-index` exits with 1 when there are differences, so 0 and 1 both count as success.
const openDiff = async ($: Engine, c: Change) => {
  const { top } = await read($, repo)
  if (!top) return
  const res = await git($, top, c.code === '?' ? ['diff', '--no-index', '--', '/dev/null', c.path] : ['diff', 'HEAD', '--', c.path])
  await update($, diff, () => ({ path: c.path, text: clip(res.exitCode <= 1 ? res.stdout : res.stderr, 90_000) }))
}

// The commit message from the staged files (not everything modified), written by Haiku in the style of
// the repo's recent subjects. A single line: the commit field is single-line.
const draftMessage = async ($: Engine) => {
  const { top } = await read($, repo)
  if (!top || (await read($, drafting))) return
  if (!(await read($, changes)).some(c => c.staged)) {
    return void (await update($, gitNote, () => ({ ok: false, text: 'Nothing staged: tick the files for the message.' })))
  }
  await update($, drafting, () => true)
  try {
    const [stat, patch, recent] = await Promise.all([
      git($, top, ['diff', '--cached', '--stat']),
      git($, top, ['diff', '--cached']),
      git($, top, ['log', '-8', '--format=%s']),
    ])
    const res = await $.model.complete({
      model: 'haiku',
      effort: 'low',
      maxTokens: 200,
      timeoutMs: 30_000,
      prompt: `Write a git commit message for the staged changes.
Rules: one line, imperative, at most 72 characters, same language and style as the recent subjects; no quotes, no trailing period, no explanation.

Recent subjects:
${recent.stdout}
Files:
${stat.stdout}
Diff:
${clip(patch.stdout, 12_000)}`,
    })
    const text = res.isAnswered ? cleanMessage(res.text) : ''
    if (text) {
      await update($, commitMsg, () => text)
      await update($, gitNote, () => null)
    } else {
      await update($, gitNote, () => ({ ok: false, text: `Haiku gave no message${res.isAnswered ? '' : ` (${res.reason})`}.` }))
    }
  } finally {
    await update($, drafting, () => false)
  }
}

// Answers from the Flow tab go to the model as soon as there is a way: in the running turn,
// attached to the next tool result (without interrupting it), otherwise as a user prompt.
const takeAnswers = async ($: Engine) => {
  const pending = Object.entries(await read($, answers)).filter(([, a]) => a.state === 'pending')
  if (!pending.length) return ''
  await update($, answers, all => {
    const next = { ...all }
    for (const [ask] of pending) if (next[ask]?.state === 'pending') next[ask] = { ...next[ask], state: 'sent' }
    return next
  })

  return answersMessage(pending.map(([ask, a]) => ({ ask, text: a.text })))
}

const submitAnswers = async ($: Engine) => {
  const text = await takeAnswers($)
  if (!text) return
  await update($, busy, () => true)
  void $.prompt.submit({ text, asUser: true })
}

const answer = async ($: Engine, ask: string, text: string) => {
  if (!text.trim()) return
  await update($, answers, all => ({ ...all, [ask]: { text: text.trim(), state: 'pending' as const } }))
  if (!(await read($, busy))) await submitAnswers($)
}

const commitStaged = async ($: Engine) => {
  const message = (await read($, commitMsg)).trim()
  const list = await read($, changes)
  if (!message) return void (await update($, gitNote, () => ({ ok: false, text: 'Write a commit message.' })))
  if (!list.some(c => c.staged)) return void (await update($, gitNote, () => ({ ok: false, text: 'Nothing staged: tick files or [stage all].' })))
  await gitAct($, async top => {
    const res = await commit($, top, message)
    if (res.ok) await update($, commitMsg, () => '')

    return res
  })
}

// After each main-loop turn: the execution analysis (what could have been delegated more cheaply) goes into Flow.
const runRetro = async ($: Engine, turnId: string) => {
  const all = await read($, steps)
  const since = await read($, turnAt)
  const turnWorkers = (await read($, workers)).filter(w => w.startedAt >= since && w.agentId)
  const ids = new Set(turnWorkers.map(w => w.agentId))
  const main = all.filter(s => s.turnId === turnId && !s.agentId)
  if (!main.length) return
  const r = retroOf(turnId, await $.clock.now(), main, turnWorkers, all.filter(s => s.agentId && ids.has(s.agentId)), await read($, plan))
  await update($, retro, () => r)
  if (!r.findings.length) return
  $.ui.toast(`Retrospective: ${r.findings.length} possible optimizations${r.saving > 0 ? ` · ~${usd(r.saving)}` : ''}`)
  // The line enters the conversation, like the validator's verdict: the model's next turn reads it.
  await $.session.append({ message: { type: 'user', content: [{ type: 'text', text: retroMessage(r) }] } })
}

// The "Memories" tab: the current project's auto-memory as a graph, and how it reaches the model.
// The directory comes from /context (the AutoMem file the engine actually loads); without it, the project slug.
const memoryDir = async ($: Engine, context: MemoryMeta['context']) => {
  const auto = context.find(f => f.type === 'AutoMem')
  if (auto) return auto.path.slice(0, auto.path.lastIndexOf('/'))
  const base = await $.process.run(['sh', '-c', 'printf %s "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"'])

  return `${base.stdout}/projects/${projectSlug(await $.session.root())}/memory`
}

const loadMemories = async ($: Engine) => {
  try {
    const usage = await $.session.usage({ breakdown: 'summary', columns: 60 })
    const context = (usage.context.breakdown?.memoryFiles ?? []).map(f => ({ path: f.path, type: f.type, tokens: f.tokens }))
    const dir = await memoryDir($, context)
    const entries = (await $.fs.list(dir).catch(() => [])).filter(f => f.kind === 'file' && f.name.endsWith('.md'))
    const index = entries.some(f => f.name === INDEX) ? parseIndex(await $.fs.read(`${dir}/${INDEX}`)) : {}
    const list: Memory[] = []
    for (const f of entries.filter(f => f.name !== INDEX)) {
      const m = parseMemory(f.name, await $.fs.read(`${dir}/${f.name}`))
      list.push({ name: m.name, file: f.name, type: m.type, description: m.description, links: m.links, indexed: f.name in index, hook: index[f.name]?.hook ?? '', size: f.size, mtimeMs: f.mtimeMs })
    }
    // The remember plugin keeps its log in the project (.remember/); the days are folded into a single row.
    const root = await $.session.root()
    const rem = (await $.fs.list(`${root}/.remember`).catch(() => [])).filter(f => f.kind === 'file' && f.name.endsWith('.md'))
    const days = rem.filter(f => f.name.startsWith('today-'))
    const remember = [
      ...rem.filter(f => !f.name.startsWith('today-')).map(f => ({ name: f.name, size: f.size })),
      ...(days.length ? [{ name: `today-*.md ×${days.length}`, size: days.reduce((n, f) => n + f.size, 0) }] : []),
    ]
    await update($, memories, () => list)
    await update($, memMeta, meta => ({ ...meta, dir, loaded: true, context, remember }))
  } catch {
    await update($, memMeta, meta => ({ ...meta, loaded: true }))
  }
}

const bump = ($: Engine, names: string[], key: keyof MemoryUse) =>
  update($, memUse, use => {
    const next = { ...use }
    for (const n of names) next[n] = { ...(next[n] ?? { read: 0, write: 0, recalled: 0 }), [key]: (next[n]?.[key] ?? 0) + 1 }

    return next
  })

const openMemory = async ($: Engine, name: string) => {
  const { dir } = await read($, memMeta)
  const m = (await read($, memories)).find(x => x.name === name)
  if (!m) return
  const text = await $.fs.read(`${dir}/${m.file}`).catch(() => '')
  await update($, memView, () => ({ name, body: clip(parseMemory(m.file, text).body, 6000) }))
}

// Per tool, with a matcher: the mod already has a matcher-less `tool.call`, and a second one is rejected.
const trackMemory: HookFor<'tool.call'> = async ($, e, next) => {
  const { dir } = await read($, memMeta)
  if (!dir) return next(e)
  const input = e as { file_path?: string; command?: string }
  const list = await read($, memories)
  const path = input.file_path ?? ''
  const isWrite = /^(Write|Edit)$/.test(String(e.tool))
  if (path.startsWith(`${dir}/`)) {
    const file = path.slice(dir.length + 1)
    const name = file === INDEX ? INDEX : (list.find(m => m.file === file)?.name ?? file.replace(/\.md$/, ''))
    await bump($, [name], isWrite ? 'write' : 'read')
  } else if (String(e.tool) === 'Bash' && input.command?.includes(dir)) {
    await bump($, namesIn(input.command, list), 'read')
  }
  const res = await next(e)
  if (isWrite && path.startsWith(`${dir}/`)) void loadMemories($)

  return res
}

export const register: Register = on => {
  // Memory usage: reads and writes through tools (including subagents'), recalls through attachments.
  on('tool.call', { tool: 'Read' }, trackMemory)
  on('tool.call', { tool: 'Write' }, trackMemory)
  on('tool.call', { tool: 'Edit' }, trackMemory)
  on('tool.call', { tool: 'Bash' }, trackMemory)

  on('prompt.attachment', async ($, e, next) => {
    const res = await next(e)
    const text = (e as { text?: string }).text ?? ''
    // A stop hook's feedback (quality gates, checks) is mechanical work: it doesn't inherit Opus.
    if (e.origin?.kind === 'hook' && e.origin.event === 'Stop') {
      await update($, turnTier, cur => (cur.why === 'picked by you' ? cur : { tier: 'sonnet', why: 'hook feedback' }))
    }
    if (/memor/i.test(e.type) && text) {
      const names = namesIn(text, await read($, memories))
      await update($, memMeta, meta => ({ ...meta, recalls: [...meta.recalls, { type: e.type, names }].slice(-20) }))
      if (names.length) await bump($, names, 'recalled')
    }

    return res
  })

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'lens', description: 'Open the Agent Lens sidebar' })
    await $.agent.register({
      name: 'validator',
      description: 'Final Opus validation of a turn with changes (started only by Agent Lens).',
      prompt: VALIDATOR_PROMPT,
      tools: ['Read', 'Bash'],
      model: 'opus',
    })
    await $.tool.register({ name: PLAN_TOOL, description: PLAN_DESCRIPTION, inputSchema: PLAN_SCHEMA, isDeferred: false })
    void refreshChanges($)
    void loadMemories($)
    const saved = await $.store.get(await missKey($))
    await update($, misses, () => (Array.isArray(saved) ? (saved as Miss[]) : []))
    await update($, hasGraph, () => false)
    if (await $.fs.exists('.codegraph')) await update($, hasGraph, () => true)
    void $.ui.open({ id: PANE, title: 'Agent Lens' })

    return next(e)
  })

  // Only the mod starts the validator, not the main model.
  on('agent.offer', { agent: 'agent-lens:validator' }, () => ({ isOffered: false }))

  on('command.run', { command: 'lens' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Agent Lens', focus: true })

    return { text: 'Agent Lens opened.' }
  })

  // A prompt sent by a human counts as "requested": the panel settles at any width,
  // and if it was closed by hand, it comes back. On an already open id it's a no-op.
  on('prompt.submit', async ($, e, next) => {
    void $.ui.open({ id: PANE, title: 'Agent Lens' })
    const tag = tagged(e.text)
    const now = await $.clock.now()
    if (!e.origin || e.origin.kind === 'composer' || e.origin.kind === 'bridge') {
      const guess = classify(tag.text)
      const known = await read($, misses)
      await update($, turnTier, () => (tag.tier ? { tier: tag.tier, why: 'picked by you' } : (learned(tag.text, guess.tier, known) ?? guess)))
      await update($, graphSeen, () => false)
      await update($, planAsked, () => false)
      await update($, turnAt, () => now)
      await update($, plan, () => null)
      await update($, answers, () => ({}))
      await update($, folds, () => ({}))
      await update($, retro, () => null)
    }
    await update($, busy, () => true)
    await update($, prompt, () => tag.text)
    await update($, edited, () => [])

    return next(tag.tier ? { ...e, text: tag.text } : e)
  })

  // The mod's rules go into the system prompt: downward delegation when routing is on,
  // CodeGraph before Grep/Read when the project has an index.
  on('prompt.compose', async ($, e, next) => {
    const res = await next(e)
    const extra = []
    if (await read($, routing)) {
      extra.push({
        id: 'agent-lens:delegate',
        scope: 'session' as const,
        text: `Whenever you can, delegate to a lower model through Agent with the model parameter: haiku for searches, inventories and code reading; sonnet for mechanical changes with a clear spec (renames, translations, tests following a pattern, precisely described point fixes). Keep on the current model only understanding the problem, design decisions and verifying the result. Don't delegate what you would solve in one or two tool calls. If a subagent replies "${ESCALATE} …", don't retry the task on the same model: take it over yourself or redelegate one tier up.`,
      })
    }
    if (await read($, planFirst)) extra.push({ id: 'agent-lens:plan', scope: 'session' as const, text: PLAN_RULE })
    if ((await read($, hasGraph)) && (await read($, graphFirst))) {
      extra.push({
        id: 'agent-lens:codegraph',
        scope: 'session' as const,
        text: 'The project has a CodeGraph index (.codegraph/). For any question about code and before any change, call codegraph_explore first (verbatim source, callers, blast radius); use Grep, Glob and Read only for what it does not cover. Tell subagents to use it too.',
      })
    }
    extra.push({
      id: 'agent-lens:language',
      scope: 'session' as const,
      text: "Reply to the user in the language of their latest prompt (Romanian prompt → Romanian reply, English prompt → English reply), including the fields you pass to the plan tool. Keep code, identifiers and commands as they are.",
    })

    return extra.length ? { sections: [...res.sections, ...extra] } : res
  })

  on('skill.prompt', async ($, e, next) => {
    await update($, skillsUsed, used => ({ ...used, [e.skill]: (used[e.skill] ?? 0) + 1 }))

    return next(e)
  })

  // The model's plan lands in the Flow tab; a republish keeps its place and bumps the revision.
  // The literal (not the constant) so the validator sees the matcher; `as never` until the MCP types generated on load include the tool.
  on('tool.call', { tool: 'mcp__agent-lens__plan' as never }, async ($, e) => {
    const fresh = normalizePlan(e, await $.clock.now())
    await update($, plan, old => ({ ...fresh, revision: old ? old.revision + 1 : 0 }))

    return { result: `Plan shown in Agent Lens · Flow (${fresh.steps.length} steps).` }
  })

  on('tool.call', async ($, e, next) => {
    const name = toolLabel(String(e.tool))
    await update($, toolCounts, counts => ({ ...counts, [name]: (counts[name] ?? 0) + 1 }))
    if (name.startsWith('codegraph:')) await update($, graphSeen, () => true)
    // The miniplan comes before any tool: the first tool of a turn without a published plan is denied once.
    if (!e.agentId && String(e.tool) !== PLAN_TOOL_ID && (await read($, planFirst)) && !(await read($, plan)) && !(await read($, planAsked))) {
      await update($, planAsked, () => true)

      return { deny: `Publish the miniplan with ${PLAN_TOOL_ID} first: what you understood (goal) and how you will act (approach), with the steps. Then repeat the tool.` }
    }
    // The turn's first classic search, without CodeGraph before it, is denied once; the second goes through.
    if (!e.agentId && /^(Grep|Glob)$/.test(String(e.tool)) && (await read($, hasGraph)) && (await read($, graphFirst)) && !(await read($, graphSeen))) {
      await update($, graphSeen, () => true)

      return { deny: 'The project has a CodeGraph index: start with codegraph_explore (verbatim source and callers in a single call). If it does not cover what you are looking for, repeat Grep/Glob.' }
    }
    const path = (e as { file_path?: string; notebook_path?: string }).file_path ?? (e as { notebook_path?: string }).notebook_path
    if (EDIT_TOOLS.has(String(e.tool)) && path) {
      const running = await read($, validations)
      const isValidator = running.some(v => v.agentId === e.agentId)
      if (!isValidator) await update($, edited, files => (files.includes(path) ? files : [...files, path]))
      // A FAIL verdict on a file edited afterwards is stale, even if the turn (on Opus) doesn't revalidate.
      if (!isValidator) {
        await update($, validations, list =>
          list.map(v => (v.status === 'fail' && v.files.includes(path) ? { ...v, status: 'stale' as const } : v)),
        )
      }
    }
    if (e.agentId) {
      await update($, workers, list =>
        list.map(w => (w.agentId === e.agentId ? { ...w, tools: w.tools + 1 } : w)),
      )
    }

    const res = await next(e)
    if (e.agentId || res.deny !== undefined || res.isError) return res
    const text = await takeAnswers($)

    return text ? { ...res, context: [...(res.context ?? []), text] } : res
  })

  // The main loop runs on the model chosen for this turn (Opus by default); subagents get their model decided at spawn.
  on('turn.step', async function* ($, e, next) {
    if (!e.agentId && (await read($, routing))) {
      const want = MODEL_IDS[(await read($, turnTier)).tier]
      if (e.model !== want) e = { ...e, model: want }
    }
    const id = `${e.turnId}:${e.agentId ?? 'main'}:${e.index}`
    const step: Step = {
      id,
      turnId: e.turnId,
      index: e.index,
      model: e.model,
      effort: e.effort === undefined ? undefined : String(e.effort),
      agentId: e.agentId,
      isDone: false,
      tools: [],
      tokensIn: 0,
      tokensOut: 0,
      cacheRead: 0,
      stop: null,
      answer: '',
      uses: [],
    }
    await update($, steps, list => [...list, step].slice(-60))

    const res = yield* next(e)

    const usage = res.usage
    const cost = usage ? costOf(tierOf(usage.model ?? e.model) ?? 'opus', usage) : 0
    const opusCost = usage ? costOf('opus', usage) : 0
    await update($, steps, list =>
      list.map(s =>
        s.id === id
          ? {
              ...s,
              isDone: true,
              model: usage?.model ?? s.model,
              tools: res.toolUses.map(u => toolLabel(u.name)),
              tokensIn: usage ? usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens : 0,
              tokensOut: usage?.output_tokens ?? 0,
              cacheRead: usage?.cache_read_input_tokens ?? 0,
              cost,
              opusCost,
              stop: res.stopReason,
              answer: clip(res.answer, 4000),
              uses: res.toolUses.map(u => ({ tool: u.name, brief: brief(u.input) })),
            }
          : s,
      ),
    )

    if (usage) {
      await update($, totals, t => ({
        steps: t.steps + 1,
        tokensIn: t.tokensIn + usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens,
        tokensOut: t.tokensOut + usage.output_tokens,
        cacheRead: t.cacheRead + usage.cache_read_input_tokens,
        cost: (t.cost ?? 0) + cost,
        opusCost: (t.opusCost ?? 0) + opusCost,
      }))
    }

    return res
  })

  on('agent.spawn', async ($, e, next) => {
    const id = e.tool_use_id || `${e.subagentType}:${await $.clock.now()}`
    const isRoutable = !e.fork && !e.workflow && e.subagentType !== VALIDATOR && (await read($, routing))
    const task = `${e.description} ${e.prompt.slice(0, 200)}`
    const asked = clip(e.prompt, 1500)
    const picked = isRoutable ? pickSubagentModel(e.subagentType, e.description, e.model) : undefined
    // What already failed on this model goes up a tier, even if the main model asked for another.
    const route = picked && (learned(task, tierOf(picked.model) ?? 'opus', await read($, misses)) ?? picked)
    const routeTier = route && tierOf(route.model)
    if (route) e = { ...e, model: route.model, prompt: routeTier && routeTier !== 'opus' ? e.prompt + ESCALATE_RULE : e.prompt }
    const worker: Worker = {
      id,
      type: e.subagentType,
      description: e.description,
      asked: e.model,
      route: route ? `${route.model}: ${route.why}` : e.subagentType === VALIDATOR ? 'opus: final validation' : undefined,
      model: e.model ?? e.parentModel,
      parentModel: e.parentModel,
      isBackground: Boolean(e.background),
      status: 'running',
      startedAt: await $.clock.now(),
      tools: 0,
      words: wordsOf(task),
      prompt: asked,
    }
    await update($, workers, list => [...list, worker].slice(-30))

    const res = await next(e)

    await update($, workers, list =>
      list.map(w =>
        w.id === id
          ? res.deny !== undefined
            ? { ...w, status: 'denied' as const }
            : { ...w, agentId: res.agentId, model: res.model }
          : w,
      ),
    )

    return res
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      void refreshChanges($)
      await runRetro($, e.turnId)
      await update($, busy, () => false)
      await submitAnswers($)
    }
    const pending = (await read($, validations)).find(v => v.agentId === e.agentId)
    if (pending) {
      const verdict = verdictOf(e.answer)
      await update($, validations, list =>
        list.map(v => (v.agentId === pending.agentId ? { ...v, status: verdict.isOk ? ('ok' as const) : ('fail' as const), summary: verdict.line } : v)),
      )
      $.ui.toast(`Opus validation: ${verdict.line}`)
      if (!verdict.isOk) await recordMiss($, pending.words, pending.tier)
      // The line enters the conversation, so the model's next turn reads it.
      await $.session.append({
        message: { type: 'user', content: [{ type: 'text', text: `[Agent Lens · final Opus validation on ${pending.files.join(', ')}]\n${e.answer}` }] },
      })
    }

    const files = await read($, edited)
    const cheaper = (await read($, turnTier)).tier !== 'opus'
    if (!e.agentId && e.reason === 'answer' && files.length > 0 && cheaper && (await read($, routing))) {
      await update($, edited, () => [])
      const request = await read($, prompt)
      const failedTier = (await read($, turnTier)).tier
      const spawned = await $.agent.spawn({
        subagentType: VALIDATOR,
        description: 'Final Opus validation',
        prompt: `User request:\n${request}\n\nModified files:\n${files.join('\n')}`,
      })
      if (spawned.agentId) {
        const validation: Validation = { agentId: spawned.agentId, files, status: 'running', summary: '', words: wordsOf(request), tier: failedTier }
        await update($, validations, list => [...list, validation].slice(-10))
      }
    }

    if (e.agentId) {
      const escalated = escalationOf(e.answer ?? '')
      const worker = (await read($, workers)).find(w => w.agentId === e.agentId)
      if (escalated && worker) {
        $.ui.toast(`${worker.type} on ${short(worker.model)} asks for a higher model: ${escalated}`)
        await recordMiss($, worker.words, tierOf(worker.model))
      }
      await update($, workers, list =>
        list.map(w =>
          w.agentId === e.agentId
            ? {
                ...w,
                escalated,
                answer: e.answer ? clip(e.answer, 1500) : undefined,
                status: e.isAborted ? ('aborted' as const) : ('done' as const),
                durationMs: e.durationMs,
                tokensOut: e.usage?.output_tokens,
              }
            : w,
        ),
      )
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Input, Code } = $.ui.resolve(e)
    const isRouting = await read($, routing)
    const list = await read($, changes)
    const repoNow = await read($, repo)
    const message = await read($, commitMsg)
    const note = await read($, gitNote)
    const diffNow = await read($, diff)
    // Steps from before a reload have no `answer`/`uses`: their absence must not block the panel.
    const opened = await read($, stepView)
    const stepNow = opened && { ...opened, answer: opened.answer ?? '', uses: opened.uses ?? [] }
    const isDrafting = await read($, drafting)
    const planNow = await read($, plan)
    const answered = await read($, answers)
    const isSyncing = await read($, syncing)
    const tierNow = await read($, turnTier)
    const graphReady = await read($, hasGraph)
    const isGraphFirst = await read($, graphFirst)
    const lastCheck = (await read($, validations)).at(-1)
    const allSteps = await read($, steps)
    const allWorkers = await read($, workers)
    const used = await read($, skillsUsed)
    const counts = await read($, toolCounts)
    const lastPrompt = await read($, prompt)
    // A tab saved by an older version (Steps, Skills) falls back to Flow.
    const stored = String(await read($, tab))
    const current: Tab = ['think', 'changes', 'workers', 'memories'].includes(stored) ? (stored as Tab) : 'think'
    const foldNow = await read($, folds)
    const retroNow = await read($, retro)
    const sessionModel = await $.session.model()
    const sum = await read($, totals)
    const learnedNow = await read($, misses)
    const isPlanFirst = await read($, planFirst)
    const since = await read($, turnAt)
    const allChecks = await read($, validations)
    const { context, rateLimits } = await $.session.usage()
    const now = await $.clock.now()
    const room = Math.max(6, (e.viewport?.rows ?? 30) - 12)

    const mainSteps = allSteps.filter(s => !s.agentId)
    const last = mainSteps.at(-1)
    const turnId = last?.turnId
    const turnSteps = allSteps.filter(s => s.turnId === turnId || (s.agentId && allWorkers.some(w => w.agentId === s.agentId && w.status === 'running')))
    const tokensIn = turnSteps.reduce((n, s) => n + s.tokensIn, 0)
    const tokensOut = turnSteps.reduce((n, s) => n + s.tokensOut, 0)
    const cacheRead = turnSteps.reduce((n, s) => n + s.cacheRead, 0)
    const turnCost = turnSteps.reduce((n, s) => n + (s.cost ?? 0), 0)
    const turnOpus = turnSteps.reduce((n, s) => n + (s.opusCost ?? 0), 0)
    const saved = sum.opusCost ? Math.round((1 - (sum.cost ?? 0) / sum.opusCost) * 100) : 0
    const running = allWorkers.filter(w => w.status === 'running').length
    const workerType = (agentId: string) => allWorkers.find(w => w.agentId === agentId)?.type ?? 'worker'

    const header = (
      <Box flexDirection="column" borderStyle="round" borderColor={C.accent} paddingX={1}>
        <Box justifyContent="space-between">
          <Text bold color={C.accent}>◆ AGENT LENS</Text>
          <Text color={running ? C.run : C.ok}>{running ? `● ${running} worker${running > 1 ? 's' : ''}` : '○ idle'}</Text>
        </Box>
        <Text>
          <Text dimColor>model </Text>
          <Text bold color={C.model}>{short(last?.model ?? String(sessionModel ?? '—'))}</Text>
          {last?.effort && <Text dimColor> · effort </Text>}
          {last?.effort && <Text color={C.info}>{last.effort}</Text>}
        </Text>
        <Box justifyContent="space-between">
          <Text wrap="truncate-end">
            <Text dimColor>routing </Text>
            {isRouting ? (
              <Text>
                <Text bold color={TIER_COLOR[tierNow.tier]}>{tierNow.tier}</Text>
                <Text dimColor> ({tierNow.why}) · [haiku]/[sonnet] in the prompt</Text>
              </Text>
            ) : (
              <Text color={C.bad}>off: everything on the session model</Text>
            )}
          </Text>
          <Button key="routing" plain label={isRouting ? '[off]' : '[on]'} hotkey="r" onPress={() => update($, routing, v => !v)} />
        </Box>
        {graphReady && (
          <Box justifyContent="space-between">
            <Text wrap="truncate-end">
              <Text dimColor>codegraph </Text>
              {isGraphFirst ? <Text color={C.graph}>first, before Grep/Glob</Text> : <Text dimColor>free</Text>}
            </Text>
            <Button key="graph" plain label={isGraphFirst ? '[off]' : '[on]'} hotkey="g" onPress={() => update($, graphFirst, v => !v)} />
          </Box>
        )}
        <Box justifyContent="space-between">
          <Text wrap="truncate-end">
            <Text dimColor>miniplan </Text>
            {isPlanFirst ? <Text color={C.accent}>first in Flow: what I understand, how I act</Text> : <Text dimColor>off</Text>}
          </Text>
          <Button key="planfirst" plain label={isPlanFirst ? '[off]' : '[on]'} hotkey="n" onPress={() => update($, planFirst, v => !v)} />
        </Box>
        {lastCheck && (
          <Text wrap="truncate-end" dimColor={lastCheck.status === 'stale'} color={lastCheck.status === 'ok' ? C.ok : lastCheck.status === 'fail' ? C.bad : lastCheck.status === 'running' ? C.run : undefined}>
            {lastCheck.status === 'running'
              ? '● opus validation running…'
              : lastCheck.status === 'stale'
                ? '↻ stale verdict: files changed afterwards'
                : `${lastCheck.status === 'ok' ? '✓' : '✗'} ${lastCheck.summary}`}
          </Text>
        )}
        <Text dimColor>
          turn: {turnSteps.length} steps · {k(tokensIn)}↑ {k(tokensOut)}↓ · cache {tokensIn ? Math.round((cacheRead / tokensIn) * 100) : 0}%
        </Text>
        {/* API list prices: on a subscription this measures savings, not the bill. */}
        <Text wrap="truncate-end">
          <Text dimColor>turn cost </Text>
          <Text>{usd(turnCost)}</Text>
          <Text dimColor> · session </Text>
          <Text>{usd(sum.cost ?? 0)}</Text>
          <Text dimColor> / all on opus {usd(sum.opusCost ?? 0)} </Text>
          <Text color={saved > 0 ? C.ok : undefined}>({saved > 0 ? `−${saved}` : '0'}%)</Text>
        </Text>
        {learnedNow.length > 0 && (
          <Box justifyContent="space-between">
            <Text wrap="truncate-end">
              <Text dimColor>learned </Text>
              <Text color={C.run}>{learnedNow.length} failures</Text>
              <Text dimColor> on cheap models · similar tasks go up a tier</Text>
            </Text>
            <Button key="forget" plain label="[forget]" onPress={async () => { await update($, misses, () => []); await $.store.delete(await missKey($)) }} />
          </Box>
        )}
        {/* From /usage: the account's context and 5h / 7-day limits. */}
        <Box gap={2}>
          <Text wrap="truncate-end">
            <Text dimColor>context </Text>
            <Text color={pctColor(context.percent ?? 0, 85)}>{context.percent ?? '—'}%</Text>
            <Text dimColor> {k(context.tokens ?? 0)}/{k(context.window)}</Text>
          </Text>
          {rateLimits.filter(r => r.kind === 'five_hour' || r.kind === 'seven_day').map(r => (
            <Text key={`rl-${r.kind}`} wrap="truncate-end">
              <Text dimColor>{WINDOWS[r.kind]} </Text>
              <Text color={pctColor(r.percentUsed, 90)}>{r.percentUsed}%</Text>
              {r.resetsAt && <Text dimColor> · {until(Date.parse(r.resetsAt) - now)}</Text>}
            </Text>
          ))}
        </Box>
      </Box>
    )

    const tabs = (
      <Box gap={1}>
        {(
          [
            ['think', 'Flow', 'f'],
            ['changes', `Git ${list.length}`, 'c'],
            ['workers', `Workers ${allWorkers.length}`, 'w'],
            ['memories', 'Memories', 'e'],
          ] as [Tab, string, string][]
        ).map(([id, label, hotkey]) => (
          <Button
            key={`tab-${id}`}
            label={label}
            hotkey={hotkey}
            variant={current === id ? 'primary' : 'secondary'}
            onPress={() => {
              void update($, tab, () => id)
              if (id === 'changes') void refreshChanges($)
              if (id === 'memories') void loadMemories($)
            }}
          />
        ))}
      </Box>
    )

    const toolIcon = (name: string) =>
      name.startsWith('codegraph:') ? '◈' : /^(Read|Grep|Glob)$/.test(name) ? '⌕' : EDIT_TOOLS.has(name) ? '✎' : name === 'Bash' ? '$' : /^(Agent|Task)$/.test(name) ? '⤷' : name === 'Skill' ? '✦' : '•'
    const toolColor = (name: string) => (name.startsWith('codegraph:') ? C.graph : EDIT_TOOLS.has(name) ? C.run : name === 'Skill' ? C.info : undefined)
    const chips = (tools: string[]) => {
      const counts = new Map<string, number>()
      for (const name of tools) counts.set(name, (counts.get(name) ?? 0) + 1)

      return [...counts].map(([name, n]) => (
        <Text key={name} color={toolColor(name)} bold={name.startsWith('codegraph:')}>
          {toolIcon(name)} {name.replace(/^codegraph:(codegraph_)?/, 'graph:')}
          {n > 1 ? `×${n}` : ''}{' '}
        </Text>
      ))
    }

    const turnTools = turnSteps.flatMap(s => s.tools)
    const graphN = turnTools.filter(t => t.startsWith('codegraph:')).length
    const classicN = turnTools.filter(t => /^(Read|Grep|Glob)$/.test(t)).length
    const graphCells = graphN + classicN === 0 ? 0 : Math.round((graphN / (graphN + classicN)) * 10)
    const maxIn = Math.max(1, ...turnSteps.map(s => s.tokensIn))
    const turnWorkers = allWorkers.filter(w => w.startedAt >= since)

    // Everything foldable: sections, plan steps, execution steps. A missing key = the default state.
    const isOpen = (key: string, byDefault: boolean) => foldNow[key] ?? byDefault
    const toggle = (key: string, open: boolean) => void update($, folds, f => ({ ...f, [key]: open }))
    const section = (key: string, title: string, byDefault: boolean, body: () => RenderChildren, aside?: RenderChildren) => {
      const open = isOpen(key, byDefault)

      return (
        <Box key={`sec-${key}`} flexDirection="column">
          <Box justifyContent="space-between">
            <Button key={`fold-${key}`} plain label={`${open ? '▾' : '▸'} ${title}`} onPress={() => toggle(key, !open)} />
            {aside}
          </Box>
          {open && body()}
        </Box>
      )
    }

    // The Flow tab: how the model understood the request, the plan by level (steps on the same level
    // run in parallel: ┬ ├ └) and what was actually executed, step by step, each with its model.
    const TIER_ICON = { haiku: '⌕', sonnet: '✎', opus: '◆' } as const
    const TIER_JOB = { haiku: 'searches, reads, inventories', sonnet: 'mechanical changes with a clear spec', opus: 'me: understanding, decisions, verification' } as const
    const STATUS_MARK = { todo: ['○', undefined], run: ['●', C.run], done: ['✓', C.ok], skip: ['⊘', undefined] } as const
    const WORKER_COLOR = { running: C.run, done: C.ok, aborted: C.bad, denied: C.bad } as const
    const planLevels = planNow ? layers(planNow.steps) : []
    const mix = planNow ? (['haiku', 'sonnet', 'opus'] as const).map(t => [t, planNow.steps.filter(s => s.tier === t).length] as const) : []
    const doneN = planNow?.steps.filter(s => s.status === 'done' || s.status === 'skip').length ?? 0
    const clarityColor = (n: number) => (n >= 8 ? C.ok : n >= 5 ? C.run : C.bad)
    const skillList = Object.entries(used).sort((a, b) => b[1] - a[1])
    const pad = '       '

    const planStep = (s: PlanStep, level: PlanStep[], li: number, si: number) => {
      const [mark, markColor] = STATUS_MARK[s.status]
      const branch = level.length === 1 ? '──' : si === 0 ? '┬─' : si === level.length - 1 ? '└─' : '├─'
      const key = `p-${s.id}`
      const open = isOpen(key, s.status === 'run')
      const deps = s.after.map(id => planNow?.steps.find(x => x.id === id)?.title ?? id)
      const peers = level.filter(x => x.id !== s.id).map(x => x.title)
      const onTier = turnWorkers.filter(w => (tierOf(w.model) ?? 'opus') === s.tier)

      return (
        <Box key={`ps-${s.id}`} flexDirection="column">
          <Box>
            <Text dimColor>{si === 0 ? `${String(li + 1).padStart(2)} ` : '   '}{branch} </Text>
            <Button key={`fold-${key}`} plain label={open ? '▾' : '▸'} onPress={() => toggle(key, !open)} />
            <Text wrap="truncate-end" dimColor={s.status === 'skip'}>
              <Text color={markColor}> {mark} </Text>
              <Text color={TIER_COLOR[s.tier]} bold={s.tier === 'opus'}>{TIER_ICON[s.tier]} {s.tier} </Text>
              <Text strikethrough={s.status === 'skip'}>{s.title}</Text>
            </Text>
          </Box>
          {open && (
            <Box flexDirection="column">
              <Text wrap="wrap">
                <Text dimColor>{pad}model </Text>
                <Text bold color={TIER_COLOR[s.tier]}>{s.tier}</Text>
                <Text dimColor> · {TIER_JOB[s.tier]}</Text>
              </Text>
              {deps.length > 0 && <Text wrap="wrap" dimColor>{pad}after: {deps.join(', ')}</Text>}
              {peers.length > 0 && <Text wrap="wrap" dimColor>{pad}in parallel with: {peers.join(', ')}</Text>}
              {s.tier !== 'opus' && onTier.length === 0 && <Text dimColor>{pad}no {s.tier} subagent started yet</Text>}
              {s.tier !== 'opus' &&
                onTier.map(w => (
                  <Text key={`pw-${s.id}-${w.id}`} wrap="truncate-end">
                    <Text dimColor>{pad}⤷ </Text>
                    <Text color={WORKER_COLOR[w.status]}>{w.type}</Text>
                    <Text dimColor> {w.description}</Text>
                  </Text>
                ))}
            </Box>
          )}
        </Box>
      )
    }

    const execStep = (s: Step, i: number, all: Step[]) => {
      const isLast = i === all.length - 1
      const branch = s.agentId ? '│ ⤷' : isLast ? '└─' : '├─'
      const gutter = s.agentId || !isLast ? '│      ' : '       '
      const cells = Math.max(1, Math.round((s.tokensIn / maxIn) * 8))
      const key = `x-${s.id}`
      const open = isOpen(key, !s.isDone)
      const uses = s.uses ?? []
      const said = (s.answer ?? '').replace(/\s+/g, ' ').trim()

      return (
        <Box key={s.id} flexDirection="column">
          <Box>
            <Text dimColor>{branch} </Text>
            <Button key={`fold-${key}`} plain label={open ? '▾' : '▸'} onPress={() => toggle(key, !open)} />
            <Text>
              {' '}
              {s.agentId && <Text color={C.run}>{workerType(s.agentId)} </Text>}
              <Text bold color={modelColor(s.model)}>{short(s.model)}</Text>
              {s.effort && <Text color={C.info}> {s.effort}</Text>}
              <Text dimColor> #{s.index} </Text>
            </Text>
            <Text wrap="truncate-end">
              {s.isDone ? (
                <Text>
                  <Text color={modelColor(s.model)}>{'▮'.repeat(cells)}</Text>
                  <Text dimColor>{'▯'.repeat(8 - cells)} {k(s.tokensIn)}↑ {k(s.tokensOut)}↓</Text>
                </Text>
              ) : (
                <Text color={C.run}>● running…</Text>
              )}
            </Text>
          </Box>
          {s.isDone && !open && (
            <Text wrap="truncate-end">
              <Text dimColor>{gutter}</Text>
              {s.tools.length ? chips(s.tools) : s.stop === 'end_turn' ? <Text color={C.ok}>✓ answer</Text> : <Text dimColor>■ {s.stop ?? '—'}</Text>}
            </Text>
          )}
          {open && (
            <Box flexDirection="column">
              {uses.map((u, ui) => {
                const name = toolLabel(u.tool)

                return (
                  <Text key={`xu-${s.id}-${ui}`} wrap="truncate-end">
                    <Text dimColor>{gutter}</Text>
                    <Text color={toolColor(name)}>{toolIcon(name)} {name} </Text>
                    <Text dimColor>{u.brief.replace(/\s+/g, ' ')}</Text>
                  </Text>
                )
              })}
              {said !== '' && (
                <Text wrap="truncate-end">
                  <Text dimColor>{gutter}„</Text>
                  {said}
                </Text>
              )}
              {s.isDone && (
                <Box>
                  <Text dimColor>{gutter}</Text>
                  <Button key={`step-${s.id}`} plain label="[tool outputs]" onPress={() => void openStep($, s)} />
                </Box>
              )}
            </Box>
          )}
        </Box>
      )
    }

    const thinkView = (
      <Box flexDirection="column" gap={1}>
        {lastPrompt !== '' && (
          <Text wrap="truncate-end">
            <Text color={C.accent}>▸ </Text>
            <Text italic>{lastPrompt.replace(/\s+/g, ' ')}</Text>
          </Text>
        )}
        {!planNow && <Text dimColor>No plan yet for this request.</Text>}
        {planNow &&
          section('goal', 'UNDERSTAND', true, () => (
            <Box flexDirection="column">
              <Text wrap="wrap">
                <Text color={C.accent}>▸ </Text>
                {planNow.goal || '—'}
              </Text>
              <Text>
                <Text dimColor>clarity </Text>
                <Text color={clarityColor(planNow.clarity)}>{'▮'.repeat(planNow.clarity)}</Text>
                <Text dimColor>{'▯'.repeat(10 - planNow.clarity)} {planNow.clarity}/10</Text>
                {planNow.revision > 0 && <Text dimColor> · rev {planNow.revision}</Text>}
              </Text>
              {(planNow.approach ?? '') !== '' && (
                <Text wrap="wrap">
                  <Text color={C.info}>→ </Text>
                  {planNow.approach}
                </Text>
              )}
            </Box>
          ))}
        {planNow &&
          planNow.assumptions.length > 0 &&
          section('assume', `ASSUMPTIONS ${planNow.assumptions.length}`, false, () => (
            <Box flexDirection="column">
              {planNow.assumptions.map((a, i) => (
                <Text key={`as-${i}`} wrap="wrap">
                  <Text color={C.run}>~ </Text>
                  {a}
                </Text>
              ))}
            </Box>
          ))}
        {planNow &&
          section(
            'plan',
            `PLAN ${doneN}/${planNow.steps.length}`,
            true,
            () => (
              <Box flexDirection="column">
                {planLevels.map((level, li) => (
                  <Box key={`lv-${li}`} flexDirection="column">
                    {level.map((s, si) => planStep(s, level, li, si))}
                    {li < planLevels.length - 1 && <Text dimColor>{'   │'}</Text>}
                  </Box>
                ))}
              </Box>
            ),
            <Text>
              {mix.filter(([, n]) => n > 0).map(([t, n]) => (
                <Text key={`mix-${t}`} color={TIER_COLOR[t]} bold={t === 'opus'}>
                  {TIER_ICON[t]}{n}{' '}
                </Text>
              ))}
            </Text>,
          )}
        {section(
          'exec',
          `EXECUTION ${turnSteps.length} steps`,
          true,
          () => (
            <Box flexDirection="column">
              {turnSteps.length === 0 && <Text dimColor>No steps yet. Send a prompt.</Text>}
              {turnSteps.length > 0 && (
                <Text wrap="truncate-end">
                  <Text dimColor>path </Text>
                  {turnSteps.slice(-30).map(s => (
                    <Text key={`m-${s.id}`} color={s.isDone ? modelColor(s.model) : C.run}>
                      {s.agentId ? (s.isDone ? '◆' : '◇') : s.isDone ? '■' : '▪'}
                    </Text>
                  ))}
                </Text>
              )}
              {graphReady && turnSteps.length > 0 && (
                <Text wrap="truncate-end">
                  <Text dimColor>graph </Text>
                  <Text color={C.graph}>{'▮'.repeat(graphCells)}</Text>
                  <Text dimColor>{'▯'.repeat(10 - graphCells)}</Text>
                  <Text dimColor> ◈{graphN} · ⌕{classicN}</Text>
                </Text>
              )}
              {skillList.length > 0 && (
                <Text wrap="truncate-end">
                  <Text dimColor>skills </Text>
                  <Text color={C.info}>✦ {skillList.map(([n, c]) => (c > 1 ? `${n}×${c}` : n)).join(' · ')}</Text>
                </Text>
              )}
              {turnSteps.slice(-room).map(execStep)}
            </Box>
          ),
          <Text dimColor>{k(tokensIn)}↑ {k(tokensOut)}↓</Text>,
        )}
        {retroNow &&
          section(
            'retro',
            `RETROSPECTIVE ${retroNow.findings.length ? `${retroNow.findings.length} to optimize` : 'ok'}`,
            true,
            () => (
              <Box flexDirection="column">
                <Text wrap="truncate-end" dimColor>
                  {retroNow.steps} steps · {usd(retroNow.cost)} · {Math.round(retroNow.cheapShare * 100)}% of cost on haiku/sonnet
                </Text>
                {retroNow.findings.length === 0 && <Text color={C.ok}>✓ delegation was right for this turn</Text>}
                {retroNow.findings.map((f, i) => (
                  <Text key={`rf-${i}`} wrap="wrap">
                    <Text color={f.kind === 'escalated' ? C.bad : C.run}>{f.kind === 'escalated' ? '⇡ ' : f.kind === 'plan' ? '≠ ' : '↓ '}</Text>
                    {f.text}
                    {f.saving > 0 && <Text color={C.ok}> · ~{usd(f.saving)}</Text>}
                    {(f.wasted ?? 0) > 0 && <Text color={C.bad}> · wasted {usd(f.wasted ?? 0)}</Text>}
                  </Text>
                ))}
                {retroNow.saving > 0 && (
                  <Text wrap="truncate-end">
                    <Text dimColor>possible savings </Text>
                    <Text color={C.ok}>~{usd(retroNow.saving)}</Text>
                    <Text dimColor> ({Math.round((retroNow.saving / Math.max(retroNow.cost, 1e-9)) * 100)}% of the turn, estimate)</Text>
                  </Text>
                )}
              </Box>
            ),
          )}
        {planNow &&
          planNow.savings.length > 0 &&
          section('save', `SAVINGS ${planNow.savings.length}`, false, () => (
            <Box flexDirection="column">
              {planNow.savings.map((v, i) => (
                <Text key={`sv-${i}`} wrap="wrap">
                  <Text color={C.ok}>⚡ </Text>
                  {v}
                </Text>
              ))}
            </Box>
          ))}
        {planNow && (planNow.questions.length > 0 || planNow.betterPrompt) && (
          <Box flexDirection="column" borderStyle="round" borderColor={C.info} paddingX={1}>
            <Text bold color={C.info}>HOW YOU CAN HELP ME BE PRECISE</Text>
            {planNow.questions.map((q, i) => {
              const a = answered[q.ask]
              const isOpen = !a || a.state === 'draft'

              return (
                <Box key={`q-${i}`} flexDirection="column" marginTop={i ? 1 : 0}>
                  <Text wrap="wrap">
                    <Text color={isOpen ? C.info : C.ok}>{isOpen ? '? ' : '✓ '}</Text>
                    {q.ask}
                  </Text>
                  {q.why !== '' && <Text wrap="wrap" dimColor>{'  '}→ {q.why}</Text>}
                  {isOpen ? (
                    <Box flexDirection="column">
                      {q.fallback !== '' && <Text wrap="wrap" dimColor>{'  '}default: {q.fallback}</Text>}
                      {q.options.length > 0 && (
                        <Box gap={1} flexWrap="wrap">
                          {q.options.map((o, oi) => (
                            <Button key={`q-${i}-o-${oi}`} plain={oi > 0 || undefined} label={o} onPress={() => void answer($, q.ask, o)} />
                          ))}
                        </Box>
                      )}
                      <Input
                        key={`q-${i}-in`}
                        label="  ↳ "
                        placeholder={q.options.length ? 'or write something else' : 'your answer'}
                        value={a?.text ?? ''}
                        submitLabel="send"
                        onInput={v => void update($, answers, all => ({ ...all, [q.ask]: { text: v, state: 'draft' as const } }))}
                        onSubmit={v => void answer($, q.ask, v)}
                      />
                    </Box>
                  ) : (
                    <Box gap={1}>
                      <Text wrap="wrap">
                        <Text color={a.state === 'sent' ? C.ok : C.run}>{'  '}↳ {a.text}</Text>
                        <Text dimColor>{a.state === 'sent' ? ' · read' : ' · reaches the next step'}</Text>
                      </Text>
                      {a.state === 'sent' && <Button key={`q-${i}-redo`} plain label="change" onPress={() => void update($, answers, all => ({ ...all, [q.ask]: { text: a.text, state: 'draft' as const } }))} />}
                    </Box>
                  )}
                </Box>
              )
            })}
            {planNow.betterPrompt !== '' && (
              <Box flexDirection="column" marginTop={planNow.questions.length ? 1 : 0}>
                <Text dimColor>next time, write it like this:</Text>
                <Text wrap="wrap" italic>„{planNow.betterPrompt}”</Text>
              </Box>
            )}
          </Box>
        )}
        {section('tools', 'TOOLS IN SESSION', false, () => (
          <Text wrap="wrap">
            {Object.entries(counts)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 12)
              .map(([name, n]) => `${name} ${n}`)
              .join(' · ') || '—'}
          </Text>
        ))}
      </Box>
    )

    const stagedN = list.filter(c => c.staged).length
    const codeColor = (code: string) => (code === 'M' ? C.run : code === 'A' || code === '?' ? C.ok : code === 'R' ? C.info : C.bad)
    const branch = branchLabel(repoNow.branch)
    const changesView = (
      <Box flexDirection="column">
        <Box justifyContent="space-between">
          <Text wrap="truncate-end">
            <Text color={C.info}>⑂ {branch.name || '—'}</Text>
            {branch.sync && <Text color={C.run}> {branch.sync}</Text>}
          </Text>
          <Text dimColor>{stagedN} staged · {list.length} total</Text>
        </Box>
        {!repoNow.loaded && <Text dimColor>Reading status…</Text>}
        {repoNow.loaded && !repoNow.top && <Text dimColor>Not a git repository.</Text>}
        {repoNow.top && list.length === 0 && <Text color={C.ok}>✓ nothing to commit</Text>}
        {list.slice(0, Math.max(4, room - 8)).map(c => {
          const slash = c.path.lastIndexOf('/')

          return (
            <Box key={`ch-${c.path}`} gap={1}>
              <Button
                key={`st-${c.path}`}
                plain
                label={c.staged && c.unstaged ? '[~]' : c.staged ? '[x]' : '[ ]'}
                onPress={() => void gitAct($, top => (c.staged && !c.unstaged ? unstage($, top, [c.path]) : stage($, top, [c.path])))}
              />
              <Text color={codeColor(c.code)} bold>{c.code}</Text>
              <Text wrap="truncate-start" dimColor>{slash >= 0 ? c.path.slice(0, slash + 1) : ''}</Text>
              <Button key={`df-${c.path}`} plain label={c.path.slice(slash + 1)} onPress={() => void openDiff($, c)} />
              {c.code === '?' ? <Text color={C.ok}>new</Text> : <Text><Text color={C.ok}>+{c.add}</Text> <Text color={C.bad}>-{c.del}</Text></Text>}
            </Box>
          )
        })}
        {list.length > Math.max(4, room - 8) && <Text dimColor>… +{list.length - Math.max(4, room - 8)} files (use [stage all])</Text>}
      </Box>
    )

    // An opened step of Flow: the answer and each tool (input → output).
    const stepDetail = stepNow && (
      <Box flexDirection="column">
        <Box justifyContent="space-between">
          <Text bold>step {stepNow.title}</Text>
          <Button key="step-back" plain label="← flow" hotkey="b" onPress={() => void update($, stepView, () => null)} />
        </Box>
        {stepNow.answer.trim() !== '' && <Text wrap="wrap">{stepNow.answer}</Text>}
        {stepNow.uses.length === 0 && stepNow.answer.trim() === '' && <Text dimColor>The step wrote no text and called no tools.</Text>}
        {stepNow.uses.map((u, i) => (
          <Box key={`su-${i}`} flexDirection="column" marginTop={1}>
            <Text wrap="truncate-end">
              <Text color={C.info} bold>{toolLabel(u.tool)} </Text>
              <Text dimColor>{u.brief}</Text>
            </Text>
            {u.output === undefined ? (
              <Text dimColor>  (no output in the transcript)</Text>
            ) : (
              <Text wrap="wrap" color={u.isError ? C.bad : undefined}>{u.output}</Text>
            )}
          </Box>
        ))}
      </Box>
    )

    const diffView = diffNow && (
      <Box flexDirection="column">
        <Box justifyContent="space-between">
          <Text bold wrap="truncate-start">{diffNow.path}</Text>
          <Button key="diff-back" plain label="← list" hotkey="b" onPress={() => void update($, diff, () => null)} />
        </Box>
        {diffNow.text.trim() ? <Code source={diffNow.text} format="diff" wrap="truncate-end" /> : <Text dimColor>No differences.</Text>}
      </Box>
    )

    // Bottom, under the list: bulk stage/unstage, the message and the commit. Enter in the field = commit.
    const gitControls = (
      <Box flexDirection="column" borderStyle="round" borderColor={C.ok} paddingX={1}>
        <Box gap={1}>
          <Button key="stage-all" label="stage all" hotkey="a" onPress={() => void gitAct($, top => stage($, top, 'all'))} />
          <Button key="unstage-all" label="unstage all" onPress={() => void gitAct($, top => unstage($, top, 'all'))} />
          <Button key="git-refresh" plain label="↻" hotkey="u" onPress={() => void refreshChanges($)} />
          <Button key="sync" label={isSyncing ? 'sync…' : `sync${branch.sync ? ` ${branch.sync}` : ''}`} hotkey="s" onPress={() => void syncRepo($)} />
          <Button key="draft-msg" label={isDrafting ? 'haiku writing…' : 'haiku message'} hotkey="m" onPress={() => void draftMessage($)} />
        </Box>
        <Input
          key="commit-msg"
          label="commit "
          placeholder="commit message"
          value={message}
          submitLabel="commit"
          onInput={v => void update($, commitMsg, () => v)}
          onSubmit={() => void commitStaged($)}
        />
        <Box justifyContent="space-between">
          <Text wrap="truncate-end" color={note ? (note.ok ? C.ok : C.bad) : undefined} dimColor={!note}>
            {note ? `${note.ok ? '✓' : '✗'} ${note.text}` : `${stagedN} files staged`}
          </Text>
          <Button key="commit" variant="primary" label={`commit ${stagedN}`} onPress={() => void commitStaged($)} />
        </Box>
      </Box>
    )

    const workersNow = workersView(
      $.ui.resolve(e),
      {
        routing: isRouting,
        tier: tierNow,
        workers: allWorkers,
        since,
        validations: allChecks,
        tools: Object.fromEntries(allWorkers.filter(w => w.agentId).map(w => [w.agentId, tally(allSteps.filter(s => s.agentId === w.agentId).flatMap(s => s.tools))])),
        fold: foldNow,
        misses: learnedNow.length,
        cost: turnCost,
        opusCost: turnOpus,
      },
      { toggle },
    )

    return (
      <Box flexDirection="column" gap={1} minHeight={e.props.scroll.bodyRows}>
        {header}
        {tabs}
        {current === 'think' ? (stepDetail || thinkView) : current === 'changes' ? (diffView || changesView) : current === 'workers' ? workersNow : current === 'memories' ? memoriesView($.ui.resolve(e), { list: await read($, memories), meta: await read($, memMeta), use: await read($, memUse), opened: await read($, memView), filter: await read($, memType), room }, { open: name => void openMemory($, name), back: () => void update($, memView, () => null), filter: t => void update($, memType, () => t), refresh: () => void loadMemories($) }) : null}
        <Box flexGrow={1} />
        {current === 'changes' && gitControls}
      </Box>
    )
  })
}
