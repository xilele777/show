<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watchEffect } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  AudioLines,
  Sun,
  Moon,
  Monitor,
  ArrowUpRight,
  Home as HomeIcon,
  Disc3,
  X
} from 'lucide-vue-next'
import { archive, dirty, loadArchive, loadError, visibleRecords } from './lib/store'
import { closeTopLayer, setupDialogLightDismiss } from './lib/motion'
import RecordDialog from './components/RecordDialog.vue'

const themes = ['system', 'light', 'dark'] as const
const route = useRoute()
const router = useRouter()
const theme = ref<(typeof themes)[number]>('system')

try {
  const saved = localStorage.getItem('concshow-theme')
  if (themes.includes(saved as (typeof themes)[number])) {
    theme.value = saved as (typeof themes)[number]
  }
} catch {}

const media = matchMedia('(prefers-color-scheme: dark)')
const themeLabel = computed(() =>
  theme.value === 'system' ? '跟随系统' : theme.value === 'light' ? '浅色主题' : '深色主题'
)

const isScrolled = ref(false)
const hudHidden = ref(false)
const scrollProgress = ref(0)
const supportsScrollTimeline =
  typeof CSS !== 'undefined' &&
  CSS.supports?.('(animation-timeline: scroll()) and (animation-range: 0% 100%)')

let lastScrollY = 0

// Stealth admin entry (mouse gesture, long-press, triple-click, or Alt+Shift+A)
const brandHolding = ref(false)
let brandPointerId = -1
let brandDownX = 0
let brandDownY = 0
let brandTriggered = false
let holdTimer: ReturnType<typeof setTimeout> | undefined
let holdVisualTimer: ReturnType<typeof setTimeout> | undefined
let brandClickCount = 0
let brandClickTimer: ReturnType<typeof setTimeout> | undefined

function enterAdminStealth() {
  brandTriggered = true
  brandHolding.value = false
  clearTimeout(holdTimer)
  clearTimeout(holdVisualTimer)
  if (route.path !== '/admin') void router.push('/admin')
}

function onBrandPointerDown(event: PointerEvent) {
  if (event.button !== 0 || route.path === '/admin') return
  brandPointerId = event.pointerId
  brandDownX = event.clientX
  brandDownY = event.clientY
  brandTriggered = false
  ;(event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId)
  clearTimeout(holdTimer)
  clearTimeout(holdVisualTimer)
  holdVisualTimer = setTimeout(() => {
    brandHolding.value = true
  }, 180)
  holdTimer = setTimeout(() => {
    enterAdminStealth()
  }, 680)
}

function onBrandPointerMove(event: PointerEvent) {
  if (event.pointerId !== brandPointerId || brandTriggered) return
  const dx = event.clientX - brandDownX
  const dy = event.clientY - brandDownY
  if (dx >= 28 && dy >= 18) {
    enterAdminStealth()
  } else if (Math.hypot(dx, dy) > 16) {
    brandHolding.value = false
    clearTimeout(holdTimer)
    clearTimeout(holdVisualTimer)
  }
}

function resetBrandGesture() {
  brandPointerId = -1
  brandHolding.value = false
  clearTimeout(holdTimer)
  clearTimeout(holdVisualTimer)
}

function onBrandClick(event: MouseEvent) {
  if (brandTriggered) {
    event.preventDefault()
    brandTriggered = false
    return
  }
  if (route.path === '/admin') return
  brandClickCount += 1
  clearTimeout(brandClickTimer)
  if (brandClickCount >= 3) {
    event.preventDefault()
    brandClickCount = 0
    enterAdminStealth()
    return
  }
  brandClickTimer = setTimeout(() => {
    brandClickCount = 0
  }, 950)
}

function onGlobalKeydown(event: KeyboardEvent) {
  if (event.altKey && event.shiftKey && event.key.toLowerCase() === 'a') {
    event.preventDefault()
    void router.push(route.path === '/admin' ? '/' : '/admin')
  }
}

// About modal
const aboutDialog = ref<HTMLDialogElement>()
let cleanupAboutDismiss: (() => void) | undefined
const firstYear = computed(
  () => visibleRecords.value.at(-1)?.date.slice(0, 4) || new Date().getFullYear()
)

function openAbout() {
  aboutDialog.value?.removeAttribute('data-closing')
  aboutDialog.value?.showModal()
}

async function closeAbout() {
  await closeTopLayer(aboutDialog.value)
}

function applyTheme() {
  const resolved = theme.value === 'system' ? (media.matches ? 'dark' : 'light') : theme.value
  document.documentElement.dataset.theme = resolved
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', resolved === 'dark' ? '#09090b' : '#f7f7f9')
}

function changeTheme() {
  theme.value = themes[(themes.indexOf(theme.value) + 1) % themes.length]!
  try {
    localStorage.setItem('concshow-theme', theme.value)
  } catch {}
  applyTheme()
}

function handleScroll() {
  const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
  const y = Math.max(0, Math.min(window.scrollY, maxScroll))
  isScrolled.value = isScrolled.value ? y > 8 : y > 28
  if (y <= 32) {
    hudHidden.value = false
  } else if (y > lastScrollY + 4 && y > 72) {
    hudHidden.value = true
  } else if (y < lastScrollY - 4) {
    hudHidden.value = false
  }
  lastScrollY = y
  if (!supportsScrollTimeline) {
    scrollProgress.value = maxScroll > 0 ? Math.min(1, y / maxScroll) : 0
  }
}

