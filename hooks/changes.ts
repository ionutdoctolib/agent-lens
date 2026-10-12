// The "Git" tab: only the modified files, not the whole tree. The commands (`status --porcelain=v1 -z`,
// `diff HEAD --numstat -z`) follow the approach from data-goblin/claude-code-filetree (MIT).
import type { Change } from '../types'

export const parseStatus = (out: string): { branch: string; changes: Change[] } => {
  const parts = out.split('\0').filter(Boolean)
  const changes: Change[] = []
  let branch = ''
  for (let i = 0; i < parts.length; i++) {
    const rec = parts[i] ?? ''
    if (rec.startsWith('## ')) {
      branch = rec.slice(3)
      continue
    }
    const [x = ' ', y = ' '] = rec
    const path = rec.slice(3)
    if (x === 'R' || x === 'C') i++ // the next record is the old path
    const isNew = x === '?'
    const isConflict = x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')
    changes.push({
      path,
      code: isNew ? '?' : isConflict ? 'U' : x !== ' ' ? x : y,
      staged: !isNew && !isConflict && x !== ' ',
      unstaged: isNew || isConflict || y !== ' ',
      add: 0,
      del: 0,
    })
  }

  return { branch, changes }
}

export const parseNumstat = (out: string): Record<string, [number, number]> => {
  const parts = out.split('\0')
  const nums: Record<string, [number, number]> = {}
  for (let i = 0; i < parts.length; i++) {
    const m = (parts[i] ?? '').match(/^(\d+|-)\t(\d+|-)\t([\s\S]*)$/)
    if (!m) continue
    let path = m[3] ?? ''
    if (path === '') {
      i += 2 // rename: the old path follows, then the new one
      path = parts[i] ?? ''
    }
    nums[path] = [Number(m[1]) || 0, Number(m[2]) || 0]
  }

  return nums
}

// "master...origin/master [ahead 1]" → { name, sync }
export const branchLabel = (line: string) => {
  const name = line.split('...')[0]?.replace(/^No commits yet on /, '') ?? ''
  const ahead = line.match(/ahead (\d+)/)?.[1]
  const behind = line.match(/behind (\d+)/)?.[1]

  return { name, upstream: line.includes('...'), gone: line.includes('[gone]'), ahead: Number(ahead ?? 0), behind: Number(behind ?? 0), sync: `${ahead ? `↑${ahead}` : ''}${behind ? `↓${behind}` : ''}` }
}

// Sync = only what is missing, after a `fetch`: no upstream → push -u; behind → pull; ahead → push.
// Upstream `[gone]` (branch deleted on the remote, usually after a merge): nothing, so it isn't re-created.
// ponytail: pull is --ff-only only; on diverged branches it stops with git's error, rebase/merge stay manual
export const syncSteps = (b: ReturnType<typeof branchLabel>): string[][] => {
  if (b.gone) return []
  if (!b.upstream) return [['push', '-u', 'origin', 'HEAD']]

  return [...(b.behind ? [['pull', '--ff-only']] : []), ...(b.ahead ? [['push']] : [])]
}

export type Outcome = { ok: boolean; text: string }

// The first useful line of a git command's output (without the `hint:` suggestions).
export const outcomeOf = (run: { exitCode: number; stdout: string; stderr: string }): Outcome => {
  const lines = (run.exitCode === 0 ? run.stdout : run.stderr || run.stdout).split('\n').map(l => l.trim()).filter(Boolean)

  return { ok: run.exitCode === 0, text: lines.find(l => !l.startsWith('hint:')) ?? (run.exitCode === 0 ? 'done' : 'failed') }
}

// Whether or not `diff` was read, files come sorted by path and with line counts filled in.
export const withCounts = (changes: Change[], nums: Record<string, [number, number]>) =>
  changes.map(c => ({ ...c, add: nums[c.path]?.[0] ?? 0, del: nums[c.path]?.[1] ?? 0 })).sort((a, b) => a.path.localeCompare(b.path))

// Cuts at a whole line (a hunk cut in the middle no longer parses); without a newline, cuts at the limit.
export const clip = (text: string, max: number) => {
  if (text.length <= max) return text
  const cut = text.slice(0, max)

  return cut.slice(0, cut.lastIndexOf('\n') + 1 || max)
}

// Haiku sometimes wraps the answer in quotes or a code fence: keep the first useful line.
export const cleanMessage = (text: string) =>
  (text.split('\n').map(l => l.trim()).find(l => l && !l.startsWith('```')) ?? '').replace(/^["'`]+|["'`]+$/g, '')
