<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  X,
  ChevronLeft,
  ChevronRight,
  MapPin,
  CalendarDays,
  Star,
  Copy,
  Check,
  ArrowLeft,
  ArrowRight
} from 'lucide-vue-next'
import { archive, visibleRecords, imageUrl } from '../lib/store'
import { dateLabel, formatPriceLabel } from '../lib/schema'
import { groupProgram } from '../lib/program'
import { categoryStyle } from '../lib/categories'
import { filterRecords, readFilters } from '../lib/filters'
import { closeTopLayer, setupDialogLightDismiss } from '../lib/motion'

const route = useRoute()
const router = useRouter()
const dialog = ref<HTMLDialogElement>()
const contentEl = ref<HTMLElement>()
const stageEl = ref<HTMLElement>()
const photo = ref(0)
const photoDir = ref<1 | -1>(1)
const recordDir = ref<1 | -1>(1)
const copied = ref(false)
const copyError = ref('')
const swipeX = ref(0)
const swiping = ref(false)
const wideMap = ref<Record<string, boolean>>({})

const record = computed(() => visibleRecords.value.find((item) => item.id === route.query.record))
const closingRecord = ref(record.value)
const activeRecord = computed(() => record.value ?? closingRecord.value)
const navList = computed(() => {
  const filtered = filterRecords(visibleRecords.value, readFilters(route.query))
  return filtered.some((item) => item.id === route.query.record) ? filtered : visibleRecords.value
})
const navIndex = computed(() => navList.value.findIndex((item) => item.id === route.query.record))
const prevRecord = computed(() => (navIndex.value > 0 ? navList.value[navIndex.value - 1] : undefined))
const nextRecord = computed(() =>
  navIndex.value >= 0 && navIndex.value < navList.value.length - 1
    ? navList.value[navIndex.value + 1]
    : undefined
)
const missing = computed(() => Boolean(route.query.record && !record.value && archive.value))
const activeImage = computed(() => activeRecord.value?.images[photo.value])
const isWidePhoto = computed(() => (activeImage.value ? Boolean(wideMap.value[activeImage.value]) : false))
const photoTransition = computed(() => (photoDir.value > 0 ? 'photo-next' : 'photo-prev'))
const recordTransition = computed(() => (recordDir.value > 0 ? 'detail-next' : 'detail-prev'))

const hasDetailFacts = computed(() => {
  const rec = activeRecord.value
  return Boolean(rec && (rec.orchestra || rec.conductor || rec.soloists.length || rec.seat || rec.price))
})

const groupedProgram = computed(() => {
  const rec = activeRecord.value
  return rec ? groupProgram(rec.program) : []
})

let copyTimer: ReturnType<typeof setTimeout> | undefined
let clearClosingTimer: ReturnType<typeof setTimeout> | undefined
let cleanupDismiss: (() => void) | undefined
let pendingPhoto: 'first' | 'last' = 'first'
let wheelAccum = 0
let wheelLock = 0
let wheelReset: ReturnType<typeof setTimeout> | undefined
const swipe = { id: -1, x: 0, y: 0, t: 0, active: false, captured: false }

function clearRecordQuery() {
  if (route.query.record) {
    const query = { ...route.query }
    delete query.record
    router.replace({ query })
  }
}

async function requestClose() {
  await closeTopLayer(dialog.value)
  clearRecordQuery()
}

function handleNativeClose() {
  if (dialog.value) dialog.value.returnValue = ''
  clearRecordQuery()
}

function recordImageAspect(path: string, img: HTMLImageElement) {
  if (!img.naturalHeight) return
  wideMap.value[path] = img.naturalWidth / img.naturalHeight > 1.28
}

function preloadImages(paths: string[]) {
  for (const path of paths) {
    const img = new Image()
    img.onload = () => recordImageAspect(path, img)
    img.src = imageUrl(path)
  }
}

watch(
  dialog,
  (el) => {
    cleanupDismiss?.()
    cleanupDismiss = el ? setupDialogLightDismiss(el, clearRecordQuery) : undefined
  },
  { immediate: true }
)

function resetScroll() {
  contentEl.value?.scrollTo({ top: 0 })
  dialog.value?.scrollTo({ top: 0 })
}

