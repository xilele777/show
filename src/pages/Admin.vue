<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import {
  AlertCircle,
  ArrowUpRight,
  BookOpen,
  Check,
  CloudUpload,
  Download,
  RotateCcw,
  Settings2,
  Upload
} from 'lucide-vue-next'
import {
  archive,
  dirty,
  discardDraft,
  draftNotice,
  markSaved,
  pendingAssets,
  replaceBaseline,
  restoreDraft,
  stage
} from '../lib/store'
import { archiveSchema, emptyRecord, type Archive, type ConcertRecord } from '../lib/schema'
import { GithubArchive, type GithubConfig } from '../lib/github'
import { draftTransaction } from '../lib/drafts'
import AdminRecordList from '../components/admin/AdminRecordList.vue'
import AdminRecordForm from '../components/admin/AdminRecordForm.vue'
import AdminSettingsForm from '../components/admin/AdminSettingsForm.vue'
import AdminPublishPanel from '../components/admin/AdminPublishPanel.vue'

const tab = ref<'records' | 'settings' | 'publish'>('records')
const editing = ref<ConcertRecord | null>(null)
const isNewRecord = ref(false)
const recordFormRef = ref<InstanceType<typeof AdminRecordForm>>()
const settingsFormRef = ref<InstanceType<typeof AdminSettingsForm>>()

const busy = ref(false)
const message = ref('')
const error = ref('')
const connected = ref(false)
const token = ref('')
const config = ref<GithubConfig>({
  owner: import.meta.env.VITE_GITHUB_OWNER || 'xilele777',
  repo: import.meta.env.VITE_GITHUB_REPO || 'concshow',
  branch: import.meta.env.VITE_GITHUB_BRANCH || 'main'
})
const commitUrl = ref('')
const hasRecoverableDraft = ref(false)
const local = import.meta.env.DEV
let client: GithubArchive | null = null

const confirmDialog = ref<HTMLDialogElement>()
const confirmTitle = ref('')
const confirmText = ref('')
let answer: ((value: boolean) => void) | null = null

const editDirty = computed(() => Boolean(editing.value && recordFormRef.value?.isDirty))
const settingsDirty = computed(() => Boolean(tab.value === 'settings' && settingsFormRef.value?.isDirty))
const sorted = computed(() => [...archive.value!.records].sort((a, b) => b.date.localeCompare(a.date)))
const demoCount = computed(() => archive.value!.records.filter((record) => record.demo).length)
const publishedCount = computed(() => archive.value!.records.filter((record) => record.published).length)

function warn(title: string, text: string): Promise<boolean> {
  confirmTitle.value = title
  confirmText.value = text
  confirmDialog.value!.showModal()
  return new Promise((resolve) => (answer = resolve))
}

function finishConfirm() {
  const value = confirmDialog.value!.returnValue === 'continue'
  confirmDialog.value!.returnValue = ''
  answer?.(value)
  answer = null
}

function clearStatus() {
  error.value = ''
  message.value = ''
  commitUrl.value = ''
}

async function changeTab(next: typeof tab.value) {
  if (busy.value) return
  if (editDirty.value && !(await warn('放弃未保存的记录？', '当前表单改动尚未保存，继续将丢弃本次编辑。')))
    return
  if (settingsDirty.value && !(await warn('放弃未保存的设置？', '站点设置尚未保存，继续将丢弃本次修改。')))
    return
  editing.value = null
  tab.value = next
  clearStatus()
}

async function startEdit(record?: ConcertRecord) {
  if (editDirty.value && !(await warn('放弃当前编辑？', '当前编辑尚未保存，继续将丢弃修改。')))
    return
  isNewRecord.value = !record
  editing.value = record ? JSON.parse(JSON.stringify(record)) : emptyRecord()
  clearStatus()
}

async function closeEdit() {
  if (editDirty.value && !(await warn('放弃未保存的编辑？', '当前改动尚未保存，确定离开吗？'))) return
  editing.value = null
}

