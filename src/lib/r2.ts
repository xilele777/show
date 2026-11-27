import { reactive } from 'vue'
import type { PendingAsset } from './schema'

export interface R2Config {
  mode: 's3' | 'worker'
  accountId: string
  bucket: string
  publicUrl: string
  workerUrl: string
  accessKeyId: string
  secretAccessKey: string
  workerToken: string
}

const STORAGE_KEY = 'concshow-r2-public'

function loadSavedPublicConfig(): Pick<R2Config, 'mode' | 'accountId' | 'bucket' | 'publicUrl' | 'workerUrl'> {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    if (raw && typeof raw === 'object') {
      return {
        mode: raw.mode === 'worker' ? 'worker' : 's3',
        accountId: typeof raw.accountId === 'string' ? raw.accountId : '',
        bucket: typeof raw.bucket === 'string' ? raw.bucket : '',
        publicUrl: typeof raw.publicUrl === 'string' ? raw.publicUrl : '',
        workerUrl: typeof raw.workerUrl === 'string' ? raw.workerUrl : ''
      }
    }
  } catch {}
  return { mode: 's3', accountId: '', bucket: '', publicUrl: '', workerUrl: '' }
}

export const r2Config = reactive<R2Config>({
  ...loadSavedPublicConfig(),
  accessKeyId: '',
  secretAccessKey: '',
  workerToken: ''
})

export function saveR2PublicConfig() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        mode: r2Config.mode,
        accountId: r2Config.accountId.trim(),
        bucket: r2Config.bucket.trim(),
        publicUrl: r2Config.publicUrl.trim(),
        workerUrl: r2Config.workerUrl.trim()
      })
    )
  } catch {}
}

export function clearR2Secrets() {
  r2Config.accessKeyId = ''
  r2Config.secretAccessKey = ''
  r2Config.workerToken = ''
}

export function isR2Ready(): boolean {
  const pub = r2Config.publicUrl.trim()
  if (!/^https:\/\/[a-zA-Z0-9.-]+/.test(pub)) return false
  if (r2Config.mode === 'worker') {
    return /^https:\/\/[a-zA-Z0-9.-]+/.test(r2Config.workerUrl.trim()) && Boolean(r2Config.workerToken.trim())
  }
  return (
    /^[a-f0-9]{16,64}$/i.test(r2Config.accountId.trim()) &&
    /^[a-z0-9][a-z0-9.-]{1,62}$/.test(r2Config.bucket.trim()) &&
    Boolean(r2Config.accessKeyId.trim()) &&
    Boolean(r2Config.secretAccessKey.trim())
  )
}

function toHex(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return toHex(digest)
}

async function hmac(key: Uint8Array | string, data: string): Promise<Uint8Array> {
  const rawKey = typeof key === 'string' ? new TextEncoder().encode(key) : key
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    rawKey as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data))
  return new Uint8Array(sig)
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export async function signR2PutHeaders(options: {
  accountId: string
  bucket: string
  key: string
  contentType: string
  payload: Uint8Array
  accessKeyId: string
  secretAccessKey: string
  now?: Date
}): Promise<{ url: string; headers: Record<string, string> }> {
  const date = options.now ?? new Date()
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = amzDate.slice(0, 8)
  const host = `${options.accountId.trim()}.r2.cloudflarestorage.com`
  const encodedKey = options.key
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')
  const canonicalUri = `/${encodeURIComponent(options.bucket.trim())}/${encodedKey}`
  const payloadHash = await sha256Hex(options.payload)

  const canonicalHeaders =
    `content-type:${options.contentType}\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date'
  const canonicalRequest = `PUT\n${canonicalUri}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${await sha256Hex(canonicalRequest)}`

  const kDate = await hmac(`AWS4${options.secretAccessKey.trim()}`, dateStamp)
  const kRegion = await hmac(kDate, 'auto')
  const kService = await hmac(kRegion, 's3')
  const kSigning = await hmac(kService, 'aws4_request')
  const signature = toHex(await hmac(kSigning, stringToSign))

  return {
    url: `https://${host}${canonicalUri}`,
    headers: {
      'Content-Type': options.contentType,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      Authorization: `AWS4-HMAC-SHA256 Credential=${options.accessKeyId.trim()}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
    }
  }
}

export function r2PublicImageUrl(publicBase: string, key: string): string {
  return `${publicBase.trim().replace(/\/+$/, '')}/${key.replace(/^\/+/, '')}`
}

export async function uploadAssetToR2(asset: PendingAsset): Promise<string> {
  if (!isR2Ready()) throw new Error('请先在「发布与同步」中配置 Cloudflare R2 参数与密钥')
  const bytes = base64ToBytes(asset.base64)
  const contentType = asset.path.endsWith('.webp')
    ? 'image/webp'
    : asset.path.endsWith('.png')
      ? 'image/png'
      : 'image/jpeg'
  const key = asset.path.replace(/^\/+/, '')

  if (r2Config.mode === 'worker') {
    const endpoint = `${r2Config.workerUrl.trim().replace(/\/+$/, '')}/${key}`
    const response = await fetch(endpoint, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
        Authorization: `Bearer ${r2Config.workerToken.trim()}`
      },
      body: bytes as BodyInit
    })
    if (!response.ok) {
      throw new Error(`R2 Worker 上传失败（${response.status}）`)
    }
    return r2PublicImageUrl(r2Config.publicUrl, key)
  }

  const { url, headers } = await signR2PutHeaders({
    accountId: r2Config.accountId,
    bucket: r2Config.bucket,
    key,
    contentType,
    payload: bytes,
    accessKeyId: r2Config.accessKeyId,
    secretAccessKey: r2Config.secretAccessKey
  })
  const response = await fetch(url, {
    method: 'PUT',
    headers,
    body: bytes as BodyInit
  })
  if (!response.ok) {
    throw new Error(`Cloudflare R2 上传失败（${response.status}），请检查密钥与存储桶 CORS 设置`)
  }
  return r2PublicImageUrl(r2Config.publicUrl, key)
}
