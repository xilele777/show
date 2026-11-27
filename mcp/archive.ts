import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { archiveSchema, recordSchema, type Archive, type ConcertRecord } from '../src/lib/schema'
import { splitPerformerNames } from '../src/lib/program'

const inputNoteSchema = z
  .string()
  .max(20000)
  .refine(
    (note) =>
      !note
        .split(/\r?\n/)
        .some(
          (line) => /[|｜]/.test(line) && /曲目(?:名称)?/.test(line) && /作曲|作词|演唱|剧目出处/.test(line)
        ),
    'note 仅用于个人感想，检测到节目单表格；请将曲目、出处、作词、作曲和演唱者填入 program。'
  )
  .describe(recordSchema.shape.note.description!)

function checkCreditPlacement(
  value: { cast?: { name: string }[]; subtitle?: string; artist?: string },
  context: z.RefinementCtx
) {
  const names = value.cast?.map((person) => person.name) ?? []
  if (names.length < 2) return
  for (const field of ['subtitle', 'artist'] as const) {
    const words = splitPerformerNames(value[field] ?? '')
    if (words.length === names.length && words.every((word) => names.includes(word))) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [field],
        message: `${field} 中重复填写了演员名单；演出人员请只保存在 cast，副标题未提供时留空。`
      })
    }
  }
}

export const runFile = promisify(execFile)
export const revisionOf = (archive: Archive) =>
  createHash('sha256')
    .update(JSON.stringify(archiveSchema.parse(archive)))
    .digest('hex')

export const createRecordSchema = recordSchema
  .omit({ demo: true })
  .extend({
    id: recordSchema.shape.id.optional(),
    status: recordSchema.shape.status.removeDefault().optional(),
    rating: recordSchema.shape.rating.default(0),
    note: inputNoteSchema.default(''),
    tags: recordSchema.shape.tags.default([]),
    program: recordSchema.shape.program.default([]),
    images: recordSchema.shape.images.default([]),
    featured: recordSchema.shape.featured.default(false),
    published: recordSchema.shape.published.default(true)
  })
  .strict()
  .superRefine(checkCreditPlacement)
export const changesSchema = recordSchema
  .omit({ id: true, demo: true })
  .partial()
  .extend({ note: inputNoteSchema.optional() })
  .strict()
  .superRefine(checkCreditPlacement)
export const batchCreateSchema = z
  .object({
    records: z.array(createRecordSchema).min(1).max(100),
    dryRun: z.boolean().default(false),
    expectedRevision: z.string().optional()
  })
  .strict()
export const batchUpdateSchema = z
  .object({
    updates: z
      .array(
        z
          .object({
            id: recordSchema.shape.id,
            changes: changesSchema.refine((value) => Object.keys(value).length > 0, '修改字段不能为空')
          })
          .strict()
      )
      .min(1)
      .max(100),
    dryRun: z.boolean().default(false),
    expectedRevision: z.string().optional()
  })
  .strict()

function identity(record: ConcertRecord) {
  return JSON.stringify(
    [record.title, record.date, record.city, record.venue].map((value) =>
      value.normalize('NFKC').replace(/\s+/g, '').toLowerCase()
    )
  )
}

