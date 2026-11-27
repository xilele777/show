import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { ArchiveStore, revisionOf } from '../mcp/archive'
import { mergeArchives, publishArchive, syncArchive } from '../mcp/publish'
import { uploadImages } from '../mcp/media'
import { archiveFixture } from './fixtures/archive'
import type { Archive } from '../src/lib/schema'

let root: string
let store: ArchiveStore
const concert = (title = '批量录入音乐会') => ({ title, date: '2025-01-02', city: '北京', type: '音乐会' })
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'concshow-mcp-test-'))
  await mkdir(join(root, 'public/content'), { recursive: true })
  await mkdir(join(root, 'public/uploads'), { recursive: true })
  await writeFile(join(root, 'public/content/archive.json'), JSON.stringify(archiveFixture))
  store = new ArchiveStore(root)
})
afterEach(async () => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  await rm(root, { recursive: true, force: true })
})

describe('MCP batch writes', () => {
  it('writes one batch, applies defaults and keeps a recoverable backup', async () => {
    const before = await store.read()
    const out = await store.create({ records: [concert(), concert('第二场')] })
    expect(out.created).toHaveLength(2)
    expect(out.created[0]).toMatchObject({
      rating: 0,
      demo: false,
      published: true,
      program: [],
      status: 'watched'
    })
    expect((await store.read()).records).toHaveLength(4)
    expect(JSON.parse(await readFile(out.backup!, 'utf8'))).toEqual(before)
    expect(out.revision).toBe(revisionOf(await store.read()))
  })
  it('skips existing and in-batch duplicates even with different generated IDs', async () => {
    const first = await store.create({ records: [concert(), concert(), concert(' 批量录入 音乐会 ')] })
    expect(first.created).toHaveLength(1)
    expect(first.skipped).toHaveLength(2)
    const retry = await store.create({ records: [concert()] })
    expect(retry.created).toHaveLength(0)
    expect(retry.skipped[0]!.id).toBe(first.created[0]!.id)
    expect(retry.backup).toBeUndefined()
  })
  it('uses the date in China to choose upcoming, with explicit status taking priority', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-26T17:00:00Z'))
    const out = await store.create({
      records: [
        { ...concert('今天'), date: '2026-11-27' },
        { ...concert('明天'), date: '2026-11-28' },
        { ...concert('手动状态'), date: '2026-11-28', status: 'watched' }
      ]
    })
    expect(out.created.map((record) => record.status)).toEqual(['watched', 'upcoming', 'watched'])
  })
  it('does not write anything for dryRun or a batch containing invalid dates or unknown fields', async () => {
    const original = await readFile(store.contentPath, 'utf8')
    expect((await store.create({ records: [concert()], dryRun: true })).created).toHaveLength(1)
    await expect(access(store.stateDirectory)).rejects.toThrow()
    await expect(
      store.create({ records: [concert(), { ...concert('无效'), date: '2025-02-30' }] })
    ).rejects.toThrow()
    await expect(store.create({ records: [{ ...concert(), typo: 'bad' }] })).rejects.toThrow()
    expect(await readFile(store.contentPath, 'utf8')).toBe(original)
  })
  it('rejects an ID collision, stale revision and a batch above 100', async () => {
    await expect(store.create({ records: [{ ...concert(), id: 'test-concert' }] })).rejects.toThrow('ID 已被')
    await expect(store.create({ records: [concert()], expectedRevision: 'stale' })).rejects.toThrow(
      '记录已变化'
    )
    await expect(
      store.create({ records: Array.from({ length: 101 }, (_, i) => concert(String(i))) })
    ).rejects.toThrow()
    expect(await store.read()).toEqual(archiveFixture)
  })
  it('updates only provided fields, preserves Chinese program entries, and adds new categories', async () => {
    const out = await store.update({
      updates: [
        {
          id: 'test-concert',
          changes: {
            note: '补充观后记',
            type: '室内乐',
            program: [{ title: '四重奏', composer: '舒伯特', half: '加演' }]
          }
        }
      ]
    })
    expect(out.updated[0]).toMatchObject({
      title: '交响音乐会',
      orchestra: '测试交响乐团',
      note: '补充观后记'
    })
    expect((await store.read()).settings.categories).toContain('室内乐')
  })
  it('rejects missing records and duplicate update IDs without partial changes', async () => {
    await expect(
      store.update({
        updates: [
          { id: 'test-concert', changes: { note: '不能落盘' } },
          { id: 'missing', changes: { rating: 1 } }
        ]
      })
    ).rejects.toThrow('找不到记录')
    await expect(
      store.update({
        updates: [
          { id: 'test-concert', changes: { rating: 1 } },
          { id: 'test-concert', changes: { rating: 2 } }
        ]
      })
    ).rejects.toThrow('重复修改')
    await expect(store.update({ updates: [{ id: 'test-concert', changes: {} }] })).rejects.toThrow('不能为空')
    expect(await store.read()).toEqual(archiveFixture)
  })
  it('prevents simultaneous clients from writing and releases its lock after errors', async () => {
    await store.locked(async () => {
      await expect(new ArchiveStore(root).create({ records: [concert()] })).rejects.toThrow('另一个写入')
    })
    await expect(
      store.locked(async () => {
        throw new Error('failure')
      })
    ).rejects.toThrow('failure')
    await expect(store.create({ records: [concert()] })).resolves.toMatchObject({
      created: [expect.anything()]
    })
  })
})

