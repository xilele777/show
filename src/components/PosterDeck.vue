<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowUpRight, ChevronLeft, ChevronRight, MapPin, Star } from 'lucide-vue-next'
import type { ConcertRecord } from '../lib/schema'
import { imageUrl } from '../lib/store'
import {
  cardPose,
  circularOffset,
  clamp,
  easeOutExpo,
  projectTarget,
  rubberBand,
  springStep,
  wrapIndex
} from '../lib/deck'

const props = defineProps<{
  records: ConcertRecord[]
}>()

const route = useRoute()
const router = useRouter()

const stageEl = ref<HTMLElement>()
const deckEl = ref<HTMLElement>()
const railEl = ref<HTMLElement>()
const activeIndex = ref(0)
const glowIndex = ref(0)
const statusText = ref('')
const isDragging = ref(false)
const indicator = ref({ x: 0, ready: false })

const total = computed(() => props.records.length)
const canLoop = computed(() => props.records.length >= 3)
const activeRecord = computed(() => props.records[activeIndex.value] ?? props.records[0])
const glowRecord = computed(() => props.records[glowIndex.value] ?? activeRecord.value)

const cardEls: (HTMLElement | null)[] = []
const thumbEls: (HTMLElement | null)[] = []
const hoverLift: number[] = []

let position = 0
let velocity = 0
let target = 0
let motion: 'idle' | 'spring' | 'direct' = 'idle'
let unit = 215
let intro = 1
let introFrom = 1
let introStart = 0
let introDuration = 1
let frame = 0
let lastTime = 0
let tiltX = 0
let tiltY = 0
let tiltTargetX = 0
let tiltTargetY = 0
let hoverIndex = -1
let reduceMotion = false
let mounted = false

let pointerId = -1
let pointerActive = false
let pointerCaptured = false
let suppressClick = false
let dragOriginX = 0
let dragOriginY = 0
let dragStartPos = 0
const samples: { t: number; p: number }[] = []

let wheelTimer: ReturnType<typeof setTimeout> | undefined
let lastNotch = 0
let statusTimer: ReturnType<typeof setTimeout> | undefined
let glowTimer: ReturnType<typeof setTimeout> | undefined
let thumbTimer: ReturnType<typeof setTimeout> | undefined
let clickTimer: ReturnType<typeof setTimeout> | undefined
let motionQuery: MediaQueryList | undefined

function setCardEl(el: unknown, index: number) {
  cardEls[index] = el instanceof HTMLElement ? el : null
}

function setThumbEl(el: unknown, index: number) {
  thumbEls[index] = el instanceof HTMLElement ? el : null
}

function normalize(index: number): number {
  if (canLoop.value) return wrapIndex(index, total.value)
  return clamp(Math.round(index), 0, Math.max(0, total.value - 1))
}

function announce(index: number) {
  clearTimeout(statusTimer)
  statusTimer = setTimeout(() => {
    const rec = props.records[index]
    if (rec) statusText.value = `${index + 1} / ${props.records.length}：${rec.title}`
  }, 220)
}

function setActive(index: number) {
  const next = normalize(index)
  if (next === activeIndex.value) return
  activeIndex.value = next
  announce(next)
}

function boundTarget(value: number): number {
  return canLoop.value ? value : clamp(value, 0, total.value - 1)
}

function springTo(next: number) {
  clearTimeout(wheelTimer)
  target = boundTarget(next)
  motion = 'spring'
  setActive(target)
  kick()
}

function goTo(index: number) {
  if (!total.value) return
  const base = Math.round(target)
  const next = canLoop.value
    ? base + Math.round(circularOffset(index, base, total.value, true))
    : index
  springTo(next)
}

function step(delta: number) {
  if (total.value <= 1) return
  const base = Math.round(target)
  const next = boundTarget(base + delta)
  if (next === base) {
    velocity -= delta * 2.4
    motion = 'spring'
    kick()
    return
  }
  springTo(next)
}

function startIntro(from: number) {
  if (reduceMotion || from >= 1) {
    intro = 1
    return
  }
  intro = from
  introFrom = from
  introStart = performance.now()
  introDuration = from <= 0 ? 1100 : 620
}

function measure() {
  const card = cardEls.find(Boolean)
  if (card?.offsetWidth) unit = clamp(card.offsetWidth * 0.8, 140, 215)
}