async function saveRecord(record: ConcertRecord) {
  clearStatus()
  const next: Archive = JSON.parse(JSON.stringify(archive.value))
  const index = next.records.findIndex((item) => item.id === record.id)
  if (index === -1) next.records.push(record)
  else next.records[index] = record
  await stage(next)
  hasRecoverableDraft.value = false
  editing.value = null
  message.value = '记录已暂存到草稿。'
}

async function toggleRecordField(record: ConcertRecord, field: 'published' | 'featured') {
  clearStatus()
  const next: Archive = JSON.parse(JSON.stringify(archive.value))
  const target = next.records.find((item) => item.id === record.id)
  if (!target) return
  target[field] = !target[field]
  await stage(next)
  hasRecoverableDraft.value = false
  message.value =
    field === 'published'
      ? target.published
        ? `已将「${target.title}」设为公开`
        : `已将「${target.title}」设为隐藏`
      : target.featured
        ? `已将「${target.title}」设为精选`
        : `已取消「${target.title}」精选`
}

async function deleteRecord(record: ConcertRecord) {
  if (!(await warn(`移除“${record.title}”？`, '将从当前草稿移除，发布后生效。'))) return
  const next: Archive = JSON.parse(JSON.stringify(archive.value))
  next.records = next.records.filter((item) => item.id !== record.id)
  await stage(next)
  hasRecoverableDraft.value = false
  message.value = '已从草稿移除。'
}

async function clearDemo() {
  if (!(await warn('清空全部示例记录？', `将移除 ${demoCount.value} 条示例，你的真实记录会保留。`)))
    return
  const next: Archive = JSON.parse(JSON.stringify(archive.value))
  next.records = next.records.filter((record) => !record.demo)
  await stage(next)
  hasRecoverableDraft.value = false
  message.value = '已清空示例记录。'
}

async function saveSettings(nextSettings: Archive['settings']) {
  clearStatus()
  const next = archiveSchema.parse({ ...archive.value, settings: nextSettings })
  await stage(next)
  hasRecoverableDraft.value = false
  message.value = '站点设置已暂存到草稿。'
}

async function connect() {
  clearStatus()
  busy.value = true
  const value = token.value
  token.value = ''
  try {
    client?.disconnect()
    client = new GithubArchive(config.value, value)
    const remote = await client.connect()
    if (!dirty.value) {
      replaceBaseline(remote)
      message.value = '仓库已连接，已同步线上最新内容。'
    } else {
      message.value = '仓库已连接，已保留当前本地草稿，可直接发布。'
    }
    connected.value = true
    try {
      localStorage.setItem('concshow-repository', JSON.stringify(config.value))
    } catch {}
  } catch (caught) {
    client?.disconnect()
    client = null
    connected.value = false
    error.value = caught instanceof Error ? caught.message : '连接失败'
  } finally {
    busy.value = false
  }
}

async function syncRemote() {
  if (!client) return
  if (
    dirty.value &&
    !(await warn('拉取线上版本覆盖草稿？', '这会丢弃当前未发布的本地修改，恢复为仓库最新内容。'))
  )
    return
  clearStatus()
  busy.value = true
  try {
    const remote = await client.connect()
    replaceBaseline(remote)
    await draftTransaction('delete').catch(() => {})
    hasRecoverableDraft.value = false
    message.value = '已从 GitHub 同步最新内容。'
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : '同步失败'
  } finally {
    busy.value = false
  }
}

function disconnect() {
  client?.disconnect()
  client = null
  connected.value = false
  token.value = ''
  message.value = '已断开仓库连接。'
}

async function publish() {
  clearStatus()
  busy.value = true
  try {
    const next: Archive = JSON.parse(JSON.stringify(archive.value))
    if (client) {
      const url = await client.publish(
        next,
        JSON.parse(JSON.stringify(pendingAssets.value)),
        (status) => (message.value = status)
      )
      await markSaved(next)
      commitUrl.value = url
      message.value = '已发布到 GitHub，Actions 构建完成后生效。'
    } else if (local) {
      const response = await fetch('/__concshow/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Concshow-Admin': '1' },
        body: JSON.stringify({ archive: next, assets: pendingAssets.value })
      })
      if (!response.ok) {
        const body = await response.json()
        throw new Error(body.error || '本地保存失败')
      }
      await markSaved(next)
      message.value = '已写入本地 public/content/archive.json。'
    } else throw new Error('请先连接 GitHub 仓库')
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : '发布失败，草稿仍保留在本地'
  } finally {
    busy.value = false
  }
}

