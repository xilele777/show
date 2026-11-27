import { archiveSchema, type Archive, type PendingAsset } from './schema'

type Commit = { sha: string; tree: { sha: string } }
export type GithubConfig = { owner: string; repo: string; branch: string }

export class GithubArchive {
  private token: string
  private head = ''
  private tree = ''
  private snapshot = ''
  readonly config: GithubConfig
  constructor(config: GithubConfig, token: string) {
    if (
      ![config.owner, config.repo].every((part) => /^[a-zA-Z0-9_.-]+$/.test(part)) ||
      !config.branch ||
      config.branch.includes('..') ||
      /[\s~^:?*\[\\]/.test(config.branch)
    )
      throw new Error('请填写有效的仓库和分支名称')
    this.config = config
    this.token = token.trim()
  }
  disconnect() {
    this.token = ''
    this.head = ''
    this.tree = ''
    this.snapshot = ''
  }
  private async request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    if (!this.token) throw new Error('请重新连接 GitHub')
    const { owner, repo } = this.config
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}${path ? `/${path}` : ''}`, {
      method,
      signal: AbortSignal.timeout(30_000),
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    })
    if (!response.ok) {
      const messages: Record<number, string> = {
        401: '令牌无效或已过期',
        403: '没有仓库写入权限，或 GitHub 请求限额已用完',
        404: '仓库、分支或内容文件不存在，或令牌没有访问权限',
        409: '仓库有新的改动，请导出草稿后重新连接',
        422: '分支有冲突或受到保护，请检查分支规则'
      }
      throw new Error(messages[response.status] || `GitHub 请求失败（${response.status}）`)
    }
    return response.json() as Promise<T>
  }
  private async getHead(): Promise<Commit> {
    const ref = await this.request<{ object: { sha: string } }>(
      `git/ref/heads/${encodeURIComponent(this.config.branch)}`
    )
    return this.request<Commit>(`git/commits/${ref.object.sha}`)
  }
  async connect(): Promise<Archive> {
    const repository = await this.request<{ permissions?: { push: boolean } }>('')
    if (repository.permissions && !repository.permissions.push) throw new Error('当前账户不能向这个仓库推送')
    const commit = await this.getHead()
    const file = await this.request<{ content: string; encoding: string }>(
      `contents/public/content/archive.json?ref=${commit.sha}`
    )
    if (file.encoding !== 'base64') throw new Error('内容文件格式无效')
    const bytes = Uint8Array.from(atob(file.content.replace(/\s/g, '')), (character) =>
      character.charCodeAt(0)
    )
    const archive = archiveSchema.parse(JSON.parse(new TextDecoder().decode(bytes)))
    this.head = commit.sha
    this.tree = commit.tree.sha
    this.snapshot = JSON.stringify(archive)
    return archive
  }
  async publish(
    archive: Archive,
    assets: PendingAsset[],
    report: (message: string) => void = () => {}
  ): Promise<string> {
    const validated = archiveSchema.parse(archive)
    if (!this.head) throw new Error('请先连接仓库并读取最新记录')
    if (!assets.length && JSON.stringify(validated) === this.snapshot) throw new Error('没有需要发布的改动')
    if (
      assets.some(
        (asset) =>
          !/^uploads\/[a-zA-Z0-9-]+\.(webp|jpg|png)$/.test(asset.path) ||
          !/^[A-Za-z0-9+/=]+$/.test(asset.base64) ||
          asset.base64.length > 8_000_000
      )
    )
      throw new Error('待上传图片无效或过大')
    const current = await this.getHead()
    if (current.sha !== this.head)
      throw new Error('仓库已有新提交。请先导出草稿、断开并重新连接，再合并改动；此次没有覆盖远端内容。')
    const referenced = new Set(
      validated.records.flatMap((record) => record.images).map((path) => `public/${path}`)
    )
    const treeEntries: { path: string; mode: string; type: string; sha: string }[] = []
    const included = assets.filter((asset) => referenced.has(`public/${asset.path}`))
    for (let index = 0; index < included.length; index++) {
      report(`正在上传照片 ${index + 1} / ${included.length}`)
      const asset = included[index]!
      const blob = await this.request<{ sha: string }>('git/blobs', 'POST', {
        content: asset.base64,
        encoding: 'base64'
      })
      treeEntries.push({ path: `public/${asset.path}`, mode: '100644', type: 'blob', sha: blob.sha })
    }
    report('正在保存观演记录')
    const blob = await this.request<{ sha: string }>('git/blobs', 'POST', {
      content: `${JSON.stringify(validated, null, 2)}\n`,
      encoding: 'utf-8'
    })
    treeEntries.push({ path: 'public/content/archive.json', mode: '100644', type: 'blob', sha: blob.sha })
    const tree = await this.request<{ sha: string }>('git/trees', 'POST', {
      base_tree: this.tree,
      tree: treeEntries
    })
    const commit = await this.request<{ sha: string }>('git/commits', 'POST', {
      message: 'Update concert journal',
      tree: tree.sha,
      parents: [this.head]
    })
    await this.request(`git/refs/heads/${encodeURIComponent(this.config.branch)}`, 'PATCH', {
      sha: commit.sha,
      force: false
    })
    this.head = commit.sha
    this.tree = tree.sha
    this.snapshot = JSON.stringify(validated)
    return `https://github.com/${this.config.owner}/${this.config.repo}/commit/${commit.sha}`
  }
}
