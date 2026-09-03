import { describe, it, expect } from 'vitest'
import { sortLabelsByName } from '../labels'

const label = (id: string, name: string) => ({ id, projectId: 'p1', name, color: 'purple' })

describe('sortLabelsByName', () => {
  it('sorts alphabetically case-insensitively', () => {
    const sorted = sortLabelsByName([
      label('1', 'zebra'),
      label('2', 'Apple'),
      label('3', 'mango'),
      label('4', 'banana'),
    ])
    expect(sorted.map((l) => l.name)).toEqual(['Apple', 'banana', 'mango', 'zebra'])
  })

  it('treats case as a non-factor (locale base sensitivity)', () => {
    const sorted = sortLabelsByName([label('1', 'BUG'), label('2', 'api'), label('3', 'Chore')])
    expect(sorted.map((l) => l.name)).toEqual(['api', 'BUG', 'Chore'])
  })

  it('re-sorts after a rename', () => {
    const labels = [label('1', 'alpha'), label('2', 'beta'), label('3', 'gamma')]
    expect(sortLabelsByName(labels).map((l) => l.id)).toEqual(['1', '2', '3'])
    // Rename "alpha" -> "zulu": next render-time sort must move it last.
    const renamed = labels.map((l) => (l.id === '1' ? { ...l, name: 'zulu' } : l))
    expect(sortLabelsByName(renamed).map((l) => l.id)).toEqual(['2', '3', '1'])
  })

  it('slots a freshly created label into position', () => {
    const labels = [label('1', 'backend'), label('2', 'frontend')]
    const withNew = [...labels, label('3', 'design')]
    expect(sortLabelsByName(withNew).map((l) => l.name)).toEqual(['backend', 'design', 'frontend'])
  })

  it('does not mutate the input (server order preserved)', () => {
    const labels = [label('1', 'zebra'), label('2', 'apple')]
    const sorted = sortLabelsByName(labels)
    expect(labels.map((l) => l.name)).toEqual(['zebra', 'apple'])
    expect(sorted).not.toBe(labels)
  })

  it('handles unicode names via localeCompare', () => {
    const sorted = sortLabelsByName([label('1', 'Ötzi'), label('2', 'apple'), label('3', 'Zebra')])
    expect(sorted.map((l) => l.name)).toEqual(['apple', 'Ötzi', 'Zebra'])
  })
})