describe('MCP image uploads', () => {
  async function image() {
    const path = join(root, 'ticket.png')
    await sharp({ create: { width: 2200, height: 1100, channels: 3, background: '#ff0000' } })
      .png()
      .toFile(path)
    return path
  }
  it('compresses large images and attaches deduplicated local image paths', async () => {
    const path = await image()
    const out = await uploadImages(store, { files: [path], destination: 'local', recordId: 'test-concert' })
    expect(out.uploaded[0]!.path).toMatch(/^uploads\/[a-f0-9]+\.webp$/)
    const info = await sharp(await readFile(join(root, 'public', out.uploaded[0]!.path))).metadata()
    expect(info.width).toBe(2000)
    await uploadImages(store, { files: [path], destination: 'local', recordId: 'test-concert' })
    expect((await store.read()).records[0]!.images).toHaveLength(2)
  })
  it('rejects reading files outside allowed roots and validates all files before writing', async () => {
    const path = await image()
    await writeFile(join(root, 'invalid.png'), 'not an image')
    await expect(
      uploadImages(store, { files: [path, 'invalid.png'], destination: 'local', recordId: 'test-concert' })
    ).rejects.toThrow()
    expect(await store.read()).toEqual(archiveFixture)
    const outside = await mkdtemp(join(tmpdir(), 'concshow-outside-'))
    try {
      await sharp({ create: { width: 1, height: 1, channels: 3, background: '#fff' } })
        .png()
        .toFile(join(outside, 'image.png'))
      await expect(
        uploadImages(store, { files: [join(outside, 'image.png')], destination: 'local' })
      ).rejects.toThrow('允许目录之外')
      vi.stubEnv('CONCSHOW_IMAGE_ROOTS', outside)
      await expect(
        uploadImages(store, { files: [join(outside, 'image.png')], destination: 'local' })
      ).resolves.toMatchObject({ uploaded: [expect.anything()] })
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })
  it('sends compressed bytes to the R2 gateway with auth and verifies public access', async () => {
    const path = await image()
    await mkdir(join(root, 'src/lib'), { recursive: true })
    await writeFile(
      join(root, 'src/lib/r2-public.json'),
      JSON.stringify({ workerUrl: 'https://images.example.com', publicUrl: 'https://images.example.com' })
    )
    vi.stubEnv('CONCSHOW_R2_TOKEN', 'test-secret')
    let size = 0
    const mock = vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method === 'PUT') {
        expect(init.headers).toMatchObject({
          Authorization: 'Bearer test-secret',
          'Content-Type': 'image/webp'
        })
        size = (init.body as Uint8Array).byteLength
        return new Response(null, { status: 201 })
      }
      return new Response(null, { headers: { 'Content-Length': String(size) } })
    })
    vi.stubGlobal('fetch', mock)
    const out = await uploadImages(store, { files: [path], recordId: 'test-concert' })
    expect(out.uploaded[0]!.path).toMatch(/^https:\/\/images.example.com\/uploads\//)
    expect(JSON.stringify(out)).not.toContain('test-secret')
    expect(mock).toHaveBeenCalledTimes(2)
  })
})

