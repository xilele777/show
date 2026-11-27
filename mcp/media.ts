import { createHash } from 'node:crypto'
import { readFile, realpath, stat, mkdir, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import sharp from 'sharp'
import { z } from 'zod'
import { ArchiveStore, checkRevision, revisionOf } from './archive'
import { recordSchema } from '../src/lib/schema'

export const imageUploadSchema = z
  .object({
    files: z.array(z.string().min(1)).min(1).max(20),
    destination: z.enum(['r2', 'local']).default('r2'),
    recordId: recordSchema.shape.id.optional(),
    expectedRevision: z.string().optional()
  })
  .strict()

export async function uploadImages(store: ArchiveStore, input: unknown) {
  const args = imageUploadSchema.parse(input)
  return store.locked(async () => {
    const before = await store.read()
    checkRevision(before, args.expectedRevision)
    const record = args.recordId ? before.records.find((record) => record.id === args.recordId) : undefined
    if (args.recordId && !record) throw new Error(`找不到记录：${args.recordId}`)
    // Resolve symlinks as well as '..'; only read explicitly allowed image directories.
    const allowed = await Promise.all(
      (process.env.CONCSHOW_IMAGE_ROOTS?.split(';').filter(Boolean) ?? [store.root]).map((path) =>
        realpath(path)
      )
    )
    const prepared = []
    for (const file of args.files) {
      const path = await realpath(isAbsolute(file) ? file : join(store.root, file))
      if (
        !allowed.some((root) => {
          const child = relative(root, path)
          return child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child)
        })
      )
        throw new Error('图片位于允许目录之外，请将图片放入项目目录，或设置 CONCSHOW_IMAGE_ROOTS（分号分隔）')
      const info = await stat(path)
      if (!info.isFile() || info.size > 20 * 1024 * 1024) throw new Error('原图必须是文件且不超过 20 MB')
      const image = sharp(await readFile(path), { limitInputPixels: 80_000_000 })
      const metadata = await image.metadata()
      if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? ''))
        throw new Error('只接受 JPG、PNG 或 WebP 图片')
      const bytes = await image
        .rotate()
        .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 85 })
        .toBuffer()
      if (bytes.length > 5 * 1024 * 1024) throw new Error('压缩后的图片超过 5 MB')
      const key = `uploads/${createHash('sha256').update(bytes).digest('hex')}.webp`
      prepared.push({ file, key, bytes })
    }
    let config: { workerUrl: string; publicUrl: string } | undefined
    let token = ''
    if (args.destination === 'r2') {
      config = JSON.parse(await readFile(join(store.root, 'src/lib/r2-public.json'), 'utf8'))
      token = process.env.CONCSHOW_R2_TOKEN?.trim() ?? ''
      if (!token) {
        try {
          token =
            JSON.parse(
              await readFile(join(store.root, '.cloudflare/upload-secrets.json'), 'utf8')
            ).UPLOAD_TOKEN?.trim() ?? ''
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
      }
      if (!token)
        throw new Error('缺少 R2 密钥：设置 CONCSHOW_R2_TOKEN 或本机 .cloudflare/upload-secrets.json')
      if (
        !config ||
        ![config.workerUrl, config.publicUrl].every((url) => {
          const parsed = new URL(url)
          return parsed.protocol === 'https:' && !parsed.username && !parsed.password
        })
      )
        throw new Error('R2 地址必须使用 HTTPS')
    }
    const paths = prepared.map((image) =>
      config ? `${config.publicUrl.replace(/\/+$/, '')}/${image.key}` : image.key
    )
    if (record && new Set([...record.images, ...paths]).size > 20) throw new Error('单场演出最多 20 张图片')
    const uploaded: { file: string; path: string; bytes: number }[] = []
    for (const image of prepared) {
      try {
        if (config) {
          const url = `${config.workerUrl.replace(/\/+$/, '')}/${image.key}`
          const response = await fetch(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'image/webp', Authorization: `Bearer ${token}` },
            body: new Uint8Array(image.bytes),
            signal: AbortSignal.timeout(30_000),
            redirect: 'error'
          })
          if (!response.ok) throw new Error(`R2 上传失败（${response.status}）`)
          const verify = await fetch(url, {
            method: 'HEAD',
            signal: AbortSignal.timeout(15_000),
            redirect: 'error'
          })
          if (!verify.ok || Number(verify.headers.get('Content-Length')) !== image.bytes.length)
            throw new Error('图片公开访问校验失败')
        } else {
          await mkdir(join(store.root, 'public/uploads'), { recursive: true })
          const path = join(store.root, 'public', image.key)
          try {
            await writeFile(path, image.bytes, { flag: 'wx' })
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
            if (!image.bytes.equals(await readFile(path))) throw new Error('已有同名图片内容不一致')
          }
        }
        uploaded.push({ file: image.file, path: paths[uploaded.length]!, bytes: image.bytes.length })
      } catch (error) {
        throw new Error(
          `${error instanceof Error ? error.message : '上传失败'}；已完成图片：${JSON.stringify(uploaded)}。此批次尚未修改记录，可重试或用修改工具关联已完成图片。`
        )
      }
    }
    let backup: string | undefined
    const next = structuredClone(before)
    if (record) {
      const target = next.records.find((item) => item.id === record.id)!
      target.images = [...new Set([...target.images, ...paths])]
      if (revisionOf(next) !== revisionOf(before)) backup = await store.save(next, before)
    }
    return { uploaded, recordId: args.recordId, backup, revision: revisionOf(next) }
  })
}
