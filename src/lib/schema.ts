import { z } from 'zod'

export const defaultEventTypes = ['音乐会', '演唱会', '音乐节', 'Livehouse', '其他'] as const
export const eventTypes = defaultEventTypes
export const programHalves = ['上半场', '下半场', '加演'] as const
export type ProgramHalf = '' | (typeof programHalves)[number]

const imagePath = z
  .string()
  .trim()
  .max(500)
  .refine((value) => {
    if (/^(photos|uploads)\/[a-zA-Z0-9._/-]+$/.test(value) && !value.includes('..')) {
      return true
    }
    if (/^https:\/\//i.test(value)) {
      try {
        const url = new URL(value)
        return url.protocol === 'https:' && Boolean(url.hostname) && !value.includes('..')
      } catch {
        return false
      }
    }
    return false
  }, '图片必须是项目内的 photos/、uploads/ 文件或有效的 HTTPS 图床地址')

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T12:00:00Z`)
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value
  }, '日期无效')

export const programItemSchema = z.object({
  title: z.string().trim().min(1).max(200),
  composer: z.string().trim().max(120).default(''),
  half: z.enum(['', '上半场', '下半场', '加演']).default('')
})

export type ProgramItem = z.infer<typeof programItemSchema>
export type ProgramEntry = string | ProgramItem

export const recordSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9-]{1,80}$/),
  title: z.string().trim().min(1).max(160),
  artist: z.string().trim().max(160).default(''),
  orchestra: z.string().trim().max(160).default(''),
  conductor: z.string().trim().max(120).default(''),
  soloists: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  date,
  city: z.string().trim().min(1).max(80),
  venue: z.string().trim().max(160).default(''),
  seat: z.string().trim().max(80).default(''),
  price: z.string().trim().max(40).default(''),
  status: z.enum(['watched', 'upcoming']).default('watched'),
  type: z.string().trim().min(1).max(30),
  rating: z.number().int().min(0).max(5),
  note: z.string().max(20000).default(''),
  tags: z.array(z.string().trim().min(1).max(40)).max(20),
  program: z.array(z.union([z.string().trim().min(1).max(300), programItemSchema])).max(100),
  images: z.array(imagePath).max(20),
  featured: z.boolean(),
  published: z.boolean(),
  demo: z.boolean()
})

export const archiveSchema = z
  .object({
    version: z.literal(1),
    settings: z.object({
      name: z.string().trim().min(1).max(40),
      englishName: z.string().trim().max(60),
      owner: z.string().trim().min(1).max(60),
      tagline: z.string().trim().min(1).max(120),
      bio: z.string().max(5000),
      categories: z
        .array(z.string().trim().min(1).max(30))
        .min(1)
        .max(20)
        .default([...defaultEventTypes])
    }),
    records: z.array(recordSchema).max(3000)
  })
  .superRefine((value, context) => {
    const ids = new Set<string>()
    value.records.forEach((record, index) => {
      if (ids.has(record.id))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['records', index, 'id'],
          message: '记录 ID 重复'
        })
      ids.add(record.id)
    })
  })

export type ConcertRecord = z.infer<typeof recordSchema>
export type Archive = z.infer<typeof archiveSchema>
export type PendingAsset = { path: string; base64: string }

export function normalizeProgramItem(entry: ProgramEntry): ProgramItem {
  if (typeof entry === 'string') {
    return { title: entry, composer: '', half: '' }
  }
  return {
    title: entry.title,
    composer: entry.composer ?? '',
    half: entry.half ?? ''
  }
}

export function formatCredits(record: Pick<ConcertRecord, 'orchestra' | 'conductor' | 'soloists' | 'artist'>): string {
  const parts: string[] = []
  if (record.orchestra) parts.push(record.orchestra)
  if (record.conductor) parts.push(`指挥 ${record.conductor}`)
  if (record.soloists.length) parts.push(record.soloists.join(' / '))
  if (parts.length) return parts.join(' · ')
  return record.artist
}

export function emptyRecord(defaultType = '音乐会'): ConcertRecord {
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  return {
    id: crypto.randomUUID(),
    title: '',
    artist: '',
    orchestra: '',
    conductor: '',
    soloists: [],
    date: today,
    city: '',
    venue: '',
    seat: '',
    price: '',
    status: 'watched',
    type: defaultType,
    rating: 0,
    note: '',
    tags: [],
    program: [],
    images: [],
    featured: false,
    published: true,
    demo: false
  }
}

export function dateLabel(date: string): string {
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(
    new Date(`${date}T12:00:00`)
  )
}

export function formatPriceLabel(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  return /^\d+(\.\d+)?$/.test(trimmed) ? `¥${trimmed}` : trimmed
}

export function assetUrl(path: string): string {
  if (/^https:\/\//i.test(path)) return path
  return `${import.meta.env.BASE_URL}${path}`
}
