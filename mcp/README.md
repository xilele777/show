# 音乐会 MCP

让 Codex 从文字、票根、海报或整理后的表格中提取演出信息，一次录入最多 100 场。服务使用 MCP 官方 SDK 和本机 STDIO，不需要启动网站或新增服务器。复用网站的内容校验和 GitHub 发布逻辑。

## 在 Codex 中使用

本机已注册名称为 `concshow` 的 MCP。首次配置后重启 Codex，使新工具加载。之后在这个项目的聊天中可以说：

> 把下面这些演出批量录入我的音乐会档案，沿用已有分类，缺失的信息先问我。

> 给这几场补上节目单和观后记，把 E:\concshow\incoming 里的照片上传并关联。

> 预览这次的发布差异，然后发布到 GitHub。

AI 负责读取你提供的材料并提取信息，MCP 负责校验、存储、上传和发布。日期、城市、评分等信息不会由 MCP 猜测。新记录默认公开展示，`rating: 0` 表示未评分；未来演出默认为 `upcoming`。

本地保存位置是 `public/content/archive.json`。使用 `npm run dev` 后刷新 `http://127.0.0.1:3001/#/admin` 即可查看。已有浏览器草稿不会自动合并 MCP 的改动；先导出旧草稿，再刷新读取本地最新内容后合并，以免旧草稿覆盖新记录。

线上网站在调用 `publish_archive` 并等待 GitHub Pages 部署后更新。上传到 R2 的图片本身会立即可公开访问。

## 工具

| 工具               | 用途                                                             |
| ------------------ | ---------------------------------------------------------------- |
| `sync_archive`     | 合并最新 GitHub 档案到本地，保留待发布修改，避免漏掉线上已有记录 |
| `archive_overview` | 分类、总数、字段说明和内容版本 `revision`                        |
| `list_concerts`    | 关键词、分类、城市、日期、状态筛选及分页                         |
| `get_concert`      | 单场完整信息                                                     |
| `create_concerts`  | 一批新增 1–100 场，自动生成 ID、跳过重复、保存备份               |
| `update_concerts`  | 一批修改 1–100 场，只修改指定字段                                |
| `upload_images`    | 压缩和上传 1–20 张图片，可自动关联记录                           |
| `publish_archive`  | 合并远端内容并以单次 GitHub 提交发布                             |

新增、修改和发布支持 `dryRun: true`。新增、修改、图片关联和发布支持 `expectedRevision`，建议传入最近读取的版本，过期时拒绝操作。记录的 ID 或规范化后的标题、日期、城市、场馆相同则视为重复；补充已有记录请用修改工具。数组字段（如节目单、图片）在修改时整体替换。

每批先校验全部记录，再一次保存；失败不会留下部分记录。MCP 和本地管理页共用写入锁。每次实际修改保留 `.concshow-backups/archive.mcp.*.json` 快照，网页的原有备份仍保留。

### 新增示例

```json
{
  "records": [
    {
      "title": "春季交响音乐会",
      "date": "2026-03-21",
      "city": "上海",
      "type": "交响音乐会",
      "venue": "上海交响音乐厅",
      "orchestra": "上海交响乐团",
      "program": [{ "title": "第五交响曲", "composer": "贝多芬", "half": "下半场" }]
    }
  ],
  "dryRun": true
}
```

必填字段是 `title`、`date`（有效的 `YYYY-MM-DD`）、`city`、`type`。其他字段见工具说明。ID 如需自行指定，仅支持字母、数字和短横线。新分类会加入网站分类列表，分类最多 20 个，档案最多 3000 场。单场最多 20 张图片、100 条节目。

### 人员、节目单与感想

| 字段       | 用途                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------ |
| `subtitle` | 明确提供的演出副标题或巡演副标，没有则留空                                                                   |
| `cast`     | 演出人员/演员表，形如 `[{"name":"曹冬","role":""}]`，未提供职责时不推测                                      |
| `soloists` | 仅用于明确标注为独奏家的人员，一般演员名单使用 `cast`                                                        |
| `program`  | 曲名 `title`、剧目出处 `source`、作词 `lyricist`、作曲 `composer`、演唱/演奏者数组 `performers`、分段 `half` |
| `note`     | 用户实际提供的个人观演感想，没有则留空，不存放节目表或演员表，不代写                                         |
| `artist`   | 兼容旧记录的历史署名字段，新录入不使用                                                                       |

节目单示例：`{"title":"红梅赞","source":"1964年歌剧《江姐》","lyricist":"阎肃","composer":"羊鸣、姜春阳、金砂","performers":["曹冬"],"half":"上半场"}`。

