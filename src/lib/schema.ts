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

export const castMemberSchema = z
  .object({
    name: z.string().trim().min(1).max(80).describe('演出人员姓名，按用户提供的写法保存'),
    role: z
      .string()
      .trim()
      .max(80)
      .default('')
      .describe('用户明确提供的职责或角色；未知时留空，不推测声部或伴奏职责')
  })
  .strict()

export const programItemSchema = z
  .object({
    title: z.string().trim().min(1).max(200).describe('曲目名称或唱段名称'),
    composer: z.string().trim().max(120).default('').describe('作曲，可包含多位作曲家'),
    half: z.enum(['', '上半场', '下半场', '加演']).default('').describe('节目单分段，保留原有顺序'),
    source: z.string().trim().max(200).default('').describe('剧目出处，保留用户提供的年份和剧目名称'),
    lyricist: z.string().trim().max(160).default('').describe('作词，可包含多位作词者及执笔说明'),
    performers: z
      .array(z.string().trim().min(1).max(80))
      .max(30)
      .default([])
      .describe('本首曲目的演唱或演奏者；没有提供时留空')
  })
  .strict()

export type ProgramItem = z.infer<typeof programItemSchema>
export type ProgramEntry = string | z.input<typeof programItemSchema>

export const recordSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9-]{1,80}$/),
  title: z.string().trim().min(1).max(160),
  subtitle: z
    .string()
    .trim()
    .max(160)
    .default('')
    .describe('演出副标题或巡演副标，未提供时留空；不得填入演员名单'),
  artist: z
    .string()
    .trim()
    .max(160)
    .default('')
    .describe(
      '仅兼容旧记录的历史署名字段。新录入用 cast 保存人员、subtitle 保存副标题；不要把人员名单填入此字段'
    ),
  cast: z
    .array(castMemberSchema)
    .max(100)
    .default([])
    .describe('演出人员或演员表，逐人保存姓名和已知职责，不重复塞进副标题、artist 或感想'),
  orchestra: z.string().trim().max(160).default(''),
  conductor: z.string().trim().max(120).default(''),
  soloists: z
    .array(z.string().trim().min(1).max(80))
    .max(20)
    .default([])
    .describe('仅用于用户明确标注的独奏家；一般音乐家或演员名单应使用 cast'),
  date,
  city: z.string().trim().min(1).max(80),
  venue: z.string().trim().max(160).default(''),
  seat: z.string().trim().max(80).default(''),
  price: z.string().trim().max(40).default(''),
  status: z.enum(['watched', 'upcoming']).default('watched'),
  type: z.string().trim().min(1).max(30),
  rating: z.number().int().min(0).max(5),
  note: z
    .string()
    .max(20000)
    .default('')
    .describe('仅保存用户的个人观演感想；用户没有提供时留空。不得放入节目单、演员表或自动编写的感想'),
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
  return programItemSchema.parse(typeof entry === 'string' ? { title: entry } : entry)
}

export function formatCredits(
  record: Pick<ConcertRecord, 'orchestra' | 'conductor' | 'soloists' | 'artist'> &
    Partial<Pick<ConcertRecord, 'cast'>>
): string {
  const parts: string[] = []
  if (record.orchestra) parts.push(record.orchestra)
  if (record.conductor) parts.push(`指挥 ${record.conductor}`)
  if (record.soloists.length) parts.push(record.soloists.join(' / '))
  if (parts.length) return parts.join(' · ')
  if (record.cast?.length) return `${record.cast.length}位演出人员`
  return record.artist
}

export function emptyRecord(defaultType = '音乐会'): ConcertRecord {
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  return {
    id: crypto.randomUUID(),
    title: '',
    subtitle: '',
    artist: '',
    cast: [],
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
