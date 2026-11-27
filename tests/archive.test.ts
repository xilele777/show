import { afterEach, describe, expect, it, vi } from 'vitest'
import seed from '../public/content/archive.json'
import { archiveSchema, recordSchema } from '../src/lib/schema'
import { GithubArchive } from '../src/lib/github'

const data = archiveSchema.parse(seed)
const next = () => {
  const archive = structuredClone(data)
  archive.settings.owner = '测试作者'
  return archive
}
type Call = { path: string; method: string; body: Record<string, unknown> | null }
function mockGit(options: { changedHead?: boolean; rejectRef?: boolean; unauthorized?: boolean } = {}) {
  const calls: Call[] = []
  let reads = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const path = url.replace('https://api.github.com/repos/test/journal', '')
      const call = {
        path,
        method: init.method || 'GET',
        body: init.body ? JSON.parse(init.body as string) : null
      }
      calls.push(call)
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
      if (options.unauthorized) return json({}, 401)
      if (path === '') return json({ permissions: { push: true } })
      if (path.startsWith('/git/ref/'))
        return json({ object: { sha: options.changedHead && reads++ > 0 ? 'other-head' : 'head-1' } })
      if (path.startsWith('/git/commits/') && call.method === 'GET')
        return json({ sha: path.split('/').at(-1), tree: { sha: 'tree-1' } })
      if (path.startsWith('/contents/'))
        return json({ content: Buffer.from(JSON.stringify(data)).toString('base64'), encoding: 'base64' })
      if (path === '/git/blobs') return json({ sha: `blob-${calls.length}` })
      if (path === '/git/trees') return json({ sha: 'tree-2' })
      if (path === '/git/commits') return json({ sha: 'head-2' })
      if (path.startsWith('/git/refs/'))
        return options.rejectRef ? json({}, 422) : json({ object: { sha: 'head-2' } })
      throw new Error(`Unexpected request: ${path}`)
    })
  )
  return calls
}
const client = () =>
  new GithubArchive({ owner: 'test', repo: 'journal', branch: 'main' }, 'test-memory-token')
afterEach(() => vi.unstubAllGlobals())

describe('archive content boundaries', () => {
  it('accepts the sample archive and rejects invalid calendar dates', () => {
    expect(data.records).toHaveLength(6)
    expect(recordSchema.safeParse({ ...data.records[0], date: '2025-02-30' }).success).toBe(false)
  })
  it('rejects path traversal and duplicated IDs', () => {
    expect(recordSchema.safeParse({ ...data.records[0], images: ['uploads/../archive.json'] }).success).toBe(
      false
    )
    expect(
      recordSchema.safeParse({ ...data.records[0], images: ['https://example.com/x.jpg'] }).success
    ).toBe(false)
    expect(archiveSchema.safeParse({ ...data, records: [data.records[0], data.records[0]] }).success).toBe(
      false
    )
  })
})
describe('GitHub publishing', () => {
  it('reads Chinese content and commits content + images together without forcing the branch', async () => {
    const calls = mockGit()
    const connection = client()
    expect((await connection.connect()).settings.name).toBe('余响')
    const archive = next()
    archive.records[0]!.images.push('uploads/test.webp')
    const url = await connection.publish(archive, [{ path: 'uploads/test.webp', base64: 'YWJj' }])
    expect(url).toContain('/commit/head-2')
    const tree = calls.find((call) => call.path === '/git/trees')!
    expect(tree.body?.base_tree).toBe('tree-1')
    expect(tree.body?.tree).toHaveLength(2)
    expect(calls.filter((call) => call.path === '/git/commits' && call.method === 'POST')).toHaveLength(1)
    expect(
      calls.find((call) => call.path === '/git/commits' && call.method === 'POST')?.body?.parents
    ).toEqual(['head-1'])
    expect(calls.at(-1)?.body).toEqual({ sha: 'head-2', force: false })
  })
  it('stops before writing if another editor has already changed the repository', async () => {
    const calls = mockGit({ changedHead: true })
    const connection = client()
    await connection.connect()
    await expect(connection.publish(next(), [])).rejects.toThrow('仓库已有新提交')
    expect(calls.every((call) => call.method === 'GET')).toBe(true)
  })
  it('surfaces a ref-update race without retrying a forced push', async () => {
    const calls = mockGit({ rejectRef: true })
    const connection = client()
    await connection.connect()
    await expect(connection.publish(next(), [])).rejects.toThrow('分支有冲突')
    expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(1)
    expect(calls.at(-1)?.body?.force).toBe(false)
  })
  it('does not write an unchanged snapshot', async () => {
    const calls = mockGit()
    const connection = client()
    await connection.connect()
    await expect(connection.publish(data, [])).rejects.toThrow('没有需要发布的改动')
    expect(calls.every((call) => call.method === 'GET')).toBe(true)
  })
  it('rejects expired credentials and disconnect clears the active credential', async () => {
    mockGit({ unauthorized: true })
    await expect(client().connect()).rejects.toThrow('令牌无效')
    mockGit()
    const connection = client()
    await connection.connect()
    connection.disconnect()
    await expect(connection.connect()).rejects.toThrow('请重新连接')
  })
  it('ignores unreferenced cancelled photos and rejects invalid upload paths', async () => {
    const calls = mockGit()
    const connection = client()
    await connection.connect()
    await expect(connection.publish(next(), [{ path: '../evil.webp', base64: 'YWJj' }])).rejects.toThrow(
      '待上传图片无效'
    )
    await connection.publish(next(), [{ path: 'uploads/cancelled.webp', base64: 'YWJj' }])
    expect(calls.filter((call) => call.path === '/git/blobs')).toHaveLength(1)
  })
})
