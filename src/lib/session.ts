import { ref } from 'vue'
import { GithubArchive, type GithubConfig } from './github'
import { dirty, replaceBaseline } from './store'

const REPO_STORAGE_KEY = 'concshow-repository'
const TOKEN_STORAGE_KEY = 'concshow-github-token'
const REMEMBER_TOKEN_KEY = 'concshow-remember-token'

function loadRepoConfig(): GithubConfig {
  const fallback: GithubConfig = {
    owner: import.meta.env.VITE_GITHUB_OWNER || 'xilele777',
    repo: import.meta.env.VITE_GITHUB_REPO || 'concshow',
    branch: import.meta.env.VITE_GITHUB_BRANCH || 'main'
  }
  try {
    const saved = JSON.parse(localStorage.getItem(REPO_STORAGE_KEY) || 'null')
    if (saved?.owner && saved?.repo && saved?.branch) return saved
  } catch {}
  return fallback
}

function loadRememberPref(): boolean {
  try {
    const raw = localStorage.getItem(REMEMBER_TOKEN_KEY)
    return raw === null ? true : raw === '1'
  } catch {
    return true
  }
}

export function loadSavedGithubToken(): string {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

export const githubConfig = ref<GithubConfig>(loadRepoConfig())
export const rememberGithubToken = ref<boolean>(loadRememberPref())
export const githubConnected = ref(false)
export const githubConnecting = ref(false)
export const hasSavedGithubToken = ref(Boolean(loadSavedGithubToken()))

let activeClient: GithubArchive | null = null

export function setRememberGithubToken(value: boolean) {
  rememberGithubToken.value = value
  try {
    localStorage.setItem(REMEMBER_TOKEN_KEY, value ? '1' : '0')
    if (!value) {
      localStorage.removeItem(TOKEN_STORAGE_KEY)
      hasSavedGithubToken.value = false
    }
  } catch {}
}

export function getGithubClient(): GithubArchive | null {
  return activeClient
}

export async function connectGithubRepo(
  tokenValue: string,
  options: { silent?: boolean } = {}
): Promise<'synced' | 'kept-draft'> {
  const trimmed = tokenValue.trim()
  if (!trimmed) throw new Error('请输入 GitHub 访问令牌')
  githubConnecting.value = true
  try {
    activeClient?.disconnect()
    const nextClient = new GithubArchive({ ...githubConfig.value }, trimmed)
    const remote = await nextClient.connect()
    activeClient = nextClient
    githubConnected.value = true
    try {
      localStorage.setItem(REPO_STORAGE_KEY, JSON.stringify(githubConfig.value))
      if (rememberGithubToken.value) {
        localStorage.setItem(TOKEN_STORAGE_KEY, trimmed)
        hasSavedGithubToken.value = true
      } else {
        localStorage.removeItem(TOKEN_STORAGE_KEY)
        hasSavedGithubToken.value = false
      }
    } catch {}
    if (!dirty.value) {
      replaceBaseline(remote)
      return 'synced'
    }
    return 'kept-draft'
  } catch (error) {
    activeClient?.disconnect()
    activeClient = null
    githubConnected.value = false
    if (options.silent) {
      const msg = error instanceof Error ? error.message : ''
      if (msg.includes('令牌无效') || msg.includes('权限')) {
        try {
          localStorage.removeItem(TOKEN_STORAGE_KEY)
          hasSavedGithubToken.value = false
        } catch {}
      }
    }
    throw error
  } finally {
    githubConnecting.value = false
  }
}

export async function autoConnectGithub(): Promise<'synced' | 'kept-draft' | null> {
  if (githubConnected.value && activeClient) return null
  const savedToken = loadSavedGithubToken()
  if (!savedToken) return null
  return connectGithubRepo(savedToken, { silent: true })
}

export function disconnectGithubRepo(clearSaved = true) {
  activeClient?.disconnect()
  activeClient = null
  githubConnected.value = false
  if (clearSaved) {
    try {
      localStorage.removeItem(TOKEN_STORAGE_KEY)
      hasSavedGithubToken.value = false
    } catch {}
  }
}