function download() {
  const blob = new Blob(
    [
      JSON.stringify(
        { format: 'concshow-backup-v1', archive: archive.value, assets: pendingAssets.value },
        null,
        2
      )
    ],
    { type: 'application/json' }
  )
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `concshow-backup-${new Date().toISOString().slice(0, 10)}.json`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  message.value = '已导出 JSON 备份。'
}

async function importBackup(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  if (!(await warn('导入并替换当前草稿？', '导入会替换当前记录与设置，不会自动发布。'))) {
    input.value = ''
    return
  }
  clearStatus()
  try {
    if (file.size > 80_000_000) throw new Error('备份文件不能超过 80 MB')
    const data = JSON.parse(await file.text())
    const next = archiveSchema.parse(data.archive || data)
    const assets = data.assets || []
    if (
      !Array.isArray(assets) ||
      assets.length > 100 ||
      assets.some(
        (asset: { path: string; base64: string }) =>
          !/^uploads\/[a-zA-Z0-9-]+\.(webp|jpg|png)$/.test(asset.path) ||
          !/^[A-Za-z0-9+/=]+$/.test(asset.base64) ||
          asset.base64.length > 8_000_000
      )
    )
      throw new Error('备份图片数据无效')
    pendingAssets.value = assets
    await stage(next)
    hasRecoverableDraft.value = false
    message.value = '已导入备份到草稿。'
  } catch (caught) {
    error.value =
      caught instanceof Error
        ? caught.message.startsWith('[')
          ? '备份格式不匹配'
          : caught.message
        : '导入失败'
  } finally {
    input.value = ''
  }
}

async function restore() {
  clearStatus()
  try {
    if (dirty.value && !(await warn('恢复浏览器草稿？', '当前草稿将被上次保存的浏览器草稿替换。')))
      return
    const result = await restoreDraft()
    hasRecoverableDraft.value = false
    message.value = result ? '已恢复浏览器草稿。' : '没有可恢复的草稿。'
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : '恢复失败'
  }
}

async function dismissRecoverableDraft() {
  await draftTransaction('delete').catch(() => {})
  hasRecoverableDraft.value = false
}

async function discard() {
  if (!(await warn('放弃全部未发布改动？', '将恢复为上次发布或读取时的内容。'))) return
  await discardDraft()
  hasRecoverableDraft.value = false
  message.value = '已恢复到上次保存的版本。'
}

function beforeUnload(event: BeforeUnloadEvent) {
  if (editDirty.value || settingsDirty.value || busy.value) event.preventDefault()
}

onBeforeRouteLeave(
  async () =>
    !busy.value &&
    ((!editDirty.value && !settingsDirty.value) ||
      (await warn('离开未保存的编辑？', '当前表单修改尚未保存，确定离开吗？')))
)

onMounted(async () => {
  try {
    const saved = JSON.parse(localStorage.getItem('concshow-repository') || 'null')
    if (saved?.owner && saved?.repo && saved?.branch) config.value = saved
  } catch {}
  window.addEventListener('beforeunload', beforeUnload)
  try {
    if (!dirty.value && (await draftTransaction('read'))) {
      hasRecoverableDraft.value = true
    }
  } catch {}
})

onUnmounted(() => {
  window.removeEventListener('beforeunload', beforeUnload)
  disconnect()
})
</script>

