import { type Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

function localArchive(): Plugin {
  return {
    name: 'local-archive',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__concshow/save', async (request, response) => {
        response.setHeader('Content-Type', 'application/json; charset=utf-8')
        const send = (status: number, error: string) => {
          response.statusCode = status
          response.end(JSON.stringify({ error }))
        }
        const host = request.headers.host?.split(':')[0]
        const origin = request.headers.origin
        if (
          request.method !== 'POST' ||
          !['127.0.0.1', 'localhost'].includes(host ?? '') ||
          request.headers['x-concshow-admin'] !== '1' ||
          (origin && origin !== `http://${request.headers.host}`)
        ) {
          send(403, '本地保存只允许来自本机管理页面')
          return
        }
        try {
          const chunks: Buffer[] = []
          let size = 0
          for await (const chunk of request) {
            size += chunk.length
            if (size > 80_000_000) {
              send(413, '上传总量过大，请分批保存')
              return
            }
            chunks.push(Buffer.from(chunk))
          }
          const body = JSON.parse(Buffer.concat(chunks).toString('utf-8'))
          const { archiveSchema } = (await server.ssrLoadModule(
            '/src/lib/schema.ts'
          )) as typeof import('./src/lib/schema')
          const archive = archiveSchema.parse(body.archive)
          const assets = body.assets as { path: string; base64: string }[]
          if (
            !Array.isArray(assets) ||
            assets.length > 100 ||
            assets.some(
              (asset) =>
                !/^uploads\/[a-zA-Z0-9-]+\.(webp|jpg|png)$/.test(asset.path) ||
                !/^[A-Za-z0-9+/=]+$/.test(asset.base64) ||
                asset.base64.length > 8_000_000
            )
          ) {
            send(400, '图片无效')
            return
          }
          const publicDirectory = resolve(server.config.root, 'public')
          await mkdir(resolve(publicDirectory, 'uploads'), { recursive: true })
          await mkdir(resolve(publicDirectory, 'content'), { recursive: true })
          const contentPath = resolve(publicDirectory, 'content/archive.json')
          // Preserve the previous snapshot so local deletions can be recovered.
          const backupDirectory = resolve(server.config.root, '.concshow-backups')
          await mkdir(backupDirectory, { recursive: true })
          try {
            await writeFile(resolve(backupDirectory, 'archive.backup.json'), await readFile(contentPath))
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          }
          const referenced = new Set(archive.records.flatMap((record) => record.images))
          for (const asset of assets.filter((asset) => referenced.has(asset.path)))
            await writeFile(resolve(publicDirectory, asset.path), Buffer.from(asset.base64, 'base64'))
          const temp = `${contentPath}.${crypto.randomUUID()}.tmp`
          await writeFile(temp, `${JSON.stringify(archive, null, 2)}\n`)
          await rename(temp, contentPath)
          response.end(JSON.stringify({ ok: true }))
        } catch (error) {
          send(400, error instanceof Error ? error.message : '保存失败')
        }
      })
    }
  }
}
export default defineConfig({
  plugins: [vue(), localArchive()],
  base: process.env.BASE_PATH || './',
  server: { strictPort: true },
  test: { environment: 'node' }
})