管理表单支持编辑全部节目字段，也能批量导入带表头的 Markdown 节目表；旧的逐行曲目文本仍可导入。旧记录没有新增字段时自动补空值，原有内容仍可编辑和保存。新增/修改工具拒绝把节目表写入感想，也会拒绝同时把同一份人员名单写入 `cast` 与副标题/历史署名。节目对象的未知字段会报错，避免静默丢失数据。工具校验不能替代事实核对：录入后仍须检查人名、顺序、分段和节目数量。

更新本地 MCP 源码后，需要重新连接 `concshow` 服务才能加载新工具参数；服务版本为 `1.1.0`。已经连接的客户端可能仍使用旧参数，不要用旧版客户端编辑含新增字段的记录。

### 图片

将照片放在项目目录内，例如 `E:\concshow\incoming`，然后调用：

```json
{
  "files": ["incoming/ticket.jpg", "incoming/stage.png"],
  "recordId": "已有记录的ID",
  "destination": "r2"
}
```

原图接受 JPG、PNG、WebP，最多 20 MB、8000 万像素；自动按方向旋转、缩至最长边 2000px、转为 WebP，压缩后最多 5 MB。文件名按图片内容生成，重试会复用相同路径。默认使用现有 R2 Worker，密钥从本机 `.cloudflare/upload-secrets.json` 读取，也可以通过环境变量提供。`destination: "local"` 保存至 `public/uploads`，发布时和内容一并提交 GitHub。

默认仅允许读取项目目录内的图片，检查包含真实路径和符号链接。要读取其他目录，用 `CONCSHOW_IMAGE_ROOTS` 指定允许目录，以分号分隔。R2 批次失败可能已有部分图片上传，错误会列出已完成路径；此时记录尚未修改，重试即可。

## 安装与连接检查

需要 Node.js 24。换机器时在项目内运行：

```powershell
npm ci
npm run mcp:check
codex mcp add concshow -- node --use-env-proxy --import file:///E:/concshow/node_modules/tsx/dist/loader.mjs E:/concshow/mcp/index.ts
```

调整为机器上的绝对路径。脚本按自身位置寻找项目，客户端工作目录不影响存储位置。`npm run mcp` 可手动启动 STDIO 服务；它等待 MCP 请求，不提供网页界面。不要往 STDOUT 写调试日志。

Codex 的官方配置说明：https://developers.openai.com/codex/mcp 。其他 MCP 客户端也可使用同样的启动命令。

## 环境变量与发布

`npm run mcp:check -- --publish-preview` 只读取并检查真实 GitHub 发布差异；`npm run mcp:check -- --sync` 合并最新线上内容到本地。开始新一批录入时 AI 会先同步档案，再查询现有记录。

| 变量                                             | 默认 / 用途                                                      |
| ------------------------------------------------ | ---------------------------------------------------------------- |
| `CONCSHOW_ROOT`                                  | 脚本所在项目根目录，可指定另一个相同结构的项目                   |
| `CONCSHOW_IMAGE_ROOTS`                           | 项目根目录；允许读图目录，以 `;` 分隔                            |
| `CONCSHOW_R2_TOKEN`                              | 回退读取本机 `.cloudflare/upload-secrets.json` 的 `UPLOAD_TOKEN` |
| `CONCSHOW_GITHUB_OWNER` / `CONCSHOW_GITHUB_REPO` | 从项目 `origin` 读取 GitHub 仓库                                 |
| `CONCSHOW_GITHUB_BRANCH`                         | `main`                                                           |
| `CONCSHOW_GITHUB_TOKEN`                          | 回退使用 `GH_TOKEN` / `GITHUB_TOKEN`，再使用 `gh auth token`     |

当前机器已经登录 GitHub CLI，可直接使用该登录发布；无需把令牌复制到 MCP 参数、聊天或仓库。其他机器运行 `gh auth login`，或在客户端环境变量提供只有目标仓库 Contents 读写权限的令牌。R2 使用项目现有的公开配置 `src/lib/r2-public.json`。

首次写入以本地 Git HEAD 的档案为合并基线；没有 Git 时以写入前档案为基线。基线保存在被忽略的 `.concshow-mcp/baseline.json`。发布会读取最新远端，合并独立记录修改；同一条记录有不同修改时拒绝，保留本地内容。发布过程再次检测远端提交，使用 `force: false` 更新分支。MCP 发布的是档案和图片，不会自动提交项目代码。

如进程异常退出留下 `.concshow-mcp/write.lock`，先确认没有 MCP 或管理页写入进程，再移除该锁。恢复快照时先保留当前档案，再把所需备份复制回 `public/content/archive.json`。

## 验证

```powershell
npm test
npm run build
npm run mcp:check
```

测试使用临时项目，覆盖批量默认值、去重、整批校验、版本保护、备份、写入锁、图片压缩、目录范围、R2 鉴权及公开访问校验、GitHub 合并和冲突，以及真实 STDIO 客户端调用。GitHub 发布测试使用模拟请求，不会发布测试演出。