export class ArchiveStore {
  readonly contentPath: string
  readonly stateDirectory: string
  constructor(readonly root: string) {
    this.contentPath = join(root, 'public/content/archive.json')
    this.stateDirectory = join(root, '.concshow-mcp')
  }
  async read() {
    return archiveSchema.parse(JSON.parse(await readFile(this.contentPath, 'utf8')))
  }
  async locked<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(this.stateDirectory, { recursive: true })
    const lockPath = join(this.stateDirectory, 'write.lock')
    let lock
    try {
      lock = await open(lockPath, 'wx')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        throw new Error(
          '另一个写入正在进行，请稍后重试。若进程异常退出，确认没有写入进程后移除 .concshow-mcp/write.lock。'
        )
      throw error
    }
    try {
      await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }))
      return await operation()
    } finally {
      await lock.close()
      await unlink(lockPath)
    }
  }
  private async atomic(path: string, value: unknown) {
    const temp = `${path}.${randomUUID()}.tmp`
    try {
      await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' })
      await rename(temp, path)
    } finally {
      await unlink(temp).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
      })
    }
  }
  async baseline(fallback: Archive): Promise<Archive> {
    try {
      return archiveSchema.parse(
        JSON.parse(await readFile(join(this.stateDirectory, 'baseline.json'), 'utf8'))
      )
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    try {
      const { stdout } = await runFile('git', ['show', 'HEAD:public/content/archive.json'], {
        cwd: this.root,
        maxBuffer: 20_000_000,
        timeout: 10_000,
        windowsHide: true
      })
      return archiveSchema.parse(JSON.parse(stdout))
    } catch {
      return fallback
    }
  }
  async markBaseline(archive: Archive) {
    await this.atomic(join(this.stateDirectory, 'baseline.json'), archive)
  }
  // Call inside locked(); each batch produces a single replacement and recoverable snapshot.
  async save(next: Archive, before: Archive) {
    const validated = archiveSchema.parse(next)
    if (revisionOf(await this.read()) !== revisionOf(before))
      throw new Error('本地内容已变化，请重新读取后重试')
    try {
      await readFile(join(this.stateDirectory, 'baseline.json'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      await this.markBaseline(await this.baseline(before))
    }
    const backupDirectory = join(this.root, '.concshow-backups')
    await mkdir(backupDirectory, { recursive: true })
    const backup = join(backupDirectory, `archive.mcp.${Date.now()}.${randomUUID()}.json`)
    await writeFile(backup, `${JSON.stringify(before, null, 2)}\n`, { flag: 'wx' })
    await this.atomic(this.contentPath, validated)
    return backup
  }
  async create(input: unknown) {
    const args = batchCreateSchema.parse(input)
    const operation = async () => {
      const before = await this.read()
      checkRevision(before, args.expectedRevision)
      const next = structuredClone(before)
      const ids = new Map(next.records.map((record) => [record.id, record]))
      const identities = new Map(next.records.map((record) => [identity(record), record]))
      const created: ConcertRecord[] = []
      const skipped: { index: number; id: string; title: string; reason: string }[] = []
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
      args.records.forEach((input, index) => {
        const record = recordSchema.parse({
          ...input,
          id: input.id ?? randomUUID(),
          demo: false,
          status: input.status ?? (input.date > today ? 'upcoming' : 'watched')
        })
        const byId = ids.get(record.id)
        if (byId && identity(byId) !== identity(record))
          throw new Error(`第 ${index + 1} 条记录 ID 已被另一场演出使用，请通过修改工具编辑`)
        const duplicate = byId ?? identities.get(identity(record))
        if (duplicate) {
          skipped.push({
            index,
            id: duplicate.id,
            title: duplicate.title,
            reason: '相同 ID 或标题、日期、城市、场馆已存在；补充资料请调用修改工具'
          })
          return
        }
        created.push(record)
        next.records.push(record)
        ids.set(record.id, record)
        identities.set(identity(record), record)
        if (!next.settings.categories.includes(record.type)) next.settings.categories.push(record.type)
      })
      archiveSchema.parse(next)
      const backup = !args.dryRun && created.length ? await this.save(next, before) : undefined
      return {
        dryRun: args.dryRun,
        created,
        skipped,
        backup,
        revision: revisionOf(args.dryRun ? before : next),
        message: args.dryRun
          ? '预览完成，尚未写入'
          : '已保存到本地项目；刷新管理页查看，发布后才会更新线上网站'
      }
    }
    return args.dryRun ? operation() : this.locked(operation)
  }
  async update(input: unknown) {
    const args = batchUpdateSchema.parse(input)
    const operation = async () => {
      const before = await this.read()
      checkRevision(before, args.expectedRevision)
      const next = structuredClone(before)
      const touched = new Set<string>()
      const updated: ConcertRecord[] = []
      for (const { id, changes } of args.updates) {
        if (touched.has(id)) throw new Error(`同一批次重复修改 ID：${id}`)
        touched.add(id)
        const index = next.records.findIndex((record) => record.id === id)
        if (index < 0) throw new Error(`找不到记录：${id}`)
        const record = recordSchema.parse({ ...next.records[index], ...changes })
        if (next.records.some((other) => other.id !== id && identity(other) === identity(record)))
          throw new Error(`修改后会与已有演出重复：${record.title}`)
        next.records[index] = record
        updated.push(record)
        if (!next.settings.categories.includes(record.type)) next.settings.categories.push(record.type)
      }
      archiveSchema.parse(next)
      const changed = revisionOf(next) !== revisionOf(before)
      const backup = !args.dryRun && changed ? await this.save(next, before) : undefined
      return {
        dryRun: args.dryRun,
        changed,
        updated,
        backup,
        revision: revisionOf(args.dryRun ? before : next)
      }
    }
    return args.dryRun ? operation() : this.locked(operation)
  }
}

export function checkRevision(archive: Archive, expected?: string) {
  if (expected && expected !== revisionOf(archive)) throw new Error('记录已变化，请重新读取 revision 后重试')
}
