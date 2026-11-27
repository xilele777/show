<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ZodError } from 'zod'
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  ImagePlus,
  Link2,
  Plus,
  Save,
  Star,
  Trash2,
  X
} from 'lucide-vue-next'
import {
  defaultEventTypes,
  normalizeProgramItem,
  programHalves,
  recordSchema,
  type ConcertRecord,
  type ProgramItem
} from '../../lib/schema'
import { categoryStyle } from '../../lib/categories'
import { imageUrl, pendingAssets, prepareImage } from '../../lib/store'
import { isR2Ready, uploadAssetToR2 } from '../../lib/r2'
import { parseProgramText, splitPerformerNames } from '../../lib/program'

const props = defineProps<{
  record: ConcertRecord
  isNew: boolean
  busy: boolean
  categories?: string[]
  archiveTags?: string[]
}>()

const emit = defineEmits<{
  save: [record: ConcertRecord]
  cancel: []
  delete: []
  toggleField: [field: 'published' | 'featured']
  error: [message: string]
  status: [message: string]
  'update:busy': [value: boolean]
}>()

const draft = ref<ConcertRecord>(JSON.parse(JSON.stringify(props.record)))
const programItems = ref<ProgramItem[]>([])
const initialSnapshot = ref('')

const soloistInput = ref('')
const tagInput = ref('')
const externalImageUrl = ref('')
const batchProgramText = ref('')
const showBatchProgram = ref(false)

// Date dropdown & calendar state
const dateYear = ref(new Date().getFullYear())
const dateMonth = ref(new Date().getMonth() + 1)
const dateDay = ref(new Date().getDate())
const calPopover = ref<HTMLElement>()
const calViewYear = ref(dateYear.value)
const calViewMonth = ref(dateMonth.value)

const currentYear = new Date().getFullYear()
const yearOptions = computed(() => {
  const minY = Math.min(1980, dateYear.value)
  const maxY = Math.max(currentYear + 5, dateYear.value)
  const arr: number[] = []
  for (let y = maxY; y >= minY; y--) arr.push(y)
  return arr
})

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

const dayOptions = computed(() => {
  const count = daysInMonth(dateYear.value, dateMonth.value)
  return Array.from({ length: count }, (_, i) => i + 1)
})

function syncDraftDate() {
  const maxD = daysInMonth(dateYear.value, dateMonth.value)
  if (dateDay.value > maxD) dateDay.value = maxD
  draft.value.date = `${dateYear.value}-${String(dateMonth.value).padStart(2, '0')}-${String(dateDay.value).padStart(2, '0')}`
}

function parseDateParts(iso: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (match) {
    dateYear.value = Number(match[1])
    dateMonth.value = Number(match[2])
    dateDay.value = Number(match[3])
  }
  calViewYear.value = dateYear.value
  calViewMonth.value = dateMonth.value
}

const calendarCells = computed(() => {
  const y = calViewYear.value
  const m = calViewMonth.value
  const firstDow = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7 // Monday = 0
  const totalDays = daysInMonth(y, m)
  const cells: (number | null)[] = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let d = 1; d <= totalDays; d++) cells.push(d)
  return cells
})

function shiftCalendarMonth(delta: number) {
  let m = calViewMonth.value + delta
  let y = calViewYear.value
  if (m < 1) {
    m = 12
    y--
  } else if (m > 12) {
    m = 1
    y++
  }
  calViewYear.value = y
  calViewMonth.value = m
}

function pickCalendarDay(day: number) {
  dateYear.value = calViewYear.value
  dateMonth.value = calViewMonth.value
  dateDay.value = day
  syncDraftDate()
  calPopover.value?.hidePopover?.()
}

function syncCalendarToSelected() {
  calViewYear.value = dateYear.value
  calViewMonth.value = dateMonth.value
}

const categoryOptions = computed(() => {
  const base = props.categories?.length ? props.categories : [...defaultEventTypes]
  return base.includes(draft.value.type) ? base : [...base, draft.value.type]
})

const suggestedTags = computed(() =>
  (props.archiveTags ?? []).filter((t) => !draft.value.tags.includes(t)).slice(0, 14)
)

const snapshot = () => JSON.stringify({ ...draft.value, program: programItems.value })

