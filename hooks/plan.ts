import type { Plan, PlanStep } from '../types'

// The tool the main model uses to publish its plan: what it understood, what it assumes,
// the step flow (who does it, after what) and what would make the request more precise.
export const PLAN_TOOL = 'plan'
export const PLAN_TOOL_ID = 'mcp__agent-lens__plan'

const TIERS = ['haiku', 'sonnet', 'opus'] as const
const STATUSES = ['todo', 'run', 'done', 'skip'] as const

export const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    goal: { type: 'string', description: 'What you understood the user wants, in one sentence, in your own words.' },
    approach: { type: 'string', description: 'How you will act, in 1-2 sentences: what you do first, what you delegate and to which model, how you verify.' },
    clarity: { type: 'integer', minimum: 0, maximum: 10, description: 'How clear the request is: 10 = you know exactly what and where, 0 = you are guessing.' },
    assumptions: { type: 'array', items: { type: 'string' }, description: 'What you assume without having been told.' },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ask: { type: 'string', description: 'A closed question, answered with a word or a choice.' },
          why: { type: 'string', description: 'What would change in the work depending on the answer.' },
          options: { type: 'array', items: { type: 'string' }, description: '2-4 short answers (1-4 words) the user picks with one click; the first is the recommended one.' },
          default: { type: 'string', description: 'What you do if there is no answer; the work continues on this.' },
        },
        required: ['ask'],
      },
      description: 'Only what concretely changes the work (at most 3). The user answers from the tab; the answer reaches you in the same turn, after a tool result.',
    },
    better_prompt: { type: 'string', description: 'The request rewritten the way it should have been phrased, as a model for next time.' },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          tier: { enum: [...TIERS], description: 'haiku = lookups/reads, sonnet = mechanical, opus = you (understanding, decisions, verification).' },
          after: { type: 'array', items: { type: 'string' }, description: 'Ids of the steps that must finish first; steps with no shared dependencies run in parallel.' },
          status: { enum: [...STATUSES] },
        },
        required: ['id', 'title', 'tier'],
      },
    },
    savings: { type: 'array', items: { type: 'string' }, description: 'Efficiencies: what you skip, what runs in parallel, what you delegate down and why.' },
  },
  required: ['goal', 'approach', 'clarity', 'steps'],
}

export const PLAN_DESCRIPTION =
  'Publishes to the Agent Lens sidebar (Flow tab) how you understood the request and how you split it into steps: what you assume, who does each step (haiku/sonnet/opus), what runs in parallel, what you make more efficient and what the user should clarify. Call it once at the start of every request, however short, before any other tool; call it again with the whole plan only when the plan changes or a phase ends (status per step). Write the plan fields in the language of the user\'s latest prompt.'

export const ANSWERS_TAG = '[Agent Lens · answers]'

export const PLAN_RULE = `At the start of every request, however short (even ones of 1-2 tool calls), before any other tool, call ${PLAN_TOOL_ID} with a mini-plan, even if you are not in plan mode: what you understood (goal) and how you act (approach), the clarity, the assumptions, the steps with model and dependencies, the efficiencies, and the questions that would make the user more specific (each with options and what you do by default, so you do not stop and wait). Call it again only when the plan changes or a phase ends; at the end mark the steps done. The user answers questions from the Flow tab: the answers arrive marked ${ANSWERS_TAG}, either after a tool result or as a new message. They override your assumptions: apply them immediately, and if they change the steps, republish the plan without the answered questions. Write the plan fields in the language of the user's latest prompt.`

const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [])
const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T) => (list.includes(v as T) ? (v as T) : fallback)

// The input comes from the model: any missing or wrongly typed field gets a safe value.
export const normalizePlan = (input: unknown, at: number): Plan => {
  const o = (input ?? {}) as Record<string, unknown>
  const raw = Array.isArray(o.steps) ? (o.steps as Record<string, unknown>[]) : []
  const steps: PlanStep[] = raw.map((s, i) => ({
    id: String(s?.id ?? i + 1),
    title: String(s?.title ?? '—'),
    tier: oneOf(s?.tier, TIERS, 'opus'),
    after: strs(s?.after),
    status: oneOf(s?.status, STATUSES, 'todo'),
  }))
  const questions = (Array.isArray(o.questions) ? o.questions : [])
    .map(q =>
      typeof q === 'string'
        ? { ask: q, why: '', options: [], fallback: '' }
        : { ask: String(q?.ask ?? ''), why: String(q?.why ?? ''), options: strs(q?.options).slice(0, 4), fallback: typeof q?.default === 'string' ? q.default : '' },
    )
    .filter(q => q.ask.trim() !== '')

  return {
    goal: String(o.goal ?? ''),
    approach: typeof o.approach === 'string' ? o.approach : '',
    clarity: Math.max(0, Math.min(10, Math.round(Number(o.clarity) || 0))),
    assumptions: strs(o.assumptions),
    questions,
    betterPrompt: typeof o.better_prompt === 'string' ? o.better_prompt : '',
    steps,
    savings: strs(o.savings),
    revision: 0,
    at,
  }
}

// Flow levels: a step sits on the level after its latest dependency,
// so steps on the same level can run in parallel. Unknown dependencies are ignored;
// a cycle lands on the last level instead of blocking the drawing.
export const layers = (steps: readonly PlanStep[]): PlanStep[][] => {
  const ids = new Set(steps.map(s => s.id))
  const level = new Map<string, number>()
  let changed = true
  for (let pass = 0; changed && pass <= steps.length; pass++) {
    changed = false
    for (const s of steps) {
      const deps = s.after.filter(d => ids.has(d) && d !== s.id)
      if (!deps.every(d => level.has(d))) continue
      const l = deps.length ? Math.max(...deps.map(d => level.get(d)!)) + 1 : 0
      if (level.get(s.id) !== l) {
        level.set(s.id, l)
        changed = true
      }
    }
  }
  const last = level.size ? Math.max(...level.values()) + 1 : 0
  const out: PlanStep[][] = []
  for (const s of steps) (out[level.get(s.id) ?? last] ??= []).push(s)

  return out.filter(Boolean)
}

// What the model reads when the user answers from the tab: the question next to the answer,
// so it does not depend on question order in a newer plan revision.
export const answersMessage = (answered: readonly { ask: string; text: string }[]) =>
  answered.length ? [ANSWERS_TAG, ...answered.map(a => `- ${a.ask}\n  → ${a.text}`)].join('\n') : ''
