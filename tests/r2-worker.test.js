import { describe, expect, it, vi } from 'vitest'
import worker from '../cloudflare/worker.mjs'

const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT1sAAAAASUVORK5CYII=', 'base64'))
const endpoint = 'https://images.example.com/uploads/test.png'
const origin = 'https://xilele777.github.io'
const environment = () => ({
  UPLOAD_TOKEN: 'test-secret',
  ALLOWED_ORIGINS: origin,
  BUCKET: { put: vi.fn(), get: vi.fn(), head: vi.fn() }
})
const upload = (headers = {}, body = png) => new Request(endpoint, {
  method: 'PUT',
  headers: { Origin: origin, 'Content-Type': 'image/png', Authorization: 'Bearer test-secret', ...headers },
  body
})

describe('R2 image Worker', () => {
  it('authorizes browser uploads and writes the image with its content type', async () => {
    const env = environment()
    const response = await worker.fetch(upload(), env)
    expect(response.status).toBe(201)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin)
    expect(env.BUCKET.put).toHaveBeenCalledWith('uploads/test.png', png, {
      httpMetadata: { contentType: 'image/png', cacheControl: 'public, max-age=86400' }
    })
  })

  it('rejects missing or incorrect secrets and unknown origins before writing', async () => {
    const env = environment()
    for (const authorization of ['', 'Bearer incorrect']) {
      expect((await worker.fetch(upload({ Authorization: authorization }), env)).status).toBe(401)
    }
    expect((await worker.fetch(upload(), { ...env, UPLOAD_TOKEN: '' })).status).toBe(401)
    expect((await worker.fetch(upload({ Origin: 'https://untrusted.example' }), env)).status).toBe(403)
    expect(env.BUCKET.put).not.toHaveBeenCalled()
  })

  it('answers browser preflight only for approved origins and headers', async () => {
    const env = environment()
    const preflight = (value) => new Request(endpoint, {
      method: 'OPTIONS',
      headers: { Origin: value, 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'authorization,content-type' }
    })
    const response = await worker.fetch(preflight(origin), env)
    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Authorization, Content-Type')
    expect((await worker.fetch(preflight('https://untrusted.example'), env)).status).toBe(403)
  })

  it('rejects non-images, wrong MIME types and oversized bodies without writing', async () => {
    const env = environment()
    expect((await worker.fetch(upload({}, new TextEncoder().encode('<script>alert(1)</script>')), env)).status).toBe(415)
    expect((await worker.fetch(upload({ 'Content-Type': 'text/html' }), env)).status).toBe(415)
    expect((await worker.fetch(upload({}, new Uint8Array(5 * 1024 * 1024 + 1)), env)).status).toBe(413)
    expect(env.BUCKET.put).not.toHaveBeenCalled()
  })

  it('serves public images and HEAD metadata while keeping other paths and methods unavailable', async () => {
    const env = environment()
    const stored = { body: png, size: png.length, httpEtag: '"image-etag"' }
    env.BUCKET.get.mockResolvedValue(stored)
    env.BUCKET.head.mockResolvedValue(stored)
    const response = await worker.fetch(new Request(endpoint), env)
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/png')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(png)
    expect((await worker.fetch(new Request(endpoint, { method: 'HEAD' }), env)).status).toBe(200)
    expect((await worker.fetch(new Request(endpoint, { method: 'DELETE' }), env)).status).toBe(405)
    expect((await worker.fetch(new Request('https://images.example.com/private.json'), env)).status).toBe(404)
    env.BUCKET.get.mockResolvedValue(null)
    expect((await worker.fetch(new Request(endpoint), env)).status).toBe(404)
  })
})
