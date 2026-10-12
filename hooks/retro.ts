import type { Plan, Retro, RetroFinding, Step, Worker } from '../types'
import { VALIDATOR, costOf, tierOf } from './router'
import type { Tier } from './router'

// Turn retrospective: after a turn ends, it looks at the real steps (model, tools, cost) and at the
// workers, and says where cheaper delegation was possible. Fixed rules, no model call.

const NEUTRAL = /^(agent-lens:plan|ToolSearch|Skill|TodoWrite|AskUserQuestion)$/
const READ = /^(Read|Grep|Glob|WebFetch|WebSearch|codegraph:.*|filesystem:(read|list|search|get|directory).*)$/
const READ_BASH = /^\s*(cd \S+ && )?(cat|sed -n|grep|rg|ls|find|head|tail|wc|tree|stat|file|git (status|log|diff|show|blame))\b/
const EDIT = /^(Edit|Write|NotebookEdit)$/

const label = (tool: string) => tool.replace(/^mcp__(?:plugin_)?([^_]+(?:_[^_]+)*?)__/, '$1:')

export type Kind = 'read' | 'edit' | 'other'

// A step is "read-only" or "edit-only" only if all its tools (apart from neutral ones) are.
export const kindOf = (s: Step): Kind => {
  const uses = (s.uses ?? []).map(u => ({ name: label(u.tool), brief: u.brief })).filter(u => !NEUTRAL.test(u.name))
  if (!uses.length) return 'other'
  if (uses.every(u => READ.test(u.name) || (u.name === 'Bash' && READ_BASH.test(u.brief)))) return 'read'
  if (uses.every(u => EDIT.test(u.name))) return 'edit'

  return 'other'
}

// ponytail: a subagent starts with a small context, so the delegated cost is estimated with the prompt capped at 30k
// and without the step where the main loop reads the summary; it is an order of magnitude, not the bill.
const DELEGATE_CONTEXT = 30_000
const costAs = (tier: Tier, s: Step, cap = Infinity) => {
  const prompt = Math.min(s.tokensIn, cap)
  const cached = Math.min(s.cacheRead, prompt)

  return costOf(tier, { input_tokens: prompt - cached, cache_read_input_tokens: cached, cache_creation_input_tokens: 0, output_tokens: s.tokensOut })
}
const spent = (list: Step[]) => list.reduce((n, s) => n + (s.cost ?? 0), 0)
const toolsOf = (list: Step[]) => {
  const counts = new Map<string, number>()
  for (const name of list.flatMap(s => s.tools).filter(t => !NEUTRAL.test(t))) counts.set(name, (counts.get(name) ?? 0) + 1)

  return [...counts].map(([name, n]) => (n > 1 ? `${name}×${n}` : name)).join(' ')
}

// Runs of at least `min` consecutive steps of the same kind, on opus, in the main loop.
const runsOf = (steps: Step[], kind: Kind, min: number) => {
  const runs: Step[][] = []
  let cur: Step[] = []
  for (const s of steps) {
    if (s.isDone && tierOf(s.model) === 'opus' && kindOf(s) === kind) cur.push(s)
    else {
      if (cur.length >= min) runs.push(cur)
      cur = []
    }
  }
  if (cur.length >= min) runs.push(cur)

  return runs
}

export const retroOf = (turnId: string, at: number, main: Step[], workers: Worker[], workerSteps: Step[], plan: Plan | null): Retro => {
  const findings: RetroFinding[] = []
  const span = (run: Step[]) => (run.length > 1 ? `#${run[0]?.index}–#${run.at(-1)?.index}` : `#${run[0]?.index}`)

  // "Don't delegate what you'd solve in one or two calls": a subagent is only worth it from 3 steps in a row.
  for (const run of runsOf(main, 'read', 3)) {
    const saving = spent(run) - run.reduce((n, s) => n + costAs('haiku', s, DELEGATE_CONTEXT), 0)
    findings.push({ kind: 'read', text: `steps ${span(run)} on opus only read (${toolsOf(run)}): an Explore on haiku would have done them`, saving: Math.max(0, saving) })
  }
  for (const run of runsOf(main, 'edit', 3)) {
    const saving = spent(run) - run.reduce((n, s) => n + costAs('sonnet', s, DELEGATE_CONTEXT), 0)
    findings.push({ kind: 'edit', text: `steps ${span(run)} on opus were serial edits (${toolsOf(run)}): with the spec written, a sonnet subagent would have done them`, saving: Math.max(0, saving) })
  }

  for (const w of workers) {
    const own = workerSteps.filter(s => s.agentId === w.agentId && s.isDone)
    if (!own.length) continue
    const t = tierOf(w.model) ?? 'opus'
    if (t === 'opus' && w.type !== VALIDATOR && own.every(s => kindOf(s) === 'read' || !s.tools.length) && own.some(s => kindOf(s) === 'read')) {
      const saving = spent(own) - own.reduce((n, s) => n + costAs('haiku', s), 0)
      findings.push({ kind: 'worker', text: `${w.type} ("${w.description}") ran only reads on opus: model: haiku was enough`, saving: Math.max(0, saving) })
    }
    if (w.escalated) {
      findings.push({ kind: 'escalated', text: `${w.type} on ${t} asked for a higher model (${w.escalated}): this task should go one level up directly`, saving: 0, wasted: spent(own) })
    }
  }

  // The plan promised delegation, the execution did not deliver.
  for (const t of ['haiku', 'sonnet'] as const) {
    const planned = plan?.steps.filter(s => s.tier === t && s.status !== 'skip') ?? []
    if (planned.length && !workers.some(w => tierOf(w.model) === t)) {
      findings.push({ kind: 'plan', text: `the plan put ${planned.length} steps on ${t} (${planned.map(s => s.title).join(', ')}), but no ${t} subagent was started`, saving: 0 })
    }
  }

  const all = [...main, ...workerSteps]
  const cost = spent(all)
  const cheap = spent(all.filter(s => tierOf(s.model) !== 'opus'))

  return {
    turnId,
    at,
    steps: all.length,
    cost,
    cheapShare: cost ? cheap / cost : 0,
    saving: findings.reduce((n, f) => n + f.saving, 0),
    findings,
  }
}

// What reaches the model after a turn with findings: the lesson, not the numbers; the next turn reads it from the conversation.
export const RETRO_TAG = '[Agent Lens · turn retrospective]'
export const retroMessage = (r: Retro) =>
  r.findings.length
    ? `${RETRO_TAG}\nWhere cheaper delegation was possible:\n${r.findings.map(f => `- ${f.text}`).join('\n')}\nApply in following turns: delegate such steps through Agent with the model parameter, without redoing this turn.`
    : ''
