// Output style tab: the styles are plain Markdown files in <config>/output-styles/, the active one is
// "outputStyle" in <config>/settings.json. Pure parsing/serialising here; the I/O lives in register.tsx.
import type { Style } from '../types'

const field = (front: string, key: string) => (front.match(new RegExp(`^${key}:[ \\t]*(.*)$`, 'm'))?.[1] ?? '').trim()

// Frontmatter (name, description, keep-coding-instructions) + the instructions body.
export const parseStyle = (file: string, raw: string): Style => {
  const text = raw.replace(/\r\n/g, '\n')
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  const front = m?.[1] ?? ''

  return {
    file,
    name: field(front, 'name') || file.replace(/\.md$/, ''),
    description: field(front, 'description'),
    keep: field(front, 'keep-coding-instructions') !== 'false',
    body: ((m ? m[2] : text) ?? '').trim(),
  }
}

const oneLine = (s: string) => s.replace(/\s*\n\s*/g, ' ').trim()

export const buildStyle = (s: Style) => `---\nname: ${oneLine(s.name)}\ndescription: ${oneLine(s.description)}\nkeep-coding-instructions: ${s.keep}\n---\n\n${s.body.trim()}\n`

// "My style!" -> "my-style": a safe file name from what the person typed.
export const slugName = (s: string) => s.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

// settings.json with `outputStyle` set; the file is plain JSON, written back with the same 2-space layout.
export const withOutputStyle = (settingsText: string, name: string) =>
  `${JSON.stringify({ ...(JSON.parse(settingsText || '{}') as Record<string, unknown>), outputStyle: name }, null, 2)}\n`

export const activeStyle = (settingsText: string) => {
  try {
    const v = (JSON.parse(settingsText) as { outputStyle?: unknown }).outputStyle

    return typeof v === 'string' ? v : ''
  } catch {
    return ''
  }
}
