import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir, access } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const config = JSON.parse(await readFile(new URL('src/lib/r2-public.json', root), 'utf8'))
const { UPLOAD_TOKEN } = JSON.parse(await readFile(new URL('.cloudflare/upload-secrets.json', root), 'utf8'))
if (!UPLOAD_TOKEN) throw new Error('Local upload secret is missing')
const archivePath = new URL('public/content/archive.json', root)
const original = await readFile(archivePath, 'utf8')
const archive = JSON.parse(original)
const imagePaths = [...new Set(archive.records.flatMap((record) => record.images))]
  .filter((path) => /^uploads\/[a-zA-Z0-9-]+\.(webp|png|jpg)$/.test(path))
const origin = 'http://127.0.0.1:3001'
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const send = (url, init = {}) => fetch(url, { ...init, signal: AbortSignal.timeout(30_000) })
const migrated = new Map()

for (const path of imagePaths) {
  const url = `${config.workerUrl}/${path}`
  const bytes = await readFile(new URL(`public/${path}`, root))
  const type = path.endsWith('.webp') ? 'image/webp' : path.endsWith('.png') ? 'image/png' : 'image/jpeg'
  const preflight = await send(url, {
    method: 'OPTIONS',
    headers: { Origin: origin, 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'authorization,content-type' }
  })
  if (preflight.status !== 204 || preflight.headers.get('Access-Control-Allow-Origin') !== origin) throw new Error(`CORS preflight failed: ${preflight.status}`)
  const unauthorized = await send(url, { method: 'PUT', headers: { 'Content-Type': type }, body: bytes })
  if (unauthorized.status !== 401) throw new Error(`Authorization check failed: ${unauthorized.status}`)
  const response = await send(url, {
    method: 'PUT',
    headers: { Origin: origin, 'Content-Type': type, Authorization: `Bearer ${UPLOAD_TOKEN}` },
    body: bytes
  })
  if (response.status !== 201) throw new Error(`Upload failed: ${response.status}`)
  const publicImage = await send(url)
  const remote = new Uint8Array(await publicImage.arrayBuffer())
  if (publicImage.status !== 200 || digest(remote) !== digest(bytes)) throw new Error('Public image did not match the uploaded file')
  migrated.set(path, `${config.publicUrl}/${path}`)
  console.log(`Verified upload, public access, CORS and authorization: ${config.publicUrl}/${path}`)
}

if (migrated.size) {
  const backup = new URL('.concshow-backups/archive.before-r2.json', root)
  await mkdir(new URL('.concshow-backups/', root), { recursive: true })
  try { await access(backup) } catch { await writeFile(backup, original) }
  for (const record of archive.records) record.images = record.images.map((path) => migrated.get(path) || path)
  await writeFile(archivePath, JSON.stringify(archive, null, 2) + '\n')
  console.log(`Updated ${migrated.size} image references in public/content/archive.json`)
} else {
  console.log('No local images need migration.')
}
