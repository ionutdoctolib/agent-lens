export type Step = {
  id: string
  turnId: string
  index: number
  model: string
  effort?: string
  agentId?: string
  isDone: boolean
  tools: string[]
  tokensIn: number
  tokensOut: number
  cacheRead: number
  cost?: number
  opusCost?: number
  stop: string | null
  answer: string
  uses: { tool: string; brief: string }[]
}

// An open step in Flow: the answer text and each tool with its input and what it returned.
export type StepView = { id: string; title: string; answer: string; uses: { tool: string; brief: string; output?: string; isError?: boolean }[] }

export type Worker = {
  id: string
  agentId?: string
  type: string
  description: string
  asked?: string
  route?: string
  model: string
  parentModel: string
  isBackground: boolean
  status: 'running' | 'done' | 'aborted' | 'denied'
  startedAt: number
  durationMs?: number
  tokensOut?: number
  tools: number
  words?: string[]
  escalated?: string
  prompt?: string
  answer?: string
}

export type Validation = {
  agentId: string
  files: string[]
  status: 'running' | 'ok' | 'fail' | 'stale'
  summary: string
  words?: string[]
  tier?: 'opus' | 'sonnet' | 'haiku'
}

export type Tab = 'think' | 'changes' | 'workers' | 'memories'

export type Change = { path: string; code: string; staged: boolean; unstaged: boolean; add: number; del: number }

export type Repo = { top: string; branch: string; loaded: boolean }

export type GitNote = { ok: boolean; text: string }

export type Diff = { path: string; text: string }

// cost: USD at each step's real model; opusCost: the same tokens priced on Opus.
export type Totals = { steps: number; tokensIn: number; tokensOut: number; cacheRead: number; cost?: number; opusCost?: number }

// A task that failed on a cheap model (FAIL verdict or ESCALATE): its words and the tier it failed on.
export type Miss = { words: string[]; tier: 'opus' | 'sonnet' | 'haiku'; at: number }

export type PlanStep = { id: string; title: string; tier: 'haiku' | 'sonnet' | 'opus'; after: string[]; status: 'todo' | 'run' | 'done' | 'skip' }

// The plan published by the model through the `plan` tool: how it understood the request and how it splits it.
export type Plan = {
  goal: string
  approach: string
  clarity: number
  assumptions: string[]
  questions: { ask: string; why: string; options: string[]; fallback: string }[]
  betterPrompt: string
  steps: PlanStep[]
  savings: string[]
  revision: number
  at: number
}

// The answer to a plan question, keyed by the question text: draft, on its way to the model, read.
export type Answer = { text: string; state: 'draft' | 'pending' | 'sent' }


// A memory from ~/.claude/projects/<slug>/memory, with [[name]] links to others.
export type Memory = { name: string; file: string; type: string; description: string; links: string[]; indexed: boolean; hook: string; size: number; mtimeMs: number }

// How it was used in this session: read (Read/Bash), written (Write/Edit), recalled (engine attachment).
export type MemoryUse = { read: number; write: number; recalled: number }

// What enters the context from memory (from /context) and the directory read.
export type MemoryMeta = {
  dir: string
  loaded: boolean
  context: { path: string; type: string; tokens: number }[]
  remember: { name: string; size: number }[]
  recalls: { type: string; names: string[] }[]
}

export type MemoryView = { name: string; body: string }

// Turn retrospective: where cheaper delegation was possible. saving = USD estimate; wasted = cost lost on an escalation.
export type RetroFinding = { kind: 'read' | 'edit' | 'worker' | 'escalated' | 'plan'; text: string; saving: number; wasted?: number }
export type Retro = { turnId: string; at: number; steps: number; cost: number; cheapShare: number; saving: number; findings: RetroFinding[] }

declare module 'claude-code' {
  interface PluginState {
    'agent-lens': {
      steps: Step[]
      workers: Worker[]
      skillsUsed: Record<string, number>
      toolCounts: Record<string, number>
      prompt: string
      tab: Tab
      fold: Record<string, boolean>
      retro: Retro | null
      routing: boolean
      edited: string[]
      validations: Validation[]
      totals: Totals
      turnTier: { tier: 'opus' | 'sonnet' | 'haiku'; why: string }
      hasGraph: boolean
      graphFirst: boolean
      graphSeen: boolean
      changes: Change[]
      repo: Repo
      commitMsg: string
      gitNote: GitNote | null
      diff: Diff | null
      drafting: boolean
      syncing: boolean
      stepView: StepView | null
      plan: Plan | null
      answers: Record<string, Answer>
      busy: boolean
      memories: Memory[]
      memMeta: MemoryMeta
      memUse: Record<string, MemoryUse>
      memView: MemoryView | null
      memType: string
      misses: Miss[]
      planFirst: boolean
      planAsked: boolean
      turnAt: number
    }
  }
}
