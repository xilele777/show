<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import {
  AlertCircle,
  ArrowUpRight,
  BookOpen,
  Check,
  CloudUpload,
  Download,
  Plus,
  RotateCcw,
  Settings2,
  Upload,
  X
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
import {
  autoConnectGithub,
  connectGithubRepo,
  disconnectGithubRepo,
  getGithubClient,
  githubConfig,
  githubConnected,
  githubConnecting
} from '../lib/session'
import { draftTransaction } from '../lib/drafts'
import { closeTopLayer, setupDialogLightDismiss } from '../lib/motion'
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
const token = ref('')
const commitUrl = ref('')
const local = import.meta.env.DEV
let toastTimer: ReturnType<typeof setTimeout> | undefined

const confirmDialog = ref<HTMLDialogElement>()
const draftDialog = ref<HTMLDialogElement>()
let cleanupDraftDismiss: (() => void) | undefined
const confirmTitle = ref('')
const confirmText = ref('')
let answer: ((value: boolean) => void) | null = null

const editDirty = computed(() => Boolean(editing.value && recordFormRef.value?.isDirty))
const settingsDirty = computed(() => Boolean(tab.value === 'settings' && settingsFormRef.value?.isDirty))
const sorted = computed(() => [...archive.value!.records].sort((a, b) => b.date.localeCompare(a.date)))
const demoCount = computed(() => archive.value!.records.filter((record) => record.demo).length)
const publishedCount = computed(() => archive.value!.records.filter((record) => record.published).length)

function isDesktopSplit(): boolean {
  return typeof window !== 'undefined' && window.innerWidth > 760
}

function selectInitialRecord() {
  if (!editing.value && isDesktopSplit() && sorted.value.length > 0) {
    isNewRecord.value = false
    editing.value = JSON.parse(JSON.stringify(sorted.value[0]))
  }
}

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
  clearTimeout(toastTimer)
  error.value = ''
  message.value = ''
  commitUrl.value = ''
}

watch(message, (val) => {
  clearTimeout(toastTimer)
  if (!val) return
  toastTimer = setTimeout(() => {
    message.value = ''
    commitUrl.value = ''
  }, commitUrl.value ? 6500 : 4200)
})

async function changeTab(next: typeof tab.value) {
  if (busy.value || tab.value === next) return
  if (editDirty.value && !(await warn('放弃未保存的记录？', '当前表单改动尚未保存，继续将丢弃本次编辑。')))
    return
  if (settingsDirty.value && !(await warn('放弃未保存的设置？', '站点设置尚未保存，继续将丢弃本次修改。')))
    return
  if (next !== 'records') {
    editing.value = null
    isNewRecord.value = false
  }
  tab.value = next
  if (next === 'records') selectInitialRecord()
  clearStatus()
}

async function startEdit(record?: ConcertRecord) {
  if (!record && isNewRecord.value && editing.value) return
  if (record && !isNewRecord.value && editing.value?.id === record.id) return
  if (editDirty.value && !(await warn('放弃当前编辑？', '当前编辑尚未保存，继续将丢弃修改。')))
    return
  isNewRecord.value = !record
  const defaultCat = archive.value?.settings.categories[0] || '音乐会'
  editing.value = record ? JSON.parse(JSON.stringify(record)) : emptyRecord(defaultCat)
  clearStatus()
}

async function closeEdit() {
  if (editDirty.value && !(await warn('放弃未保存的编辑？', '当前改动尚未保存，确定离开吗？'))) return
  if (isDesktopSplit() && isNewRecord.value && sorted.value.length > 0) {
    isNewRecord.value = false
    editing.value = JSON.parse(JSON.stringify(sorted.value[0]))
  } else {
    isNewRecord.value = false
    editing.value = null
  }
}

async function saveRecord(record: ConcertRecord) {
  clearStatus()
  const next: Archive = JSON.parse(JSON.stringify(archive.value))
  const index = next.records.findIndex((item) => item.id === record.id)
  if (index === -1) next.records.push(record)
  else next.records[index] = record
  await stage(next)
  isNewRecord.value = false
  editing.value = JSON.parse(JSON.stringify(record))
  recordFormRef.value?.markClean()
  message.value = '记录已暂存到草稿。'
}