describe('MCP GitHub publishing', () => {
  function mockRemote(remote: Archive, options: { changedHead?: boolean; rejectRef?: boolean } = {}) {
    vi.stubEnv('CONCSHOW_GITHUB_OWNER', 'test')
    vi.stubEnv('CONCSHOW_GITHUB_REPO', 'journal')
    vi.stubEnv('CONCSHOW_GITHUB_TOKEN', 'test-secret')
    const calls: { path: string; method: string; body: any }[] = []
    let heads = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        const path = url.replace('https://api.github.com/repos/test/journal', '')
        calls.push({
          path,
          method: init.method || 'GET',
          body: init.body ? JSON.parse(String(init.body)) : null
        })
        const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
        if (!path) return json({ permissions: { push: true } })
        if (path.startsWith('/git/ref/'))
          return json({ object: { sha: options.changedHead && heads++ > 0 ? 'head-race' : 'head-1' } })
        if (path.startsWith('/git/commits/'))
          return json({ sha: path.split('/').at(-1), tree: { sha: 'tree-1' } })
        if (path.startsWith('/contents/'))
          return json({ encoding: 'base64', content: Buffer.from(JSON.stringify(remote)).toString('base64') })
        if (path === '/git/blobs') return json({ sha: 'blob-1' })
        if (path === '/git/trees') return json({ sha: 'tree-2' })
        if (path === '/git/commits') return json({ sha: 'head-2' })
        if (path.startsWith('/git/refs/')) return json({}, options.rejectRef ? 422 : 200)
        throw new Error(path)
      })
    )
    return calls
  }
  it('merges independent edits and rejects simultaneous edits to the same record', () => {
    const local = structuredClone(archiveFixture)
    const remote = structuredClone(archiveFixture)
    local.records[0]!.note = '本地修改'
    remote.records[1]!.note = '远端修改'
    const merged = mergeArchives(archiveFixture, local, remote)
    expect(merged.records.map((record) => record.note)).toEqual(['本地修改', '远端修改'])
    remote.records[0]!.note = '冲突'
    expect(() => mergeArchives(archiveFixture, local, remote)).toThrow('同时修改')
  })
  it('previews without remote mutation, then publishes in one commit and stores a new baseline', async () => {
    await store.create({ records: [concert()] })
    const remote = structuredClone(archiveFixture)
    remote.records[1]!.note = '网页新增笔记'
    const calls = mockRemote(remote)
    const preview = await publishArchive(store, { dryRun: true })
    expect(preview).toMatchObject({ changed: true, added: [{ title: '批量录入音乐会' }] })
    expect(calls.every((call) => call.method === 'GET')).toBe(true)
    const out = await publishArchive(store, {})
    expect(out).toMatchObject({ commitUrl: 'https://github.com/test/journal/commit/head-2' })
    const blob = calls.find((call) => call.path === '/git/blobs')!
    const submitted = JSON.parse(blob.body.content) as Archive
    expect(submitted.records.find((record) => record.id === 'test-livehouse')!.note).toBe('网页新增笔记')
    expect(calls.filter((call) => call.path === '/git/commits' && call.method === 'POST')).toHaveLength(1)
    expect(calls.at(-1)!.body).toEqual({ sha: 'head-2', force: false })
    expect(await store.baseline(await store.read())).toEqual(submitted)
  })
  it('syncs remote additions without publishing or losing pending local edits', async () => {
    await store.create({ records: [concert()] })
    const remote = structuredClone(archiveFixture)
    remote.records.push({ ...remote.records[0]!, id: 'remote-new', title: '远端新增演出' })
    const calls = mockRemote(remote)
    const out = await syncArchive(store)
    expect(out.recordCount).toBe(4)
    expect(calls.every((call) => call.method === 'GET')).toBe(true)
    expect(await store.baseline(await store.read())).toEqual(remote)
    const preview = await publishArchive(store, { dryRun: true })
    expect(preview.added.map((record) => record.title)).toEqual(['批量录入音乐会'])
  })
  it('stops on a record conflict or a changed remote head and retains local edits', async () => {
    await store.update({ updates: [{ id: 'test-concert', changes: { note: '本地笔记' } }] })
    const local = await store.read()
    const remote = structuredClone(archiveFixture)
    remote.records[0]!.note = '远端冲突笔记'
    const calls = mockRemote(remote)
    await expect(publishArchive(store, {})).rejects.toThrow('同时修改')
    expect(calls.every((call) => call.method === 'GET')).toBe(true)
    mockRemote(archiveFixture, { changedHead: true })
    await expect(publishArchive(store, {})).rejects.toThrow('仓库已有新提交')
    mockRemote(archiveFixture, { rejectRef: true })
    await expect(publishArchive(store, {})).rejects.toThrow('分支有冲突')
    expect(await store.read()).toEqual(local)
  })
})
