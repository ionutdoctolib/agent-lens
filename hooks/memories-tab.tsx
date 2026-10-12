import type { Memory, MemoryMeta, MemoryUse, MemoryView } from '../types'
import { backlinks, isolated } from './memories'

// Memories tab, drawing only. Whatever touches `$` (reading the directory, tracking tools) lives in
// register.tsx, with the atoms: the engine does not let `$` pass into an imported function and reads atoms only from their own file.

export const INDEX = 'MEMORY.md'
const TYPE_COLOR: Record<string, string> = { project: 'cyan', feedback: 'yellow', reference: 'blue', user: 'magenta' }
// What each memory type is for, and why it matters to the model. The four types are the memory system's own taxonomy.
const TYPE_HELP: Record<string, string> = {
  user: 'user: who you are, your role and preferences. Shapes every answer.',
  feedback: 'feedback: how to work with you, corrections and confirmed approaches, with the why. Applied to every similar task.',
  project: 'project: ongoing work, goals and deadlines not visible in the code. Goes stale, so check its dates.',
  reference: 'reference: pointers to external systems (dashboards, tickets, docs). Tells the model where to look.',
}
const UNTYPED = 'untyped: no type in the frontmatter, so the model cannot tell when it applies.'
const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
const tail = (path: string) => path.split('/').slice(-2).join('/')
const clip = (text: string, n = 70) => (text.length > n ? `${text.slice(0, n - 1)}…` : text)

export type MemoryData = { list: Memory[]; meta: MemoryMeta; use: Record<string, MemoryUse>; opened: MemoryView | null; filter: string; room: number }
export type MemoryActions = { open: (name: string) => void; back: () => void; filter: (type: string) => void; refresh: () => void }
type Ui = { Box: any; Text: any; Button: any; Markdown: any } // ponytail: terminal elements, untyped here; register.tsx provides them from $.ui.resolve

