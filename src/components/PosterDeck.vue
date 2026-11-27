<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowUpRight, ChevronLeft, ChevronRight, MapPin, Pause, Play, Star } from 'lucide-vue-next'
import type { ConcertRecord } from '../lib/schema'
import { imageUrl } from '../lib/store'
import {
  buildDeckSlots,
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
const activeSlot = ref(0)
const glowIndex = ref(0)
const statusText = ref('')
const isDragging = ref(false)
const autoGlide = ref(true)

const total = computed(() => props.records.length)
const slots = computed(() => buildDeckSlots(props.records, 11))
const slotCount = computed(() => slots.value.length)
const canLoop = computed(() => props.records.length >= 2)
const activeRecord = computed(() => props.records[activeIndex.value] ?? props.records[0])
const glowRecord = computed(() => props.records[glowIndex.value] ?? activeRecord.value)

const cardEls: (HTMLElement | null)[] = []
const thumbEls: (HTMLElement | null)[] = []
const hoverLift: number[] = []

const GLIDE_SPEED = 0.14
const PANORAMA_RANGE = 5.4

let position = 0
let velocity = 0
let target = 0
let motion: 'idle' | 'spring' | 'direct' | 'glide' = 'idle'
let unit = 205
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
let hoverSlot = -1
let reduceMotion = false
let pointerInside = false
let focusInside = false
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
let glideTimer: ReturnType<typeof setTimeout> | undefined
let motionQuery: MediaQueryList | undefined

function setCardEl(el: unknown, index: number) {
  cardEls[index] = el instanceof HTMLElement ? el : null
}

function setThumbEl(el: unknown, index: number) {
  thumbEls[index] = el instanceof HTMLElement ? el : null
}

function hasOpenDialog(): boolean {
  return typeof document !== 'undefined' && Boolean(document.querySelector('dialog[open]'))
}

function canAutoGlide(): boolean {
  return (
    mounted &&
    autoGlide.value &&
    !reduceMotion &&
    canLoop.value &&
    !pointerInside &&
    !focusInside &&
    !isDragging.value &&
    !hasOpenDialog() &&
    document.visibilityState !== 'hidden'
  )
}

function scheduleGlideResume(delay = 2200) {
  clearTimeout(glideTimer)
  if (!autoGlide.value || reduceMotion || !canLoop.value) return
  glideTimer = setTimeout(() => {
    if (!canAutoGlide() || motion === 'direct') return
    motion = 'glide'
    kick()
  }, delay)
}

function toggleAutoGlide() {
  autoGlide.value = !autoGlide.value
  if (autoGlide.value) {
    scheduleGlideResume(260)
  } else {
    clearTimeout(glideTimer)
    if (motion === 'glide') springTo(Math.round(position))
  }
}

function normalizeSlot(slotPos: number): number {
  const count = slotCount.value
  if (!count) return 0
  if (canLoop.value) return wrapIndex(slotPos, count)
  return clamp(Math.round(slotPos), 0, Math.max(0, count - 1))
}

function announce(index: number) {
  clearTimeout(statusTimer)
  statusTimer = setTimeout(() => {
    const rec = props.records[index]
    if (rec) statusText.value = `${index + 1} / ${props.records.length}：${rec.title}`
  }, 220)
}

function setActiveSlot(slotPos: number) {
  const nextSlot = normalizeSlot(slotPos)
  activeSlot.value = nextSlot
  const nextRecord = slots.value[nextSlot]?.recordIndex ?? 0
  if (nextRecord !== activeIndex.value) {
    activeIndex.value = nextRecord
    announce(nextRecord)
  }
}

function boundTarget(value: number): number {
  return canLoop.value ? value : clamp(value, 0, Math.max(0, slotCount.value - 1))
}

function springTo(next: number) {
  clearTimeout(wheelTimer)
  clearTimeout(glideTimer)
  target = boundTarget(next)
  motion = 'spring'
  setActiveSlot(target)
  kick()
  scheduleGlideResume(2600)
}

function goToSlot(slotIndex: number) {
  if (!slotCount.value) return
  const base = Math.round(position)
  const next = canLoop.value
    ? base + Math.round(circularOffset(slotIndex, base, slotCount.value, true))
    : slotIndex
  springTo(next)
}

function goToRecord(recordIndex: number) {
  if (!total.value || !slotCount.value) return
  const base = Math.round(position)
  let bestSlot = recordIndex
  let bestDist = Infinity
  for (let i = 0; i < slotCount.value; i++) {
    if (slots.value[i]?.recordIndex !== recordIndex) continue
    const dist = Math.abs(circularOffset(i, base, slotCount.value, canLoop.value))
    if (dist < bestDist) {
      bestDist = dist
      bestSlot = i
    }
  }
  goToSlot(bestSlot)
}

function step(delta: number) {
  if (total.value <= 1) return
  const base = Math.round(motion === 'spring' ? target : position)
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
  introDuration = from <= 0 ? 1050 : 580
}

function measure() {
  const card = cardEls.find(Boolean)
  if (card?.offsetWidth) unit = clamp(card.offsetWidth * 0.8, 150, 275)
}

function render() {
  const n = slotCount.value
  const loop = canLoop.value
  const active = activeSlot.value
  for (let i = 0; i < n; i++) {
    const el = cardEls[i]
    if (!el) continue
    const pose = cardPose(circularOffset(i, position, n, loop), unit, intro, PANORAMA_RANGE)
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

  if (motion === 'glide') {
    if (!canAutoGlide()) {
      motion = 'spring'
      target = boundTarget(Math.round(position))
      velocity = 0
      setActiveSlot(target)
      busy = true
    } else {
      const count = slotCount.value
      position = ((position + GLIDE_SPEED * dt) % count + count) % count
      target = position
      setActiveSlot(Math.round(position))
      busy = true
    }
  } else if (motion === 'spring') {
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

  for (let i = 0; i < slotCount.value; i++) {
    const goal = i === hoverSlot && i !== activeSlot.value && !isDragging.value ? 1 : 0
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
  clearTimeout(glideTimer)
  router.replace({ path: '/', query: { ...route.query, record: record.id } })
}

function handleCardClick(record: ConcertRecord, slotIndex: number) {
  if (suppressClick) return
  const dist = Math.abs(circularOffset(slotIndex, position, slotCount.value, canLoop.value))
  if (slotIndex === activeSlot.value && dist < 0.35) openRecord(record)
  else goToSlot(slotIndex)
}

function dragPosition(value: number): number {
  if (canLoop.value) return value
  const max = Math.max(0, slotCount.value - 1)
  if (value < 0) return -rubberBand(-value)
  if (value > max) return max + rubberBand(value - max)
  return value
}

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0 || total.value <= 1) return
  clearTimeout(clickTimer)
  clearTimeout(glideTimer)
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
  const slotIdx = card ? Number(card.dataset.slot) : -1
  hoverSlot = slotIdx
  if (card && slotIdx === activeSlot.value && !reduceMotion) {
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
      clearTimeout(glideTimer)
      deckEl.value?.setPointerCapture?.(event.pointerId)
      dragOriginX = event.clientX
      dragStartPos = position
      velocity = 0
      motion = 'direct'
      samples.length = 0
      tiltTargetX = 0
      tiltTargetY = 0
      hoverSlot = -1
    } else if (Math.abs(dy) > 10) {
      pointerActive = false
      return
    } else {
      return
    }
  }

  position = dragPosition(dragStartPos - (event.clientX - dragOriginX) / unit)
  target = boundTarget(Math.round(position))
  setActiveSlot(target)
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
  hoverSlot = -1
  tiltTargetX = 0
  tiltTargetY = 0
  kick()
}

function onStagePointerEnter(event: PointerEvent) {
  if (event.pointerType !== 'mouse') return
  pointerInside = true
  clearTimeout(glideTimer)
  if (motion === 'glide') springTo(Math.round(position))
}

function onStagePointerLeave(event: PointerEvent) {
  if (event.pointerType !== 'mouse') return
  pointerInside = false
  scheduleGlideResume(1600)
}

function onStageFocusIn() {
  focusInside = true
  clearTimeout(glideTimer)
  if (motion === 'glide') springTo(Math.round(position))
}

function onStageFocusOut(event: FocusEvent) {
  const next = event.relatedTarget as Node | null
  if (next && stageEl.value?.contains(next)) return
  focusInside = false
  scheduleGlideResume(1800)
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
    if ((delta < 0 && base <= 0) || (delta > 0 && base >= slotCount.value - 1)) return
  }
  event.preventDefault()
  clearTimeout(glideTimer)

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
  setActiveSlot(target)
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
  if (isTypingTarget(event.target) || hasOpenDialog()) return
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
      goToRecord(0)
      break
    case 'End':
      if (!inStage) return
      goToRecord(total.value - 1)
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
  thumbTimer = setTimeout(() => goToRecord(index), 90)
}