function skipToContent() {
  const main = document.getElementById('main-content')
  main?.focus()
  main?.scrollIntoView()
}

watchEffect(() => {
  const name = archive.value?.settings.name || '余响'
  const en = archive.value?.settings.englishName || 'AFTERGLOW'
  const record = archive.value?.records.find(
    (item) => item.published && item.id === route.query.record
  )
  const label = record?.title || (route.path === '/admin' ? '管理' : name)
  document.title = record?.title ? `${label} · ${name}` : `${name} ${en}`
})

onMounted(() => {
  applyTheme()
  media.addEventListener('change', applyTheme)
  window.addEventListener('scroll', handleScroll, { passive: true })
  window.addEventListener('keydown', onGlobalKeydown)
  handleScroll()
  loadArchive()
  if (aboutDialog.value) {
    cleanupAboutDismiss = setupDialogLightDismiss(aboutDialog.value, () => {})
  }
})

onUnmounted(() => {
  media.removeEventListener('change', applyTheme)
  window.removeEventListener('scroll', handleScroll)
  window.removeEventListener('keydown', onGlobalKeydown)
  clearTimeout(holdTimer)
  clearTimeout(holdVisualTimer)
  clearTimeout(brandClickTimer)
  cleanupAboutDismiss?.()
})
</script>

<template>
  <a class="skip-link" href="#main-content" @click.prevent="skipToContent">跳至正文</a>

  <div class="stage-ambient" aria-hidden="true">
    <div class="ambient-orb ambient-orb--one" />
    <div class="ambient-orb ambient-orb--two" />
  </div>

  <div
    class="scroll-progress-bar"
    :class="{ 'is-visible': isScrolled }"
    :style="!supportsScrollTimeline ? { '--scroll-progress': scrollProgress } : undefined"
    aria-hidden="true"
  />

  <header class="floating-hud" :class="{ 'is-hidden': hudHidden }">
    <RouterLink
      to="/"
      class="floating-brand"
      :class="{ 'is-holding': brandHolding }"
      aria-label="余响，返回首页"
      draggable="false"
      @dragstart.prevent
      @pointerdown="onBrandPointerDown"
      @pointermove="onBrandPointerMove"
      @pointerup="resetBrandGesture"
      @pointercancel="resetBrandGesture"
      @click="onBrandClick"
    >
      <span class="brand-mark"><AudioLines :size="15" :stroke-width="1.9" /></span>
      <span class="brand-cn">{{ archive?.settings.name || '余响' }}</span>
    </RouterLink>

    <div class="floating-actions">
      <div id="hud-slot" class="hud-slot" />

      <button
        v-if="archive"
        type="button"
        class="icon-button hud-icon-btn"
        aria-label="关于这本档案"
        title="关于"
        @click="openAbout"
      >
        <Disc3 :size="15" />
      </button>

      <button
        type="button"
        class="icon-button hud-icon-btn"
        :aria-label="`${themeLabel}，点击切换主题`"
        :title="themeLabel"
        @click="changeTheme"
      >
        <Sun v-if="theme === 'light'" :size="15" />
        <Moon v-else-if="theme === 'dark'" :size="15" />
        <Monitor v-else :size="15" />
      </button>

      <RouterLink
        v-if="route.path === '/admin'"
        to="/"
        class="icon-button hud-icon-btn"
        aria-label="返回首页"
        title="返回首页"
      >
        <HomeIcon :size="15" />
      </RouterLink>
    </div>
  </header>

  <div v-if="dirty && route.path !== '/admin'" class="draft-pill">
    <span>本地草稿预览中</span>
    <RouterLink to="/admin">发布 <ArrowUpRight :size="13" /></RouterLink>
  </div>

  <main id="main-content" tabindex="-1">
    <div v-if="loadError" class="page-width empty-state" role="alert">
      <h1>无法加载档案</h1>
      <p>{{ loadError }}</p>
      <button type="button" class="button small" @click="loadArchive">重试</button>
    </div>

    <RouterView v-else-if="archive" v-slot="{ Component }">
      <component :is="Component" />
    </RouterView>

    <div v-else class="page-width loading-state" aria-live="polite">
      <AudioLines :size="32" />
    </div>
  </main>

  <dialog
    ref="aboutDialog"
    closedby="any"
    class="about-dialog"
    aria-labelledby="about-dialog-title"
  >
    <button
      type="button"
      class="icon-button about-dialog-close"
      aria-label="关闭档案介绍"
      autofocus
      @click="closeAbout"
    >
      <X :size="18" />
    </button>
    <div v-if="archive" class="about-dialog-head">
      <div class="mini-vinyl" aria-hidden="true">
        <span><AudioLines :size="13" /></span>
      </div>
      <div>
        <h1 id="about-dialog-title">{{ archive.settings.name }} {{ archive.settings.englishName }}</h1>
        <p class="about-owner">{{ archive.settings.owner }} · {{ firstYear }}</p>
      </div>
    </div>
    <p v-if="archive?.settings.tagline" class="about-tagline">{{ archive.settings.tagline }}</p>
    <p v-if="archive" class="about-bio">{{ archive.settings.bio }}</p>
  </dialog>

  <RecordDialog />
</template>
