# 余响 AFTERGLOW

一个展示个人音乐会、演唱会、音乐节与 Livehouse 观演记录的网站。浅深主题、照片、票根式精选、筛选与时间线、观后记和节目单；管理页支持编辑、图片压缩、浏览器草稿和 GitHub 发布。

## 本地运行

Node.js 24：

```powershell
npm ci
npm run dev
```

打开 http://127.0.0.1:3001/ ，管理入口 http://127.0.0.1:3001/#/admin 。本地管理编辑完先“保存到草稿”，再进入“连接与发布”点击“保存到本地项目”。记录写到 `public/content/archive.json`，图片写到 `public/uploads`；本地上一个内容快照位于被 Git 忽略的 `.concshow-backups/archive.backup.json`。

`show-tracker/` 是单独克隆的参考仓库，不会纳入本项目提交。

## 发布到 GitHub Pages

1. 创建自己的 GitHub 仓库，将本项目推送到 `main` 分支。
2. 仓库 Settings → Pages → Source 选择 **GitHub Actions**。
3. Actions 中执行 **Publish concert journal**。之后推送 `main` 会自动构建发布。
4. 构建过程自动配置仓库子路径；hash 路由让详情和管理页可直接打开，避免 Pages 路由 404。

```powershell
git init -b main
git add .
git commit -m "Create personal concert journal"
git remote add origin https://github.com/YOUR_NAME/YOUR_REPO.git
git push -u origin main
```

修改默认分支时，同时修改 `.github/workflows/pages.yml` 里的分支和 `VITE_GITHUB_BRANCH`。

## 在线管理

GitHub Pages 是静态托管，写入由管理页面连接 GitHub REST API 完成。

1. 在 https://github.com/settings/personal-access-tokens/new 创建 **Fine-grained personal access token**。
2. Repository access 只选本站仓库，Repository permissions → **Contents: Read and write**。请设置较短有效期。无需令牌的 Actions 或 Workflows 写权限。
3. 打开线上 `#/admin` → “连接与发布”，输入用户名、仓库、分支和令牌。连接时读取仓库里最新的内容。
4. 编辑、上传、保存到草稿，然后点击“发布到 GitHub”。内容与图片创建单次 Git 提交；等待 Actions 部署成功后新内容才上线。

令牌只存在当前管理页的内存里，离开、断开或刷新后清除；不会存到草稿、JSON、localStorage 或代码中。没有配置 OAuth 服务，所以当前是令牌连接，不是 GitHub OAuth 一键登录。仓库权限、GitHub 配额或分支保护会影响发布；失败会保留本地草稿。发布前检测远端提交，冲突时导出草稿，重新连接读取最新内容，再手动合并；不会强制推送覆盖。

图片会转为 WebP（不支持编码时退回 PNG），最长边 2000px，压缩后单张最多 5 MB。导出的备份包含记录和尚未提交的图片；已发布图片需从仓库克隆或下载完整备份。

“公开展示”只控制页面是否显示记录，**不构成访问权限控制**：内容 JSON 和图片仍在静态站点/仓库里。不公开的记录应另外保存在私人笔记中。默认示例记录和图片不是真实观演经历，管理页可一键移除示例。

## 检查

```powershell
npm test
npm run build
npm run preview
```

测试覆盖内容格式、日期/路径验证、GitHub 单次提交、并发保护、失败保留分支和令牌断开。生产包在 `dist/`。浏览器草稿通过 IndexedDB 存储，不会跨浏览器/设备自动同步。

## 文件

- `src/pages/`：首页、档案、关于、管理。
- `src/lib/github.ts`：GitHub 内容发布。
- `src/lib/schema.ts`：内容结构与校验。
- `src/lib/store.ts`、`drafts.ts`：内容、图片压缩和本地草稿。
- `vite.config.ts`：仅开发时启用的本机保存接口。
- `PLAN.md`：首版范围与后续方向。
- `public/photos/SOURCES.md`：示意照片来源。
