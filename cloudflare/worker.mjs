const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const TYPES = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg' }

async function authorized(request, secret) {
  if (!secret) return false
  const hash = async (value) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
  const [actual, expected] = await Promise.all([
    hash(request.headers.get('Authorization') || ''),
    hash(`Bearer ${secret}`)
  ])
  let difference = 0
  for (let index = 0; index < expected.length; index++) difference |= actual[index] ^ expected[index]
  return difference === 0
}

async function readImage(request) {
  const reader = request.body?.getReader()
  if (!reader) return null
  const chunks = []
  let length = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > MAX_IMAGE_BYTES) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

function isImage(bytes, extension) {
  if (!bytes?.length) return false
  if (extension === 'jpg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (extension === 'png') return [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)
  return bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP'
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin')
    const allowedOrigins = (env.ALLOWED_ORIGINS || '').split(',').map((value) => value.trim())
    const cors = origin && allowedOrigins.includes(origin)
      ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Expose-Headers': 'ETag', Vary: 'Origin' }
      : { Vary: 'Origin' }
    const reply = (message, status, extra = {}) => new Response(message, {
      status,
      headers: { ...cors, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra }
    })
    const pathname = new URL(request.url).pathname
    const match = /^\/uploads\/[a-zA-Z0-9-]+\.(webp|png|jpg)$/.exec(pathname)
    if (!match) return reply('Not found', 404)
    const key = pathname.slice(1)
    const contentType = TYPES[match[1]]

    if (request.method === 'OPTIONS') {
      if (!origin || !allowedOrigins.includes(origin)) return reply('Origin not allowed', 403)
      const method = request.headers.get('Access-Control-Request-Method')
      const headers = (request.headers.get('Access-Control-Request-Headers') || '').toLowerCase().split(',').map((value) => value.trim()).filter(Boolean)
      if (!['PUT', 'GET', 'HEAD'].includes(method) || headers.some((header) => !['authorization', 'content-type'].includes(header))) {
        return reply('Preflight not allowed', 403)
      }
      return reply(null, 204, {
        'Access-Control-Allow-Methods': 'PUT, GET, HEAD',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Max-Age': '3600'
      })
    }

    if (request.method === 'GET' || request.method === 'HEAD') {
      const object = request.method === 'HEAD' ? await env.BUCKET.head(key) : await env.BUCKET.get(key)
      if (!object) return reply('Not found', 404)
      return reply(request.method === 'HEAD' ? null : object.body, 200, {
        'Content-Type': contentType,
        'Content-Length': String(object.size),
        ETag: object.httpEtag,
        'Cache-Control': 'public, max-age=86400'
      })
    }

    if (request.method !== 'PUT') return reply('Method not allowed', 405, { Allow: 'GET, HEAD, PUT, OPTIONS' })
    if (origin && !allowedOrigins.includes(origin)) return reply('Origin not allowed', 403)
    if (!await authorized(request, env.UPLOAD_TOKEN)) return reply('Unauthorized', 401)
    if (request.headers.get('Content-Type')?.split(';')[0].trim() !== contentType) return reply('Unsupported image type', 415)
    if (Number(request.headers.get('Content-Length')) > MAX_IMAGE_BYTES) return reply('Image exceeds 5 MB', 413)
    const bytes = await readImage(request)
    if (!bytes) return reply('Image exceeds 5 MB or is empty', 413)
    if (!isImage(bytes, match[1])) return reply('Invalid image', 415)
    await env.BUCKET.put(key, bytes, {
      httpMetadata: { contentType, cacheControl: 'public, max-age=86400' }
    })
    return reply(null, 201)
  }
}