watch(
  record,
  async (value, oldValue) => {
    clearTimeout(clearClosingTimer)
    if (value) {
      closingRecord.value = value
      const count = value.images.length
      photo.value = pendingPhoto === 'last' && count > 0 ? count - 1 : 0
      pendingPhoto = 'first'
      swipeX.value = 0
      copied.value = false
      copyError.value = ''
      if (count) preloadImages(value.images)
      await nextTick()
      if (oldValue && value.id !== oldValue.id) {
        resetScroll()
      }
      if (dialog.value && !dialog.value.open) {
        dialog.value.removeAttribute('data-closing')
        dialog.value.showModal()
      }
      return
    }

    if (oldValue) closingRecord.value = oldValue
    if (dialog.value?.open) {
      await closeTopLayer(dialog.value)
    }
    const animations = dialog.value?.getAnimations?.() ?? []
    if (animations.length) {
      await Promise.race([
        Promise.allSettled(animations.map((a) => a.finished)),
        new Promise<void>((resolve) => setTimeout(resolve, 480))
      ])
    } else {
      await new Promise<void>((resolve) => {
        clearClosingTimer = setTimeout(resolve, 420)
      })
    }
    if (!record.value && !dialog.value?.open) {
      closingRecord.value = undefined
    }
  },
  { immediate: true }
)

onUnmounted(() => {
  cleanupDismiss?.()
  clearTimeout(copyTimer)
  clearTimeout(clearClosingTimer)
  clearTimeout(wheelReset)
})

function changePhoto(amount: 1 | -1) {
  if (record.value && record.value.images.length > 0) {
    photoDir.value = amount
    photo.value = (photo.value + amount + record.value.images.length) % record.value.images.length
  }
}

function selectPhoto(index: number) {
  if (index === photo.value) return
  photoDir.value = index > photo.value ? 1 : -1
  photo.value = index
}

function switchRecord(id: string, dir: 1 | -1) {
  recordDir.value = dir
  router.replace({ query: { ...route.query, record: id } })
}

function canBrowse(delta: 1 | -1): boolean {
  const count = record.value?.images.length ?? 0
  const next = photo.value + delta
  if (count > 1 && next >= 0 && next < count) return true
  return Boolean(delta > 0 ? nextRecord.value : prevRecord.value)
}

function browse(delta: 1 | -1) {
  const count = record.value?.images.length ?? 0
  const next = photo.value + delta
  if (count > 1 && next >= 0 && next < count) {
    photoDir.value = delta
    photo.value = next
    return
  }
  const adjacent = delta > 0 ? nextRecord.value : prevRecord.value
  if (!adjacent) return
  photoDir.value = delta
  pendingPhoto = delta < 0 ? 'last' : 'first'
  switchRecord(adjacent.id, delta)
}

function onDialogKeydown(event: KeyboardEvent) {
  if (event.altKey || event.ctrlKey || event.metaKey) return
  const node = event.target as HTMLElement | null
  if (node && (node.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName))) return
  if (event.key === 'ArrowRight') browse(1)
  else if (event.key === 'ArrowLeft') browse(-1)
  else return
  event.preventDefault()
}

function onStageDown(event: PointerEvent) {
  if (event.button !== 0 || (event.target as Element | null)?.closest('button')) return
  Object.assign(swipe, {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    t: event.timeStamp,
    active: true,
    captured: false
  })
}

function onStageMove(event: PointerEvent) {
  if (!swipe.active || event.pointerId !== swipe.id) return
  const dx = event.clientX - swipe.x
  const dy = event.clientY - swipe.y
  if (!swipe.captured) {
    if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
      swipe.captured = true
      swiping.value = true
      stageEl.value?.setPointerCapture?.(event.pointerId)
    } else {
      if (Math.abs(dy) > 10) swipe.active = false
      return
    }
  }
  swipeX.value = canBrowse(dx < 0 ? 1 : -1) ? dx : dx * 0.22
}

function onStageUp(event: PointerEvent) {
  if (!swipe.active || event.pointerId !== swipe.id) return
  swipe.active = false
  if (!swipe.captured) return
  swipe.captured = false
  swiping.value = false
  try {
    stageEl.value?.releasePointerCapture?.(event.pointerId)
  } catch {}
  const dx = event.clientX - swipe.x
  const elapsed = Math.max(1, event.timeStamp - swipe.t)
  const speed = (dx / elapsed) * 1000
  swipeX.value = 0
  if (event.type === 'pointercancel') return
  if (Math.abs(dx) > 64 || (Math.abs(dx) > 18 && Math.abs(speed) > 480)) browse(dx < 0 ? 1 : -1)
}

function onStageWheel(event: WheelEvent) {
  if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return
  event.preventDefault()
  const now = performance.now()
  clearTimeout(wheelReset)
  wheelReset = setTimeout(() => {
    wheelAccum = 0
  }, 180)
  if (now < wheelLock) {
    wheelLock = now + 220
    return
  }
  wheelAccum += event.deltaX
  if (Math.abs(wheelAccum) > 60) {
    browse(wheelAccum > 0 ? 1 : -1)
    wheelAccum = 0
    wheelLock = now + 420
  }
}

async function filterByTag(tag: string) {
  await closeTopLayer(dialog.value)
  router.replace({ query: { q: tag } })
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(location.href)
    copied.value = true
    clearTimeout(copyTimer)
    copyTimer = setTimeout(() => {
      copied.value = false
    }, 2400)
  } catch {
    copyError.value = '无法复制，请从地址栏复制链接。'
  }
}
</script>

