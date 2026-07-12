# 小陌的博客

一个用 Astro 生成的中文静态博客，记录技术、成长与日常。文章可以直接写成 Markdown，也可以先在飞书写作，再由 GitHub Actions 同步到仓库。

## 本地开发

推荐 Node.js 24 和项目锁定的 npm 版本。

```sh
npm ci
npm run dev
```

提交前运行完整检查：

```sh
npm run verify
```

这个命令依次运行测试、Astro 类型检查和静态构建。生成结果位于 `dist/`。

## 内容目录

- `src/content/posts/manual/`：手写并由 Git 直接维护的文章。
- `src/content/posts/feishu/`：飞书同步生成的文章，不要手工编辑。
- `public/media/feishu/`：飞书文档素材的本地归档，不要手工编辑。
- `.feishu-manifest.json`：同步状态清单，由同步程序维护。

飞书同步需要四个环境变量。配置完成后可以在本地运行：

```sh
npm run sync:feishu
```

应用权限、多维表格九字段、GitHub secrets 和发布自动化的完整步骤见 [飞书发布配置](docs/FEISHU_SETUP.md)。

## 自动化

`deploy.yml` 在 `main` 更新后使用 Node.js 24 执行 `npm ci` 和 `npm run verify`，通过后部署 GitHub Pages。

`sync-feishu.yml` 每 30 分钟检查一次飞书，也支持通过 `workflow_dispatch` 手动运行或由飞书自动化触发。它只提交飞书生成的文章、素材与 manifest；内容确实变化并通过验证后，同一 workflow 会把提交推送到 `main` 并直接部署 Pages。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动本地开发服务器 |
| `npm run test` | 运行 Node 测试 |
| `npm run check` | 运行 Astro 类型检查 |
| `npm run build` | 生成静态站点 |
| `npm run verify` | 依次执行测试、检查和构建 |
| `npm run sync:feishu` | 从飞书同步已发布文章 |

不要在仓库中保存 App Secret、GitHub PAT 或 access token。若凭据曾进入提交历史，应先撤销并轮换，再清理历史记录。
