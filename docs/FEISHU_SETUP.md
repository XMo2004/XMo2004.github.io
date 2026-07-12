# 飞书发布配置

这套同步流程把飞书文档当作写作原稿，把多维表格当作发布清单。同步程序只读取状态为「已发布」的记录，生成 Markdown、下载文档素材，并更新 `.feishu-manifest.json`。生成结果由 Git 保存，随后照常构建 Astro 静态站点。

## 1. 创建飞书自建应用

在飞书开放平台创建企业自建应用，启用下面三项最小权限：

- 查看新版文档（`docx:document:readonly`）
- 查看、评论和导出多维表格（`bitable:app:readonly`）
- 下载云文档中的图片和附件（`docs:document.media:download`）

配置完成后发布应用版本，并确认应用已安装到写作所在的企业。本文后面会用到应用的 App ID 和 App Secret。不要把 App Secret 写入多维表格、Git 仓库或 Actions 日志。

### 给应用共享资源

开通 API 权限不等于应用自动获得某篇文档的访问权，还需要逐项共享资源：

1. 在多维表格的共享设置中加入应用，授予读取记录所需的权限。多维表格启用了高级权限时，还要把应用加入有权读取相关字段的角色；如果接口返回成功但记录为空，优先检查这里。
2. 对每篇准备发布的新版文档，通过「添加文档应用」或共享设置把阅读权限授予应用。
3. `文档链接` 必须是直接的 `/docx/` 链接。知识库页面的 `/wiki/` token 不是文档 ID，不能直接填入。

## 2. 建立发布清单

在多维表格中创建九个字段，名称需要完全一致：

| 字段 | 推荐类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| 标题 | 单行文本 | 否 | 留空时使用飞书文档标题。 |
| 文档链接 | 超链接 | 是 | 新版文档的 HTTPS `/docx/` 链接。 |
| Slug | 单行文本 | 是 | 公开 URL 片段；只用小写英文字母、数字和单个连字符，例如 `build-a-blog`。 |
| 摘要 | 多行文本 | 是 | 用于文章列表和页面描述。不可为空。 |
| 标签 | 多选 | 否 | 可留空；选项文字会成为站点标签。 |
| 发布日期 | 日期 | 是 | 文章公开日期。 |
| 状态 | 单选 | 是 | 只使用「草稿」「已发布」「已下线」。同步仅发布「已发布」。 |
| 精选 | 复选框 | 否 | 勾选后进入首页精选区；空值按否处理。 |
| 封面 | 附件 | 否 | 可上传一张封面；留空时站点使用排版封面。 |

`Slug` 不能与手写文章或另一条飞书记录重复。把记录改为「草稿」或「已下线」后，下次同步会从飞书生成目录中移除对应文章；手写文章不会受影响。

## 3. 配置 GitHub Actions secrets

打开仓库的 **Settings → Secrets and variables → Actions**，新增四个 Repository secrets：

| Secret | 值的来源 |
| --- | --- |
| `FEISHU_APP_ID` | 飞书应用的 App ID |
| `FEISHU_APP_SECRET` | 飞书应用的 App Secret |
| `FEISHU_BITABLE_APP_TOKEN` | 多维表格 URL 或开放平台提供的 app token |
| `FEISHU_BITABLE_TABLE_ID` | 发布清单所在数据表的 table ID |

同步 workflow 只引用这四个飞书 secrets。提交生成内容时使用 GitHub 自动提供的 `GITHUB_TOKEN`，无需再创建一个提交用 PAT。

同时检查 **Settings → Actions → General → Workflow permissions**。仓库需要允许 workflow 使用读写权限；分支保护规则也要允许 `github-actions[bot]` 把生成内容推回默认分支。

首次上线还要打开 **Settings → Pages → Build and deployment**，把 **Source** 设为 **GitHub Actions**。在 **Settings → Environments → github-pages** 中，把部署分支限制为 `main`；这样手动运行也不会意外发布其他分支。

## 4. 从飞书触发同步

`.github/workflows/sync-feishu.yml` 支持三种入口：

- 每 30 分钟运行一次的定时同步；cron 使用 UTC。
- GitHub Actions 页面里的手动 `workflow_dispatch`；点击 **Run workflow** 时必须选择 `main`，非 `main` 手动运行会在读取飞书或写入仓库前明确失败。
- 飞书自动化发送的 `repository_dispatch`，事件类型必须是 `feishu_publish`。

### 创建最小权限 PAT

飞书自动化需要调用 GitHub REST API。创建 fine-grained（细粒度）Personal Access Token 时：

1. Repository access 只选择这个博客仓库。
2. Repository permissions 只把 **Contents** 设为 **Read and write（读写）**；其余保持 No access。
3. 设置合理的过期时间，并在到期前轮换。

这个 PAT 只保存在飞书自动化的安全凭据中，不要写进表格字段、文档正文、仓库文件或 GitHub Actions secrets。

### 配置自动化 HTTP 请求

在多维表格里创建自动化：当 `状态` 字段发生变化时，发送下面的请求。这样切换为「已发布」会立即上线，改回「草稿」或「已下线」也会立即撤下；30 分钟定时任务只作为漏触发时的兜底。

