import type { Validation, Worker } from '../types'

// Workers tab: each subagent is a foldable card. Closed: type, model, status, task.
// Open: why this model, the prompt received, the tools, the answer. Drawing only, like Memories.

type Tier = 'opus' | 'sonnet' | 'haiku'
type Ui = { Box: any; Text: any; Button: any } // ponytail: terminal elements, untyped here; register.tsx provides them from $.ui.resolve

export type WorkersData = {
  routing: boolean
  tier: { tier: Tier; why: string }
  workers: Worker[]
  since: number
  validations: Validation[]
  tools: Record<string, string>
  fold: Record<string, boolean>
  misses: number
  cost: number
  opusCost: number
}
export type WorkersActions = { toggle: (key: string, open: boolean) => void }

const ICON: Record<Tier, string> = { haiku: '⌕', sonnet: '✎', opus: '◆' }
const COLOR: Record<Tier, string | undefined> = { haiku: 'green', sonnet: 'blue', opus: undefined }
const tierIn = (model: string): Tier => (/haiku/i.test(model) ? 'haiku' : /sonnet/i.test(model) ? 'sonnet' : 'opus')
const short = (model: string) => model.replace(/^claude-/, '').replace(/-\d{8}$/, '')
const secs = (ms: number) => (ms >= 60000 ? `${Math.floor(ms / 60000)}m${Math.round((ms % 60000) / 1000)}s` : `${Math.round(ms / 1000)}s`)
const usd = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`
const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n))

// What comes out of a subagent's branch: escalation, validator verdict or a learned upgrade.
export const outcomeOf = (w: Worker, check?: Validation) => {
  if (w.escalated) return { mark: '⇡', color: 'yellow', text: `asks for a higher model: ${w.escalated} → failure recorded` }
  if (check?.status === 'fail') return { mark: '✗', color: 'red', text: `${check.summary.replace(/^VERDICT:\s*/i, '')} → failure recorded` }
  if (check?.status === 'ok') return { mark: '✓', color: 'green', text: 'validated' }
  if (w.route?.includes('learned')) return { mark: '↑', color: 'yellow', text: 'upgraded from learned failures' }

  return undefined
}

// Where the subagent's model comes from, in words.
export const whyOf = (w: Worker) =>
  w.route
    ? w.route.replace(/^[^:]+:\s*/, '')
    : w.asked
      ? `requested by the main model (${w.asked})`
      : short(w.model) === short(w.parentModel)
        ? 'inherited from the main turn'
        : 'from the agent definition'

const STATUS: Record<Worker['status'], [string, string, string]> = {
  running: ['●', 'yellow', 'running'],
  done: ['✓', 'green', 'done'],
  aborted: ['✗', 'red', 'stopped'],
  denied: ['⊘', 'red', 'denied'],
}

export const workersView = ({ Box, Text, Button }: Ui, d: WorkersData, act: WorkersActions) => {
  const current = d.workers.filter(w => w.startedAt >= d.since)
  const older = d.workers.filter(w => w.startedAt < d.since).slice(-8).reverse()
  const row = (label: string, value: string, key: string) => (
    <Text key={key} wrap="wrap">
      <Text dimColor>{label.padEnd(9)}</Text>
      {value}
    </Text>
  )

  const card = (w: Worker, openByDefault: boolean) => {
    const t = tierIn(w.model)
    const [mark, color, label] = STATUS[w.status]
    const out = outcomeOf(w, d.validations.find(v => v.agentId === w.agentId))
    const key = `w-${w.id}`
    const isOpen = d.fold[key] ?? openByDefault

    return (
      <Box key={key} flexDirection="column" borderStyle="round" borderColor={w.status === 'running' ? 'yellow' : COLOR[t]} paddingX={1}>
        <Box justifyContent="space-between">
          <Button key={`fold-${key}`} plain label={`${isOpen ? '▾' : '▸'} ${w.type}`} onPress={() => act.toggle(key, !isOpen)} />
          <Text color={color}>
            {mark} {label}
            {w.durationMs !== undefined ? ` · ${secs(w.durationMs)}` : ''}
          </Text>
        </Box>
        <Text wrap="truncate-end">
          <Text bold color={COLOR[t]}>
            {ICON[t]} {t}
          </Text>
          <Text dimColor>
            {' '}
            {short(w.model)}
            {w.isBackground ? ' · background' : ''} · {w.tools} tools
            {w.tokensOut !== undefined ? ` · ${k(w.tokensOut)}↓` : ''}
          </Text>
        </Text>
        <Text wrap={isOpen ? 'wrap' : 'truncate-end'}>{w.description || '—'}</Text>
        {out && (
          <Text wrap="truncate-end" color={out.color}>
            {out.mark} {out.text}
          </Text>
        )}
        {isOpen && (
          <Box flexDirection="column" marginTop={1}>
            {row('why', whyOf(w), 'why')}
            {row('tools', (w.agentId && d.tools[w.agentId]) || '—', 'tools')}
            {w.prompt && row('task', w.prompt, 'prompt')}
            {w.answer && row('answer', w.answer, 'answer')}
            {!w.answer && w.status === 'running' && <Text dimColor>the answer appears when it finishes</Text>}
          </Box>
        )}
      </Box>
    )
  }

  const mix = (['haiku', 'sonnet', 'opus'] as const).map(t => [t, current.filter(w => tierIn(w.model) === t).length] as const).filter(([, n]) => n > 0)
  const running = current.filter(w => w.status === 'running').length
  const rulesOpen = d.fold.rules ?? false

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text bold dimColor>THIS TURN</Text>
        <Text wrap="truncate-end">
          <Text color={COLOR[d.tier.tier]}>{ICON[d.tier.tier]} </Text>
          <Text bold color={COLOR[d.tier.tier]}>turn on {d.routing ? d.tier.tier : 'session model'}</Text>
          <Text dimColor> ({d.routing ? d.tier.why : 'routing off'})</Text>
        </Text>
        <Text wrap="truncate-end">
          <Text dimColor>{current.length} workers </Text>
          {mix.map(([t, n]) => (
            <Text key={`mix-${t}`} color={COLOR[t]} bold={t === 'opus'}>
              {ICON[t]}
              {n}{' '}
            </Text>
          ))}
          {running > 0 && <Text color="yellow">· ● {running} running</Text>}
        </Text>
        <Text wrap="truncate-end" dimColor>
          {usd(d.cost)} this turn · on opus it would have been {usd(d.opusCost)}
          {d.misses > 0 ? ` · ${d.misses} learned failures` : ''}
        </Text>
      </Box>
      {d.workers.length === 0 && <Text dimColor>No subagents invoked in this session.</Text>}
      {current.map((w, i) => card(w, w.status === 'running' || i === current.length - 1))}
      {older.length > 0 && <Text bold dimColor>PREVIOUS TURNS</Text>}
      {older.map(w => card(w, false))}
      <Box flexDirection="column">
        <Button key="fold-rules" plain label={`${rulesOpen ? '▾' : '▸'} how the model is chosen`} onPress={() => act.toggle('rules', !rulesOpen)} />
        {rulesOpen && (
          <Box flexDirection="column">
            <Text>the request picks the turn's model</Text>
            <Text dimColor> ├ [haiku]/[sonnet] in prompt ▶ pinned</Text>
            <Text dimColor> ├ ≥2 similar failures ▶ +1 level</Text>
            <Text dimColor> └ keywords ▶ haiku │ sonnet │ opus</Text>
            <Text>cheap subagent (haiku/sonnet)</Text>
            <Text dimColor> └ unsure ▶ ESCALATE ▶ failure recorded</Text>
            <Text>cheap turn with modified files</Text>
            <Text dimColor> └ opus validator ▶ FAIL ▶ failure recorded</Text>
            <Text>recorded failures (per project)</Text>
            <Text dimColor> └ only goes up: similar tasks +1</Text>
          </Box>
        )}
      </Box>
    </Box>
  )
}