watch(
  () => props.record,
  (value) => {
    const cloned = JSON.parse(JSON.stringify(value)) as ConcertRecord
    cloned.soloists = cloned.soloists ?? []
    cloned.cast = cloned.cast ?? []
    cloned.subtitle = cloned.subtitle ?? ''
    cloned.orchestra = cloned.orchestra ?? ''
    cloned.conductor = cloned.conductor ?? ''
    cloned.seat = cloned.seat ?? ''
    cloned.price = cloned.price ?? ''
    cloned.time = cloned.time ?? ''
    cloned.status = cloned.status ?? 'watched'
    draft.value = cloned
    programItems.value = (cloned.program ?? []).map(normalizeProgramItem)
    parseDateParts(cloned.date)
    initialSnapshot.value = snapshot()
  },
  { immediate: true }
)

const isDirty = computed(() => snapshot() !== initialSnapshot.value)

function markClean() {
  initialSnapshot.value = snapshot()
}

function syncField(field: 'published' | 'featured', value: boolean) {
  draft.value[field] = value
  try {
    const snap = JSON.parse(initialSnapshot.value)
    snap[field] = value
    initialSnapshot.value = JSON.stringify(snap)
  } catch {}
}

defineExpose({ isDirty, markClean, syncField })

function addSoloist() {
  const parts = soloistInput.value
    .split(/[,，/]/)
    .map((s) => s.trim())
    .filter(Boolean)
  for (const name of parts) {
    if (!draft.value.soloists.includes(name) && draft.value.soloists.length < 20) {
      draft.value.soloists.push(name)
    }
  }
  soloistInput.value = ''
}

function removeSoloist(index: number) {
  draft.value.soloists.splice(index, 1)
}

function addTag(raw?: string) {
  const source = typeof raw === 'string' ? raw : tagInput.value
  const parts = source
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean)
  for (const tag of parts) {
    if (!draft.value.tags.includes(tag) && draft.value.tags.length < 20) {
      draft.value.tags.push(tag)
    }
  }
  if (typeof raw !== 'string') tagInput.value = ''
}

function removeTag(index: number) {
  draft.value.tags.splice(index, 1)
}

function addProgramItem() {
  const prevHalf = programItems.value.at(-1)?.half ?? ''
  programItems.value.push({
    title: '',
    composer: '',
    half: prevHalf,
    source: '',
    lyricist: '',
    section: programItems.value.at(-1)?.section ?? '',
    credits: [],
    description: '',
    performers: []
  })
}

function removeProgramItem(index: number) {
  programItems.value.splice(index, 1)
}

function moveProgramItem(index: number, delta: -1 | 1) {
  const next = index + delta
  if (next < 0 || next >= programItems.value.length) return
  const [item] = programItems.value.splice(index, 1)
  if (item) programItems.value.splice(next, 0, item)
}

function importBatchProgram() {
  emit('error', '')
  try {
    const parsed = parseProgramText(batchProgramText.value)
    if (programItems.value.length + parsed.length > 100) throw new Error('单场节目单最多 100 首曲目。')
    programItems.value.push(...parsed)
    batchProgramText.value = ''
    showBatchProgram.value = false
  } catch (error) {
    emit('error', error instanceof Error ? error.message : '节目单导入失败')
  }
}

async function upload(event: Event) {
  emit('error', '')
  emit('update:busy', true)
  const input = event.target as HTMLInputElement
  try {
    const files = [...(input.files ?? [])]
    if (files.length + draft.value.images.length > 20) throw new Error('每条记录最多 20 张图片')
    const useR2 = isR2Ready()
    for (const file of files) {
      const asset = await prepareImage(file)
      if (useR2) {
        const url = await uploadAssetToR2(asset)
        draft.value.images.push(url)
      } else {
        pendingAssets.value.push(asset)
        draft.value.images.push(asset.path)
      }
    }
    emit('status', useR2 ? '照片已直传至 Cloudflare R2。' : '照片已添加，保存记录后生效。')
  } catch (caught) {
    emit('error', caught instanceof Error ? caught.message : '图片处理失败')
  } finally {
    emit('update:busy', false)
    input.value = ''
  }
}

function addExternalImage() {
  emit('error', '')
  const url = externalImageUrl.value.trim()
  if (!url) return
  if (!/^https:\/\//i.test(url)) {
    emit('error', '外链图床图片必须使用 HTTPS 地址')
    return
  }
  if (draft.value.images.length >= 20) {
    emit('error', '每条记录最多 20 张图片')
    return
  }
  draft.value.images.push(url)
  externalImageUrl.value = ''
}

