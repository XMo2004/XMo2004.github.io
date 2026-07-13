# 小陌博客：文章社交分享卡片与结构化数据设计

日期：2026-07-14
状态：已确认，待实施计划

## 1. 背景

博客当前所有页面都输出 canonical、基础 Open Graph 和基础 Twitter 元数据；四篇文章还输出 `BlogPosting` JSON-LD。现有文章元数据已经包含标题、摘要、发布日期、可选更新时间、分类、专栏和标签，足以生成文章级分享预览。

当前缺口是：

- 没有任何页面输出 `og:image` 或 `twitter:image`。
- `twitter:card` 固定为文字型 `summary`。
- 文章声明了 `og:type=article`，却没有发布时间、更新时间、分类和标签等 `article:*` 属性。
- `BlogPosting` 没有图片、实体 URL、发布者、关键词、语言和预计阅读时间。
- 社交标题与 HTML `<title>` 共用带站名后缀的字符串；同时已有 `og:site_name`，长文章标题会因此更早被截断。
- 当前 `dateModified` 在没有可信更新时间时回退到发布日期；文章日后改稿时可能形成失真的更新时间。

本项目在静态构建期间为每篇文章生成一张确定的 `1200 × 630` PNG，并让文章的 Open Graph、Twitter 与 JSON-LD 共享同一张绝对 URL 图片。页面仍由 GitHub Pages 静态托管，不增加运行时服务。

## 2. 目标

- 每篇文章都有可被主流分享抓取器读取的 `1200 × 630` PNG。
- 分享图延续博客的纸张、宋体、砖红和苔绿色气质，形成稳定的 `XMO / NOTES` 视觉身份。
- 无论文章是否有封面，都能生成完整、清晰、风格一致的卡片。
- 标题、分类、专栏和日期只取自真实内容数据；长标题安全换行，最多三行。
- 构建不联网、不读取系统字体，在 macOS 本地和 GitHub Actions Ubuntu 环境使用同一字体和同一渲染链路。
- 图片 URL 随实际视觉输入变化，避免社交平台长期复用旧卡片。
- 补齐文章 Open Graph 属性，并扩充现有 `BlogPosting`，但不虚构作者主页、社交账号、更新时间或组织 Logo。
- 保持当前纯静态部署、飞书同步事务、内容 manifest 和回滚边界不变。

## 3. 非目标

- 不为首页、归档、分类、专栏、标签、关于页或 404 页生成默认分享图；本轮只处理文章。
- 不把文章封面拼入分享卡片。文章封面仍用于站内卡片，分享图使用统一编辑部版式。
- 不新增飞书多维表格字段，不修改飞书同步记录格式或 `.feishu-manifest.json`。
- 不凭空添加 Twitter/X handle、作者资料 URL、`sameAs`、组织 Logo 或其他尚不存在的身份数据。
- 不在本轮解决 404 的 `noindex` 策略，也不建立全站 `WebSite` / `Blog` JSON-LD 图谱。
- 不生成动态图片接口，不依赖 CDN 图片转换，不在客户端运行生成脚本。
- 不承诺颜色 emoji 原样渲染；标题的语义文本在 HTML 元数据中保持原值，分享图使用固定字体可表示的字形。

## 4. 方案选择

### 4.1 采用：Satori 排版为 SVG，再由 Sharp 输出 PNG

构建端把纯数据对象交给 Satori。Satori 显式读取仓库内的中文字体字节，完成 Flexbox 布局、换行、三行截断和文字路径嵌入；随后由现有直接依赖 Sharp 把 SVG 转为 `1200 × 630` PNG。

采用原因：

- PNG 对 Open Graph 和 Twitter 抓取器的兼容性高于直接发布 SVG。
- Satori 默认把字体轮廓嵌入 SVG 路径，Sharp 不需要再次寻找系统字体。
- 现有项目已经锁定并在封面管线中验证 `sharp@0.35.3`。
- 不安装或启动 Chromium，不引入截图时序、DPR、抗锯齿和 CI 浏览器缓存差异。
- 简单的编辑部版式适合 Satori 支持的布局子集，不需要完整浏览器 CSS。