function render() {
  const n = total.value
  const loop = canLoop.value
  const active = activeIndex.value
  for (let i = 0; i < n; i++) {
    const el = cardEls[i]
    if (!el) continue
    const pose = cardPose(circularOffset(i, position, n, loop), unit, intro)
    const lift = hoverLift[i] ?? 0
    const tx = i === active ? tiltX : 0
    const ty = i === active ? tiltY : 0
    el.style.transform =
      `translate3d(${pose.x.toFixed(2)}px, ${(-lift * 10).toFixed(2)}px, ${pose.z.toFixed(2)}px) ` +
      `rotateX(${tx.toFixed(2)}deg) rotateY(${(pose.rotateY + ty).toFixed(2)}deg) scale(${pose.scale.toFixed(4)})`
    el.style.opacity = pose.opacity.toFixed(3)
    el.style.zIndex = String(pose.zIndex)
    el.style.visibility = pose.opacity < 0.01 ? 'hidden' : 'visible'
    el.style.pointerEvents = pose.visible ? 'auto' : 'none'
    el.style.setProperty('--shade', (pose.shade * (1 - lift * 0.65)).toFixed(3))
  }
}

function tick(now: number) {
  const dt = Math.min(0.034, Math.max(0, (now - lastTime) / 1000))
  lastTime = now
  let busy = false

  if (motion === 'spring') {
    if (reduceMotion) {
      position = target
      velocity = 0
      motion = 'idle'
    } else {
      let remaining = dt
      while (remaining > 0) {
        const h = Math.min(remaining, 1 / 120)
        ;[position, velocity] = springStep(position, velocity, target, h)
        remaining -= h
      }
      if (Math.abs(position - target) < 0.0006 && Math.abs(velocity) < 0.01) {
        position = target
        velocity = 0
        motion = 'idle'
      } else {
        busy = true
      }
    }
  }

  if (intro < 1) {
    const t = clamp((now - introStart) / introDuration, 0, 1)
    intro = introFrom + (1 - introFrom) * easeOutExpo(t)
    if (t < 1) busy = true
    else intro = 1
  }

  const k = reduceMotion ? 1 : 1 - Math.exp(-dt * 13)
  tiltX += (tiltTargetX - tiltX) * k
  tiltY += (tiltTargetY - tiltY) * k
  if (Math.abs(tiltTargetX - tiltX) > 0.01 || Math.abs(tiltTargetY - tiltY) > 0.01) busy = true
  else {
    tiltX = tiltTargetX
    tiltY = tiltTargetY
  }

  for (let i = 0; i < total.value; i++) {
    const goal = i === hoverIndex && i !== activeIndex.value && !isDragging.value ? 1 : 0
    const current = hoverLift[i] ?? 0
    const next = current + (goal - current) * k
    if (Math.abs(goal - next) > 0.002) {
      hoverLift[i] = next
      busy = true
    } else {
      hoverLift[i] = goal
    }
  }

  render()
  frame = busy ? requestAnimationFrame(tick) : 0
}

function kick() {
  if (!mounted || frame) return
  lastTime = performance.now()
  frame = requestAnimationFrame(tick)
}

function openRecord(record: ConcertRecord) {
  router.replace({ path: '/', query: { ...route.query, record: record.id } })
}

function handleCardClick(record: ConcertRecord, index: number) {
  if (suppressClick) return
  if (index === activeIndex.value && Math.abs(position - target) < 0.2) openRecord(record)
  else goTo(index)
}

function dragPosition(value: number): number {
  if (canLoop.value) return value
  const max = total.value - 1
  if (value < 0) return -rubberBand(-value)
  if (value > max) return max + rubberBand(value - max)
  return value
}

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0 || total.value <= 1) return
  clearTimeout(clickTimer)
  suppressClick = false
  pointerActive = true
  pointerCaptured = false
  pointerId = event.pointerId
  dragOriginX = event.clientX
  dragOriginY = event.clientY
}