async function toggleRecordField(field: 'published' | 'featured') {
  if (!editing.value || isNewRecord.value) return
  clearStatus()
  const next: Archive = JSON.parse(JSON.stringify(archive.value))
  const target = next.records.find((item) => item.id === editing.value!.id)
  if (!target) return
  target[field] = !target[field]
  await stage(next)
  recordFormRef.value?.syncField(field, target[field])
  message.value =
    field === 'published'
      ? target.published
        ? `已将「${target.title}」设为公开`
        : `已将「${target.title}」设为隐藏`
      : target.featured
        ? `已将「${target.title}」设为精选`
        : `已取消「${target.title}」精选`
}

async function deleteCurrentRecord() {
  if (!editing.value || isNewRecord.value) return
  const target = editing.value
  if (!(await warn(`移除“${target.title}”？`, '将从当前草稿移除，发布后生效。'))) return
  const next: Archive = JSON.parse(JSON.stringify(archive.value))
  next.records = next.records.filter((item) => item.id !== target.id)
  await stage(next)
  isNewRecord.value = false
  editing.value = isDesktopSplit() && sorted.value.length > 0 ? JSON.parse(JSON.stringify(sorted.value[0])) : null
  message.value = '已从草稿移除。'
}

async function clearDemo() {
  if (!(await warn('清空全部示例记录？', `将移除 ${demoCount.value} 条示例，你的真实记录会保留。`)))
    return
  const next: Archive = JSON.parse(JSON.stringify(archive.value))
  next.records = next.records.filter((record) => !record.demo)
  await stage(next)
  if (editing.value?.demo) {
    isNewRecord.value = false
    editing.value = isDesktopSplit() && sorted.value.length > 0 ? JSON.parse(JSON.stringify(sorted.value[0])) : null
  }
  message.value = '已清空示例记录。'
}

async function saveSettings(nextSettings: Archive['settings']) {
  clearStatus()
  const next = archiveSchema.parse({ ...archive.value, settings: nextSettings })
  await stage(next)
  message.value = '站点设置已暂存到草稿。'
}

async function connect() {
  clearStatus()
  busy.value = true
  const value = token.value
  token.value = ''
  try {
    const result = await connectGithubRepo(value)
    message.value =
      result === 'synced'
        ? '仓库已连接，已同步线上最新内容。'
        : '仓库已连接，已保留当前本地草稿，可直接发布。'
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : '连接失败'
  } finally {
    busy.value = false
  }
}

async function syncRemote() {
  const client = getGithubClient()
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
    if (tab.value === 'records') {
      isNewRecord.value = false
      editing.value = isDesktopSplit() && sorted.value.length > 0 ? JSON.parse(JSON.stringify(sorted.value[0])) : null
    }
    message.value = '已从 GitHub 同步最新内容。'
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : '同步失败'
  } finally {
    busy.value = false
  }
}

function disconnect() {
  disconnectGithubRepo(true)
  token.value = ''
  message.value = '已断开仓库连接并清除本地令牌。'
}

async function publish() {
  if (!githubConnected.value && !local) {
    await changeTab('publish')
    message.value = '请先连接 GitHub 仓库后再发布。'
    return
  }
  clearStatus()
  busy.value = true
  try {
    const next: Archive = JSON.parse(JSON.stringify(archive.value))
    const client = getGithubClient()
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
    if (tab.value === 'records') {
      isNewRecord.value = false
      editing.value = isDesktopSplit() && sorted.value.length > 0 ? JSON.parse(JSON.stringify(sorted.value[0])) : null
    }
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
    await closeTopLayer(draftDialog.value)
    if (result && tab.value === 'records') {
      isNewRecord.value = false
      editing.value = isDesktopSplit() && sorted.value.length > 0 ? JSON.parse(JSON.stringify(sorted.value[0])) : null
    }
    message.value = result ? '已恢复浏览器草稿。' : '没有可恢复的草稿。'
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : '恢复失败'
  }
}

async function dismissRecoverableDraft() {
  await draftTransaction('delete').catch(() => {})
  await closeTopLayer(draftDialog.value)
}

