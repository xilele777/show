<script setup lang="ts">
import { ref } from 'vue'
import { ArrowUpRight, CloudUpload, Eye, EyeOff, Github, Link2, LogOut, RefreshCw } from 'lucide-vue-next'
import type { GithubConfig } from '../../lib/github'

defineProps<{
  dirty: boolean
  busy: boolean
  local: boolean
  connected: boolean
  recordCount: number
  pendingCount: number
  config: GithubConfig
  token: string
}>()

const emit = defineEmits<{
  'update:token': [value: string]
  publish: []
  discard: []
  connect: []
  disconnect: []
  syncRemote: []
}>()

const showToken = ref(false)
</script>

<template>
  <div class="panel-heading">
    <div>
      <h2>发布与同步</h2>
      <p>{{ local && !connected ? '本地开发可直接写入项目文件，也可连接 GitHub 发布。' : '将草稿与照片同步到线上仓库。' }}</p>
    </div>
    <Github :size="24" :stroke-width="1.5" />
  </div>

  <section class="publish-card">
    <div>
      <span class="live-dot" :class="{ unsaved: dirty }" />
      <h3>{{ dirty ? '有待发布改动' : '内容已是最新' }}</h3>
    </div>
    <p>{{ recordCount }} 条记录 · {{ pendingCount }} 张新照片</p>
    <div class="publish-actions">
      <button
        type="button"
        class="button small"
        :disabled="busy || !dirty || (!connected && !local)"
        @click="emit('publish')"
      >
        <CloudUpload :size="16" />
        {{
          busy
            ? '正在处理…'
            : connected
              ? '发布到 GitHub'
              : local
                ? '保存到本地项目'
                : '请先连接仓库'
        }}
      </button>
      <button
        v-if="dirty"
        type="button"
        class="button secondary small"
        :disabled="busy"
        @click="emit('discard')"
      >
        放弃改动
      </button>
      <a
        v-if="connected"
        :href="`https://github.com/${config.owner}/${config.repo}/actions`"
        target="_blank"
        rel="noopener noreferrer"
        class="text-link"
      >
        查看部署 <ArrowUpRight :size="14" />
      </a>
    </div>
  </section>

  <section class="github-connect">
    <h3><Github :size="17" />{{ connected ? '已连接 GitHub 仓库' : '连接 GitHub 仓库' }}</h3>

    <template v-if="connected">
      <p class="connected-repo">
        <Link2 :size="15" />{{ config.owner }} / {{ config.repo }}
        <span class="small-badge">{{ config.branch }}</span>
      </p>
      <div class="connected-repo-actions">
        <button
          type="button"
          class="button secondary small"
          :disabled="busy"
          @click="emit('syncRemote')"
        >
          <RefreshCw :size="14" />从仓库同步
        </button>
        <button
          type="button"
          class="button secondary small"
          :disabled="busy"
          @click="emit('disconnect')"
        >
          <LogOut :size="14" />断开连接
        </button>
      </div>
    </template>

    <form v-else @submit.prevent="emit('connect')">
      <div class="form-grid">
        <label>
          GitHub 用户 / 组织
          <input
            v-model="config.owner"
            required
            autocomplete="off"
            autocapitalize="none"
            spellcheck="false"
            placeholder="xilele777"
          />
        </label>
        <label>
          仓库名
          <input
            v-model="config.repo"
            required
            autocomplete="off"
            autocapitalize="none"
            spellcheck="false"
            placeholder="concshow"
          />
        </label>
        <label>
          分支
          <input
            v-model="config.branch"
            required
            autocomplete="off"
            autocapitalize="none"
            spellcheck="false"
            placeholder="main"
          />
        </label>
        <label class="full">
          访问令牌 (PAT)
          <div class="token-input-wrap">
            <input
              :value="token"
              :type="showToken ? 'text' : 'password'"
              required
              autocomplete="off"
              autocapitalize="none"
              spellcheck="false"
              placeholder="github_pat_…"
              @input="emit('update:token', ($event.target as HTMLInputElement).value)"
            />
            <button
              type="button"
              class="token-eye-btn"
              :aria-pressed="showToken"
              :aria-label="showToken ? '隐藏令牌' : '显示令牌'"
              @click="showToken = !showToken"
            >
              <EyeOff v-if="showToken" :size="15" />
              <Eye v-else :size="15" />
            </button>
          </div>
          <small>仅暂存在当前页面内存，需要仓库 Contents 读写权限。</small>
        </label>
      </div>
      <button class="button secondary small" :disabled="busy">
        <Github :size="15" />{{ busy ? '正在连接…' : '连接仓库' }}
      </button>
    </form>

    <details class="setup-guide">
      <summary>首次使用如何配置？</summary>
      <ol>
        <li>仓库 Settings → Pages 中将 Source 设为 GitHub Actions。</li>
        <li>
          在
          <a
            href="https://github.com/settings/personal-access-tokens/new"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub Token 设置 ↗
          </a>
          创建仅授权本仓库的 Fine-grained token（Contents: Read and write）。
        </li>
        <li>填写上方仓库信息与令牌连接，即可直接发布更新。</li>
      </ol>
    </details>
  </section>
</template>
