<script setup lang="ts">
import { computed, ref } from 'vue'
import { Eye, EyeOff, ImagePlus, Pencil, Plus, Search, Star, Trash2 } from 'lucide-vue-next'
import type { ConcertRecord } from '../../lib/schema'
import { imageUrl } from '../../lib/store'

const props = defineProps<{
  records: ConcertRecord[]
  publishedCount: number
  demoCount: number
}>()

const emit = defineEmits<{
  create: []
  edit: [record: ConcertRecord]
  delete: [record: ConcertRecord]
  toggleField: [record: ConcertRecord, field: 'published' | 'featured']
  clearDemo: []
}>()

const filterQuery = ref('')

const filteredRecords = computed(() => {
  const q = filterQuery.value.trim().toLocaleLowerCase()
  if (!q) return props.records
  return props.records.filter((r) =>
    [r.title, r.artist, r.city, r.venue, r.type, ...r.tags]
      .join(' ')
      .toLocaleLowerCase()
      .includes(q)
  )
})
</script>

<template>
  <div class="panel-heading">
    <div>
      <h2>观演记录</h2>
      <p>共 {{ records.length }} 条 · {{ publishedCount }} 条公开</p>
    </div>
    <button type="button" class="button small" @click="emit('create')">
      <Plus :size="16" />新增记录
    </button>
  </div>

  <div v-if="demoCount" class="demo-admin-banner">
    <span>包含 {{ demoCount }} 条示例记录</span>
    <button type="button" class="banner-link" @click="emit('clearDemo')">
      清空示例 <Trash2 :size="13" />
    </button>
  </div>

  <div v-if="records.length > 3" class="admin-list-toolbar">
    <label class="admin-search">
      <Search :size="14" />
      <input
        v-model="filterQuery"
        type="search"
        placeholder="筛选标题、音乐人、城市…"
        aria-label="筛选观演记录"
      />
    </label>
  </div>

  <div class="admin-records">
    <article v-for="record in filteredRecords" :key="record.id">
      <img
        v-if="record.images[0]"
        :src="imageUrl(record.images[0])"
        alt=""
        loading="lazy"
        @click="emit('edit', record)"
      />
      <div v-else class="admin-no-image" @click="emit('edit', record)">
        <ImagePlus :size="20" />
      </div>

      <div class="admin-record-info" @click="emit('edit', record)">
        <div class="admin-record-title-row">
          <h3>{{ record.title }}</h3>
          <span v-if="record.demo" class="small-badge">示例</span>
          <span v-if="!record.published" class="small-badge">未公开</span>
        </div>
        <p>{{ record.date }} · {{ record.city }} · {{ record.type }}</p>
      </div>

      <div class="admin-record-actions">
        <button
          type="button"
          class="icon-button"
          :class="{ 'is-active': record.featured }"
          :aria-label="record.featured ? `取消精选：${record.title}` : `设为精选：${record.title}`"
          :title="record.featured ? '取消精选' : '设为精选'"
          @click="emit('toggleField', record, 'featured')"
        >
          <Star :size="15" />
        </button>
        <button
          type="button"
          class="icon-button"
          :class="{ 'is-muted': !record.published }"
          :aria-label="record.published ? `设为私密：${record.title}` : `公开展示：${record.title}`"
          :title="record.published ? '公开中（点击隐藏）' : '已隐藏（点击公开）'"
          @click="emit('toggleField', record, 'published')"
        >
          <Eye v-if="record.published" :size="15" />
          <EyeOff v-else :size="15" />
        </button>
        <button
          type="button"
          class="icon-button"
          :aria-label="`编辑${record.title}`"
          title="编辑"
          @click="emit('edit', record)"
        >
          <Pencil :size="15" />
        </button>
        <button
          type="button"
          class="icon-button"
          :aria-label="`移除${record.title}`"
          title="移除"
          @click="emit('delete', record)"
        >
          <Trash2 :size="15" />
        </button>
      </div>
    </article>

    <div v-if="!records.length" class="empty-state">
      <h3>还没有观演记录</h3>
      <p>添加第一场演出的照片与记忆。</p>
      <button type="button" class="button small" @click="emit('create')">
        <Plus :size="16" />新增记录
      </button>
    </div>

    <div v-else-if="!filteredRecords.length" class="empty-state">
      <h3>没有匹配的记录</h3>
      <button type="button" class="button secondary small" @click="filterQuery = ''">
        清除搜索
      </button>
    </div>
  </div>
</template>
