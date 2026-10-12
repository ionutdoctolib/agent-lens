// Memories tab: the current project's auto memory (~/.claude/projects/<slug>/memory) as a graph.
// Only the open project's directory: other projects' memories live in other slugs and are not read.
import type { Memory } from '../types'

// Same slug as the engine: any non-alphanumeric character in the path becomes "-".
export const projectSlug = (root: string) => root.replace(/[^a-zA-Z0-9]/g, '-')

const field = (front: string, key: string) => {
  const m = front.match(new RegExp(`^\\s*${key}:\\s*(.*)$`, 'm'))

  return (m?.[1] ?? '').trim().replace(/^"(.*)"$/, '$1').replace(/\\"/g, '"')
}

// Frontmatter (name, description, type — also under `metadata:`) + the [[name]] links from the body.
export const parseMemory = (file: string, text: string) => {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  const front = m?.[1] ?? ''
  const body = (m ? m[2] : text) ?? ''
  const links = [...new Set([...body.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)].map(l => (l[1] ?? '').trim()))]

  return {
    name: field(front, 'name') || file.replace(/\.md$/, ''),
    type: field(front, 'type') || 'untyped',
    description: field(front, 'description'),
    links,
    body: body.trim(),
  }
}

// MEMORY.md: "- [Title](file.md) — hook", one line per memory.
export const parseIndex = (text: string) => {
  const out: Record<string, { title: string; hook: string }> = {}
  for (const m of text.matchAll(/^\s*-\s*\[([^\]]+)\]\(([^)]+\.md)\)\s*(?:[—–-]\s*(.*))?$/gm)) {
    out[m[2] ?? ''] = { title: m[1] ?? '', hook: (m[3] ?? '').trim() }
  }

  return out
}

// Incoming links: who links to each memory.
export const backlinks = (list: readonly Pick<Memory, 'name' | 'links'>[]) => {
  const out: Record<string, string[]> = {}
  for (const m of list) for (const to of m.links) (out[to] ??= []).push(m.name)

  return out
}

// Which memories a text names (a Bash command, an attachment): by file, as "…/name.md", not as the suffix of another name.
export const namesIn = (text: string, list: readonly Pick<Memory, 'name' | 'file'>[]) =>
  list.filter(m => new RegExp(`(^|[/\\s"'(\\[])${m.file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(text)).map(m => m.name)

// Memories with no link at all, in either direction.
export const isolated = (list: readonly Pick<Memory, 'name' | 'links'>[]) => {
  const back = backlinks(list)

  return list.filter(m => m.links.length === 0 && !back[m.name]?.length).map(m => m.name)
}