function onThumbLeave() {
  clearTimeout(thumbTimer)
}

function syncRail() {
  const rail = railEl.value
  const thumb = thumbEls[activeIndex.value]
  if (!rail || !thumb) return
  if (rail.scrollWidth > rail.clientWidth + 1) {
    const center = thumb.offsetLeft + thumb.offsetWidth / 2
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
  if (reduceMotion && motion === 'glide') springTo(Math.round(position))
}

function onVisibilityChange() {
  if (document.visibilityState === 'hidden') {
    clearTimeout(glideTimer)
    if (motion === 'glide') springTo(Math.round(position))
  } else {
    scheduleGlideResume(1200)
  }
}

watch(
  () => props.records,
  (list, oldList) => {
    if (!list.length) {
      activeIndex.value = 0
      activeSlot.value = 0
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
    clearTimeout(glideTimer)
    position = index
    target = index
    velocity = 0
    motion = 'idle'
    activeIndex.value = index
    activeSlot.value = index
    glowIndex.value = index
    hoverLift.length = 0
    cardEls.length = slotCount.value
    thumbEls.length = list.length
    startIntro(oldList && oldList.length ? 0.55 : 0)
    if (mounted) {
      void nextTick(() => {
        measure()
        render()
        syncRail()
        kick()
        scheduleGlideResume(1600)
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
    if (typeof id !== 'string') {
      scheduleGlideResume(1500)
      return
    }
    clearTimeout(glideTimer)
    const index = props.records.findIndex((r) => r.id === id)
    if (index >= 0 && index !== activeIndex.value) goToRecord(index)
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
  document.addEventListener('visibilitychange', onVisibilityChange)
  measure()
  render()
  syncRail()
  kick()
  scheduleGlideResume(1500)
})

onUnmounted(() => {
  mounted = false
  cancelAnimationFrame(frame)
  frame = 0
  stageEl.value?.removeEventListener('wheel', onWheel)
  window.removeEventListener('keydown', onWindowKeydown)
  window.removeEventListener('resize', onResize)
  document.removeEventListener('visibilitychange', onVisibilityChange)
  motionQuery?.removeEventListener('change', onMotionChange)
  clearTimeout(statusTimer)
  clearTimeout(glowTimer)
  clearTimeout(thumbTimer)
  clearTimeout(wheelTimer)
  clearTimeout(clickTimer)
  clearTimeout(glideTimer)
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
    @pointerenter="onStagePointerEnter"
    @pointerleave="onStagePointerLeave"
    @focusin="onStageFocusIn"
    @focusout="onStageFocusOut"
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
      @click="step(-1)"
    >
      <ChevronLeft :size="20" />
    </button>

    <button
      v-if="records.length > 1"
      type="button"
      class="deck-nav deck-nav--next icon-button"
      aria-label="下一张海报"
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
        v-for="slot in slots"
        :key="slot.slotIndex"
        :ref="(el) => setCardEl(el, slot.slotIndex)"
        type="button"
        class="poster-card"
        :class="{ 'is-active': slot.slotIndex === activeSlot }"
        :data-slot="slot.slotIndex"
        :tabindex="slot.duplicate ? -1 : undefined"
        :aria-hidden="slot.duplicate ? 'true' : undefined"
        :role="slot.duplicate ? undefined : 'group'"
        :aria-roledescription="slot.duplicate ? undefined : 'slide'"
        :aria-label="
          slot.duplicate ? undefined : `${slot.recordIndex + 1} / ${records.length}：${slot.item.title}`
        "
        @click="handleCardClick(slot.item, slot.slotIndex)"
      >
        <img
          v-if="slot.item.images[0]"
          :src="imageUrl(slot.item.images[0])"
          :alt="slot.duplicate ? '' : slot.item.title"
          decoding="async"
          draggable="false"
        />
        <div v-else class="poster-fallback">
          <span>{{ slot.item.type }}</span>
          <strong>{{ slot.item.title }}</strong>
        </div>

        <span class="poster-pill">{{ slot.item.type }}</span>
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
            <template v-if="activeRecord.rating > 0">
              <span class="meta-sep">·</span>
              <span class="rating" :aria-label="`评分 ${activeRecord.rating} / 5`">
                <Star
                  v-for="star in 5"
                  :key="star"
                  :size="12"
                  :class="{ filled: star <= activeRecord.rating }"
                />
              </span>
            </template>
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
            <button
              v-if="records.length > 1"
              type="button"
              class="glide-toggle"
              :aria-label="autoGlide ? '暂停连续漫游' : '开启连续漫游'"
              :title="autoGlide ? '暂停连续漫游' : '开启连续漫游'"
              @click="toggleAutoGlide"
            >
              <Pause v-if="autoGlide" :size="11" />
              <Play v-else :size="11" />
            </button>
          </div>
        </div>
      </Transition>
    </div>

    <nav v-if="records.length > 1" ref="railEl" class="poster-rail" aria-label="选择海报">
      <button
        v-for="(record, index) in records"
        :key="record.id"
        :ref="(el) => setThumbEl(el, index)"
        type="button"
        class="rail-dot"
        :class="{ active: index === activeIndex }"
        :aria-current="index === activeIndex ? 'true' : undefined"
        :aria-label="record.title"
        :title="record.title"
        @click="goToRecord(index)"
        @pointerenter="onThumbEnter($event, index)"
        @pointerleave="onThumbLeave"
      />
    </nav>

    <p class="visually-hidden" role="status" aria-live="polite">{{ statusText }}</p>
  </section>
</template>