export const memoriesView = ({ Box, Text, Button, Markdown }: Ui, { list, meta, use, opened, filter, room }: MemoryData, act: MemoryActions) => {
  const back = backlinks(list)
  const names = new Set(list.map(m => m.name))
  const edges = list.reduce((n, m) => n + m.links.filter(l => names.has(l)).length, 0)
  const lonely = isolated(list)
  const marks = (name: string) => {
    const u = use[name]

    return u ? `${u.read ? ` ◉${u.read}` : ''}${u.write ? ` ✎${u.write}` : ''}${u.recalled ? ` ↺${u.recalled}` : ''}` : ''
  }
  const open = (name: string) => () => act.open(name)

  if (!meta.loaded) return <Text dimColor>Reading the project memory…</Text>
  if (!list.length) return <Text dimColor>The project has no memories in {meta.dir || '—'}.</Text>

  // An open memory: its neighbors in the graph (what it cites, who cites it) and how it was used.
  const node = opened && list.find(m => m.name === opened.name)
  if (opened && node) {
    const out = node.links
    const inc = back[node.name] ?? []
    const u = use[node.name]
    const edge = (name: string, i: number, all: string[], dir: string) => (
      <Box key={`${dir}-${name}`}>
        <Text dimColor>{i === all.length - 1 ? '  └─ ' : '  ├─ '}</Text>
        {names.has(name) ? (
          <Button key={`go-${dir}-${name}`} plain label={name} onPress={open(name)} />
        ) : (
          <Text color="red">✗ {name} (does not exist yet)</Text>
        )}
        <Text dimColor>{marks(name)}</Text>
      </Box>
    )

    return (
      <Box flexDirection="column">
        <Box justifyContent="space-between">
          <Text bold color={TYPE_COLOR[node.type]} wrap="truncate-end">◆ {node.name}</Text>
          <Button key="mem-back" plain label="← graf" hotkey="b" onPress={act.back} />
        </Box>
        <Text dimColor wrap="wrap">{node.type} · {k(node.size)} B · {node.description}</Text>
        <Text dimColor wrap="wrap">{TYPE_HELP[node.type] ?? UNTYPED}</Text>
        <Text wrap="wrap">
          <Text dimColor>in prompt (MEMORY.md): </Text>
          {node.indexed ? <Text>„{node.hook}”</Text> : <Text color="red">missing from the index: the model sees it only if it looks for it</Text>}
        </Text>
        <Text dimColor>
          in session: read {u?.read ?? 0} · written {u?.write ?? 0} · recalled {u?.recalled ?? 0}
        </Text>
        <Box flexDirection="column" marginTop={1}>
          <Text bold dimColor>LINKS TO → {out.length}</Text>
          {out.length === 0 && <Text dimColor>  —</Text>}
          {out.map((n, i) => edge(n, i, out, 'out'))}
          <Text bold dimColor>CITED BY ← {inc.length}</Text>
          {inc.length === 0 && <Text dimColor>  —</Text>}
          {inc.map((n, i) => edge(n, i, inc, 'in'))}
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Markdown text={opened.body} />
        </Box>
      </Box>
    )
  }

  const types = Object.entries(list.reduce<Record<string, number>>((acc, m) => ({ ...acc, [m.type]: (acc[m.type] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1])
  const shown = list
    .filter(m => filter === 'all' || m.type === filter)
    .map(m => ({ m, inN: back[m.name]?.length ?? 0, outN: m.links.length }))
    .sort((a, b) => b.inN + b.outN - (a.inN + a.outN) || a.m.name.localeCompare(b.m.name))
  const maxDeg = Math.max(1, ...shown.map(s => s.inN + s.outN))
  const rows = Math.max(6, room - 10)
  const idx = use[INDEX]
  const reads = Object.entries(use).filter(([n, u]) => n !== INDEX && u.read).length
  const writes = Object.values(use).reduce((n, u) => n + u.write, 0)
  const recalled = Object.entries(use).filter(([, u]) => u.recalled).length
  const missing = list.filter(m => !m.indexed).length

  return (
    <Box flexDirection="column">
      <Text wrap="truncate-start" dimColor>{meta.dir}</Text>
      <Text>
        <Text bold>{list.length}</Text>
        <Text dimColor> memories · </Text>
        <Text bold>{edges}</Text>
        <Text dimColor> links · {lonely.length} isolated</Text>
        {missing > 0 && <Text color="red"> · {missing} outside the index</Text>}
      </Text>
      <Text wrap="wrap" dimColor>user = who you are · feedback = how to work with you · project = ongoing work · reference = where to look</Text>

      <Box marginTop={1} flexDirection="column">
        {meta.context.map(f => (
          <Text key={`ctx-${f.path}`} wrap="truncate-end">
            <Text color="green">in prompt </Text>
            <Text>{tail(f.path)}</Text>
            <Text dimColor> {f.type} · {k(f.tokens)} tok, on every request</Text>
          </Text>
        ))}
        {meta.context.length === 0 && <Text dimColor>in prompt  nothing from memory in context</Text>}
        <Text wrap="truncate-end">
          <Text color="cyan">◉ read {reads}</Text>
          <Text color="blue">  ↺ recalled {recalled}</Text>
          <Text color="yellow">  ✎ written {writes}</Text>
          {idx?.read ? <Text dimColor>  (MEMORY.md read ×{idx.read})</Text> : null}
        </Text>
        <Text dimColor wrap="wrap">◉ opened as a file · ↺ attached by the engine · ✎ edited in memory/ · ←cited by →links to</Text>
        {meta.remember.length > 0 && (
          <Text wrap="wrap" dimColor>
            <Text color="magenta">+ .remember </Text>
            {meta.remember.map(f => `${f.name} ${k(f.size)}`).join(' · ')} (remember plugin, at SessionStart)
          </Text>
        )}
      </Box>

      <Box marginTop={1} gap={1} flexWrap="wrap">
        {[['all', list.length] as [string, number], ...types].map(([t, n]) => (
          <Button key={`mt-${t}`} label={`${t} ${n}`} variant={filter === t ? 'primary' : 'secondary'} onPress={() => act.filter(t)} />
        ))}
        <Button key="mem-refresh" plain label="↻" onPress={act.refresh} />
      </Box>
      {filter !== 'all' && <Text wrap="wrap" dimColor>{TYPE_HELP[filter] ?? UNTYPED}</Text>}
      {shown.slice(0, rows).map(({ m, inN, outN }) => {
        const cells = Math.max(inN + outN ? 1 : 0, Math.round(((inN + outN) / maxDeg) * 6))
        const text = m.description || m.hook

        return (
          <Box key={`mem-${m.name}`}>
            <Text color={TYPE_COLOR[m.type]}>{'▮'.repeat(cells).padEnd(6, '·')} </Text>
            <Button key={`mo-${m.name}`} plain label={m.name} onPress={open(m.name)} />
            {text ? <Text dimColor>  </Text> : null}
            {text ? <Button key={`md-${m.name}`} plain label={clip(text)} onPress={open(m.name)} /> : null}
            <Text dimColor>
              {`  ←${inN} →${outN}`}
            </Text>
            <Text color="green">{marks(m.name)}</Text>
            {!m.indexed && <Text color="red"> !idx</Text>}
          </Box>
        )
      })}
      {shown.length > rows && <Text dimColor>… +{shown.length - rows} (filter by type)</Text>}
    </Box>
  )
}
