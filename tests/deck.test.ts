import { describe, expect, it } from 'vitest'
import {
  canLoopDeck,
  cardPose,
  circularOffset,
  initialDeckIndex,
  projectTarget,
  rubberBand,
  springStep,
  wrapIndex
} from '../src/lib/deck'
import { filterRecords, readFilters } from '../src/lib/filters'
import { archiveFixture } from './fixtures/archive'
import { archiveSchema } from '../src/lib/schema'

describe('poster deck motion', () => {
  it('wraps indices and takes the shortest circular path', () => {
    expect(wrapIndex(-1, 6)).toBe(5)
    expect(wrapIndex(13, 6)).toBe(1)
    expect(circularOffset(5, 0, 6, true)).toBe(-1)
    expect(circularOffset(1, 5.5, 6, true)).toBeCloseTo(1.5)
    expect(circularOffset(5, 0, 6, false)).toBe(5)
  })

  it('settles the spring on its target without drifting', () => {
    let p = 0
    let v = 0
    for (let i = 0; i < 240; i++) [p, v] = springStep(p, v, 3, 1 / 120)
    expect(p).toBeCloseTo(3, 2)
    expect(Math.abs(v)).toBeLessThan(0.05)
  })

  it('projects flings and short drags to a neighbouring card', () => {
    expect(projectTarget(2, 2.05, 0)).toBe(2)
    expect(projectTarget(2, 2.2, 0)).toBe(3)
    expect(projectTarget(2, 1.95, -3)).toBe(1)
    expect(projectTarget(2, 2.6, 30)).toBe(7)
  })

  it('keeps the centre card upright and fades far cards', () => {
    const centre = cardPose(0, 200)
    expect(centre.x).toBe(0)
    expect(centre.shade).toBe(0)
    expect(centre.opacity).toBe(1)
    expect(cardPose(4, 200).visible).toBe(false)
    expect(cardPose(4.2, 200, 1, 4.6).visible).toBe(true)
    expect(rubberBand(10)).toBeLessThan(0.32)
  })

  it('enables continuous looping only when enough records exist to avoid visible duplicates', () => {
    expect(canLoopDeck(1)).toBe(false)
    expect(canLoopDeck(6)).toBe(false)
    expect(canLoopDeck(8)).toBe(false)
    expect(canLoopDeck(9)).toBe(true)
    expect(initialDeckIndex(6, -1, 0)).toBe(2)
    expect(initialDeckIndex(6, 4, 0)).toBe(4)
    expect(initialDeckIndex(10, -1, 1)).toBe(1)
  })
})

describe('record filters', () => {
  const records = archiveSchema.parse(archiveFixture).records

  it('reads only string query values and matches keywords case-insensitively', () => {
    const filters = readFilters({ q: ' LIVEHOUSE ', year: ['2025'] })
    expect(filters.year).toBe('')
    expect(filterRecords(records, filters).map((record) => record.id)).toEqual(['test-livehouse'])
  })
})