<template>
  <div class="page-width admin-page">
    <h1 class="visually-hidden">观演管理</h1>

    <div class="admin-shell">
      <aside class="admin-sidebar">
        <button type="button" :class="{ active: tab === 'records' }" @click="changeTab('records')">
          <BookOpen :size="16" />观演记录 <span>{{ archive!.records.length }}</span>
        </button>
        <button type="button" :class="{ active: tab === 'settings' }" @click="changeTab('settings')">
          <Settings2 :size="16" />站点设置
        </button>
        <button type="button" :class="{ active: tab === 'publish' }" @click="changeTab('publish')">
          <CloudUpload :size="16" />发布与同步 <i v-if="dirty" />
        </button>

        <div class="sidebar-status">
          <div class="sidebar-status-row">
            <span class="live-dot" :class="{ unsaved: dirty }" />
            <b>{{ dirty ? '待发布' : '已同步' }}</b>
          </div>
          <p>{{ connected ? 'GitHub 已连接' : local ? '本地开发模式' : '未连接仓库' }}</p>
          <p v-if="draftNotice">{{ draftNotice }}</p>
        </div>

        <div class="sidebar-tools">
          <button type="button" @click="download"><Download :size="14" />导出备份</button>
          <label>
            <Upload :size="14" />导入备份
            <input type="file" accept="application/json,.json" :disabled="busy" @change="importBackup" />
          </label>
          <button type="button" @click="restore"><RotateCcw :size="14" />恢复草稿</button>
        </div>
      </aside>

      <div class="admin-content">
        <div v-if="hasRecoverableDraft" class="draft-recover-banner" role="status">
          <span>检测到上次未发布的浏览器草稿</span>
          <div class="banner-actions">
            <button type="button" class="banner-link" @click="restore">恢复草稿</button>
            <button type="button" class="banner-link muted-action" @click="dismissRecoverableDraft">
              忽略
            </button>
          </div>
        </div>

        <div v-if="message" class="notice success" role="status">
          <div class="notice-main">
            <Check :size="16" />
            <span>{{ message }}</span>
          </div>
          <a
            v-if="commitUrl"
            :href="commitUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="notice-action"
          >
            查看提交 <ArrowUpRight :size="13" />
          </a>
          <button
            v-else-if="dirty && tab !== 'publish'"
            type="button"
            class="notice-action"
            @click="changeTab('publish')"
          >
            去发布 <ArrowUpRight :size="13" />
          </button>
        </div>

        <div v-if="error" class="notice error" role="alert">
          <div class="notice-main">
            <AlertCircle :size="16" />
            <span>{{ error }}</span>
          </div>
        </div>

        <AdminRecordList
          v-if="tab === 'records' && !editing"
          :records="sorted"
          :published-count="publishedCount"
          :demo-count="demoCount"
          @create="startEdit()"
          @edit="startEdit"
          @delete="deleteRecord"
          @toggle-field="toggleRecordField"
          @clear-demo="clearDemo"
        />

        <AdminRecordForm
          v-else-if="tab === 'records' && editing"
          ref="recordFormRef"
          :record="editing"
          :is-new="isNewRecord"
          v-model:busy="busy"
          @save="saveRecord"
          @cancel="closeEdit"
          @error="error = $event"
          @status="message = $event"
        />

        <AdminSettingsForm
          v-else-if="tab === 'settings'"
          ref="settingsFormRef"
          :settings="archive!.settings"
          :archive="archive!"
          @save="saveSettings"
          @error="error = $event"
        />

        <AdminPublishPanel
          v-else
          :dirty="dirty"
          :busy="busy"
          :local="local"
          :connected="connected"
          :record-count="archive!.records.length"
          :pending-count="pendingAssets.length"
          :config="config"
          v-model:token="token"
          @publish="publish"
          @discard="discard"
          @connect="connect"
          @disconnect="disconnect"
          @sync-remote="syncRemote"
        />
      </div>
    </div>
  </div>

  <dialog
    ref="confirmDialog"
    class="confirm-dialog"
    aria-labelledby="confirm-title"
    aria-describedby="confirm-description"
    @close="finishConfirm"
  >
    <h1 id="confirm-title">{{ confirmTitle }}</h1>
    <p id="confirm-description">{{ confirmText }}</p>
    <form method="dialog">
      <button class="button secondary small" value="cancel" autofocus>留在这里</button>
      <button class="button small" value="continue">继续</button>
    </form>
  </dialog>
</template>
