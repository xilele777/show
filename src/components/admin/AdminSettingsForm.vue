<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Plus, RotateCcw, Save, X } from 'lucide-vue-next'
import { archiveSchema, defaultEventTypes, type Archive } from '../../lib/schema'
import { categoryStyle } from '../../lib/categories'

const props = defineProps<{
  settings: Archive['settings']
  archive: Archive
}>()

const emit = defineEmits<{
  save: [settings: Archive['settings']]
  error: [message: string]
}>()

const draft = ref<Archive['settings']>(JSON.parse(JSON.stringify(props.settings)))
const newCategory = ref('')

watch(
  () => props.settings,
  (val) => {
    draft.value = JSON.parse(JSON.stringify(val))
  }
)

const isDirty = computed(() => JSON.stringify(draft.value) !== JSON.stringify(props.settings))

defineExpose({ isDirty, reset: () => (draft.value = JSON.parse(JSON.stringify(props.settings))) })

function addCategory() {
  const val = newCategory.value.trim()
  if (!val) return
  if (!draft.value.categories.includes(val) && draft.value.categories.length < 20) {
    draft.value.categories.push(val)
  }
  newCategory.value = ''
}

function removeCategory(index: number) {
  if (draft.value.categories.length <= 1) return
  draft.value.categories.splice(index, 1)
}

function resetCategories() {
  draft.value.categories = [...defaultEventTypes]
}

function submit() {
  emit('error', '')
  try {
    const parsed = archiveSchema.parse({ ...props.archive, settings: draft.value })
    emit('save', parsed.settings)
  } catch {
    emit('error', '请填写站点名称、作者、一句话简介，并保留至少一个演出分类。')
  }
}
</script>

<template>
  <form @submit.prevent="submit">
    <div class="panel-heading">
      <div>
        <h2>站点设置</h2>
        <p>管理档案简介与前台右上角筛选分类。</p>
      </div>
    </div>

    <div class="form-grid">
      <label>
        站点名称 *
        <input v-model="draft.name" required maxlength="40" />
      </label>
      <label>
        英文副标
        <input v-model="draft.englishName" maxlength="60" />
      </label>
      <label class="full">
        作者称呼 *
        <input v-model="draft.owner" required maxlength="60" />
      </label>
      <label class="full">
        一句话简介 *
        <input v-model="draft.tagline" required maxlength="120" />
      </label>

      <div class="field-label full">
        <div class="field-head-inline">
          <span>演出分类（用于前台筛选与录入）</span>
          <button type="button" class="banner-link muted-action" @click="resetCategories">
            <RotateCcw :size="12" />恢复默认
          </button>
        </div>

        <div class="chip-editor">
          <div class="chip-list">
            <span
              v-for="(cat, idx) in draft.categories"
              :key="cat"
              class="editor-chip category-chip"
              :style="categoryStyle(cat)"
            >
              <i class="cat-dot" aria-hidden="true" />
              {{ cat }}
              <button
                v-if="draft.categories.length > 1"
                type="button"
                class="chip-remove"
                :aria-label="`移除分类 ${cat}`"
                @click="removeCategory(idx)"
              >
                <X :size="12" />
              </button>
            </span>
          </div>

          <div class="chip-input-row">
            <input
              v-model="newCategory"
              maxlength="30"
              placeholder="新增自定义分类，如：室内乐、歌剧、独奏会"
              @keydown.enter.prevent="addCategory"
            />
            <button type="button" class="button secondary small" @click="addCategory">
              <Plus :size="14" />添加分类
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="form-actions">
      <button class="button small" type="submit" :disabled="!isDirty">
        <Save :size="15" />保存设置
      </button>
    </div>
  </form>
</template>
