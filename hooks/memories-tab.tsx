import type { Memory, MemoryMeta, MemoryUse, MemoryView } from '../types'
import { backlinks, isolated } from './memories'

// Memories tab, drawing only. Whatever touches `$` (reading the directory, tracking tools) lives in
// register.tsx, with the atoms: the engine does not let `$` pass into an imported function and reads atoms only from their own file.

export const INDEX = 'MEMORY.md'
const TYPE_COLOR: Record<string, string> = { project: 'cyan', feedback: 'yellow', reference: 'blue', user: 'magenta' }
const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
const tail = (path: string) => path.split('/').slice(-2).join('/')

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
  const rows = Math.max(5, room - 14)
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

      <Box flexDirection="column" marginTop={1}>
        <Text bold dimColor>HOW THEY REACH THE MODEL</Text>
        {meta.context.map(f => (
          <Text key={`ctx-${f.path}`} wrap="truncate-end">
            <Text color="green">1 prompt </Text>
            <Text>{tail(f.path)}</Text>
            <Text dimColor> {f.type} · {k(f.tokens)} tok, on every request</Text>
          </Text>
        ))}
        {meta.context.length === 0 && <Text dimColor>1 prompt  nothing from memory in context</Text>}
        <Text wrap="truncate-end">
          <Text color="cyan">2 read    </Text>
          <Text dimColor>whole file, via Read/Bash when the index looks relevant: </Text>
          <Text bold>{reads}</Text>
          {idx?.read ? <Text dimColor> (+ MEMORY.md ×{idx.read})</Text> : null}
        </Text>
        <Text wrap="truncate-end">
          <Text color="blue">3 recall   </Text>
          <Text dimColor>attached by the engine: </Text>
          <Text bold>{recalled}</Text>
          <Text dimColor> ({meta.recalls.length} attachments)</Text>
        </Text>
        <Text wrap="truncate-end">
          <Text color="yellow">4 write    </Text>
          <Text dimColor>Write/Edit in memory/: </Text>
          <Text bold>{writes}</Text>
        </Text>
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
      <Text dimColor>graph: ←cited by →links to · ◉read ✎written ↺recalled</Text>
      {shown.slice(0, rows).map(({ m, inN, outN }) => {
        const cells = Math.max(inN + outN ? 1 : 0, Math.round(((inN + outN) / maxDeg) * 6))

        return (
          <Box key={`mem-${m.name}`}>
            <Text color={TYPE_COLOR[m.type]}>{'▮'.repeat(cells).padEnd(6, '·')} </Text>
            <Button key={`mo-${m.name}`} plain label={m.name} onPress={open(m.name)} />
            <Text dimColor wrap="truncate-end">
              {' '}←{inN} →{outN}
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
