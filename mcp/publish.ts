import { readFile, realpath } from 'node:fs/promises'
import { join, relative, isAbsolute, sep } from 'node:path'
import { z } from 'zod'
import { GithubArchive, type GithubConfig } from '../src/lib/github'
import { archiveSchema, type Archive, type PendingAsset } from '../src/lib/schema'
import { ArchiveStore, checkRevision, revisionOf, runFile } from './archive'

const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

// Preserve independent remote edits, but reject different edits to the same record.
export function mergeArchives(base: Archive, local: Archive, remote: Archive): Archive {
  function merge<T>(name: string, original: T, ours: T, theirs: T): T {
    if (equal(ours, original)) return theirs
    if (equal(theirs, original) || equal(ours, theirs)) return ours
    throw new Error(`本地与 GitHub 同时修改了 ${name}，请先合并；此次没有发布`)
  }
  const maps = [base, local, remote].map(
    (archive) => new Map(archive.records.map((record) => [record.id, record]))
  )
  const ids = [...new Set([...local.records, ...remote.records, ...base.records].map((record) => record.id))]
  const records = ids.flatMap((id) => {
    const record = merge(`记录 ${id}`, maps[0]!.get(id), maps[1]!.get(id), maps[2]!.get(id))
    return record ? [record] : []
  })
  const { categories: baseCategories, ...baseSettings } = base.settings
  const { categories: localCategories, ...localSettings } = local.settings
  const { categories: remoteCategories, ...remoteSettings } = remote.settings
  const categories = equal(localCategories, baseCategories)
    ? remoteCategories
    : equal(remoteCategories, baseCategories)
      ? localCategories
      : [...new Set([...localCategories, ...remoteCategories])]
  return archiveSchema.parse({
    version: 1,
    settings: {
      ...merge('网站设置', baseSettings, localSettings, remoteSettings),
      categories
    },
    records
  })
}

export const publishSchema = z
  .object({
    dryRun: z.boolean().default(false),
    expectedRevision: z.string().optional()
  })
  .strict()

export async function githubConfig(root: string): Promise<GithubConfig> {
  let owner = process.env.CONCSHOW_GITHUB_OWNER
  let repo = process.env.CONCSHOW_GITHUB_REPO
  if (!owner || !repo) {
    const { stdout } = await runFile('git', ['remote', 'get-url', 'origin'], {
      cwd: root,
      timeout: 10_000,
      windowsHide: true
    })
    const match = /^(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(
      stdout.trim()
    )
    if (!match) throw new Error('请设置 CONCSHOW_GITHUB_OWNER 和 CONCSHOW_GITHUB_REPO')
    owner ??= match[1]
    repo ??= match[2]
  }
  return { owner: owner!, repo: repo!, branch: process.env.CONCSHOW_GITHUB_BRANCH || 'main' }
}

async function githubToken() {
  const token =
    process.env.CONCSHOW_GITHUB_TOKEN?.trim() ||
    process.env.GH_TOKEN?.trim() ||
    process.env.GITHUB_TOKEN?.trim()
  if (token) return token
  try {
    const { stdout } = await runFile('gh', ['auth', 'token', '--hostname', 'github.com'], {
      timeout: 10_000,
      windowsHide: true
    })
    if (stdout.trim()) return stdout.trim()
  } catch {}
  throw new Error('请先运行 gh auth login，或设置 CONCSHOW_GITHUB_TOKEN（仓库 Contents 读写权限）')
}

export async function syncArchive(store: ArchiveStore) {
  return store.locked(async () => {
    const local = await store.read()
    const config = await githubConfig(store.root)
    const connection = new GithubArchive(config, await githubToken())
    try {
      const remote = await connection.connect()
      const next = mergeArchives(await store.baseline(local), local, remote)
      const backup = !equal(next, local) ? await store.save(next, local) : undefined
      await store.markBaseline(remote)
      return {
        repository: `${config.owner}/${config.repo}`,
        recordCount: next.records.length,
        changed: !equal(next, local),
        backup,
        revision: revisionOf(next),
        message: '已将最新 GitHub 档案合并到本地，保留本地未发布的修改；此次没有发布'
      }
    } finally {
      connection.disconnect()
    }
  })
}

export async function publishArchive(store: ArchiveStore, input: unknown) {
  const args = publishSchema.parse(input)
  return store.locked(async () => {
    const local = await store.read()
    checkRevision(local, args.expectedRevision)
    const config = await githubConfig(store.root)
    const connection = new GithubArchive(config, await githubToken())
    try {
      const remote = await connection.connect()
      const next = mergeArchives(await store.baseline(local), local, remote)
      const remoteImages = new Set(remote.records.flatMap((record) => record.images))
      const paths = [...new Set(next.records.flatMap((record) => record.images))].filter(
        (path) => path.startsWith('uploads/') && !remoteImages.has(path)
      )
      const assets: PendingAsset[] = []
      const uploadRoot = paths.length ? await realpath(join(store.root, 'public/uploads')) : ''
      for (const path of paths) {
        if (!/^uploads\/[a-zA-Z0-9-]+\.(webp|jpg|png)$/.test(path)) throw new Error('待发布本地图片路径无效')
        const actual = await realpath(join(store.root, 'public', path))
        const child = relative(uploadRoot, actual)
        if (child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child))
          throw new Error('图片位于 uploads 目录之外')
        const bytes = await readFile(actual)
        if (bytes.length > 5 * 1024 * 1024) throw new Error('待发布图片超过 5 MB')
        assets.push({ path, base64: bytes.toString('base64') })
      }
      const changed = !equal(next, remote) || assets.length > 0
      const summary = {
        repository: `${config.owner}/${config.repo}`,
        branch: config.branch,
        recordCount: next.records.length,
        added: next.records
          .filter((record) => !remote.records.some((other) => other.id === record.id))
          .map((record) => ({ id: record.id, title: record.title })),
        updated: next.records
          .filter((record) => remote.records.some((other) => other.id === record.id && !equal(record, other)))
          .map((record) => ({ id: record.id, title: record.title })),
        removed: remote.records
          .filter((record) => !next.records.some((other) => other.id === record.id))
          .map((record) => ({ id: record.id, title: record.title })),
        localImageCount: assets.length,
        changed
      }
      if (args.dryRun) return { ...summary, dryRun: true, revision: revisionOf(local) }
      // A browser or external editor may have saved while the remote was being read.
      if (revisionOf(await store.read()) !== revisionOf(local))
        throw new Error('本地内容已变化，请重新读取后发布')
      const commitUrl = changed ? await connection.publish(next, assets) : undefined
      try {
        if (!equal(next, local)) await store.save(next, local)
        await store.markBaseline(next)
      } catch (error) {
        return {
          ...summary,
          commitUrl,
          localSyncError: error instanceof Error ? error.message : '本地同步失败',
          message: commitUrl
            ? 'GitHub 提交已成功，但本地同步失败；请保留草稿并根据提交合并本地内容后再发布'
            : '远端没有待发布改动，但本地同步失败'
        }
      }
      return {
        ...summary,
        commitUrl,
        revision: revisionOf(next),
        message: changed ? '已提交到 GitHub，等待 Pages 部署后线上更新' : '线上内容已是最新'
      }
    } finally {
      connection.disconnect()
    }
  })
}
