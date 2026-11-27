import { normalizeProgramItem, type ConcertRecord } from './schema'

export interface RecordFilters {
  q: string
  year: string
  city: string
  type: string
  status: string
}

const pick = (value: unknown) => (typeof value === 'string' ? value : '')

export function readFilters(query: Record<string, unknown>): RecordFilters {
  return {
    q: pick(query.q),
    year: pick(query.year),
    city: pick(query.city),
    type: pick(query.type),
    status: pick(query.status)
  }
}

export function hasFilters(filters: RecordFilters): boolean {
  return Boolean(filters.q || filters.year || filters.city || filters.type || filters.status)
}

export function filterRecords(records: ConcertRecord[], filters: RecordFilters): ConcertRecord[] {
  const needle = filters.q.trim().toLocaleLowerCase()
  return records.filter(
    (record) =>
      (!filters.year || record.date.startsWith(filters.year)) &&
      (!filters.city || record.city === filters.city) &&
      (!filters.type || record.type === filters.type) &&
      (!filters.status || record.status === filters.status) &&
      (!needle ||
        [
          record.title,
          record.subtitle,
          record.artist,
          ...record.cast.map((person) => `${person.name} ${person.role}`),
          record.orchestra,
          record.conductor,
          ...record.soloists,
          record.city,
          record.venue,
          record.seat,
          ...record.tags,
          ...record.program.map((p) => {
            const item = normalizeProgramItem(p)
            return `${item.composer} ${item.title} ${item.source} ${item.lyricist} ${item.section} ${item.description} ${item.credits.map((credit) => `${credit.role} ${credit.name}`).join(' ')} ${item.performers.join(' ')}`
          })
        ]
          .join(' ')
          .toLocaleLowerCase()
          .includes(needle))
  )
}
