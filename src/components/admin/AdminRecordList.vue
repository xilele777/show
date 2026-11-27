<script setup lang="ts">
import { computed, ref } from 'vue'
import { EyeOff, ImagePlus, Plus, Search, Star, Trash2 } from 'lucide-vue-next'
import type { ConcertRecord } from '../../lib/schema'
import { categoryStyle } from '../../lib/categories'
import { imageUrl } from '../../lib/store'

const props = defineProps<{
  records: ConcertRecord[]
  selectedId?: string
  isNew?: boolean
  publishedCount: number
  demoCount: number
}>()

const emit = defineEmits<{
  create: []
  select: [record: ConcertRecord]
  clearDemo: []
}>()

const filterQuery = ref('')
const statusFilter = ref<'all' | 'published' | 'hidden' | 'upcoming'>('all')

const filteredRecords = computed(() => {
  const q = filterQuery.value.trim().toLocaleLowerCase()
  return props.records.filter((r) => {
    if (statusFilter.value === 'published' && !r.published) return false
    if (statusFilter.value === 'hidden' && r.published) return false
    if (statusFilter.value === 'upcoming' && r.status !== 'upcoming') return false
    if (!q) return true
    return [r.title, r.artist, r.orchestra, r.conductor, ...r.soloists, r.city, r.venue, r.type, ...r.tags]
      .join(' ')
      .toLocaleLowerCase()
      .includes(q)
  })
})
</script>

<template>
  <div class="master-head">
    <div class="master-head-top">
      <div>
        <h2>观演记录</h2>
        <p>{{ records.length }} 条 · {{ publishedCount }} 条公开</p>
      </div>
      <div class="master-head-actions">
        <button
          v-if="demoCount"
          type="button"
          class="button secondary small"
          title="清空示例记录"
          @click="emit('clearDemo')"
        >
          <Trash2 :size="13" />清空示例
        </button>
        <button type="button" class="button small" @click="emit('create')">
          <Plus :size="15" />新增
        </button>
      </div>
    </div>

    <label v-if="records.length > 0" class="admin-search">
      <Search :size="14" />
      <input
        v-model="filterQuery"
        type="search"
        placeholder="搜索标题、乐团、城市…"
        aria-label="筛选观演记录"
      />
    </label>

    <div v-if="records.length > 2" class="master-filter-pills" role="group" aria-label="快速筛选">
      <button
        type="button"
        :class="{ active: statusFilter === 'all' }"
        @click="statusFilter = 'all'"
      >
        全部
      </button>
      <button
        type="button"
        :class="{ active: statusFilter === 'published' }"
        @click="statusFilter = 'published'"
      >
        公开
      </button>
      <button
        type="button"
        :class="{ active: statusFilter === 'hidden' }"
        @click="statusFilter = 'hidden'"
      >
        未公开
      </button>
      <button
        type="button"
        :class="{ active: statusFilter === 'upcoming' }"
        @click="statusFilter = 'upcoming'"
      >
        待观看
      </button>
    </div>
  </div>

  <div class="master-list">
    <div v-if="isNew" class="master-item is-new active">
      <div class="master-thumb master-thumb--empty">
        <Plus :size="16" />
      </div>
      <div class="master-item-body">
        <div class="master-item-top">
          <strong>正在新增记录…</strong>
        </div>
        <p class="master-new-hint">填写右侧信息后保存草稿</p>
      </div>
    </div>

    <button
      v-for="record in filteredRecords"
      :key="record.id"
      type="button"
      class="master-item"
      :class="{ active: !isNew && selectedId === record.id }"
      :style="categoryStyle(record.type)"
      @click="emit('select', record)"
    >
      <img
        v-if="record.images[0]"
        class="master-thumb"
        :src="imageUrl(record.images[0])"
        alt=""
        loading="lazy"
      />
      <div v-else class="master-thumb master-thumb--empty">
        <ImagePlus :size="15" />
      </div>

      <div class="master-item-body">
        <div class="master-item-top">
          <strong>{{ record.title }}</strong>
          <Star v-if="record.featured" :size="12" class="master-star-icon" aria-label="精选" />
          <EyeOff v-if="!record.published" :size="12" class="master-hidden-icon" aria-label="未公开" />
        </div>
        <div class="master-item-meta">
          <span class="master-cat-dot" aria-hidden="true" />
          <span>{{ record.type }}</span>
          <span class="meta-dot">·</span>
          <time>{{ record.date }}</time>
          <span class="meta-dot">·</span>
          <span>{{ record.city }}</span>
          <span v-if="record.status === 'upcoming'" class="master-upcoming-flag">待观看</span>
        </div>
      </div>
    </button>

    <div v-if="!records.length && !isNew" class="empty-state master-empty">
      <h3>还没有观演记录</h3>
      <p>添加第一场演出的照片与记忆。</p>
      <button type="button" class="button small" @click="emit('create')">
        <Plus :size="15" />新增记录
      </button>
    </div>

    <div v-else-if="!filteredRecords.length && !isNew" class="empty-state master-empty">
      <h3>没有匹配的记录</h3>
      <button
        type="button"
        class="button secondary small"
        @click="filterQuery = ''; statusFilter = 'all'"
      >
        清除筛选
      </button>
    </div>
  </div>
</template>
