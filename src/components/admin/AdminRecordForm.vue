<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  Link2,
  Plus,
  Save,
  Star,
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

const snapshot = () =>
  JSON.stringify({ ...draft.value, program: programItems.value })

watch(
  () => props.record,
  (value) => {
    const cloned = JSON.parse(JSON.stringify(value)) as ConcertRecord
    cloned.soloists = cloned.soloists ?? []
    cloned.orchestra = cloned.orchestra ?? ''
    cloned.conductor = cloned.conductor ?? ''
    cloned.seat = cloned.seat ?? ''
    cloned.price = cloned.price ?? ''
    cloned.status = cloned.status ?? 'watched'
    draft.value = cloned
    programItems.value = (cloned.program ?? []).map(normalizeProgramItem)
    parseDateParts(cloned.date)
    initialSnapshot.value = snapshot()
  },
  { immediate: true }
)

const isDirty = computed(() => snapshot() !== initialSnapshot.value)

defineExpose({ isDirty })

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
  programItems.value.push({ title: '', composer: '', half: prevHalf })
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
  const lines = batchProgramText.value
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  let currentHalf: ProgramItem['half'] = ''
  for (const line of lines) {
    if (/^(上半场|下半场|加演)[:：]?$/.test(line)) {
      currentHalf = line.replace(/[:：]$/, '') as ProgramItem['half']
      continue
    }
    const splitMatch = /^([^·—-]+?)\s*[·—-]\s*(.+)$/.exec(line)
    if (splitMatch && splitMatch[1]!.length <= 24) {
      programItems.value.push({
        composer: splitMatch[1]!.trim(),
        title: splitMatch[2]!.trim(),
        half: currentHalf
      })
    } else {
      programItems.value.push({ title: line, composer: '', half: currentHalf })
    }
  }
  batchProgramText.value = ''
  showBatchProgram.value = false
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
        title: item.title.trim(),
        composer: item.composer.trim(),
        half: item.half
      }))
      .filter((item) => Boolean(item.title))

    const parsed = recordSchema.parse({
      ...draft.value,
      tags: [...new Set(draft.value.tags)],
      program: cleanProgram
    })
    emit('save', parsed)
  } catch (caught) {
    emit(
      'error',
      caught instanceof Error
        ? caught.message.startsWith('[')
          ? '请填写演出标题、有效日期和城市。'
          : caught.message
        : '保存失败'
    )
  }
}
</script>

<template>
  <form class="record-form" @submit.prevent="submit">
    <div class="panel-heading">
      <div>
        <h2>{{ isNew ? '新增记录' : '编辑记录' }}</h2>
      </div>
      <button type="button" class="icon-button" aria-label="关闭编辑" @click="emit('cancel')">
        <X :size="20" />
      </button>
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
        <input
          v-model="draft.title"
          required
          maxlength="160"
          placeholder="例如：柴可夫斯基第五交响曲"
        />
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
        <span>独奏家 / 特邀嘉宾（支持多位）</span>
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
        补充演出信息 / 巡演副标
        <input v-model="draft.artist" maxlength="160" placeholder="例如：亚洲巡演特别场（未填乐团/指挥时作为主署名显示）" />
      </label>

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
              <select v-model.number="calViewYear" class="select-control cal-mini-select" aria-label="日历年份">
                <option v-for="y in yearOptions" :key="y" :value="y">{{ y }}年</option>
              </select>
              <select v-model.number="calViewMonth" class="select-control cal-mini-select" aria-label="日历月份">
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
            <span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span>
          </div>

          <div class="calendar-grid">
            <template v-for="(day, idx) in calendarCells" :key="idx">
              <span v-if="day === null" class="calendar-empty" />
              <button
                v-else
                type="button"
                class="calendar-day"
                :class="{
                  selected:
                    day === dateDay && calViewYear === dateYear && calViewMonth === dateMonth
                }"
                @click="pickCalendarDay(day)"
              >
                {{ day }}
              </button>
            </template>
          </div>
        </div>
      </div>

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
          <button
            v-if="draft.rating > 0"
            type="button"
            class="star-clear-btn"
            @click="draft.rating = 0"
          >
            清除
          </button>
        </div>
      </div>

      <label class="full">
        观后记
        <textarea
          v-model="draft.note"
          rows="5"
          maxlength="20000"
          placeholder="记下现场的瞬间与感受…"
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
          <span>曲目单（可区分上下半场，逐条录入曲目名与作曲家）</span>
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
            v-model="batchProgramText"
            rows="4"
            placeholder="每行一首，可用「上半场」「下半场」「加演」单独成行分组，或写「作曲家 · 曲目名」"
          />
          <button type="button" class="button secondary small" @click="importBatchProgram">
            导入到曲目单
          </button>
        </div>

        <div class="program-builder">
          <div v-for="(item, index) in programItems" :key="index" class="program-row">
            <select v-model="item.half" class="select-control program-half-select" aria-label="场次分段">
              <option value="">不区分</option>
              <option v-for="h in programHalves" :key="h" :value="h">{{ h }}</option>
            </select>
            <input
              v-model="item.composer"
              maxlength="120"
              class="program-composer-input"
              placeholder="作曲家（可选）"
              aria-label="作曲家"
            />
            <input
              v-model="item.title"
              maxlength="200"
              class="program-title-input"
              placeholder="曲目名 *"
              aria-label="曲目名"
            />
            <div class="program-row-actions">
              <button
                type="button"
                class="icon-button"
                :disabled="index === 0"
                aria-label="上移"
                @click="moveProgramItem(index, -1)"
              >
                <ArrowUp :size="13" />
              </button>
              <button
                type="button"
                class="icon-button"
                :disabled="index === programItems.length - 1"
                aria-label="下移"
                @click="moveProgramItem(index, 1)"
              >
                <ArrowDown :size="13" />
              </button>
              <button
                type="button"
                class="icon-button"
                aria-label="删除曲目"
                @click="removeProgramItem(index)"
              >
                <X :size="13" />
              </button>
            </div>
          </div>

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
          {{ isR2Ready() ? 'R2 图床已就绪（上传将直传 Cloudflare R2）' : '首张为封面 · 支持 JPG / PNG / WebP' }}
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
          <button v-else type="button" class="cover-button" @click="makeCover(index)">
            设为封面
          </button>
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
      <button class="button small" type="submit" :disabled="busy">
        <Save :size="15" />保存草稿
      </button>
    </div>
  </form>
</template>
