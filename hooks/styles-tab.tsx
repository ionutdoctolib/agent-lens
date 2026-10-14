import type { Style, StyleDraft } from '../types'

// Output style tab, drawing only (like memories-tab.tsx): what touches `$` lives in register.tsx.

const clip = (text: string, n = 60) => (text.length > n ? `${text.slice(0, n - 1)}…` : text)

export type StyleData = { list: Style[]; active: string; draft: StyleDraft | null; fresh: string; note: string; loaded: boolean }
export type StyleActions = {
  open: (file: string) => void
  back: () => void
  use: (file: string) => void
  desc: (v: string) => void
  line: (i: number, v: string) => void
  add: (i: number) => void
  drop: (i: number) => void
  save: () => void
  fresh: (v: string) => void
  create: (name: string) => void
  refresh: () => void
}
type Ui = { Box: any; Text: any; Button: any; Input: any } // ponytail: terminal elements, untyped here; register.tsx provides them from $.ui.resolve

export const stylesView = ({ Box, Text, Button, Input }: Ui, { list, active, draft, fresh, note, loaded }: StyleData, act: StyleActions) => {
  if (!loaded) return <Text dimColor>Reading the output styles…</Text>

  const status = note ? <Text wrap="wrap" color={note.startsWith('✗') ? 'red' : 'green'}>{note}</Text> : null
  const style = draft && list.find(s => s.file === draft.file)

  // An open style: description and instructions edited line by line. Enter in a field = save.
  if (draft && style) {
    const isActive = style.name === active

    return (
      <Box flexDirection="column">
        <Box justifyContent="space-between">
          <Text bold color={isActive ? 'green' : undefined} wrap="truncate-end">{isActive ? '● ' : '○ '}{style.name}</Text>
          <Button key="st-back" plain label="← list" hotkey="b" onPress={act.back} />
        </Box>
        <Text dimColor wrap="truncate-start">{style.file}{draft.dirty ? ' · unsaved changes' : ''}</Text>
        <Box gap={1} marginTop={1}>
          <Button key="st-use" variant="primary" label={isActive ? 'in use' : 'use this style'} onPress={() => act.use(style.file)} />
          <Button key="st-save" label="save" hotkey="s" onPress={act.save} />
        </Box>
        {status}
        <Box marginTop={1} flexDirection="column">
          <Input key="st-desc" label="description " placeholder="one line" value={draft.description} submitLabel="save" onInput={act.desc} onSubmit={act.save} />
          <Text bold dimColor>INSTRUCTIONS · one line per field</Text>
          {draft.lines.map((l, i) => (
            <Box key={`st-row-${i}`}>
              <Input key={`st-line-${i}`} placeholder="(empty line)" value={l} submitLabel="save" onInput={(v: string) => act.line(i, v)} onSubmit={act.save} />
              <Button key={`st-add-${i}`} plain label=" +" onPress={() => act.add(i)} />
              <Button key={`st-drop-${i}`} plain label=" ×" onPress={() => act.drop(i)} />
            </Box>
          ))}
        </Box>
        <Text dimColor wrap="wrap">+ inserts a line below · × removes it · a style change reaches the model from the next session.</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      <Text wrap="wrap">
        <Text bold>{list.length}</Text>
        <Text dimColor> styles · active: </Text>
        <Text bold color="green">{active || 'default'}</Text>
        <Button key="st-refresh" plain label=" ↻" onPress={act.refresh} />
      </Text>
      <Text dimColor wrap="wrap">Click a style to read and edit it · “use” writes outputStyle in settings.json, read at the start of the next session.</Text>
      {status}
      <Box marginTop={1} flexDirection="column">
        {list.map(s => (
          <Box key={`st-${s.file}`}>
            <Text color={s.name === active ? 'green' : undefined}>{s.name === active ? '● ' : '○ '}</Text>
            <Button key={`st-open-${s.file}`} plain label={s.name} onPress={() => act.open(s.file)} />
            <Text dimColor>  </Text>
            <Button key={`st-desc-${s.file}`} plain label={clip(s.description)} onPress={() => act.open(s.file)} />
            {s.name === active ? null : <Button key={`st-quick-${s.file}`} plain label="  use" onPress={() => act.use(s.file)} />}
          </Box>
        ))}
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text bold dimColor>NEW STYLE</Text>
        <Input key="st-new" label="name " placeholder={`name; starts as a copy of ${active || 'the first style'}`} value={fresh} submitLabel="create" onInput={act.fresh} onSubmit={act.create} />
      </Box>
    </Box>
  )
}
