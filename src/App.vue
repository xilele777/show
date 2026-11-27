<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch, watchEffect } from 'vue'
import { useRoute } from 'vue-router'
import {
  AudioLines,
  Sun,
  Moon,
  Monitor,
  ArrowUpRight,
  SlidersHorizontal,
  Home as HomeIcon,
  Disc3,
  X
} from 'lucide-vue-next'
import { archive, dirty, loadArchive, loadError, visibleRecords } from './lib/store'
import { closeTopLayer, setupDialogLightDismiss } from './lib/motion'
import RecordDialog from './components/RecordDialog.vue'

const themes = ['system', 'light', 'dark'] as const
const route = useRoute()
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
const scrollProgress = ref(0)
const supportsScrollTimeline =
  typeof CSS !== 'undefined' &&
  CSS.supports?.('(animation-timeline: scroll()) and (animation-range: 0% 100%)')

// Compact live tally in header
const targetCounts = computed(() => ({
  shows: visibleRecords.value.length,
  cities: new Set(visibleRecords.value.map((r) => r.city)).size
}))
const animatedCounts = ref({ shows: 0, cities: 0 })
let countFrame = 0

function animateCounts() {
  cancelAnimationFrame(countFrame)
  const target = targetCounts.value
  if (
    typeof window === 'undefined' ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    animatedCounts.value = { ...target }
    return
  }
  const duration = 650
  const start = performance.now()
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / duration)
    const eased = 1 - Math.pow(1 - t, 3)
    animatedCounts.value = {
      shows: Math.round(target.shows * eased),
      cities: Math.round(target.cities * eased)
    }
    if (t < 1) countFrame = requestAnimationFrame(step)
  }
  countFrame = requestAnimationFrame(step)
}

watch(targetCounts, animateCounts, { immediate: true })

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
  const y = window.scrollY
  isScrolled.value = y > 20
  if (!supportsScrollTimeline) {
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight
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
  handleScroll()
  loadArchive()
  if (aboutDialog.value) {
    cleanupAboutDismiss = setupDialogLightDismiss(aboutDialog.value, () => {})
  }
})

onUnmounted(() => {
  media.removeEventListener('change', applyTheme)
  window.removeEventListener('scroll', handleScroll)
  cancelAnimationFrame(countFrame)
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

  <header class="site-header" :class="{ 'is-scrolled': isScrolled }">
    <div class="header-capsule">
      <div class="header-left">
        <RouterLink to="/" class="brand" aria-label="余响，返回首页">
          <span class="brand-mark"><AudioLines :size="17" :stroke-width="1.8" /></span>
          <span class="brand-titles">
            <span class="brand-cn">{{ archive?.settings.name || '余响' }}</span>
            <span class="brand-en">{{ archive?.settings.englishName || 'AFTERGLOW' }}</span>
          </span>
        </RouterLink>
      </div>

      <div class="header-actions">
        <span v-if="archive && visibleRecords.length" class="header-tally" aria-label="观演统计">
          <b>{{ String(animatedCounts.shows).padStart(2, '0') }}</b> 场 ·
          <b>{{ String(animatedCounts.cities).padStart(2, '0') }}</b> 城
        </span>

        <button
          v-if="archive"
          type="button"
          class="icon-button header-icon-btn"
          aria-label="关于这本档案"
          title="关于"
          @click="openAbout"
        >
          <Disc3 :size="16" />
        </button>

        <button
          type="button"
          class="icon-button header-icon-btn"
          :aria-label="`${themeLabel}，点击切换主题`"
          :title="themeLabel"
          @click="changeTheme"
        >
          <Sun v-if="theme === 'light'" :size="16" />
          <Moon v-else-if="theme === 'dark'" :size="16" />
          <Monitor v-else :size="16" />
        </button>

        <RouterLink
          v-if="route.path === '/admin'"
          to="/"
          class="icon-button header-icon-btn"
          aria-label="返回首页"
          title="返回首页"
        >
          <HomeIcon :size="16" />
        </RouterLink>
        <RouterLink
          v-else
          to="/admin"
          class="icon-button header-icon-btn"
          aria-label="管理记录"
          title="管理记录"
        >
          <SlidersHorizontal :size="15" />
        </RouterLink>
      </div>
    </div>
  </header>

  <div v-if="dirty && route.path !== '/admin'" class="draft-banner">
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