function trackHover(event: PointerEvent) {
  if (event.pointerType !== 'mouse') return
  const card = (event.target as Element | null)?.closest<HTMLElement>('.poster-card')
  const index = card ? Number(card.dataset.index) : -1
  hoverIndex = index
  if (card && index === activeIndex.value && !reduceMotion) {
    const rect = card.getBoundingClientRect()
    const px = clamp((event.clientX - rect.left) / rect.width, 0, 1)
    const py = clamp((event.clientY - rect.top) / rect.height, 0, 1)
    tiltTargetX = (0.5 - py) * 7
    tiltTargetY = (px - 0.5) * 9
    card.style.setProperty('--mx', `${(px * 100).toFixed(1)}%`)
    card.style.setProperty('--my', `${(py * 100).toFixed(1)}%`)
  } else {
    tiltTargetX = 0
    tiltTargetY = 0
  }
  kick()
}

function onPointerMove(event: PointerEvent) {
  if (!pointerActive || event.pointerId !== pointerId) {
    trackHover(event)
    return
  }
  const dx = event.clientX - dragOriginX
  const dy = event.clientY - dragOriginY

  if (!pointerCaptured) {
    if (Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(dy)) {
      pointerCaptured = true
      isDragging.value = true
      suppressClick = true
      clearTimeout(wheelTimer)
      deckEl.value?.setPointerCapture?.(event.pointerId)
      dragOriginX = event.clientX
      dragStartPos = position
      velocity = 0
      motion = 'direct'
      samples.length = 0
      tiltTargetX = 0
      tiltTargetY = 0
      hoverIndex = -1
    } else if (Math.abs(dy) > 10) {
      pointerActive = false
      return
    } else {
      return
    }
  }

  position = dragPosition(dragStartPos - (event.clientX - dragOriginX) / unit)
  target = boundTarget(Math.round(position))
  setActive(target)
  samples.push({ t: event.timeStamp, p: position })
  while (samples.length > 2 && event.timeStamp - samples[0]!.t > 110) samples.shift()
  kick()
}

function onPointerUp(event: PointerEvent) {
  if (!pointerActive || event.pointerId !== pointerId) return
  pointerActive = false
  if (!pointerCaptured) return
  pointerCaptured = false
  isDragging.value = false
  try {
    deckEl.value?.releasePointerCapture?.(event.pointerId)
  } catch {}

  let v = 0
  const first = samples[0]
  const last = samples[samples.length - 1]
  if (event.type !== 'pointercancel' && first && last && last.t - first.t > 8 && event.timeStamp - last.t < 90) {
    v = (last.p - first.p) / ((last.t - first.t) / 1000)
  }
  velocity = clamp(v, -36, 36)
  springTo(projectTarget(dragStartPos, position, velocity))
  clearTimeout(clickTimer)
  clickTimer = setTimeout(() => {
    suppressClick = false
  }, 80)
}

function onDeckLeave() {
  hoverIndex = -1
  tiltTargetX = 0
  tiltTargetY = 0
  kick()
}

function onWheel(event: WheelEvent) {
  if (total.value <= 1 || event.ctrlKey) return
  const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY)
  if (
    horizontal &&
    (event.target as Element | null)?.closest('.poster-rail') &&
    railEl.value &&
    railEl.value.scrollWidth > railEl.value.clientWidth + 1
  ) {
    return
  }
  let delta = horizontal ? event.deltaX : event.deltaY
  if (event.deltaMode === 1) delta *= 40
  else if (event.deltaMode === 2) delta *= 800
  if (!delta) return

  if (!canLoop.value && !horizontal && motion !== 'direct') {
    const base = Math.round(target)
    if ((delta < 0 && base <= 0) || (delta > 0 && base >= total.value - 1)) return
  }
  event.preventDefault()

  const notch = event.deltaMode !== 0 || (!horizontal && event.deltaX === 0 && Math.abs(delta) >= 48)
  if (notch) {
    const now = performance.now()
    if (now - lastNotch < 70) return
    lastNotch = now
    step(delta > 0 ? 1 : -1)
    return
  }

  if (motion !== 'direct') {
    motion = 'direct'
    velocity = 0
  }
  position = dragPosition(position + clamp(delta, -90, 90) / (unit * 1.15))
  target = boundTarget(Math.round(position))
  setActive(target)
  kick()
  clearTimeout(wheelTimer)
  wheelTimer = setTimeout(() => springTo(Math.round(position)), 120)
}

function isTypingTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null
  return Boolean(node && (node.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName)))
}

