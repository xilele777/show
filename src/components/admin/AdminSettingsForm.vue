<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Save } from 'lucide-vue-next'
import { archiveSchema, type Archive } from '../../lib/schema'

const props = defineProps<{
  settings: Archive['settings']
  archive: Archive
}>()

const emit = defineEmits<{
  save: [settings: Archive['settings']]
  error: [message: string]
}>()

const draft = ref<Archive['settings']>({ ...props.settings })

watch(
  () => props.settings,
  (val) => {
    draft.value = { ...val }
  }
)

const isDirty = computed(() => JSON.stringify(draft.value) !== JSON.stringify(props.settings))

defineExpose({ isDirty, reset: () => (draft.value = { ...props.settings }) })

function submit() {
  emit('error', '')
  try {
    const parsed = archiveSchema.parse({ ...props.archive, settings: draft.value })
    emit('save', parsed.settings)
  } catch {
    emit('error', '请填写站点名称、作者与一句话简介。')
  }
}
</script>

<template>
  <form @submit.prevent="submit">
    <div class="panel-heading">
      <div>
        <h2>站点设置</h2>
        <p>显示在顶部栏与「关于」弹窗中。</p>
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
      <label class="full">
        关于介绍
        <textarea v-model="draft.bio" rows="7" maxlength="5000" />
      </label>
    </div>

    <div class="form-actions">
      <button class="button small" type="submit" :disabled="!isDirty">
        <Save :size="15" />保存设置
      </button>
    </div>
  </form>
</template>