<template>
  <p v-if="missing" class="status-banner" role="status">
    这条记录不存在或尚未公开。<button @click="clearRecordQuery">返回</button>
  </p>

  <dialog
    ref="dialog"
    closedby="any"
    class="record-dialog"
    aria-labelledby="record-title"
    @close="handleNativeClose"
    @keydown="onDialogKeydown"
  >
    <div v-if="activeRecord" class="dialog-floating-actions">
      <button
        type="button"
        class="icon-button dialog-action-btn"
        :class="{ copied }"
        :aria-label="copied ? '已复制分享链接' : '复制分享链接'"
        :title="copied ? '已复制链接' : '复制链接'"
        @click="copyLink"
      >
        <Check v-if="copied" :size="15" />
        <Copy v-else :size="15" />
      </button>
      <button
        type="button"
        class="icon-button dialog-action-btn"
        aria-label="关闭"
        autofocus
        @click="requestClose"
      >
        <X :size="18" />
      </button>
    </div>

    <div
      v-if="activeRecord"
      class="detail-shell"
      :class="{ 'detail-shell--single': !activeRecord.images.length }"
      :style="categoryStyle(activeRecord.type)"
    >
      <div v-if="activeImage" class="detail-ambient" aria-hidden="true">
        <Transition name="photo-bg">
          <img :key="activeImage" :src="imageUrl(activeImage)" alt="" decoding="async" />
        </Transition>
      </div>

      <div
        v-if="activeRecord.images.length"
        ref="stageEl"
        class="detail-stage"
        :class="{ 'is-swiping': swiping, 'is-wide': isWidePhoto }"
        :style="{ '--swipe-x': `${swipeX}px` }"
        tabindex="0"
        aria-label="现场海报与照片浏览"
        @pointerdown="onStageDown"
        @pointermove="onStageMove"
        @pointerup="onStageUp"
        @pointercancel="onStageUp"
        @wheel="onStageWheel"
      >
        <Transition name="photo-bg">
          <img
            :key="activeImage"
            class="detail-stage-bg"
            :src="imageUrl(activeImage!)"
            alt=""
            aria-hidden="true"
            decoding="async"
          />
        </Transition>

        <div class="detail-stage-track">
          <Transition :name="photoTransition">
            <img
              :key="`${activeRecord.id}-${activeImage}`"
              class="detail-stage-img"
              :src="imageUrl(activeImage!)"
              :alt="`${activeRecord.title} · ${photo + 1}`"
              decoding="sync"
              draggable="false"
              @load="activeImage && recordImageAspect(activeImage, $event.target as HTMLImageElement)"
            />
          </Transition>
        </div>

        <template v-if="activeRecord.images.length > 1">
          <button type="button" class="photo-prev icon-button" aria-label="上一张" @click="changePhoto(-1)">
            <ChevronLeft :size="18" />
          </button>
          <button type="button" class="photo-next icon-button" aria-label="下一张" @click="changePhoto(1)">
            <ChevronRight :size="18" />
          </button>
          <div class="photo-dots" role="group" aria-label="切换图片">
            <button
              v-for="(img, idx) in activeRecord.images"
              :key="img"
              type="button"
              class="photo-dot"
              :class="{ active: idx === photo }"
              :aria-label="`第 ${idx + 1} 张`"
              @click="selectPhoto(idx)"
            />
          </div>
        </template>
      </div>

      <div ref="contentEl" class="detail-content">
        <Transition :name="recordTransition" mode="out-in" @enter="resetScroll">
          <div :key="activeRecord.id" class="detail-body">
            <div class="detail-kicker">
              <span class="detail-type-label">
                <i class="detail-type-dot" aria-hidden="true" />{{ activeRecord.type }}
              </span>
              <span v-if="activeRecord.status === 'upcoming'" class="detail-upcoming-pill">待观看</span>
            </div>

            <header class="detail-header">
              <h1 id="record-title">{{ activeRecord.title }}</h1>
              <p v-if="activeRecord.subtitle || activeRecord.artist" class="detail-subtitle">
                {{ activeRecord.subtitle || activeRecord.artist }}
              </p>
              <div class="detail-meta">
                <span
                  ><CalendarDays :size="13" />{{
                    dateLabel(activeRecord.date) + (activeRecord.time ? ` ${activeRecord.time}` : '')
                  }}</span
                >
                <span>
                  <MapPin :size="13" />{{ activeRecord.city
                  }}<template v-if="activeRecord.venue"> · {{ activeRecord.venue }}</template>
                </span>
                <span
                  v-if="activeRecord.rating > 0"
                  class="rating"
                  :aria-label="`评分 ${activeRecord.rating} / 5`"
                >
                  <Star
                    v-for="star in 5"
                    :key="star"
                    :size="12"
                    :class="{ filled: star <= activeRecord.rating }"
                  />
                </span>
              </div>
            </header>

            <dl v-if="hasDetailFacts" class="detail-facts">
              <template v-if="activeRecord.orchestra">
                <dt>演出团体</dt>
                <dd>{{ activeRecord.orchestra }}</dd>
              </template>
              <template v-if="activeRecord.conductor">
                <dt>指挥</dt>
                <dd>{{ activeRecord.conductor }}</dd>
              </template>
              <template v-if="activeRecord.soloists.length">
                <dt>独奏</dt>
                <dd>{{ activeRecord.soloists.join(' / ') }}</dd>
              </template>
              <template v-if="activeRecord.seat">
                <dt>座位</dt>
                <dd>{{ activeRecord.seat }}</dd>
              </template>
              <template v-if="activeRecord.price">
                <dt>票价</dt>
                <dd>{{ formatPriceLabel(activeRecord.price) }}</dd>
              </template>
            </dl>

            <section v-if="activeRecord.cast.length" class="cast-block">
              <h2>演出人员</h2>
              <ul class="cast-list" role="list">
                <li v-for="(person, index) in activeRecord.cast" :key="index">
                  <span>{{ person.name }}</span>
                  <small v-if="person.role">{{ person.role }}</small>
                </li>
              </ul>
            </section>

            <section v-if="groupedProgram.length" class="setlist-block">
              <h2>节目单</h2>
              <div class="setlist-groups">
                <div v-for="(group, groupIndex) in groupedProgram" :key="groupIndex" class="setlist-group">
                  <h3
                    v-if="
                      group.half && (groupIndex === 0 || groupedProgram[groupIndex - 1]?.half !== group.half)
                    "
                    class="setlist-half-heading"
                  >
                    {{ group.half }}
                  </h3>
                  <component
                    :is="group.half ? 'h4' : 'h3'"
                    v-if="group.section"
                    class="setlist-section-heading"
                    >{{ group.section }}</component
                  >
                  <ol class="program" role="list" :start="group.start">
                    <li v-for="item in group.items" :key="item.index">
                      <span class="program-num" aria-hidden="true">{{
                        String(item.index).padStart(2, '0')
                      }}</span>
                      <div class="program-main">
                        <strong class="program-title">{{ item.title }}</strong>
                        <dl
                          v-if="
                            item.source ||
                            item.composer ||
                            item.lyricist ||
                            item.performers.length ||
                            item.credits.length
                          "
                          class="program-credits"
                        >
                          <template v-if="item.source"
                            ><dt>出处</dt>
                            <dd>{{ item.source }}</dd></template
                          >
                          <template v-if="item.lyricist"
                            ><dt>作词</dt>
                            <dd>{{ item.lyricist }}</dd></template
                          >
                          <template v-if="item.composer"
                            ><dt>作曲</dt>
                            <dd>{{ item.composer }}</dd></template
                          >
                          <template v-if="item.performers.length"
                            ><dt>演唱 / 演奏</dt>
                            <dd>{{ item.performers.join('、') }}</dd></template
                          >
                          <template v-for="(credit, creditIndex) in item.credits" :key="creditIndex">
                            <dt>{{ credit.role || '署名' }}</dt>
                            <dd>{{ credit.name }}</dd>
                          </template>
                        </dl>
                        <p v-if="item.description" class="program-description">{{ item.description }}</p>
                      </div>
                    </li>
                  </ol>
                </div>
              </div>
            </section>

            <section v-if="activeRecord.note" class="personal-note-block">
              <h2>个人感想</h2>
              <p class="detail-note">{{ activeRecord.note }}</p>
            </section>

            <div v-if="activeRecord.tags.length" class="tags">
              <button
                v-for="tag in activeRecord.tags"
                :key="tag"
                type="button"
                class="tag-chip"
                @click="filterByTag(tag)"
              >
                # {{ tag }}
              </button>
            </div>

            <p v-if="copyError" class="demo-note" role="status">{{ copyError }}</p>
          </div>
        </Transition>

        <div v-if="prevRecord || nextRecord" class="detail-footer">
          <button
            v-if="prevRecord"
            type="button"
            class="detail-footer-nav"
            @click="switchRecord(prevRecord.id, -1)"
          >
            <ArrowLeft :size="14" />
            <span>{{ prevRecord.title }}</span>
          </button>
          <span v-else />
          <button
            v-if="nextRecord"
            type="button"
            class="detail-footer-nav detail-footer-nav--next"
            @click="switchRecord(nextRecord.id, 1)"
          >
            <span>{{ nextRecord.title }}</span>
            <ArrowRight :size="14" />
          </button>
        </div>
      </div>
    </div>
  </dialog>
</template>