```http
POST https://api.github.com/repos/XMo2004/XMo2004.github.io/dispatches
Accept: application/vnd.github+json
Authorization: Bearer <fine-grained-pat>
X-GitHub-Api-Version: 2026-03-10
Content-Type: application/json

{"event_type":"feishu_publish"}
```

把 Authorization 值放在飞书的安全配置中。GitHub 正常接收时返回 HTTP 204。`repository_dispatch` 只会使用默认分支上已经存在的 workflow 文件。

同步结束后，workflow 只会暂存并提交以下路径：

```text
src/content/posts/feishu
public/media/feishu
.feishu-manifest.json
```

其他工作区文件不会进入自动提交。如果内容没有变化，workflow 不创建空提交。

GitHub 不会让 `GITHUB_TOKEN` 推送的提交再次触发普通 `push` workflow。因此同步 workflow 会在确认内容变更、验证站点并推送 `main` 后，直接构建和发布 Pages，不依赖第二次 API 通知；任一步失败都会留在同一次 Actions 运行中，便于重新执行。没有内容变化时不会重复部署。

## 5. 本地运行

推荐使用 Node.js 24。首次安装依赖：

```sh
npm ci
```

在当前终端设置四个环境变量。下面都是占位符，不要照抄为真实值：

```sh
export FEISHU_APP_ID='<app-id>'
export FEISHU_APP_SECRET='<app-secret>'
export FEISHU_BITABLE_APP_TOKEN='<bitable-app-token>'
export FEISHU_BITABLE_TABLE_ID='<table-id>'
```

运行同步并检查站点：

```sh
npm run sync:feishu
npm run verify
git diff -- src/content/posts/feishu public/media/feishu .feishu-manifest.json
```

同步会直接更新生成目录。确认 diff 后再提交；不要手工修改 `src/content/posts/feishu`、`public/media/feishu` 或 manifest，因为下一次同步会覆盖这些改动。

## 6. 排障

### 提示缺少环境变量

检查四个变量是否都存在。GitHub 上要检查 Repository secrets 的名称，名称区分大小写；本地可以用 `printenv FEISHU_APP_ID` 等命令确认变量已进入当前 shell，但不要打印 secret 的值到共享日志。

### 文档返回 403 或错误码 1770032

应用没有文档资源权限。确认开放平台权限已经发布，再回到文档共享设置，通过「添加文档应用」把目标文档授权给应用。每篇文章都要可读。

### 多维表格返回空记录

依次检查 app token、table ID、字段名和 `状态` 值。若表格启用了高级权限，确认应用能够读取九个字段。筛选条件只匹配完全等于「已发布」的记录。

### Slug、日期或字段格式报错

错误信息会带 record ID 和字段名。`Slug` 只能使用小写字母、数字与连字符；发布日期必须是有效日期；状态只能是三个约定选项。字段名称前后的空格也会造成读取失败。

### 素材下载失败

403 通常是应用没有文档或素材下载权限，404 表示附件 token 已失效或素材已删除。重新共享原文档并确认「下载云文档中的图片和附件」权限已经生效。封面字段只保留一个有效附件。

### 出现 99991400、1254290 或网络错误

这些错误通常表示限流或短暂服务异常。同步客户端会指数退避后重试；仍失败时，等待一段时间再手动运行 workflow。不要通过缩短 cron 间隔来规避失败。

### 飞书自动化收到 401 或 404

401 多半是 PAT 无效或过期。404 常见原因是仓库坐标错误、PAT 没有该仓库的访问权，或 `repository_dispatch` workflow 尚未进入默认分支。事件类型必须写成 `feishu_publish`。

### Actions 能同步但不能推送

检查 workflow 的 `contents: write`、仓库的 Workflow permissions 和默认分支保护规则。日志中的提交步骤只应看到三个生成路径；如果出现其他路径，先停止 workflow 并检查配置。

### Actions 失败或线上内容异常

先打开仓库的 **Actions** 页面，进入最新的 **Sync Feishu content** 或 **Deploy site** 运行，定位第一个失败步骤并阅读日志。修正权限、字段或临时网络问题后，使用 **Re-run failed jobs（重新运行失败的任务）**；同步是幂等的，成功步骤可以安全重跑。

如果错误内容已经进入 `main`，在本地拉取最新分支，找到对应的 `content: sync Feishu posts` 提交并创建反向提交：

```sh
git switch main
git pull --ff-only
git revert <bad-sync-commit>
git push origin main
```

不要用强制推送或 `reset --hard` 覆盖远端历史。反向提交会触发普通部署，恢复上一版线上内容；修好飞书记录后，再手动运行一次 **Sync Feishu content**。

## 7. 凭据处理

- 不在 issue、截图或构建日志中粘贴 App Secret、PAT 或 tenant access token。
- 轮换 App Secret：先在飞书开放平台生成或重置 App Secret，立即更新 GitHub 的 `FEISHU_APP_SECRET`，手动运行同步验证成功后，再确认旧值已经失效。
- 轮换 PAT：先创建同仓库、同到期策略且仅有 Contents 读写权限的新 fine-grained PAT，更新飞书自动化的 Authorization，确认测试请求返回 204 后，再撤销旧 PAT。
- 怀疑泄露时，不等待常规轮换，立即撤销相应旧凭据并更新保存位置。
- 定期清理不再使用的应用版本和 PAT。权限够用即可，不要为了排障长期保留更大的授权范围。
