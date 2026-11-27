import type { Archive, PendingAsset } from './schema'
type Draft = { archive: Archive; assets: PendingAsset[] }
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('concshow-drafts', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('drafts')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new Error('浏览器无法打开草稿存储，请导出备份'))
  })
}
export async function draftTransaction(
  action: 'read' | 'write' | 'delete',
  value?: Draft
): Promise<Draft | undefined> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('drafts', action === 'read' ? 'readonly' : 'readwrite')
    const store = transaction.objectStore('drafts')
    const request =
      action === 'read'
        ? store.get('current')
        : action === 'write'
          ? store.put(value, 'current')
          : store.delete('current')
    transaction.oncomplete = () => {
      db.close()
      resolve(action === 'read' ? request.result : undefined)
    }
    transaction.onerror = () => {
      db.close()
      reject(new Error('浏览器草稿保存失败，请导出备份'))
    }
  })
}
