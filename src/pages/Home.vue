<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ArrowUpRight,
  ChevronDown,
  Disc3,
  GalleryHorizontalEnd,
  List,
  ListFilter,
  MapPin,
  Search as SearchIcon,
  Star,
  X
} from 'lucide-vue-next'
import { visibleRecords, imageUrl } from '../lib/store'
import { eventTypes, type ConcertRecord } from '../lib/schema'
import { filterRecords, hasFilters, readFilters } from '../lib/filters'
import { runViewTransition } from '../lib/motion'
import PosterDeck from '../components/PosterDeck.vue'

const route = useRoute()
const router = useRouter()

const mode = ref<'deck' | 'timeline'>('deck')
const hudReady = ref(false)
const filters = computed(() => readFilters(route.query))
const query = computed(() => filters.value.q)
const year = computed(() => filters.value.year)
const city = computed(() => filters.value.city)
const type = computed(() => filters.value.type)

onMounted(() => {
  hudReady.value = true
})

async function updateQuery(next: Record<string, unknown>, animate: boolean) {
  const apply = async () => {
    await router.replace({ query: next as typeof route.query })
    await nextTick()
  }
  if (animate && mode.value === 'timeline') await runViewTransition(apply)
  else await apply()
}

async function applyFilter(key: string, value: string) {
  await updateQuery({ ...route.query, [key]: value || undefined }, key !== 'q')
}

async function resetFilters() {
  await updateQuery(route.query.record ? { record: route.query.record } : {}, true)
}

async function switchMode(nextMode: 'deck' | 'timeline') {
  if (mode.value === nextMode) return
  await runViewTransition(async () => {
    mode.value = nextMode
    await nextTick()
  })
}

const years = computed(() =>
  [...new Set(visibleRecords.value.map((r) => r.date.slice(0, 4)))].sort().reverse()
)
const cities = computed(() => [...new Set(visibleRecords.value.map((r) => r.city))].sort())

const filtered = computed(() => hasFilters(filters.value))

const records = computed(() => filterRecords(visibleRecords.value, filters.value))

const timelineGroups = computed(() => {
  const map = new Map<string, ConcertRecord[]>()
  for (const record of records.value) {
    const key = record.date.slice(0, 4)
    map.set(key, [...(map.get(key) ?? []), record])
  }
  return [...map.entries()]
})
</script>

