import { expect, test } from 'claude-code/testing'

import { branchLabel, cleanMessage, clip, parseNumstat, parseStatus, syncSteps } from '../hooks/changes'

test('status: index, worktree, new, rename, conflict', () => {
  const out = ['## master...origin/master [ahead 2]', 'M  a.rb', ' M b.rb', 'MM c.rb', '?? d.rb', 'R  new.rb', 'old.rb', 'UU e.rb', 'A  dir/f.rb'].join('\0') + '\0'
  const { branch, changes } = parseStatus(out)
  expect(branch).toBe('master...origin/master [ahead 2]')
  expect(changes.map(c => c.path)).toEqual(['a.rb', 'b.rb', 'c.rb', 'd.rb', 'new.rb', 'e.rb', 'dir/f.rb'])
  expect(changes.map(c => [c.code, c.staged, c.unstaged])).toEqual([
    ['M', true, false],
    ['M', false, true],
    ['M', true, true],
    ['?', false, true],
    ['R', true, false],
    ['U', false, true],
    ['A', true, false],
  ])
})

test('numstat: regular, binary, rename', () => {
  const out = ['3\t1\ta.rb', '-\t-\timg.png', '2\t0\t', 'old.rb', 'new.rb'].join('\0') + '\0'
  expect(parseNumstat(out)).toEqual({ 'a.rb': [3, 1], 'img.png': [0, 0], 'new.rb': [2, 0] })
})

test('branch: name and sync', () => {
  expect(branchLabel('master...origin/master [ahead 2, behind 1]')).toEqual({ name: 'master', upstream: true, gone: false, ahead: 2, behind: 1, sync: '↑2↓1' })
  expect(branchLabel('No commits yet on main')).toEqual({ name: 'main', upstream: false, gone: false, ahead: 0, behind: 0, sync: '' })
})

test('sync: only the needed steps', () => {
  expect(syncSteps(branchLabel('feat'))).toEqual([['push', '-u', 'origin', 'HEAD']])
  expect(syncSteps(branchLabel('master...origin/master'))).toEqual([])
  expect(syncSteps(branchLabel('feat...origin/feat [gone]'))).toEqual([])
  expect(syncSteps(branchLabel('master...origin/master [behind 3]'))).toEqual([['pull', '--ff-only']])
  expect(syncSteps(branchLabel('master...origin/master [ahead 1]'))).toEqual([['push']])
  expect(syncSteps(branchLabel('master...origin/master [ahead 1, behind 2]'))).toEqual([['pull', '--ff-only'], ['push']])
})

test('clip cuts at a whole line', () => {
  expect(clip('ab\ncd\nef', 100)).toBe('ab\ncd\nef')
  expect(clip('ab\ncd\nef', 7)).toBe('ab\ncd\n')
  expect(clip('abcdef', 3)).toBe('abc')
})

test('cleanMessage strips the fence and quotes', () => {
  expect(cleanMessage('```\n"Add login form"\n```')).toBe('Add login form')
  expect(cleanMessage('  Fix typo  \nbody')).toBe('Fix typo')
  expect(cleanMessage('')).toBe('')
})