`satori` 作为锁定版本的直接生产依赖。固定字体采用 Google Fonts 仓库中的 [`ZCOOLXiaoWei-Regular.ttf`](https://github.com/google/fonts/blob/main/ofl/zcoolxiaowei/ZCOOLXiaoWei-Regular.ttf)，许可证采用同目录的 [`OFL.txt`](https://github.com/google/fonts/blob/main/ofl/zcoolxiaowei/OFL.txt)；两者放在 `src/assets/fonts/`，仅用于构建。实现时记录字体文件 SHA-256，哈希也进入图片版本输入。不得使用 Satori 不支持的 WOFF2，也不得在构建时下载 Google Fonts。

### 4.2 不采用：直接发布 SVG

SVG 体积更小、实现步骤更少，但分享平台对 SVG 预览的支持不一致。它也更容易因为外部字体或 `<foreignObject>` 支持差异出现空白字形。本项目需要一张跨平台抓取器可直接使用的图片，因此不采用。

### 4.3 不采用：浏览器截图

浏览器截图能最接近网页 CSS，但必须安装并启动 Chromium。项目的完整验证会执行临时构建和正式构建，截图开销会被重复放大；结果还可能随浏览器、Skia、DPR 和字体加载时序变化。对于一张固定比例、布局简单的卡片，不值得引入这层成本。

### 4.4 不采用：仅缩放文章封面

当前四篇文章只有一篇带封面，无封面是合法且常见的内容状态。直接缩放封面既无法覆盖全部文章，也不能建立稳定的博客视觉身份。

## 5. 视觉设计

### 5.1 画布与配色

- 固定尺寸：`1200 × 630`。
- 固定浅色主题，不跟随访问者深色模式。
- 主背景：纸张色 `#f4efe4`。
- 右侧抬升面板：`#fbf8f1`。
- 主文字：墨色 `#1d211d`。
- 次文字：灰绿 `#646960`。
- 强调：砖红 `#9f422e`。
- 镂空标识：苔绿 `#566444`。
- 画布完全不透明，输出不保留 alpha。

### 5.2 布局

卡片分为约 `71% / 29%` 两栏：

- 左栏承担文章信息，四周保留至少 `80px` 安全边距。
- 左上显示 `SITE.mark`，即 `XMO / NOTES`。
- 标题位于视觉中心，使用固定中文衬线字体，最多三行。
- 左下显示分类、可选专栏和发布日期；分类使用砖红色，其余为次文字色。
- 右栏使用浅色抬升面板、细分隔线、非常浅的对角线纹理和纵向镂空 `XMO` 标识。
- 右上显示文章年份，右下显示 `LONG-TERM NOTES`。

不显示摘要、标签列表、阅读时间或文章封面，避免缩小后的分享预览信息过密。标签仍进入 HTML 和 JSON-LD。

### 5.3 标题规则

- 社交卡片使用文章原始标题，不附加 `| 小陌的博客`。
- Satori 以 `lang="zh-CN"` 排版，允许中文逐字换行和中英混排自然换行。
- 标题最多三行，超出时使用省略号。
- 字号按标题字素数量分三档，短标题更大、长标题更小；最终是否换行由真实字体度量决定，而不是按字符数硬切行。
- HTML `<title>` 继续保留站名后缀；`og:title` 和 `twitter:title` 改用原始页面标题。`og:site_name` 继续承担站名信息。
- 控制字符归一为空格，连续空白折叠。标题原值仍用于页面正文和机器可读元数据，视觉归一只影响图片排版。

如果标题包含固定字体不支持的颜色 emoji 或罕见字形，渲染层不得联网补字体。实现应在构建阶段给出明确的文章 slug 与缺失字形错误，阻止残缺图片上线；后续可单独设计本地 emoji 兜底。

### 5.4 图片替代文本

每张图片的社交替代文本由可验证字段生成：

```text
“<文章标题>”文章分享卡片，来自 XMO / NOTES
```

该字符串用于 `og:image:alt` 和 `twitter:image:alt`，不依赖封面 alt，也不写入站内可见 `<img>`。

## 6. 数据模型与公共接口

新增纯数据模型，避免布局组件各自重新拼接字段：

```ts
interface SocialCardInput {
  slug: string;
  title: string;
  pubDate: Date;
  category: string;
  column?: string;
  siteMark: string;
}

interface SocialImageMetadata {
  path: string;
  width: 1200;
  height: 630;
  mimeType: 'image/png';
  alt: string;
}

interface ArticleOpenGraphMetadata {
  publishedTime: string;
  modifiedTime?: string;
  section: string;
  tags: readonly string[];
}
```

`src/lib/social-card.ts` 负责：

- 规范化真实视觉输入。
- 计算内容哈希和公开路径。
- 构建 Satori 节点树。
- 读取并校验固定字体。
- 生成 SVG 与 PNG。
- 返回可供布局和 endpoint 共用的 `SocialImageMetadata`。

布局和图片 endpoint 必须调用同一个路径 helper，不能各自复制哈希规则。

## 7. 路径、哈希与缓存失效

公开路径格式：

```text
/social/posts/<slug>-<16位十六进制摘要>.png
```

摘要使用 SHA-256 的前 16 位十六进制字符。哈希输入至少包含：

- 显式模板版本。
- `1200 × 630` 尺寸与全部视觉常量。
- `SITE.mark`。
- 规范化后的标题、发布日期、分类和可选专栏。
- 字体文件 SHA-256。
- `package.json` 中锁定的 Satori 与 Sharp 版本。

未进入视觉的摘要、标签和更新时间不应改变图片 URL。进入视觉的任一字段、模板或字体发生变化时，路径必须变化。slug 已由内容 schema 校验为安全 ASCII；摘要只含小写十六进制，不允许用户数据直接控制目录结构。

内容哈希解决社交平台长期缓存旧 URL 的问题。GitHub Pages 的响应缓存策略由平台控制，本项目不宣称自定义静态响应头生效。

## 8. 静态生成流程

新增 `src/pages/social/posts/[asset].png.ts` 静态二进制 endpoint：

1. `getStaticPaths()` 读取真实 `posts` 内容集合。
2. 对每篇文章构造 `SocialCardInput` 和统一的 `SocialImageMetadata`。
3. `params.asset` 使用 `<slug>-<摘要>`，`props` 只包含已规范化的渲染模型。
4. `GET` 使用 Satori 输出嵌入字体路径的 SVG。
5. Sharp 把 SVG 光栅化为无 alpha 的 `1200 × 630` 调色板 PNG。
6. endpoint 返回 `image/png`；Astro 静态构建把它写进 `dist/social/posts/`。

PNG 编码使用固定参数，优先选择高压缩、256 色调色板和无 alpha。单张图片上限为 `350 KiB`；超过上限即构建失败，不静默降低尺寸或丢字。

图片只存在于 `dist/`：

- 不写入 `public/media/feishu`。
- 不加入 `.feishu-manifest.json`。
- 不作为生成内容提交到 Git。
- 每次构建从当前文章集合重新生成，因此不会在 Pages 产物中保留旧哈希孤儿文件。

当前两条 workflow 都上传 `dist/`。普通部署和飞书同步部署无需新增步骤；飞书文章在同步后执行现有完整构建时自动获得分享图。

## 9. BaseLayout 元数据契约

`BaseLayout` 增加可选 `socialImage` 与 `articleMetadata`，保持普通页面兼容：

所有页面的 HTML `<title>` 继续使用带站名后缀的 `documentTitle`；`og:title` 与 `twitter:title` 改用调用方传入的原始 `title`。站名继续由 `og:site_name` 单独表达。这项解耦不依赖页面是否有社交图片。

### 9.1 有社交图片时

输出：

- `og:image`，值为基于 `SITE.canonicalOrigin` 的 HTTPS 绝对 URL。
- `og:image:secure_url`。
- `og:image:type=image/png`。
- `og:image:width=1200`。
- `og:image:height=630`。
- `og:image:alt`。
- `twitter:card=summary_large_image`。
- `twitter:image`。
- `twitter:image:alt`。

### 9.2 没有社交图片时

普通页面继续：

- 不输出空的图片字段。
- 使用 `twitter:card=summary`。
- 不输出任何 `article:*` 字段。

这样不会为非文章页面伪造默认图片，也给后续全站默认图保留相同接口。

### 9.3 文章 Open Graph

文章额外输出：

- `article:published_time`。
- 仅在内容存在真实 `updatedDate` 时输出 `article:modified_time`。
- `article:section`。
- 每个标签一个 `article:tag`。

不输出 `article:author`，因为该属性需要真实作者资料 URL，而当前配置只有作者姓名。

## 10. BlogPosting JSON-LD

保持单个、可安全序列化的 `BlogPosting` 对象，不在本轮升级为全站 `@graph`。字段为：

- `@context: https://schema.org`。
- `@type: BlogPosting`。
- `@id: <canonical>#article`。
- `url: <canonical>`。
- `headline`。
- `description`。
- `image: ImageObject`，包含绝对 `url`、`width=1200`、`height=630`。
- `articleSection`。
- 非空标签数组对应 `keywords`。
- `datePublished`。
- 仅在真实 `updatedDate` 存在时输出 `dateModified`。
- `author: Person`，只包含真实 `SITE.author` 名称。
- `publisher: Person`，只包含真实 `SITE.author` 名称。
- `mainEntityOfPage: WebPage` 与 canonical `@id`。
- `inLanguage: zh-CN`。
- `isAccessibleForFree: true`。
- 有阅读分钟数时输出 ISO 8601 `timeRequired`，例如 `PT4M`。
- 有专栏时继续输出 `isPartOf: CollectionPage` 及真实专栏 URL。

不再用发布日期无条件填充 `dateModified`。这比字段数量更多但值可能失真更重要。未来若飞书发布清单增加可信更新时间，可直接复用现有可选 `updatedDate`，无需再次修改布局契约。

所有 JSON-LD 继续通过现有安全序列化器输出，防止 `</script>` 或 Unicode 行分隔符破坏脚本边界。

## 11. 失败、安全与隐私边界

- 卡片节点使用纯对象构造，不把文章字段作为 HTML 或 SVG 字符串插入，也不使用 `dangerouslySetInnerHTML`。
- 构建期间不发起字体、图片、emoji 或其他网络请求。
- 分享图不读取飞书 token、记录 ID、文档 ID、附件 URL 或 `sourceUrl`。
- 缺失字体、缺失字形、Satori 布局失败、Sharp 编码失败、尺寸错误或体积超限都会让完整站点构建失败。
- 失败消息只包含公开文章 slug、失败阶段和安全规则，不输出正文或内部飞书标识。
- GitHub Actions 只有在 `npm run verify` 成功后部署，因此失败时线上继续提供上一版 Pages。

## 12. 测试策略

### 12.1 纯逻辑与渲染测试

新增专门测试覆盖：

- 同一规范化输入得到相同公开路径和相同 PNG 字节。
- 标题、日期、分类、专栏、模板版本或字体摘要变化时路径变化。
- Satori 或 Sharp 锁定版本变化时路径变化。
- 摘要、标签或更新时间变化时图片路径不变，因为它们不进入视觉。
- 标题中的连续空白和控制字符被安全规范化。
- 长中文标题、中英混排、特殊标点和可疑标签文本不会越界或注入节点结构。
- 缺失字形产生明确失败，不生成豆腐字卡片。
- 输出格式是 PNG，尺寸严格为 `1200 × 630`，无 alpha，单图不超过 `350 KiB`。
- 渲染函数不访问网络。

### 12.2 源码契约测试

更新现有“不得出现社交图片”测试为条件契约：

- `BaseLayout` 只在传入图片时输出完整 OG/Twitter 图片字段。
- 有图时 Twitter 卡片为 `summary_large_image`；无图时仍为 `summary`。
- HTML 标题保留站名后缀，社交标题不重复站名。
- 文章传入社交图片和文章元数据；普通页面不传。
- 不出现虚构 `twitter:site`、`twitter:creator` 或 `article:author`。

### 12.3 构建产物测试

临时干净构建应断言：

- 每篇文章正好对应一个 `dist/social/posts/*.png`。
- 每个文章 HTML 的 `og:image` 和 `twitter:image` 是同一个绝对 HTTPS URL。
- URL 对应的 PNG 文件真实存在，尺寸、类型和体积符合门禁。
- `og:image:alt` 与 `twitter:image:alt` 非空且一致。
- 文章输出发布时间、分类和逐个标签；仅带 `updatedDate` 的夹具输出修改时间。
- 普通页面不输出文章属性或空图片字段。
- `BlogPosting.image.url` 与 `og:image` 一致，并包含新增真实字段。
- `canonical`、`og:url`、JSON-LD `url` 和 `mainEntityOfPage.@id` 完全一致。
- 现有 JSON-LD 注入安全、分类/专栏链接、搜索索引和文章正文测试继续通过。

### 12.4 验证与线上验收

- 运行聚焦测试、`astro check` 和完整 `npm run verify`。
- 在本地生产构建中抽查短标题、当前长标题和无专栏夹具的真实 PNG。
- 部署后读取至少一篇线上文章的 `<head>`，确认绝对图片 URL 与所有 Article 元数据。
- 直接请求线上 PNG，确认 HTTP 200、`image/png`、`1200 × 630` 且图像可解码。
- 在主流链接预览调试器可用时做一次非阻塞人工复核；外部平台缓存不作为部署成功的唯一判断。

## 13. 实施与提交边界

建议拆分为三个可独立验证的提交：

1. `feat: generate article social cards`
   固定字体与许可证、Satori 直接依赖、纯生成模块、静态 endpoint 和渲染测试。

2. `feat: publish social image metadata`
   `BaseLayout` / `PostLayout` / 文章路由接线，Open Graph、Twitter、扩充后的 `BlogPosting` 与构建产物测试。

3. `docs: document article sharing metadata`
   更新维护说明，记录构建失败、字体许可、卡片体积门禁和线上验证方式。

不把自动生成 PNG 提交到仓库，不修改飞书生成目录、manifest 或 workflow。

## 14. 发布与回滚

### 发布

1. 在独立功能分支实现并通过聚焦测试。
2. 完整运行 `npm run verify`，记录文章数、生成图片数、总体积与最大单图体积。
3. 合入 `main`，让现有普通部署 workflow 构建并发布。
4. 验证线上文章 head 与 PNG。
5. 手动触发一次飞书同步；即使内容无变化，它仍会验证新构建。若未来有新文章，现有流程会自动为它生成图片。

### 回滚

如果图片或元数据出现问题，反向提交功能代码并重新部署：

- 文章恢复为文字型社交元数据。
- 下一次干净构建不再输出旧哈希 PNG，Pages 产物自动移除它们。
- 内容、飞书生成树、封面 WebP 和 manifest 无需回滚。
- 旧图片 URL 即使被外部平台短期缓存，也不会影响博客页面和新部署。

## 15. 验收标准

- 当前每篇文章都有一张可访问、可解码、无 alpha 的 `1200 × 630` PNG。
- 卡片在短标题、长中文标题和中英混排下无裁切、溢出或缺字，最多三行。
- 所有图片采用已确认的编辑部版式，不依赖文章封面，视觉与博客一致。
- 单图不超过 `350 KiB`，构建不联网、不依赖系统字体。
- 文章 head 输出完整图片字段、`summary_large_image` 与真实 `article:*` 属性。
- `BlogPosting` 的图片、URL、分类、标签、语言、发布者和阅读时间与页面真实数据一致。
- 不存在虚构作者 URL、社交账号、组织 Logo或更新时间。
- 图片 URL在视觉输入变化时自动改变，同一输入保持稳定。
- 飞书同步、普通部署、完整测试与 GitHub Pages 静态托管边界保持不变。
- 功能失败会阻止新部署，线上上一版继续可用；回滚无需改动文章内容或飞书数据。