function onWindowKeydown(event: KeyboardEvent) {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
  if (isTypingTarget(event.target) || document.querySelector('dialog[open]')) return
  const inStage = Boolean(stageEl.value?.contains(document.activeElement))
  switch (event.key) {
    case 'ArrowRight':
      step(1)
      break
    case 'ArrowLeft':
      step(-1)
      break
    case 'Home':
      if (!inStage) return
      goTo(0)
      break
    case 'End':
      if (!inStage) return
      goTo(total.value - 1)
      break
    case 'Enter':
      if (document.activeElement !== stageEl.value || !activeRecord.value) return
      openRecord(activeRecord.value)
      break
    default:
      return
  }
  event.preventDefault()
}

function onThumbEnter(event: PointerEvent, index: number) {
  if (event.pointerType !== 'mouse') return
  clearTimeout(thumbTimer)
  thumbTimer = setTimeout(() => goTo(index), 90)
}

function onThumbLeave() {
  clearTimeout(thumbTimer)
}

function syncRail() {
  const rail = railEl.value
  const thumb = thumbEls[activeIndex.value]
  if (!rail || !thumb) return
  const center = thumb.offsetLeft + thumb.offsetWidth / 2
  indicator.value = { x: center, ready: true }
  if (rail.scrollWidth > rail.clientWidth + 1) {
    rail.scrollTo({
      left: center - rail.clientWidth / 2,
      behavior: reduceMotion ? 'auto' : 'smooth'
    })
  }
}

function onResize() {
  measure()
  render()
  syncRail()
}

function onMotionChange() {
  reduceMotion = Boolean(motionQuery?.matches)
}

watch(
  () => props.records,
  (list, oldList) => {
    if (!list.length) {
      activeIndex.value = 0
      return
    }
    let index = -1
    if (!oldList || !oldList.length) {
      const fromRoute = list.findIndex((r) => r.id === route.query.record)
      const featured = list.findIndex((r) => r.featured)
      index = fromRoute >= 0 ? fromRoute : featured >= 0 ? featured : 0
    } else {
      const prevId = oldList[activeIndex.value]?.id
      index = prevId ? list.findIndex((r) => r.id === prevId) : -1
      if (index < 0) index = Math.min(activeIndex.value, list.length - 1)
    }
    clearTimeout(wheelTimer)
    position = index
    target = index
    velocity = 0
    motion = 'idle'
    activeIndex.value = index
    glowIndex.value = index
    hoverLift.length = 0
    cardEls.length = list.length
    thumbEls.length = list.length
    startIntro(oldList && oldList.length ? 0.55 : 0)
    if (mounted) {
      void nextTick(() => {
        measure()
        render()
        syncRail()
        kick()
      })
    }
  },
  { immediate: true }
)

watch(activeIndex, (index) => {
  clearTimeout(glowTimer)
  glowTimer = setTimeout(() => {
    glowIndex.value = index
  }, 160)
  void nextTick(syncRail)
})

watch(
  () => route.query.record,
  (id) => {
    if (typeof id !== 'string') return
    const index = props.records.findIndex((r) => r.id === id)
    if (index >= 0 && index !== activeIndex.value) goTo(index)
  }
)

onMounted(() => {
  mounted = true
  motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  onMotionChange()
  motionQuery.addEventListener('change', onMotionChange)
  if (reduceMotion) intro = 1
  stageEl.value?.addEventListener('wheel', onWheel, { passive: false })
  window.addEventListener('keydown', onWindowKeydown)
  window.addEventListener('resize', onResize, { passive: true })
  measure()
  render()
  syncRail()
  kick()
})

onUnmounted(() => {
  mounted = false
  cancelAnimationFrame(frame)
  frame = 0
  stageEl.value?.removeEventListener('wheel', onWheel)
  window.removeEventListener('keydown', onWindowKeydown)
  window.removeEventListener('resize', onResize)
  motionQuery?.removeEventListener('change', onMotionChange)
  clearTimeout(statusTimer)
  clearTimeout(glowTimer)
  clearTimeout(thumbTimer)
  clearTimeout(wheelTimer)
  clearTimeout(clickTimer)
})
</script>

