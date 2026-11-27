import { z } from 'zod'

export const eventTypes = ['音乐会', '演唱会', '音乐节', 'Livehouse', '其他'] as const
const imagePath = z
  .string()
  .max(500)
  .refine(
    (value) => /^(photos|uploads)\/[a-zA-Z0-9._/-]+$/.test(value) && !value.includes('..'),
    '图片必须是项目里的 photos/ 或 uploads/ 文件'
  )
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T12:00:00Z`)
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value
  }, '日期无效')

export const recordSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9-]{1,80}$/),
  title: z.string().trim().min(1).max(160),
  artist: z.string().trim().max(160),
  date,
  city: z.string().trim().min(1).max(80),
  venue: z.string().trim().max(160),
  type: z.enum(eventTypes),
  rating: z.number().int().min(0).max(5),
  note: z.string().max(20000),
  tags: z.array(z.string().trim().min(1).max(40)).max(20),
  program: z.array(z.string().trim().min(1).max(300)).max(100),
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
      bio: z.string().max(5000)
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
export function emptyRecord(): ConcertRecord {
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  return {
    id: crypto.randomUUID(),
    title: '',
    artist: '',
    date: today,
    city: '',
    venue: '',
    type: '音乐会',
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
export function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`
}