function makeCover(index: number) {
  if (index <= 0) return
  const image = draft.value.images.splice(index, 1)[0]!
  draft.value.images.unshift(image)
}

function setRating(star: number) {
  draft.value.rating = draft.value.rating === star ? 0 : star
}

function submit() {
  emit('error', '')
  if (soloistInput.value.trim()) addSoloist()
  if (tagInput.value.trim()) addTag()
  syncDraftDate()
  try {
    const cleanProgram = programItems.value
      .map((item) => ({
        ...item,
        title: item.title.trim(),
        composer: item.composer.trim(),
        half: item.half
      }))
      .filter((item) => Boolean(item.title))

    const parsed = recordSchema.parse({
      ...draft.value,
      cast: draft.value.cast.filter((person) => person.name.trim() || person.role.trim()),
      tags: [...new Set(draft.value.tags)],
      program: cleanProgram
    })
    emit('save', parsed)
  } catch (caught) {
    const labels: Record<string, string> = {
      title: '演出标题',
      date: '日期',
      time: '开始时间',
      city: '城市',
      cast: '演出人员',
      program: '节目单',
      name: '姓名',
      role: '职责 / 角色',
      source: '剧目出处',
      lyricist: '作词',
      performers: '演唱 / 演奏者',
      composer: '作曲',
      section: '节目小节',
      credits: '曲目署名',
      description: '节目说明',
      note: '个人感想',
      subtitle: '副标题'
    }
    const issue = caught instanceof ZodError ? caught.issues[0] : undefined
    emit(
      'error',
      issue
        ? `${issue.path.map((part) => (typeof part === 'number' ? `第 ${part + 1} 项` : (labels[part] ?? part))).join(' · ')}：${issue.message}`
        : caught instanceof Error
          ? caught.message
          : '保存失败'
    )
  }
}
</script>

