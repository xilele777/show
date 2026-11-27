<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ImagePlus, Save, Star, X } from 'lucide-vue-next'
import { eventTypes, recordSchema, type ConcertRecord } from '../../lib/schema'
import { imageUrl, pendingAssets, prepareImage } from '../../lib/store'

const props = defineProps<{
  record: ConcertRecord
  isNew: boolean
  busy: boolean
}>()

const emit = defineEmits<{
  save: [record: ConcertRecord]
  cancel: []
  error: [message: string]
  status: [message: string]
  'update:busy': [value: boolean]
}>()

const draft = ref<ConcertRecord>(JSON.parse(JSON.stringify(props.record)))
const tags = ref('')
const program = ref('')
const initialSnapshot = ref('')

const snapshot = () =>
  JSON.stringify({ ...draft.value, tags: tags.value, program: program.value })

watch(
  () => props.record,
  (value) => {
    draft.value = JSON.parse(JSON.stringify(value))
    tags.value = value.tags.join(', ')
    program.value = value.program.join('\n')
    initialSnapshot.value = snapshot()
  },
  { immediate: true }
)

const isDirty = computed(() => snapshot() !== initialSnapshot.value)

defineExpose({ isDirty })

async function upload(event: Event) {
  emit('error', '')
  emit('update:busy', true)
  const input = event.target as HTMLInputElement
  try {
    const files = [...(input.files ?? [])]
    if (files.length + draft.value.images.length > 20) throw new Error('每条记录最多 20 张图片')
    for (const file of files) {
      const asset = await prepareImage(file)
      pendingAssets.value.push(asset)
      draft.value.images.push(asset.path)
    }
    emit('status', '照片已添加，保存记录后生效。')
  } catch (caught) {
    emit('error', caught instanceof Error ? caught.message : '图片处理失败')
  } finally {
    emit('update:busy', false)
    input.value = ''
  }
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
  try {
    const parsed = recordSchema.parse({
      ...draft.value,
      tags: [
        ...new Set(
          tags.value
            .split(/[,，]/)
            .map((tag) => tag.trim())
            .filter(Boolean)
        )
      ],
      program: program.value
        .split('\n')
        .map((song) => song.trim())
        .filter(Boolean)
    })
    emit('save', parsed)
  } catch (caught) {
    emit(
      'error',
      caught instanceof Error
        ? caught.message.startsWith('[')
          ? '请填写标题、日期和城市。'
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
      <label class="full">
        演出标题 *
        <input
          v-model="draft.title"
          required
          maxlength="160"
          placeholder="例如：柴可夫斯基第五交响曲"
        />
      </label>

      <label class="full">
        艺术家 / 乐团
        <input v-model="draft.artist" maxlength="160" placeholder="音乐人、乐队或指挥" />
      </label>

      <label>
        演出日期 *
        <input v-model="draft.date" type="date" required />
      </label>

      <label>
        城市 *
        <input v-model="draft.city" required maxlength="80" placeholder="例如：上海" />
      </label>

      <label class="full">
        场地
        <input v-model="draft.venue" maxlength="160" placeholder="音乐厅、体育馆或 Livehouse" />
      </label>

      <div class="field-label full">
        <span>演出类型</span>
        <div class="type-pills" role="radiogroup" aria-label="演出类型">
          <button
            v-for="item in eventTypes"
            :key="item"
            type="button"
            role="radio"
            class="type-pill-btn"
            :class="{ active: draft.type === item }"
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
          rows="6"
          maxlength="20000"
          placeholder="记下现场的瞬间与感受…"
        />
      </label>

      <label class="full">
        标签
        <input v-model="tags" placeholder="用逗号分隔，例如：交响乐, 户外" />
      </label>

      <label class="full">
        曲目单
        <textarea v-model="program" rows="4" placeholder="每行一首曲目，可留空" />
      </label>
    </div>

    <section class="upload-section">
      <div class="upload-section-head">
        <h3>
          现场照片 <span>{{ draft.images.length }} / 20</span>
        </h3>
        <span>首张为封面 · 支持 JPG / PNG / WebP</span>
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
          <b>{{ busy ? '处理中…' : '添加照片' }}</b>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            :disabled="busy"
            @change="upload"
          />
        </label>
      </div>
    </section>

    <div class="record-options">
      <label><input v-model="draft.featured" type="checkbox" />设为首页精选</label>
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
