import type { Miss } from '../types'

// Model routing: Opus is the default; Sonnet only for mechanical work, Haiku only for short lookups.
export type Tier = 'opus' | 'sonnet' | 'haiku'

export const MODEL_IDS: Record<Tier, string> = {
  opus: 'claude-opus-5-5',
  sonnet: 'claude-sonnet-5-5',
  haiku: 'claude-haiku-5-5',
}
export const VALIDATOR = 'agent-lens:validator'

const LIGHT_TYPES = /^(Explore|claude-code-guide|statusline-setup)$/
const HEAVY = /(?<![\p{L}\p{N}])(arhitect|design|refactor|migra|debug|bug|de ce|audit|planific|implementeaz|modul|securit|performan|analiz|review|investig|diagnos|crash|eroare|error|nu merge|nu func|why|security|performance|analy[sz]|investigat|does not work|doesn't work|not working|broken)/iu
const LOOKUP = /(?<![\p{L}\p{N}])(unde(?![\p{L}\p{N}])|where(?![\p{L}\p{N}])|which (is|are)(?![\p{L}\p{N}])|what (does|is)(?![\p{L}\p{N}])|show me|how many|how much|care (e|este|sunt)(?![\p{L}\p{N}])|ce (face|este|e|inseamn|înseamn)|arat[aă]-mi (unde|care|ce)|list(eaz[aă]|[aă]m)?(?![\p{L}\p{N}])|caut|g[aă]se[sș]te|find|search|locat|grep|explor|inventar|cum (se )?(activ|dezactiv|ascund|ar[aă]t|scot|pun|rulez|pornesc)|m?ascund|ar[aă]t(?![\p{L}\p{N}])|c[aâ]te(?![\p{L}\p{N}])|c[aâ]t(?![\p{L}\p{N}]))/iu
const ACTION = /(?<![\p{L}\p{N}])(repar|fix|adaug|f[aă](?![\p{L}\p{N}])|schimb|modific|implement|creeaz|crea[zs]|scrie|m[uă]t[aă](?![\p{L}\p{N}])|actualiz|update|add(?![\p{L}\p{N}])|change|make(?![\p{L}\p{N}])|create)/iu
const MECHANICAL = /(?<![\p{L}\p{N}])(redenume|rename|typo|traduc|commit|formatea|rubocop|lint|[sș]terge|scoate|adaug[aă] (un |o )?(c[aâ]mp|coloan|traducer|test|spec|buton|link)|culoar|colou?r|translat|delete|remove|format(?![\p{L}\p{N}])|roz|bar[aă](?![\p{L}\p{N}])|bordur|etichet|aliniaz)/iu

// Quoted or pasted text (errors, UI snippets, logs) says nothing about how hard the request is.
const QUOTED = /<pasted_content[^>]*>[\s\S]*?<\/pasted_content[^>]*>|```[\s\S]*?```|„[^”]*”|"[^"\n]*"|`[^`\n]*`|«[^»]*»/g

// ponytail: keyword and length heuristic; a model.complete classifier if it is wrong often
export const classify = (text: string): { tier: Tier; why: string } => {
  const t = text.replace(QUOTED, ' ').trim()
  if (HEAVY.test(t) || t.length > 600) return { tier: 'opus', why: 'complex' }
  if (MECHANICAL.test(t) && t.length <= 400) return { tier: 'sonnet', why: 'mechanical work' }
  if (ACTION.test(t)) return { tier: 'opus', why: 'change' }
  if (LOOKUP.test(t) && t.length <= 200) return { tier: 'haiku', why: 'short lookup' }

  return { tier: 'opus', why: 'default' }
}

// "[haiku] where is X" pins the turn's model; the tag does not reach the model.
export const tagged = (text: string): { tier?: Tier; text: string } => {
  const m = text.match(/^\s*\[(opus|sonnet|haiku)\]\s*/i)

  return m ? { tier: m[1].toLowerCase() as Tier, text: text.slice(m[0].length) } : { text }
}

export const pickSubagentModel = (type: string, description: string, asked?: string) => {
  if (asked) return { model: asked, why: 'requested' }
  if (LIGHT_TYPES.test(type)) return { model: 'haiku', why: 'search type' }
  const { tier, why } = classify(description)

  return { model: tier, why }
}