<template>
  <form class="record-form" @submit.prevent="submit">
    <div class="panel-heading record-form-heading">
      <div class="record-form-title-wrap">
        <button
          type="button"
          class="icon-button mobile-back-btn"
          aria-label="返回列表"
          title="返回列表"
          @click="emit('cancel')"
        >
          <ArrowLeft :size="16" />
        </button>
        <div>
          <h2>{{ isNew ? '新增记录' : draft.title || '编辑记录' }}</h2>
          <p v-if="isDirty" class="unsaved-hint">有未保存的表单修改</p>
        </div>
      </div>

      <div class="record-form-head-actions">
        <template v-if="!isNew">
          <button
            type="button"
            class="icon-button"
            :class="{ 'is-active': draft.featured }"
            :aria-label="draft.featured ? '取消精选' : '设为精选'"
            :title="draft.featured ? '取消精选' : '设为精选'"
            @click="emit('toggleField', 'featured')"
          >
            <Star :size="15" />
          </button>
          <button
            type="button"
            class="icon-button"
            :class="{ 'is-muted': !draft.published }"
            :aria-label="draft.published ? '公开中（点击隐藏）' : '已隐藏（点击公开）'"
            :title="draft.published ? '公开中（点击隐藏）' : '已隐藏（点击公开）'"
            @click="emit('toggleField', 'published')"
          >
            <Eye v-if="draft.published" :size="15" />
            <EyeOff v-else :size="15" />
          </button>
          <button
            type="button"
            class="icon-button"
            aria-label="移除这条记录"
            title="移除"
            @click="emit('delete')"
          >
            <Trash2 :size="15" />
          </button>
        </template>
        <button class="button small" type="submit" :disabled="busy || (!isNew && !isDirty)">
          <Save :size="14" />保存草稿
        </button>
      </div>
    </div>

    <div class="form-grid">
      <div class="field-label full">
        <span>观看状态</span>
        <div class="type-pills" role="radiogroup" aria-label="观看状态">
          <button
            type="button"
            role="radio"
            class="type-pill-btn"
            :class="{ active: draft.status === 'watched' }"
            :aria-checked="draft.status === 'watched'"
            @click="draft.status = 'watched'"
          >
            已观看
          </button>
          <button
            type="button"
            role="radio"
            class="type-pill-btn upcoming-pill-btn"
            :class="{ active: draft.status === 'upcoming' }"
            :aria-checked="draft.status === 'upcoming'"
            @click="draft.status = 'upcoming'"
          >
            待观看
          </button>
        </div>
      </div>

      <label class="full">
        演出标题 *
        <input v-model="draft.title" required maxlength="160" placeholder="例如：柴可夫斯基第五交响曲" />
      </label>

      <label>
        乐团 / 团体
        <input v-model="draft.orchestra" maxlength="160" placeholder="例如：柏林爱乐乐团 / 乐队名称" />
      </label>

      <label>
        指挥
        <input v-model="draft.conductor" maxlength="120" placeholder="例如：基里尔·别特连科（可留空）" />
      </label>

      <div class="field-label full">
        <span>独奏家（明确标注时填写）</span>
        <div class="chip-editor">
          <div v-if="draft.soloists.length" class="chip-list">
            <span v-for="(person, idx) in draft.soloists" :key="`${person}-${idx}`" class="editor-chip">
              {{ person }}
              <button
                type="button"
                class="chip-remove"
                :aria-label="`移除 ${person}`"
                @click="removeSoloist(idx)"
              >
                <X :size="12" />
              </button>
            </span>
          </div>
          <div class="chip-input-row">
            <input
              v-model="soloistInput"
              maxlength="80"
              placeholder="输入独奏家姓名，按回车或逗号添加多位"
              @keydown.enter.prevent="addSoloist"
            />
            <button type="button" class="button secondary small" @click="addSoloist">
              <Plus :size="14" />添加
            </button>
          </div>
        </div>
      </div>

      <label class="full">
        副标题 / 巡演副标
        <input v-model="draft.subtitle" maxlength="160" placeholder="有副标题时填写，未提供则留空" />
      </label>

      <label v-if="draft.artist" class="full">
        历史署名
        <input v-model="draft.artist" maxlength="160" />
        <small>旧记录保留的署名；演出人员请填写在下方。</small>
      </label>

      <fieldset class="cast-editor full">
        <legend>演出人员 / 演员表</legend>
        <p class="field-hint">按节目单填写姓名；职责或角色未提供时留空。</p>
        <div v-for="(person, index) in draft.cast" :key="index" class="cast-editor-row">
          <label :for="`cast-name-${index}`">
            姓名
            <input :id="`cast-name-${index}`" v-model="person.name" maxlength="80" required />
          </label>
          <label :for="`cast-role-${index}`">
            职责 / 角色
            <input
              :id="`cast-role-${index}`"
              v-model="person.role"
              maxlength="80"
              placeholder="未提供则留空"
            />
          </label>
          <button
            type="button"
            class="icon-button"
            :aria-label="`移除演出人员 ${person.name || index + 1}`"
            @click="draft.cast.splice(index, 1)"
          >
            <X :size="14" />
          </button>
        </div>
        <button
          type="button"
          class="button secondary small"
          :disabled="draft.cast.length >= 100"
          @click="draft.cast.push({ name: '', role: '' })"
        >
          <Plus :size="14" />添加演出人员
        </button>
      </fieldset>

      <div class="field-label full">
        <span>演出日期 *</span>
        <div class="date-picker-row">
          <span class="select-wrap">
            <select
              v-model.number="dateYear"
              class="select-control"
              aria-label="选择年份"
              @change="syncDraftDate"
            >
              <option v-for="y in yearOptions" :key="y" :value="y">{{ y }} 年</option>
            </select>
            <ChevronDown :size="13" class="select-chevron" aria-hidden="true" />
          </span>

          <span class="select-wrap">
            <select
              v-model.number="dateMonth"
              class="select-control"
              aria-label="选择月份"
              @change="syncDraftDate"
            >
              <option v-for="m in 12" :key="m" :value="m">{{ String(m).padStart(2, '0') }} 月</option>
            </select>
            <ChevronDown :size="13" class="select-chevron" aria-hidden="true" />
          </span>

          <span class="select-wrap">
            <select
              v-model.number="dateDay"
              class="select-control"
              aria-label="选择日期"
              @change="syncDraftDate"
            >
              <option v-for="d in dayOptions" :key="d" :value="d">{{ String(d).padStart(2, '0') }} 日</option>
            </select>
            <ChevronDown :size="13" class="select-chevron" aria-hidden="true" />
          </span>

          <button
            type="button"
            popovertarget="date-calendar-popover"
            class="button secondary small calendar-trigger-btn"
            @click="syncCalendarToSelected"
          >
            <CalendarDays :size="14" />日历选日
          </button>
        </div>

        <div id="date-calendar-popover" ref="calPopover" popover="auto" class="calendar-popover">
          <div class="calendar-head">
            <button
              type="button"
              class="icon-button cal-nav-btn"
              aria-label="上个月"
              @click="shiftCalendarMonth(-1)"
            >
              <ChevronLeft :size="15" />
            </button>
            <div class="calendar-selects">
              <select
                v-model.number="calViewYear"
                class="select-control cal-mini-select"
                aria-label="日历年份"
              >
                <option v-for="y in yearOptions" :key="y" :value="y">{{ y }}年</option>
              </select>
              <select
                v-model.number="calViewMonth"
                class="select-control cal-mini-select"
                aria-label="日历月份"
              >
                <option v-for="m in 12" :key="m" :value="m">{{ m }}月</option>
              </select>
            </div>
            <button
              type="button"
              class="icon-button cal-nav-btn"
              aria-label="下个月"
              @click="shiftCalendarMonth(1)"
            >
              <ChevronRight :size="15" />
            </button>
          </div>

          <div class="calendar-weekdays" aria-hidden="true">
            <span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span
            ><span>日</span>
          </div>

          <div class="calendar-grid">
            <template v-for="(day, idx) in calendarCells" :key="idx">
              <span v-if="day === null" class="calendar-empty" />
              <button
                v-else
                type="button"
                class="calendar-day"
                :class="{
                  selected: day === dateDay && calViewYear === dateYear && calViewMonth === dateMonth
                }"
                @click="pickCalendarDay(day)"
              >
                {{ day }}
              </button>
            </template>
          </div>
        </div>
      </div>

      <label for="record-time">
        开始时间（可留空）
        <input id="record-time" name="time" v-model="draft.time" type="time" step="60" />
      </label>

      <label>
        城市 *
        <input v-model="draft.city" required maxlength="80" placeholder="例如：上海" />
      </label>

      <label>
        场地
        <input v-model="draft.venue" maxlength="160" placeholder="音乐厅、体育馆或 Livehouse" />
      </label>

      <label>
        座位号
        <input v-model="draft.seat" maxlength="80" placeholder="例如：池座 5 排 12 号 / 站区" />
      </label>

      <label>
        票价
        <input v-model="draft.price" maxlength="40" placeholder="例如：¥680 / 赠票" />
      </label>

      <div class="field-label full">
        <span>演出分类</span>
        <div class="type-pills" role="radiogroup" aria-label="演出分类">
          <button
            v-for="item in categoryOptions"
            :key="item"
            type="button"
            role="radio"
            class="type-pill-btn category-pill-btn"
            :class="{ active: draft.type === item }"
            :style="categoryStyle(item)"
            :aria-checked="draft.type === item"
            @click="draft.type = item"
          >
            {{ item }}
          </button>
        </div>
      </div>

      <div class="field-label full">
        <span>评分</span>
        <div class="star-picker" role="group" aria-label="观演评分">
          <button
            v-for="star in 5"
            :key="star"
            type="button"
            class="star-btn"
            :class="{ active: star <= draft.rating }"
            :aria-label="`${star} 星`"
            :aria-pressed="draft.rating === star"
            @click="setRating(star)"
          >
            <Star :size="18" />
          </button>
          <span class="star-picker-text">
            {{ draft.rating ? `${draft.rating} / 5` : '未评分' }}
          </span>
          <button v-if="draft.rating > 0" type="button" class="star-clear-btn" @click="draft.rating = 0">
            清除
          </button>
        </div>
      </div>

      <label class="full">
        个人感想 / 观后记
        <textarea
          v-model="draft.note"
          rows="5"
          maxlength="20000"
          placeholder="记下现场的瞬间与感受；演员表和节目单请填写在各自区域。"
        />
      </label>

      <div class="field-label full">
        <span>标签（支持多个）</span>
        <div class="chip-editor">
          <div v-if="draft.tags.length" class="chip-list">
            <span v-for="(tag, idx) in draft.tags" :key="tag" class="editor-chip">
              # {{ tag }}
              <button
                type="button"
                class="chip-remove"
                :aria-label="`移除标签 ${tag}`"
                @click="removeTag(idx)"
              >
                <X :size="12" />
              </button>
            </span>
          </div>
          <div class="chip-input-row">
            <input
              v-model="tagInput"
              maxlength="40"
              placeholder="输入标签，按回车或逗号一次添加多个"
              @keydown.enter.prevent="addTag()"
            />
            <button type="button" class="button secondary small" @click="addTag()">
              <Plus :size="14" />添加标签
            </button>
          </div>
          <div v-if="suggestedTags.length" class="chip-suggestions">
            <button
              v-for="tag in suggestedTags"
              :key="tag"
              type="button"
              class="chip-suggest-btn"
              @click="addTag(tag)"
            >
              + {{ tag }}
            </button>
          </div>
        </div>
      </div>

      <div class="field-label full">
        <div class="field-head-inline">
          <span>节目单</span>
          <button
            type="button"
            class="banner-link muted-action"
            @click="showBatchProgram = !showBatchProgram"
          >
            {{ showBatchProgram ? '收起批量导入' : '批量文本导入' }}
          </button>
        </div>

        <div v-if="showBatchProgram" class="batch-program-box">
          <textarea
            aria-label="批量导入节目单"
            v-model="batchProgramText"
            rows="4"
            placeholder="可粘贴含曲目名称、剧目出处、作词、作曲、演唱的 Markdown 表格；也支持每行一首，以「上半场」「下半场」「加演」分组。"
          />
          <button type="button" class="button secondary small" @click="importBatchProgram">
            导入到曲目单
          </button>
        </div>

        <div class="program-builder">
          <fieldset v-for="(item, index) in programItems" :key="index" class="program-entry-editor">
            <legend>曲目 {{ index + 1 }}</legend>
            <div class="program-row">
              <label :for="`program-half-${index}`">
                分段
                <select
                  :id="`program-half-${index}`"
                  v-model="item.half"
                  class="select-control program-half-select"
                >
                  <option value="">不区分</option>
                  <option v-for="h in programHalves" :key="h" :value="h">{{ h }}</option>
                </select>
              </label>
              <label :for="`program-composer-${index}`">
                作曲
                <input
                  :id="`program-composer-${index}`"
                  v-model="item.composer"
                  maxlength="120"
                  class="program-composer-input"
                  placeholder="作曲家（可选）"
                />
              </label>
              <label :for="`program-title-${index}`" class="program-title-input">
                曲目名 *
                <input
                  :id="`program-title-${index}`"
                  v-model="item.title"
                  maxlength="200"
                  placeholder="曲目名 *"
                />
              </label>
              <div class="program-row-actions">
                <button
                  type="button"
                  class="icon-button"
                  :disabled="index === 0"
                  :aria-label="`上移曲目 ${index + 1}`"
                  @click="moveProgramItem(index, -1)"
                >
                  <ArrowUp :size="13" />
                </button>
                <button
                  type="button"
                  class="icon-button"
                  :disabled="index === programItems.length - 1"
                  :aria-label="`下移曲目 ${index + 1}`"
                  @click="moveProgramItem(index, 1)"
                >
                  <ArrowDown :size="13" />
                </button>
                <button
                  type="button"
                  class="icon-button"
                  :aria-label="`删除曲目 ${index + 1}`"
                  @click="removeProgramItem(index)"
                >
                  <X :size="13" />
                </button>
              </div>
            </div>
            <div class="program-extra-fields">
              <label :for="`program-section-${index}`">
                节目小节 / 表演形式
                <input
                  :id="`program-section-${index}`"
                  :name="`program-${index}-section`"
                  v-model="item.section"
                  maxlength="100"
                  placeholder="例如：混声合唱 / 马头琴独奏"
                />
              </label>
              <label :for="`program-source-${index}`">
                剧目出处
                <input
                  :id="`program-source-${index}`"
                  v-model="item.source"
                  maxlength="200"
                  placeholder="例如：1964年歌剧《江姐》"
                />
              </label>
              <label :for="`program-lyricist-${index}`">
                作词
                <input :id="`program-lyricist-${index}`" v-model="item.lyricist" maxlength="160" />
              </label>
              <label :for="`program-performers-${index}`">
                演唱 / 演奏者
                <input
                  :id="`program-performers-${index}`"
                  :value="item.performers.join('、')"
                  maxlength="2400"
                  placeholder="多位姓名用顿号或逗号分隔"
                  @change="item.performers = splitPerformerNames(($event.target as HTMLInputElement).value)"
                />
              </label>
            </div>
            <fieldset class="program-credit-editor">
              <legend>曲目署名</legend>
              <p class="field-hint">保留节目单中的职责，如编曲、改编、领唱、呼麦、钢琴伴奏。</p>
              <div v-for="(credit, creditIndex) in item.credits" :key="creditIndex" class="cast-editor-row">
                <label :for="`program-credit-role-${index}-${creditIndex}`">
                  职责
                  <input
                    :id="`program-credit-role-${index}-${creditIndex}`"
                    :name="`program-${index}-credit-${creditIndex}-role`"
                    v-model="credit.role"
                    maxlength="80"
                  />
                </label>
                <label :for="`program-credit-name-${index}-${creditIndex}`">
                  姓名 *
                  <input
                    :id="`program-credit-name-${index}-${creditIndex}`"
                    :name="`program-${index}-credit-${creditIndex}-name`"
                    v-model="credit.name"
                    maxlength="80"
                    required
                  />
                </label>
                <button
                  type="button"
                  class="icon-button"
                  :aria-label="`移除曲目 ${index + 1} 署名 ${credit.name || creditIndex + 1}`"
                  @click="item.credits.splice(creditIndex, 1)"
                >
                  <X :size="14" />
                </button>
              </div>
              <button
                type="button"
                class="button secondary small"
                :disabled="item.credits.length >= 50"
                @click="item.credits.push({ name: '', role: '' })"
              >
                <Plus :size="14" />添加曲目署名
              </button>
            </fieldset>
            <label :for="`program-description-${index}`" class="program-description-editor">
              节目说明
              <textarea
                :id="`program-description-${index}`"
                :name="`program-${index}-description`"
                v-model="item.description"
                rows="2"
                maxlength="2000"
                placeholder="节目背景或资助说明"
              />
            </label>
          </fieldset>

          <button type="button" class="button secondary small add-program-btn" @click="addProgramItem">
            <Plus :size="14" />添加一条曲目
          </button>
        </div>
      </div>
    </div>

    <section class="upload-section">
      <div class="upload-section-head">
        <h3>
          现场照片 <span>{{ draft.images.length }} / 20</span>
        </h3>
        <span>
          {{
            isR2Ready() ? 'R2 图床已就绪（上传将直传 Cloudflare R2）' : '首张为封面 · 支持 JPG / PNG / WebP'
          }}
        </span>
      </div>
      <div class="upload-grid">
        <div v-for="(image, index) in draft.images" :key="image" class="upload-preview">
          <img :src="imageUrl(image)" :alt="`第 ${index + 1} 张照片`" />
          <button
            type="button"
            class="image-remove icon-button"
            :aria-label="`移除第 ${index + 1} 张照片`"
            @click="draft.images.splice(index, 1)"
          >
            <X :size="14" />
          </button>
          <span v-if="index === 0" class="cover-badge">封面</span>
          <button v-else type="button" class="cover-button" @click="makeCover(index)">设为封面</button>
        </div>

        <label v-if="draft.images.length < 20" class="upload-button">
          <ImagePlus :size="24" />
          <b>{{ busy ? '处理中…' : isR2Ready() ? '直传到 R2' : '添加照片' }}</b>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            :disabled="busy"
            @change="upload"
          />
        </label>
      </div>

      <div class="chip-input-row external-url-row">
        <input
          v-model="externalImageUrl"
          type="url"
          placeholder="或直接粘贴 Cloudflare R2 / 图床 HTTPS 图片链接…"
          @keydown.enter.prevent="addExternalImage"
        />
        <button type="button" class="button secondary small" @click="addExternalImage">
          <Link2 :size="14" />添加外链
        </button>
      </div>
    </section>

    <div class="record-options">
      <label><input v-model="draft.featured" type="checkbox" />设为精选</label>
      <label><input v-model="draft.published" type="checkbox" />公开展示</label>
      <label v-if="draft.demo"><input v-model="draft.demo" type="checkbox" />示例标记</label>
    </div>

    <div class="form-actions">
      <button type="button" class="button secondary small" @click="emit('cancel')">取消</button>
      <button class="button small" type="submit" :disabled="busy"><Save :size="15" />保存草稿</button>
    </div>
  </form>
</template>
