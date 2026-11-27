import { computed, ref } from 'vue'
import { archiveSchema, assetUrl, type Archive, type PendingAsset } from './schema'
import { draftTransaction } from './drafts'

export const archive = ref<Archive | null>(null)
export const loadError = ref('')
export const dirty = ref(false)
export const pendingAssets = ref<PendingAsset[]>([])
export const draftNotice = ref('')
export const visibleRecords = computed(() =>
  [...(archive.value?.records ?? [])]
    .filter((record) => record.published)
    .sort((a, b) => b.date.localeCompare(a.date))
)
let publishedSnapshot: Archive | null = null
let writeQueue = Promise.resolve()
const savedImagePreviews = ref<Record<string, string>>({})
export function replaceBaseline(next: Archive) {
  archive.value = archiveSchema.parse(next)
  publishedSnapshot = JSON.parse(JSON.stringify(next))
  dirty.value = false
  pendingAssets.value = []
}
export async function loadArchive() {
  try {
    const response = await fetch(assetUrl('content/archive.json'), { cache: 'no-cache' })
    if (!response.ok) throw new Error(`内容加载失败（${response.status}）`)
    replaceBaseline(archiveSchema.parse(await response.json()))
    loadError.value = ''
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : '内容加载失败'
  }
}
export async function stage(next: Archive) {
  archive.value = archiveSchema.parse(next)
  const referenced = new Set(archive.value.records.flatMap((record) => record.images))
  pendingAssets.value = pendingAssets.value.filter((asset) => referenced.has(asset.path))
  dirty.value = true
  const snapshot = JSON.parse(JSON.stringify({ archive: archive.value, assets: pendingAssets.value }))
  writeQueue = writeQueue
    .catch(() => {})
    .then(async () => {
      await draftTransaction('write', snapshot)
      draftNotice.value = '草稿已保存在此浏览器'
    })
  try {
    await writeQueue
  } catch (error) {
    draftNotice.value = error instanceof Error ? error.message : '草稿保存失败，请导出备份'
  }
}
export async function restoreDraft() {
  const draft = await draftTransaction('read')
  if (!draft) return false
  const validated = archiveSchema.parse(draft.archive)
  if (
    !Array.isArray(draft.assets) ||
    draft.assets.some(
      (asset) =>
        !/^uploads\/[a-zA-Z0-9-]+\.(webp|jpg|png)$/.test(asset.path) ||
        !/^[A-Za-z0-9+/=]+$/.test(asset.base64) ||
        asset.base64.length > 8_000_000
    )
  )
    throw new Error('草稿图片无效')
  archive.value = validated
  pendingAssets.value = draft.assets
  dirty.value = true
  return true
}
export async function markSaved(next: Archive) {
  await writeQueue.catch(() => {})
  pendingAssets.value.forEach((asset) => {
    savedImagePreviews.value[asset.path] =
      `data:image/${asset.path.endsWith('.webp') ? 'webp' : asset.path.endsWith('.png') ? 'png' : 'jpeg'};base64,${asset.base64}`
  })
  archive.value = next
  publishedSnapshot = JSON.parse(JSON.stringify(next))
  dirty.value = false
  pendingAssets.value = []
  try {
    await draftTransaction('delete')
    draftNotice.value = ''
  } catch {
    draftNotice.value = '内容已保存，但旧浏览器草稿无法清除。'
  }
}
export async function discardDraft() {
  if (publishedSnapshot) archive.value = JSON.parse(JSON.stringify(publishedSnapshot))
  await markSaved(archive.value!)
}
export function imageUrl(path: string): string {
  if (/^https:\/\//i.test(path)) return path
  const pending = pendingAssets.value.find((asset) => asset.path === path)
  return pending
    ? `data:image/${path.endsWith('.webp') ? 'webp' : path.endsWith('.png') ? 'png' : 'jpeg'};base64,${pending.base64}`
    : savedImagePreviews.value[path] || assetUrl(path)
}

export async function prepareImage(file: File): Promise<PendingAsset> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    throw new Error('请选择 JPG、PNG 或 WebP 图片')
  if (file.size > 20 * 1024 * 1024) throw new Error('单张原图不能超过 20 MB')
  const bitmap = await createImageBitmap(file)
  if (bitmap.width * bitmap.height > 80_000_000) {
    bitmap.close()
    throw new Error('图片尺寸过大，请先缩小原图')
  }
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const context = canvas.getContext('2d')
  if (!context) {
    bitmap.close()
    throw new Error('浏览器无法处理图片')
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('图片压缩失败'))), 'image/webp', 0.85)
  )
  if (blob.size > 5 * 1024 * 1024) throw new Error('压缩后图片仍超过 5 MB，请缩小原图')
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
  const extension = blob.type === 'image/webp' ? 'webp' : 'png'
  return { path: `uploads/${crypto.randomUUID()}.${extension}`, base64: data.split(',')[1]! }
}