async function discard() {
  if (!(await warn('放弃全部未发布改动？', '将恢复为上次发布或读取时的内容。'))) return
  await discardDraft()
  if (tab.value === 'records') {
    isNewRecord.value = false
    editing.value = isDesktopSplit() && sorted.value.length > 0 ? JSON.parse(JSON.stringify(sorted.value[0])) : null
  }
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
  window.addEventListener('beforeunload', beforeUnload)
  if (draftDialog.value) {
    cleanupDraftDismiss = setupDialogLightDismiss(draftDialog.value, () => {})
  }
  selectInitialRecord()
  try {
    if (!dirty.value && (await draftTransaction('read'))) {
      draftDialog.value?.removeAttribute('data-closing')
      draftDialog.value?.showModal()
    }
  } catch {}
  try {
    const autoResult = await autoConnectGithub()
    if (autoResult === 'synced') {
      if (tab.value === 'records' && !editDirty.value) {
        isNewRecord.value = false
        editing.value = isDesktopSplit() && sorted.value.length > 0 ? JSON.parse(JSON.stringify(sorted.value[0])) : null
      }
      message.value = '已自动连接 GitHub 仓库并同步最新内容。'
    } else if (autoResult === 'kept-draft') {
      message.value = '已自动连接 GitHub 仓库，保留当前本地草稿。'
    }
  } catch (caught) {
    error.value = caught instanceof Error ? `自动连接仓库失败：${caught.message}` : '自动连接仓库失败'
  }
})

onUnmounted(() => {
  clearTimeout(toastTimer)
  cleanupDraftDismiss?.()
  window.removeEventListener('beforeunload', beforeUnload)
})
</script>

