<script setup lang="ts">
import { ref } from 'vue'
import {
  ArrowUpRight,
  Cloud,
  CloudUpload,
  Eye,
  EyeOff,
  Github,
  Link2,
  LogOut,
  RefreshCw
} from 'lucide-vue-next'
import type { GithubConfig } from '../../lib/github'
import {
  clearR2Secrets,
  isR2Ready,
  r2Config,
  rememberR2Secrets,
  saveR2PublicConfig,
  saveR2Secrets,
  setRememberR2Secrets
} from '../../lib/r2'
import { rememberGithubToken, setRememberGithubToken } from '../../lib/session'

defineProps<{
  dirty: boolean
  busy: boolean
  local: boolean
  connected: boolean
  connecting?: boolean
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
  status: [message: string]
}>()

const showToken = ref(false)
const showR2Secret = ref(false)

function saveR2() {
  saveR2PublicConfig()
  saveR2Secrets()
  emit('status', isR2Ready() ? 'Cloudflare R2 图床已就绪，上传照片将直传 R2。' : '已保存 R2 基础配置（填写密钥后即可启用直传）。')
}
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
    <p>{{ recordCount }} 条记录 · {{ pendingCount }} 张待随仓库提交的照片</p>
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
          <small>勾选“记住令牌”后，下次打开后台将自动重连仓库；随时可断开并清除。</small>
        </label>
      </div>
      <label class="remember-check">
        <input
          type="checkbox"
          :checked="rememberGithubToken"
          @change="setRememberGithubToken(($event.target as HTMLInputElement).checked)"
        />
        在此浏览器记住令牌（下次自动连接）
      </label>
      <button class="button secondary small" :disabled="busy || connecting">
        <Github :size="15" />{{ connecting || busy ? '正在连接…' : '连接仓库' }}
      </button>
    </form>

    <details class="setup-guide">
      <summary>首次使用如何配置 GitHub Pages？</summary>
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

  <section class="github-connect">
    <h3>
      <Cloud :size="17" />Cloudflare R2 图床
      <span class="small-badge">{{ isR2Ready() ? '已就绪（上传直传 R2）' : '未启用（使用仓库存储）' }}</span>
    </h3>

    <form @submit.prevent="saveR2">
      <div class="form-grid">
        <div class="field-label full">
          <span>上传方式</span>
          <div class="type-pills" role="radiogroup" aria-label="R2 上传方式">
            <button
              type="button"
              role="radio"
              class="type-pill-btn"
              :class="{ active: r2Config.mode === 's3' }"
              :aria-checked="r2Config.mode === 's3'"
              @click="r2Config.mode = 's3'"
            >
              R2 S3 API 直传
            </button>
            <button
              type="button"
              role="radio"
              class="type-pill-btn"
              :class="{ active: r2Config.mode === 'worker' }"
              :aria-checked="r2Config.mode === 'worker'"
              @click="r2Config.mode = 'worker'"
            >
              Worker 上传网关
            </button>
          </div>
        </div>

        <label class="full">
          公开访问域名 *
          <input
            v-model="r2Config.publicUrl"
            type="url"
            autocomplete="off"
            autocapitalize="none"
            spellcheck="false"
            placeholder="https://img.example.com 或 https://pub-xxxx.r2.dev"
          />
          <small>用于在前端展示照片的 HTTPS 访问地址（无末尾斜杠）。</small>
        </label>

        <template v-if="r2Config.mode === 's3'">
          <label>
            Cloudflare Account ID
            <input
              v-model="r2Config.accountId"
              autocomplete="off"
              autocapitalize="none"
              spellcheck="false"
              placeholder="32 位十六进制 Account ID"
            />
          </label>
          <label>
            Bucket 名称
            <input
              v-model="r2Config.bucket"
              autocomplete="off"
              autocapitalize="none"
              spellcheck="false"
              placeholder="concshow-media"
            />
          </label>
          <label>
            R2 Access Key ID
            <input
              v-model="r2Config.accessKeyId"
              autocomplete="off"
              autocapitalize="none"
              spellcheck="false"
              placeholder="仅存于页面内存"
            />
          </label>
          <label>
            R2 Secret Access Key
            <div class="token-input-wrap">
              <input
                v-model="r2Config.secretAccessKey"
                :type="showR2Secret ? 'text' : 'password'"
                autocomplete="off"
                autocapitalize="none"
                spellcheck="false"
                placeholder="仅存于页面内存"
              />
              <button
                type="button"
                class="token-eye-btn"
                :aria-pressed="showR2Secret"
                :aria-label="showR2Secret ? '隐藏密钥' : '显示密钥'"
                @click="showR2Secret = !showR2Secret"
              >
                <EyeOff v-if="showR2Secret" :size="15" />
                <Eye v-else :size="15" />
              </button>
            </div>
          </label>
        </template>

        <template v-else>
          <label>
            Worker 上传地址
            <input
              v-model="r2Config.workerUrl"
              type="url"
              autocomplete="off"
              autocapitalize="none"
              spellcheck="false"
              placeholder="https://r2-upload.example.workers.dev"
            />
          </label>
          <label>
            Worker 上传密钥 (Bearer)
            <div class="token-input-wrap">
              <input
                v-model="r2Config.workerToken"
                :type="showR2Secret ? 'text' : 'password'"
                autocomplete="off"
                autocapitalize="none"
                spellcheck="false"
                placeholder="仅存于页面内存"
              />
              <button
                type="button"
                class="token-eye-btn"
                :aria-pressed="showR2Secret"
                :aria-label="showR2Secret ? '隐藏密钥' : '显示密钥'"
                @click="showR2Secret = !showR2Secret"
              >
                <EyeOff v-if="showR2Secret" :size="15" />
                <Eye v-else :size="15" />
              </button>
            </div>
          </label>
        </template>
      </div>

      <label class="remember-check" style="margin-top: 12px">
        <input
          type="checkbox"
          :checked="rememberR2Secrets"
          @change="setRememberR2Secrets(($event.target as HTMLInputElement).checked)"
        />
        在此浏览器记住 R2 密钥（刷新后保持可用）
      </label>

      <div class="connected-repo-actions" style="margin-top: 14px">
        <button type="submit" class="button secondary small">保存 R2 配置</button>
        <button
          v-if="r2Config.accessKeyId || r2Config.secretAccessKey || r2Config.workerToken"
          type="button"
          class="button secondary small"
          @click="clearR2Secrets"
        >
          清除本地密钥
        </button>
      </div>
    </form>

    <details class="setup-guide">
      <summary>如何配置 Cloudflare R2 跨域与直传？</summary>
      <ol>
        <li>在 Cloudflare Dashboard → R2 创建存储桶，并绑定公开域名或开启 <code>r2.dev</code> 公开访问。</li>
        <li>若使用 S3 API 直传：创建具备该桶 Object Read &amp; Write 权限的 R2 API Token，并在存储桶 Settings → CORS Policy 允许来源站点的 <code>PUT</code> 请求（含 <code>content-type</code>、<code>x-amz-content-sha256</code>、<code>x-amz-date</code>、<code>authorization</code> 头）。</li>
        <li>若不希望浏览器持有 R2 API Key，可部署一个绑定 R2 存储桶的 Cloudflare Worker，接收带 <code>Authorization: Bearer</code> 的 <code>PUT /&lt;key&gt;</code> 请求并写入 <code>env.BUCKET.put(key, request.body)</code>。</li>
        <li>勾选“记住 R2 密钥”后，下次进入后台无需重复填写；如在公共设备使用，请取消勾选或点击“清除本地密钥”。</li>
      </ol>
    </details>
  </section>
</template>
