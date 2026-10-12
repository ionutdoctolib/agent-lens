import { expect, test } from 'claude-code/testing'

import { classify, pickSubagentModel, tagged, verdictOf } from '../hooks/router'

test('opus is the default; haiku for short lookups, sonnet for mechanical work', () => {
  expect(classify('unde e controllerul de plăți?').tier).toBe('haiku')
  expect(classify('redenumește câmpul name în title în Fabric').tier).toBe('sonnet')
  expect(classify('adaugă un buton de export pe pagina de comenzi').tier).toBe('sonnet')
  expect(classify('de ce crapă importul Nexus?').tier).toBe('opus')
  expect(classify('vreau o pagină nouă pentru stocuri').tier).toBe('opus')
  expect(classify('unde e X? '.repeat(40)).tier).toBe('opus')
})

test('whole words, diacritics and change verbs (Romanian and English)', () => {
  expect(classify('adaugă câmp categorie pe produs').tier).toBe('sonnet')
  expect(classify('fă lista de prețuri să afișeze TVA').tier).toBe('opus')
  expect(classify('arată-mi cum se calculează discountul și repară-l').tier).toBe('opus')
  expect(classify('șterge coloana veche').tier).toBe('sonnet')
  expect(classify('sterge coloana veche').tier).toBe('sonnet')
  expect(classify('câte comenzi am azi?').tier).toBe('haiku')
  expect(classify('listează controllerele Nexus').tier).toBe('haiku')
  // UI touch-ups: colors, bars, borders → sonnet, even with a change verb
  expect(classify('adaugă și contextul în bară si combina').tier).toBe('sonnet')
  expect(classify('fă bordura verde').tier).toBe('sonnet')
  expect(classify('barbar fix').tier).toBe('opus')
  // English prompts are detected too
  expect(classify('where is the payments controller?').tier).toBe('haiku')
  expect(classify('rename the name field to title').tier).toBe('sonnet')
  expect(classify('why does the import crash?').tier).toBe('opus')
})

test('quoted or pasted text does not raise the turn to opus', () => {
  expect(classify('scoate mesajul „Eroare la import, de ce nu merge”').tier).toBe('sonnet')
  expect(classify('scoate tabul <pasted_content id="x">audit debug crash</pasted_content id="x">').tier).toBe('sonnet')
  expect(classify('scoate textul: Niciun plan pentru cererea asta, fa si la astea scurte').tier).toBe('sonnet')
  expect(classify('planifică migrarea comenzilor').tier).toBe('opus')
})

test('subagents: requested model honored, lookups on haiku, the rest on opus', () => {
  expect(pickSubagentModel('Explore', 'Find callers').model).toBe('haiku')
  expect(pickSubagentModel('general-purpose', 'Caută controllerele Nexus').model).toBe('haiku')
  expect(pickSubagentModel('general-purpose', 'Implement drawer').model).toBe('opus')
  expect(pickSubagentModel('Plan', 'Design module', 'sonnet')).toEqual({ model: 'sonnet', why: 'requested' })
})

test('the [haiku] tag pins the model and is stripped from the text', () => {
  expect(classify('cum mascund sau arat agentlens').tier).toBe('haiku')
  expect(tagged('[Haiku] unde e X')).toEqual({ tier: 'haiku', text: 'unde e X' })
  expect(tagged('fără etichetă')).toEqual({ text: 'fără etichetă' })
})

test('the verdict is read from the last line', () => {
  expect(verdictOf('totul bine\nVERDICT: OK').isOk).toBe(true)
  expect(verdictOf('VERDICT: FAIL — lipsește testul')).toEqual({ isOk: false, line: 'VERDICT: FAIL — lipsește testul' })
  expect(verdictOf('fără verdict').line).toBe('VERDICT missing')
})