<template>
  <div class="page-width admin-page">
    <h1 class="visually-hidden">观演管理</h1>

    <div class="admin-shell">
      <header class="admin-topbar">
        <nav class="admin-tabs" aria-label="后台分区">
          <button type="button" :class="{ active: tab === 'records' }" @click="changeTab('records')">
            <BookOpen :size="15" />
            <span>观演记录</span>
            <span class="tab-count">{{ archive!.records.length }}</span>
          </button>
          <button type="button" :class="{ active: tab === 'settings' }" @click="changeTab('settings')">
            <Settings2 :size="15" />
            <span>站点设置</span>
          </button>
          <button type="button" :class="{ active: tab === 'publish' }" @click="changeTab('publish')">
            <CloudUpload :size="15" />
            <span>仓库与图床</span>
            <i v-if="!githubConnected && !local" class="tab-dot-warn" title="尚未连接仓库" />
          </button>
        </nav>

        <div class="admin-topbar-right">
          <button
            type="button"
            class="conn-status-pill"
            :class="{ connected: githubConnected, local: !githubConnected && local }"
            :title="draftNotice || '点击查看仓库连接与图床设置'"
            @click="changeTab('publish')"
          >
            <span class="live-dot" :class="{ unsaved: dirty }" />
            <span>
              {{
                githubConnecting
                  ? '正在连接…'
                  : githubConnected
                    ? `${githubConfig.owner}/${githubConfig.repo}`
                    : local
                      ? '本地开发'
                      : '未连接仓库'
              }}
            </span>
          </button>

          <div class="topbar-tools">
            <button type="button" class="icon-button" title="导出 JSON 备份" aria-label="导出备份" @click="download">
              <Download :size="14" />
            </button>
            <label class="icon-button topbar-upload-btn" title="导入 JSON 备份" aria-label="导入备份">
              <Upload :size="14" />
              <input type="file" accept="application/json,.json" :disabled="busy" @change="importBackup" />
            </label>
            <button type="button" class="icon-button" title="恢复浏览器草稿" aria-label="恢复草稿" @click="restore">
              <RotateCcw :size="14" />
            </button>
          </div>

          <button
            v-if="dirty"
            type="button"
            class="button small topbar-publish-btn"
            :disabled="busy"
            @click="publish"
          >
            <CloudUpload :size="14" />
            {{
              busy
                ? '发布中…'
                : githubConnected
                  ? '发布到 GitHub'
                  : local
                    ? '保存到本地'
                    : '连接并发布'
            }}
          </button>
        </div>
      </header>

      <div v-if="tab === 'records'" class="admin-workspace" :class="{ 'has-editing': Boolean(editing) }">
        <aside class="admin-master-pane">
          <AdminRecordList
            :records="sorted"
            :selected-id="editing?.id"
            :is-new="isNewRecord"
            :published-count="publishedCount"
            :demo-count="demoCount"
            @create="startEdit()"
            @select="startEdit"
            @clear-demo="clearDemo"
          />
        </aside>

        <section class="admin-detail-pane">
          <AdminRecordForm
            v-if="editing"
            ref="recordFormRef"
            :record="editing"
            :is-new="isNewRecord"
            :categories="archive!.settings.categories"
            :archive-tags="[...new Set(archive!.records.flatMap((r) => r.tags))]"
            v-model:busy="busy"
            @save="saveRecord"
            @cancel="closeEdit"
            @delete="deleteCurrentRecord"
            @toggle-field="toggleRecordField"
            @error="error = $event"
            @status="message = $event"
          />

          <div v-else class="detail-empty-placeholder">
            <BookOpen :size="30" :stroke-width="1.3" />
            <h3>选择一条观演记录进行编辑</h3>
            <p>左侧列表会始终保持可见，方便随时切换与对照。</p>
            <button type="button" class="button small" @click="startEdit()">
              <Plus :size="15" />新增记录
            </button>
          </div>
        </section>
      </div>

      <div v-else-if="tab === 'settings'" class="admin-panel-single">
        <AdminSettingsForm
          ref="settingsFormRef"
          :settings="archive!.settings"
          :archive="archive!"
          @save="saveSettings"
          @error="error = $event"
        />
      </div>

      <div v-else class="admin-panel-single">
        <AdminPublishPanel
          :dirty="dirty"
          :busy="busy"
          :local="local"
          :connected="githubConnected"
          :connecting="githubConnecting"
          :record-count="archive!.records.length"
          :pending-count="pendingAssets.length"
          :config="githubConfig"
          v-model:token="token"
          @publish="publish"
          @discard="discard"
          @connect="connect"
          @disconnect="disconnect"
          @sync-remote="syncRemote"
          @status="message = $event"
        />
      </div>
    </div>
  </div>

  <div class="admin-toast-stack" aria-live="polite">
    <Transition name="toast-pop">
      <div v-if="message" key="toast-success" class="admin-toast success" role="status">
        <Check :size="15" />
        <span>{{ message }}</span>
        <a
          v-if="commitUrl"
          :href="commitUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="toast-action"
        >
          查看提交 <ArrowUpRight :size="13" />
        </a>
        <button
          v-else-if="dirty && (githubConnected || local)"
          type="button"
          class="toast-action"
          :disabled="busy"
          @click="publish"
        >
          立即发布 <ArrowUpRight :size="13" />
        </button>
        <button
          type="button"
          class="toast-close"
          aria-label="关闭提示"
          @click="clearStatus"
        >
          <X :size="14" />
        </button>
      </div>
    </Transition>

    <Transition name="toast-pop">
      <div v-if="error" key="toast-error" class="admin-toast error" role="alert">
        <AlertCircle :size="15" />
        <span>{{ error }}</span>
        <button
          type="button"
          class="toast-close"
          aria-label="关闭错误提示"
          @click="error = ''"
        >
          <X :size="14" />
        </button>
      </div>
    </Transition>
  </div>

  <dialog
    ref="draftDialog"
    closedby="any"
    class="confirm-dialog"
    aria-labelledby="draft-dialog-title"
    aria-describedby="draft-dialog-desc"
  >
    <h1 id="draft-dialog-title">检测到未发布的浏览器草稿</h1>
    <p id="draft-dialog-desc">是否恢复上次暂存在浏览器中的改动？选择“忽略”将清除该草稿。</p>
    <form method="dialog" @submit.prevent>
      <button type="button" class="button secondary small" @click="dismissRecoverableDraft">
        忽略
      </button>
      <button type="button" class="button small" autofocus @click="restore">
        恢复草稿
      </button>
    </form>
  </dialog>

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