<template>
  <section
    v-if="records.length && activeRecord"
    ref="stageEl"
    class="poster-stage"
    role="region"
    aria-roledescription="carousel"
    aria-label="观演海报翻阅舞台"
    tabindex="0"
  >
    <div class="stage-poster-glow" aria-hidden="true">
      <Transition name="glow-fade">
        <img
          v-if="glowRecord?.images[0]"
          :key="glowRecord.id"
          :src="imageUrl(glowRecord.images[0])"
          alt=""
          decoding="async"
        />
      </Transition>
    </div>

    <button
      v-if="records.length > 1"
      type="button"
      class="deck-nav deck-nav--prev icon-button"
      aria-label="上一张海报"
      :disabled="!canLoop && activeIndex === 0"
      @click="step(-1)"
    >
      <ChevronLeft :size="20" />
    </button>

    <button
      v-if="records.length > 1"
      type="button"
      class="deck-nav deck-nav--next icon-button"
      aria-label="下一张海报"
      :disabled="!canLoop && activeIndex === records.length - 1"
      @click="step(1)"
    >
      <ChevronRight :size="20" />
    </button>

    <div
      ref="deckEl"
      class="poster-deck"
      :class="{ 'is-dragging': isDragging }"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @pointerleave="onDeckLeave"
    >
      <button
        v-for="(record, index) in records"
        :key="record.id"
        :ref="(el) => setCardEl(el, index)"
        type="button"
        class="poster-card"
        :class="{ 'is-active': index === activeIndex }"
        :data-index="index"
        role="group"
        aria-roledescription="slide"
        :aria-label="`${index + 1} / ${records.length}：${record.title}`"
        @click="handleCardClick(record, index)"
      >
        <img
          v-if="record.images[0]"
          :src="imageUrl(record.images[0])"
          :alt="record.title"
          decoding="async"
          draggable="false"
        />
        <div v-else class="poster-fallback">
          <span>{{ record.type }}</span>
          <strong>{{ record.title }}</strong>
        </div>

        <span class="poster-pill">{{ record.type }}</span>
        <span class="poster-open-pill" aria-hidden="true">
          <ArrowUpRight :size="16" />
        </span>
      </button>
    </div>

    <div class="poster-caption-stack">
      <Transition name="caption-swap">
        <div :key="activeRecord.id" class="poster-caption">
          <div class="poster-caption-meta">
            <time :datetime="activeRecord.date">{{ activeRecord.date.replaceAll('-', '.') }}</time>
            <span class="meta-sep">·</span>
            <span><MapPin :size="13" />{{ activeRecord.city }}</span>
            <template v-if="activeRecord.venue">
              <span class="meta-sep">·</span>
              <span>{{ activeRecord.venue }}</span>
            </template>
            <span class="meta-sep">·</span>
            <span
              class="rating"
              :aria-label="activeRecord.rating ? `评分 ${activeRecord.rating} / 5` : '尚未评分'"
            >
              <Star
                v-for="star in 5"
                :key="star"
                :size="12"
                :class="{ filled: star <= activeRecord.rating }"
              />
            </span>
          </div>

          <button type="button" class="poster-title-btn" @click="openRecord(activeRecord)">
            <h2>{{ activeRecord.title }}</h2>
          </button>

          <div class="poster-caption-sub">
            <span v-if="activeRecord.artist">{{ activeRecord.artist }}</span>
            <span class="poster-counter">
              {{ String(activeIndex + 1).padStart(2, '0') }} /
              {{ String(records.length).padStart(2, '0') }}
            </span>
          </div>
        </div>
      </Transition>
    </div>

    <nav v-if="records.length > 1" ref="railEl" class="poster-rail" aria-label="选择海报">
      <span
        class="rail-indicator"
        :class="{ ready: indicator.ready }"
        :style="{ transform: `translateX(${indicator.x}px)` }"
        aria-hidden="true"
      />
      <button
        v-for="(record, index) in records"
        :key="record.id"
        :ref="(el) => setThumbEl(el, index)"
        type="button"
        class="rail-thumb"
        :class="{ active: index === activeIndex }"
        :aria-current="index === activeIndex ? 'true' : undefined"
        :aria-label="record.title"
        :title="record.title"
        @click="goTo(index)"
        @pointerenter="onThumbEnter($event, index)"
        @pointerleave="onThumbLeave"
      >
        <img
          v-if="record.images[0]"
          :src="imageUrl(record.images[0])"
          alt=""
          loading="lazy"
          decoding="async"
        />
        <span v-else class="rail-thumb-fallback" />
      </button>
    </nav>

    <p class="visually-hidden" role="status" aria-live="polite">{{ statusText }}</p>
  </section>
</template>
