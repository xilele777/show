import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearR2Secrets, isR2Ready, r2Config, saveR2PublicConfig } from '../src/lib/r2'

afterEach(() => {
  clearR2Secrets()
  vi.unstubAllGlobals()
})

describe('deployed R2 configuration', () => {
  it('uses the deployed Worker and requires a secret before enabling upload', () => {
    expect(r2Config.mode).toBe('worker')
    expect(r2Config.workerUrl).toBe('https://concshow-images.2519175810.workers.dev')
    expect(r2Config.publicUrl).toBe(r2Config.workerUrl)
    expect(isR2Ready()).toBe(false)
    r2Config.workerToken = 'test-secret'
    expect(isR2Ready()).toBe(true)
    clearR2Secrets()
    expect(isR2Ready()).toBe(false)
  })

  it('persists public settings without saving any upload or R2 credentials', () => {
    const setItem = vi.fn()
    vi.stubGlobal('localStorage', { setItem })
    r2Config.workerToken = 'private-worker-token'
    r2Config.accessKeyId = 'private-access-key'
    r2Config.secretAccessKey = 'private-secret-key'
    saveR2PublicConfig()
    const saved = JSON.parse(setItem.mock.calls[0]![1])
    expect(saved.workerUrl).toBe(r2Config.workerUrl)
    expect(Object.keys(saved).sort()).toEqual(['accountId', 'bucket', 'mode', 'publicUrl', 'workerUrl'])
    expect(setItem.mock.calls[0]![1]).not.toContain('private-')
  })
})