export const tierOf = (model: string): Tier | undefined => /opus|sonnet|haiku/i.exec(model)?.[0].toLowerCase() as Tier | undefined

export const verdictOf = (answer: string) => {
  const line = answer.match(/VERDICT:\s*(OK|FAIL)\b[^\n]*/i)?.[0]

  return { isOk: /VERDICT:\s*OK/i.test(line ?? ''), line: line ?? 'VERDICT missing' }
}

export const VALIDATOR_PROMPT = `You are the final validator of a work turn. You receive the user's request and the modified files.
Read the changes (git diff -- <files>; read an untracked file in full) and check:
- it does what was asked, completely, with nothing left half-done;
- obvious bugs, edge cases, mishandled errors;
- nothing destructive or unrequested.
Do not modify anything. Answer in the language of the user's request, at most 10 lines, with file:line where relevant.
The last line is exactly one of: "VERDICT: OK" or "VERDICT: FAIL — <main reason>".`

// A cheap subagent that is unsure stops instead of guessing; the mod sees the line and flags it.
export const ESCALATE = 'ESCALATE:'
export const ESCALATE_RULE = `\n\n[Agent Lens] You are running on a cheap model. If the task requires a design decision, touches more modules than you were given, or is ambiguous, do not guess and do not deliver half a job: stop and reply only with the line "${ESCALATE} <what is missing or what must be decided>".`
export const escalationOf = (answer: string) => answer.match(/(?:ESCALATE|ESCALADEAZ[AĂ]):[ \t]*([^\n]*)/i)?.[1]?.trim() || undefined

// USD per million tokens (claude-api skill, 2026-10-06); cache writes at 1h TTL, as Claude Code runs.
// Haiku costs 5x above 100K prompt tokens.
export const PRICES: Record<Tier, { input: number; output: number; write: number; read: number }> = {
  opus: { input: 4, output: 20, write: 8, read: 0.2 },
  sonnet: { input: 2, output: 10, write: 4, read: 0.2 },
  haiku: { input: 0.1, output: 0.5, write: 0.2, read: 0.01 },
}

type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }

export const costOf = (tier: Tier, u: Usage) => {
  const p = PRICES[tier]
  const prompt = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
  const long = tier === 'haiku' && prompt > 100_000 ? 5 : 1

  return (long * (u.input_tokens * p.input + u.cache_creation_input_tokens * p.write + u.cache_read_input_tokens * p.read + u.output_tokens * p.output)) / 1e6
}

const RANK: Record<Tier, number> = { haiku: 0, sonnet: 1, opus: 2 }
const UP: Record<Tier, Tier> = { haiku: 'sonnet', sonnet: 'opus', opus: 'opus' }
const STOP = new Set('acest aceasta aceste acum asta astea care catre cand cele cine daca dupa este fara intr intre pentru prin sunt toate unde with from that this into what when have should could would file files code'.split(' '))

export const wordsOf = (text: string) => {
  const plain = text.replace(QUOTED, ' ').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')

  return [...new Set(plain.match(/[\p{L}\p{N}]{4,}/gu) ?? [])].filter(w => !STOP.has(w)).slice(0, 40)
}

// The same text failing again on the same level counts once: the threshold needs different texts.
export const addMiss = (misses: Miss[], miss: Miss) => {
  const isSame = misses.some(m => m.tier === miss.tier && m.words.join(' ') === miss.words.join(' '))

  return miss.words.length === 0 || isSame ? misses : [...misses, miss].slice(-40)
}

// ponytail: match on common words (>=2) with at least 2 failures; a model.complete classifier if it escalates from noise.
// Only goes up: a failure on sonnet raises similar tasks to opus, never the reverse.
export const learned = (text: string, tier: Tier, misses: Miss[]) => {
  if (tier === 'opus') return undefined
  const words = new Set(wordsOf(text))
  const hits = misses.filter(m => RANK[m.tier] >= RANK[tier] && m.words.filter(w => words.has(w)).length >= 2)
  if (hits.length < 2) return undefined
  const worst = hits.reduce((a, b) => (RANK[b.tier] > RANK[a.tier] ? b : a)).tier

  return { tier: UP[worst], why: `learned: ${hits.length} failures` }
}
