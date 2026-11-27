import type { ConcertRecord } from './schema'

export interface RecordFilters {
  q: string
  year: string
  city: string
  type: string
}

const pick = (value: unknown) => (typeof value === 'string' ? value : '')

export function readFilters(query: Record<string, unknown>): RecordFilters {
  return { q: pick(query.q), year: pick(query.year), city: pick(query.city), type: pick(query.type) }
}

export function hasFilters(filters: RecordFilters): boolean {
  return Boolean(filters.q || filters.year || filters.city || filters.type)
}

export function filterRecords(records: ConcertRecord[], filters: RecordFilters): ConcertRecord[] {
  const needle = filters.q.trim().toLocaleLowerCase()
  return records.filter(
    (record) =>
      (!filters.year || record.date.startsWith(filters.year)) &&
      (!filters.city || record.city === filters.city) &&
      (!filters.type || record.type === filters.type) &&
      (!needle ||
        [record.title, record.artist, record.city, record.venue, ...record.tags]
          .join(' ')
          .toLocaleLowerCase()
          .includes(needle))
  )
}