<template>
  <Teleport v-if="hudReady" to="#hud-slot">
    <div class="hud-home-controls">
      <button
        v-if="filtered"
        type="button"
        class="icon-button hud-icon-btn filter-clear-pill"
        aria-label="清除筛选"
        title="清除筛选"
        @click="resetFilters"
      >
        <X :size="14" />
      </button>

      <button
        type="button"
        popovertarget="filter-popover"
        class="icon-button hud-icon-btn filter-trigger-btn"
        :class="{ 'has-active': filtered }"
        aria-label="筛选观演档案"
        title="筛选"
      >
        <ListFilter :size="15" />
      </button>

      <div class="view-switch hud-view-switch" role="group" aria-label="切换展示方式">
        <button
          type="button"
          :class="{ selected: mode === 'deck' }"
          :aria-pressed="mode === 'deck'"
          aria-label="海报翻阅视图"
          title="海报翻阅"
          @click="switchMode('deck')"
        >
          <GalleryHorizontalEnd :size="14" />
        </button>
        <button
          type="button"
          :class="{ selected: mode === 'timeline' }"
          :aria-pressed="mode === 'timeline'"
          aria-label="时光轴视图"
          title="时光轴"
          @click="switchMode('timeline')"
        >
          <List :size="15" />
        </button>
      </div>
    </div>
  </Teleport>

  <search id="filter-popover" popover="auto" class="filter-popover" aria-label="筛选观演档案">
    <div class="filter-popover-head">
      <span>筛选</span>
      <div class="filter-popover-head-right">
        <span class="filter-count">{{ records.length }} / {{ visibleRecords.length }}</span>
        <button
          v-if="filtered"
          type="button"
          class="filter-clear-link"
          @click="resetFilters"
        >
          重置
        </button>
      </div>
    </div>

    <div class="filter-pills" role="group" aria-label="按演出类型筛选">
      <button
        type="button"
        class="filter-pill"
        :class="{ selected: !type }"
        :aria-pressed="!type"
        @click="applyFilter('type', '')"
      >
        全部 <span>{{ visibleRecords.length }}</span>
      </button>
      <button
        v-for="item in eventTypes"
        :key="item"
        type="button"
        class="filter-pill"
        :class="{ selected: type === item }"
        :aria-pressed="type === item"
        @click="applyFilter('type', item)"
      >
        {{ item }}
      </button>
    </div>

    <label class="search-box">
      <SearchIcon :size="14" />
      <input
        type="search"
        :value="query"
        placeholder="搜索演出、音乐人、标签"
        aria-label="搜索观演档案"
        @input="applyFilter('q', ($event.target as HTMLInputElement).value)"
      />
    </label>

    <div class="filter-select-row">
      <span class="select-wrap">
        <select
          class="select-control filter-select"
          aria-label="按年份筛选"
          :value="year"
          @change="applyFilter('year', ($event.target as HTMLSelectElement).value)"
        >
          <option value="">全部年份</option>
          <option v-for="item in years" :key="item" :value="item">{{ item }}</option>
        </select>
        <ChevronDown :size="13" class="select-chevron" aria-hidden="true" />
      </span>

      <span class="select-wrap">
        <select
          class="select-control filter-select"
          aria-label="按城市筛选"
          :value="city"
          @change="applyFilter('city', ($event.target as HTMLSelectElement).value)"
        >
          <option value="">全部城市</option>
          <option v-for="item in cities" :key="item" :value="item">{{ item }}</option>
        </select>
        <ChevronDown :size="13" class="select-chevron" aria-hidden="true" />
      </span>
    </div>
  </search>

  <div class="page-width archive-stage" :class="{ 'archive-stage--deck': mode === 'deck' && records.length }">
    <!-- 3D Panoramic Poster Deck -->
    <PosterDeck v-if="records.length && mode === 'deck'" :records="records" />

    <!-- Timeline View -->
    <div v-else-if="records.length" class="timeline">
      <section v-for="[yearKey, items] in timelineGroups" :key="yearKey" class="timeline-year">
        <div class="timeline-year-label">
          <h3>{{ yearKey }}</h3>
          <span>{{ items.length }} 场</span>
        </div>

        <div class="timeline-list">
          <RouterLink
            v-for="record in items"
            :key="record.id"
            :to="{ path: '/', query: { ...route.query, record: record.id } }"
            class="timeline-record"
            :style="{ viewTransitionName: `record-${record.id}` }"
          >
            <time :datetime="record.date">{{ record.date.slice(5).replace('-', '.') }}</time>
            <div class="timeline-thumb">
              <img v-if="record.images[0]" :src="imageUrl(record.images[0])" alt="" loading="lazy" />
              <div v-else class="no-photo"><span>LIVE</span></div>
            </div>
            <div class="timeline-info">
              <div class="timeline-topline">
                <time class="timeline-mobile-date" :datetime="record.date">
                  {{ record.date.slice(5).replace('-', '.') }}
                </time>
                <span class="timeline-type">{{ record.type }}</span>
                <span
                  v-if="record.rating > 0"
                  class="rating timeline-rating"
                  :aria-label="`评分 ${record.rating} / 5`"
                >
                  <Star
                    v-for="star in 5"
                    :key="star"
                    :size="11"
                    :class="{ filled: star <= record.rating }"
                  />
                </span>
              </div>
              <h4>{{ record.title }}</h4>
              <p>
                <span v-if="record.artist" class="timeline-artist">{{ record.artist }}</span>
                <span v-if="record.artist" class="timeline-sep" aria-hidden="true">·</span>
                <span class="timeline-place">
                  <MapPin :size="12" />{{ record.city
                  }}<template v-if="record.venue"> · {{ record.venue }}</template>
                </span>
              </p>
            </div>
            <span class="timeline-arrow-wrap" aria-hidden="true">
              <ArrowUpRight :size="16" class="timeline-arrow" />
            </span>
          </RouterLink>
        </div>
      </section>
    </div>

    <!-- Empty State -->
    <div v-else class="empty-state">
      <Disc3 :size="34" :stroke-width="1.2" />
      <h3>{{ filtered ? '没有匹配记录' : '暂无观演记录' }}</h3>
      <button v-if="filtered" type="button" class="button secondary small" @click="resetFilters">
        显示全部
      </button>
      <RouterLink v-else to="/admin" class="button small">
        新增记录 <ArrowUpRight :size="15" />
      </RouterLink>
    </div>
  </div>
</template>
