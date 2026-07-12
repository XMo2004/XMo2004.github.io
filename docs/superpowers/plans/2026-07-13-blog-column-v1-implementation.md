# Blog Column V1 Content Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a complete four-article “博客搭建手记” column from Feishu, keep the existing public URL stable, leave only one featured article, and verify the content, synchronization, deployment and rollback paths end to end.

**Architecture:** Feishu documents remain the source for the three practical articles and the existing Base remains the release ledger. All replacement and new documents are completed and read back before publication; the two new Base rows stay in draft, while article 02 is prepared as a separate replacement document so the current source remains available for rollback. A short release window changes the article 02 document link and batch-publishes articles 03–04, after which the existing idempotent sync generates Markdown, verifies the Astro site, commits generated content and deploys GitHub Pages.

**Tech Stack:** Feishu Docx and Base through `lark-cli`, Astro 7 static output, Markdown, Node 22+ test runner, YAML, Git/GitHub CLI, GitHub Actions and GitHub Pages.

---

## Scope and release invariants

This plan creates no new Base fields, content-schema fields, workflow triggers, server components or visual redesigns.

Public column after release:

| Order | Slug | Title | Source | Featured |
| --- | --- | --- | --- | --- |
| 1 | `welcome` | 欢迎来到小陌的博客 | Manual Markdown | No |
| 2 | `published-from-feishu` | 从飞书到博客：一条可回滚的静态发布链路 | Feishu replacement document | Yes |
| 3 | `feishu-sync-safety` | 飞书同步失败时，怎样保证博客不发布半成品 | New Feishu document | No |
| 4 | `github-pages-maintenance` | GitHub Pages 上线后的部署、维护与恢复清单 | New Feishu document | No |

The following rules are hard gates:

- Never manually edit `src/content/posts/feishu/`, `public/media/feishu/` or `.feishu-manifest.json`.
- Never put Base tokens, document tokens, record IDs, file tokens, local paths or private Feishu URLs in an article, Git commit or public build output.
- Preserve the article 02 slug, publication date and existing Base attachment field. The release update deliberately omits `封面`, so the existing cover cannot be cleared by the metadata update.
- Keep articles 03–04 in `草稿` until all three documents, the one-featured code change and the pre-release deployment have passed.
- Do not overwrite or delete the currently linked article 02 document. Create a replacement and retain the old document as rollback material.
- Persist the rollback state outside the repository in a mode-`0600` JSON package; never rely on an hours-long shell session as the only copy.
- Immediately before release, require the current Base row to equal the snapshot and the three reviewed document revision/hash pairs to remain unchanged.
- If any final Base write or read-back check fails, restore article 02 from the in-memory snapshot, return articles 03–04 to `草稿`, dispatch synchronization, verify the rollback and stop.
- Preserve the unrelated untracked `.playwright-cli/` directory in the main worktree.

## File responsibility map

Create during implementation:

- `tests/content-metadata.test.mjs` — repository-level invariant that exactly one source article is featured and its slug is `published-from-feishu`.
- `.release/blog-column-v1/02-publishing-chain.md` — temporary, untracked body for article 02.
- `.release/blog-column-v1/03-sync-safety.md` — temporary, untracked body for article 03.
- `.release/blog-column-v1/04-pages-maintenance.md` — temporary, untracked body for article 04.
- `.release/blog-column-v1/validate-drafts.mjs` — temporary, untracked content gate; delete together with the drafts after successful release.

Modify and commit:

- `src/content/posts/manual/welcome.md` — change only `featured: true` to `featured: false`.

External writes during implementation:

- Create three Feishu documents: one replacement source for article 02 and new sources for articles 03–04.
- Create two Base records for articles 03–04 as `草稿`.
- At release, update the existing article 02 Base record to point at the replacement document and batch-update articles 03–04 to `已发布`.

Generated changes expected from the existing sync workflow:

- `src/content/posts/feishu/published-from-feishu.md`
- `src/content/posts/feishu/feishu-sync-safety.md`
- `src/content/posts/feishu/github-pages-maintenance.md`
- `.feishu-manifest.json`
- No new media for articles 03–04; article 02 continues to use its existing cover.

### Task 1: Create an isolated release worktree and capture a clean baseline

**Files:**

- Read: `docs/superpowers/specs/2026-07-13-blog-column-v1-design.md`
- Read: `docs/FEISHU_SETUP.md`
- Read: `.github/workflows/sync-feishu.yml`
- Read: `.github/workflows/deploy.yml`
- Read: `scripts/feishu/records.mjs`
- Read: `scripts/feishu/sync.mjs`
- Read: `tests/feishu-sync.test.mjs`

- [ ] **Step 1: Load the required implementation skills**

Read and follow `using-git-worktrees` before creating the worktree. Use `subagent-driven-development` for task execution and `humanizer-zh` for the final Chinese prose pass. Before claiming completion, use `verification-before-completion`.

Before any Feishu command, read the version-matched embedded CLI guidance:

```bash
lark-cli skills read lark-shared
lark-cli skills read lark-doc
lark-cli skills read lark-doc references/lark-doc-fetch.md
lark-cli skills read lark-doc references/lark-doc-create.md
lark-cli skills read lark-doc references/lark-doc-md.md
lark-cli skills read lark-doc references/style/lark-doc-style.md
lark-cli skills read lark-doc references/style/lark-doc-create-workflow.md
lark-cli skills read lark-drive
lark-cli skills read lark-drive references/lark-drive-search.md
lark-cli skills read lark-base
lark-cli skills read lark-base references/lark-base-cell-value.md
lark-cli skills read lark-base references/lark-base-record-upsert.md
lark-cli skills read lark-base references/lark-base-record-batch-create.md
lark-cli skills read lark-base references/lark-base-record-batch-update.md
```

Expected: every resource reaches EOF and no operation is performed yet.

- [ ] **Step 2: Confirm the main worktree has only the known local state**

Run in `/Users/xmo/Documents/Blog`:

```bash
git status --short --branch
git fetch origin
```

Expected: `main` may be ahead of `origin/main` by the approved design and implementation-plan commits; the only unrelated untracked path is `.playwright-cli/`. Stop if there are any other changes.

- [ ] **Step 3: Create the isolated worktree from the current local main**

Run:

```bash
git worktree add .worktrees/blog-column-v1 -b feat/blog-column-v1 main
cd .worktrees/blog-column-v1
npm ci
PATH="/opt/homebrew/bin:$PATH" npm run verify
```

Expected: the existing 210 tests pass, Astro reports zero diagnostics and 16 pages build. If the exact test count has legitimately changed on `main`, record the new baseline but require all tests to pass.

- [ ] **Step 4: Confirm GitHub and Feishu identities without printing credentials**

Run:

```bash
gh auth status
lark-cli auth status
```

Expected: GitHub can read and dispatch workflows; Feishu user identity is ready. Do not copy auth output into repository files or articles.

- [ ] **Step 5: Create a private release-state directory**

Run:

```bash
umask 077
RELEASE_STATE_DIR="${TMPDIR:-/tmp}/xmo-blog-column-v1"
test ! -e "$RELEASE_STATE_DIR" || { echo 'Existing release state requires explicit resume or cleanup.' >&2; exit 1; }
mkdir -m 700 "$RELEASE_STATE_DIR"
ROLLBACK_FILE="$RELEASE_STATE_DIR/rollback.json"
```

Expected: the directory is outside the repository and readable only by the current user. It may contain opaque Feishu identifiers and document URLs, but never credentials.

- [ ] **Step 6: Resolve the real Base and validate the exact schema**

Keep the resolved values only in the active private shell session:

```bash
BASE_TOKEN="$(lark-cli base +title-resolve --as user --title '博客发布中心' --json | jq -er '.data.base_token')"
TABLE_ID="$(lark-cli base +table-list --as user --base-token "$BASE_TOKEN" --json | jq -er '.data.tables[] | select(.name == "博客文章") | .id')"
lark-cli base +field-list --as user --base-token "$BASE_TOKEN" --table-id "$TABLE_ID" --json |
  jq -e '
    (.data.fields | map({key:.name,value:{type,multiple:(.multiple // false),style_type:(.style.type // null)}}) | from_entries) as $f |
    ($f | keys | sort) == (["标题","文档链接","Slug","摘要","标签","分类","专栏","专栏序号","发布日期","状态","精选","封面"] | sort)
    and $f["标题"].type == "text"
    and $f["文档链接"] == {type:"text",multiple:false,style_type:"url"}
    and $f["Slug"].type == "text"
    and $f["摘要"].type == "text"
    and $f["标签"] == {type:"select",multiple:true,style_type:null}
    and $f["分类"] == {type:"select",multiple:false,style_type:null}
    and $f["专栏"] == {type:"select",multiple:false,style_type:null}
    and $f["专栏序号"].type == "number"
    and $f["发布日期"].type == "datetime"
    and $f["状态"] == {type:"select",multiple:false,style_type:null}
    and $f["精选"].type == "checkbox"
    and $f["封面"].type == "attachment"'
```

Expected: the final command prints `true`. Stop on multiple Base matches, a missing table or any schema mismatch; do not guess IDs or field names.

- [ ] **Step 7: Resolve the authorized publishing folder**

Resolve the one existing Drive folder titled `博客发布中心`:

```bash
PUBLISH_FOLDER_RESPONSE="$(lark-cli drive +search --as user --query '博客发布中心' --only-title \
  --doc-types folder --page-size 20 --json)"
PUBLISH_FOLDER_TOKEN="$(printf '%s' "$PUBLISH_FOLDER_RESPONSE" | jq -er '
  [.data.results[] | select(.result_meta.doc_types == "folder")] |
  if length == 1 then .[0].result_meta.token else error("publishing folder must resolve exactly once") end')"
```

Expected: the folder resolves exactly once. Stop on ambiguity; do not create documents in an unverified folder.

### Task 2: Snapshot the published record and write three repository-grounded drafts

**Files:**

- Read: `src/content/posts/feishu/published-from-feishu.md`
- Read: `.feishu-manifest.json`
- Read: `scripts/feishu/client.mjs`
- Read: `scripts/feishu/records.mjs`
- Read: `scripts/feishu/sync.mjs`
- Read: `tests/feishu-sync.test.mjs`
- Read: `.github/workflows/sync-feishu.yml`
- Read: `.github/workflows/deploy.yml`
- Read: `docs/FEISHU_SETUP.md`
- Create untracked: `.release/blog-column-v1/02-publishing-chain.md`
- Create untracked: `.release/blog-column-v1/03-sync-safety.md`
- Create untracked: `.release/blog-column-v1/04-pages-maintenance.md`
- Create untracked: `.release/blog-column-v1/validate-drafts.mjs`

- [ ] **Step 1: Read the article 02 row and build an in-memory rollback snapshot**

Project only the fields required for release and rollback; deliberately exclude the attachment field:

```bash
ARTICLE02_RESPONSE="$(lark-cli base +record-list --as user --base-token "$BASE_TOKEN" --table-id "$TABLE_ID" \
  --field-id 标题 --field-id 文档链接 --field-id Slug --field-id 摘要 --field-id 标签 \
  --field-id 分类 --field-id 专栏 --field-id 专栏序号 --field-id 发布日期 --field-id 状态 --field-id 精选 \
  --filter-json '{"logic":"and","conditions":[["Slug","==","published-from-feishu"]]}' \
  --limit 2 --json)"
ARTICLE02_SNAPSHOT="$(printf '%s' "$ARTICLE02_RESPONSE" | jq -ce '
  .data as $d |
  if (($d.record_id_list | length) != 1 or ($d.data | length) != 1) then
    error("article 02 must resolve to exactly one record")
  else
    (reduce range(0; $d.fields | length) as $i ({}; .[$d.fields[$i]] = $d.data[0][$i]))
    + {record_id: $d.record_id_list[0]}
  end')"
ARTICLE02_RECORD_ID="$(printf '%s' "$ARTICLE02_SNAPSHOT" | jq -er '.record_id')"
ARTICLE02_OLD_DOC_URL="$(printf '%s' "$ARTICLE02_SNAPSHOT" | jq -er '.["文档链接"]')"
jq -n --argjson article02 "$ARTICLE02_SNAPSHOT" '{
  version:1,
  created_at:(now | todateiso8601),
  article02_snapshot:$article02
}' > "$ROLLBACK_FILE"
chmod 600 "$ROLLBACK_FILE"
```

Expected: the snapshot says `Slug=published-from-feishu`, `状态=已发布`, `专栏=博客搭建手记`, `专栏序号=2` and `精选=true`. The rollback file exists outside the repository with mode `0600`; never print or commit it.

- [ ] **Step 2: Read back the old source for factual comparison and rollback evidence**

Run:

```bash
ARTICLE02_OLD_DOC_RESPONSE="$(lark-cli docs +fetch --as user --doc "$ARTICLE02_OLD_DOC_URL" --scope full --detail simple --doc-format markdown --json)"
lark-cli docs +fetch --as bot --doc "$ARTICLE02_OLD_DOC_URL" --scope outline --max-depth 2 --detail simple --doc-format markdown --json
ARTICLE02_OLD_REVISION="$(printf '%s' "$ARTICLE02_OLD_DOC_RESPONSE" | jq -er '.data.document.revision_id')"
ARTICLE02_OLD_HASH="$(printf '%s' "$ARTICLE02_OLD_DOC_RESPONSE" | jq -er '.data.document.content' | shasum -a 256 | awk '{print $1}')"
ROLLBACK_NEXT="$RELEASE_STATE_DIR/rollback.next.json"
jq --argjson revision "$ARTICLE02_OLD_REVISION" --arg hash "$ARTICLE02_OLD_HASH" \
  '.article02_old_document={revision_id:$revision,content_sha256:$hash}' \
  "$ROLLBACK_FILE" > "$ROLLBACK_NEXT" && chmod 600 "$ROLLBACK_NEXT" && mv "$ROLLBACK_NEXT" "$ROLLBACK_FILE"
```

Expected: the current short article is readable as both the user and the GitHub Actions application identity and matches the generated article's subject. Retain its revision/hash in the rollback package. Stop on a bot permission error and do not silently fall back to another folder or identity. Do not alter this document.

- [ ] **Step 3: Write the article 02 replacement body**

Use `apply_patch` to create `.release/blog-column-v1/02-publishing-chain.md`. Do not add an H1 because the Feishu document title is supplied separately. Use these exact H2 headings:

```markdown
## 为什么把飞书当写作桌面
## 从“已发布”到静态页面的数据流
## 发布语义、幂等与稳定 URL
## 我如何验证这条链路
## 可复用的发布清单
```

Ground every technical statement in the current repository:

- Base status `已发布` is the only input selected by `scripts/feishu/client.mjs`.
- `scripts/feishu/records.mjs` validates Slug, date, category, optional column/order pairing, featured state and cover shape.
- `scripts/feishu/sync.mjs` reads a stable document revision, validates the full next set, prepares a temporary tree and replaces generated targets as one state transition.
- `.github/workflows/sync-feishu.yml` verifies before committing generated content and deploys only when generated content changed.
- The public slug remains stable even though the source document link is replaced.

Do not claim mathematical exactly-once delivery; describe repeated dispatches as safe because the generated state and manifest are deterministic and a no-change run does not produce another generated-content commit.

- [ ] **Step 4: Write the article 03 body**

Use `apply_patch` to create `.release/blog-column-v1/03-sync-safety.md` with these exact H2 headings:

```markdown
## 同步链路里最容易被低估的失败
## 为什么必须先校验再替换
## 文档修订号和混合版本问题
## 原子替换、回滚日志与恢复顺序
## 失败时的排查清单
```

Ground the article in the revision retry and rollback tests in `tests/feishu-sync.test.mjs`. Explain that the reader-visible guarantee is “the previous generated site remains intact when validation or replacement fails,” not that every upstream API call is transactional.

- [ ] **Step 5: Write the article 04 body**

Use `apply_patch` to create `.release/blog-column-v1/04-pages-maintenance.md` with these exact H2 headings:

```markdown
## 一次完整部署到底发生了什么
## 上线后应该验证哪些事
## 为什么无内容变更时不重复部署
## 从失败日志到恢复上一版
## 每次发布都可以复用的维护清单
```

Ground the article in both workflow files. Distinguish the normal push deployment from the Feishu synchronization deployment, and state that recovery means fixing the source or metadata and rerunning the verified workflow while the last successful Pages deployment remains available.

- [ ] **Step 6: Add an automated draft gate and confirm the first pass is actionable**

Create `.release/blog-column-v1/validate-drafts.mjs`. It must:

- Import `estimateReadingMinutes` from `src/lib/posts.ts`.
- Require all three files to have at least five non-empty `##` headings and at least 3 estimated reading minutes.
- Reject `用于验证`, `测试文章更新`, `测试文章`, `以后补充`, `TODO`, `TBD`, `record_id`, `document_id`, `file_token`, `recvp`, `/Users/`, `my.feishu.cn`, raw `/docx/` URLs and credential-like `SECRET`, `TOKEN` or `PAT` assignments.
- Require article 02 to mention `已发布`, `Slug`, `GitHub Actions`, `幂等` and `回滚`.
- Require article 03 to mention `修订`, `校验`, `原子`, `上一版`, `失败恢复` and `排查`.
- Require article 04 to mention `GitHub Pages`, `workflow`, `无变更`, `静态部署`, `日志` and `恢复`.
- Print only filenames, heading counts and reading-minute estimates; never print document or Base identifiers.
- Support a later `--generated-root` mode. In that mode parse the four final source files' YAML frontmatter and bodies, then assert exact Slugs, titles, column orders `1–4`, one featured Slug, article 02-only cover presence, all specified H2 headings, at least 3 reading minutes for articles 02–04, and tag coverage of at least two articles each for `飞书发布`, `自动化` and `静态部署`.

Run:

```bash
PATH="/opt/homebrew/bin:$PATH" node --experimental-strip-types .release/blog-column-v1/validate-drafts.mjs
```

Expected: all three drafts pass, each reports at least five H2 headings and at least 3 minutes. If the first run fails, improve the prose or factual completeness rather than weakening the gate.

- [ ] **Step 7: Perform the human Chinese and factual review**

Apply `humanizer-zh` to remove generic framing, slogan-like conclusions, repetitive three-part lists and unsupported certainty. Then inspect every implementation claim next to the cited repository file. Run:

```bash
rg -n "用于验证|测试文章更新|测试文章|以后补充|TODO|TBD|record_id|document_id|file_token|recvp|/Users/|my\.feishu\.cn" .release/blog-column-v1
PATH="/opt/homebrew/bin:$PATH" node --experimental-strip-types .release/blog-column-v1/validate-drafts.mjs
git status --short
```

Expected: `rg` returns no matches; the validator passes; Git shows only the untracked `.release/` directory and no tracked changes.

### Task 3: Create and read back three Feishu documents without changing publication

**Files:**

- Read: `.release/blog-column-v1/02-publishing-chain.md`
- Read: `.release/blog-column-v1/03-sync-safety.md`
- Read: `.release/blog-column-v1/04-pages-maintenance.md`

- [ ] **Step 1: Create the three documents in the authorized publishing folder**

Re-resolve `PUBLISH_FOLDER_TOKEN` with the Task 1 command if the shell session changed. Never guess or persist a folder token in the repository.

Run the three commands serially and capture each JSON response in the active private shell session:

```bash
DOC02_RESPONSE="$(lark-cli docs +create --as user --title '从飞书到博客：一条可回滚的静态发布链路' \
  --doc-format markdown --content @.release/blog-column-v1/02-publishing-chain.md \
  --parent-token "$PUBLISH_FOLDER_TOKEN" --json)"
DOC03_RESPONSE="$(lark-cli docs +create --as user --title '飞书同步失败时，怎样保证博客不发布半成品' \
  --doc-format markdown --content @.release/blog-column-v1/03-sync-safety.md \
  --parent-token "$PUBLISH_FOLDER_TOKEN" --json)"
DOC04_RESPONSE="$(lark-cli docs +create --as user --title 'GitHub Pages 上线后的部署、维护与恢复清单' \
  --doc-format markdown --content @.release/blog-column-v1/04-pages-maintenance.md \
  --parent-token "$PUBLISH_FOLDER_TOKEN" --json)"
```

Extract the document URLs from the documented response path, require all three to be non-empty HTTPS `/docx/` URLs and keep them only in the private shell session:

```bash
DOC02_URL="$(printf '%s' "$DOC02_RESPONSE" | jq -er '.data.document.url')"
DOC03_URL="$(printf '%s' "$DOC03_RESPONSE" | jq -er '.data.document.url')"
DOC04_URL="$(printf '%s' "$DOC04_RESPONSE" | jq -er '.data.document.url')"
```

Expected: three distinct documents exist. Article 02's replacement URL differs from `ARTICLE02_OLD_DOC_URL`.

- [ ] **Step 2: Fetch every created document back as Markdown**

Run:

```bash
DOC02_READBACK_RESPONSE="$(lark-cli docs +fetch --as user --doc "$DOC02_URL" --scope full --detail simple --doc-format markdown --json)"
DOC03_READBACK_RESPONSE="$(lark-cli docs +fetch --as user --doc "$DOC03_URL" --scope full --detail simple --doc-format markdown --json)"
DOC04_READBACK_RESPONSE="$(lark-cli docs +fetch --as user --doc "$DOC04_URL" --scope full --detail simple --doc-format markdown --json)"
DOC02_READBACK="$(printf '%s' "$DOC02_READBACK_RESPONSE" | jq -er '.data.document.content')"
DOC03_READBACK="$(printf '%s' "$DOC03_READBACK_RESPONSE" | jq -er '.data.document.content')"
DOC04_READBACK="$(printf '%s' "$DOC04_READBACK_RESPONSE" | jq -er '.data.document.content')"
```

Expected: titles are exact, all five H2 sections are present in each document, lists and inline code remain readable, and no unsupported fragment or empty heading appears.

Record each document's URL, revision ID and SHA-256 of its returned Markdown in the mode-`0600` rollback package:

```bash
DOC02_REVISION="$(printf '%s' "$DOC02_READBACK_RESPONSE" | jq -er '.data.document.revision_id')"
DOC03_REVISION="$(printf '%s' "$DOC03_READBACK_RESPONSE" | jq -er '.data.document.revision_id')"
DOC04_REVISION="$(printf '%s' "$DOC04_READBACK_RESPONSE" | jq -er '.data.document.revision_id')"
DOC02_HASH="$(printf '%s' "$DOC02_READBACK" | shasum -a 256 | awk '{print $1}')"
DOC03_HASH="$(printf '%s' "$DOC03_READBACK" | shasum -a 256 | awk '{print $1}')"
DOC04_HASH="$(printf '%s' "$DOC04_READBACK" | shasum -a 256 | awk '{print $1}')"
ROLLBACK_NEXT="$RELEASE_STATE_DIR/rollback.next.json"
jq \
  --arg url02 "$DOC02_URL" --argjson rev02 "$DOC02_REVISION" --arg hash02 "$DOC02_HASH" \
  --arg url03 "$DOC03_URL" --argjson rev03 "$DOC03_REVISION" --arg hash03 "$DOC03_HASH" \
  --arg url04 "$DOC04_URL" --argjson rev04 "$DOC04_REVISION" --arg hash04 "$DOC04_HASH" \
  '.reviewed_documents={
    article02:{url:$url02,revision_id:$rev02,content_sha256:$hash02},
    article03:{url:$url03,revision_id:$rev03,content_sha256:$hash03},
    article04:{url:$url04,revision_id:$rev04,content_sha256:$hash04}
  }' "$ROLLBACK_FILE" > "$ROLLBACK_NEXT" &&
  chmod 600 "$ROLLBACK_NEXT" && mv "$ROLLBACK_NEXT" "$ROLLBACK_FILE"
```

The `rollback.next.json` plus `mv` pattern prevents an interrupted write from truncating the only recovery state.

- [ ] **Step 3: Prove the GitHub Actions application identity can read every new source**

Run:

```bash
lark-cli docs +fetch --as bot --doc "$DOC02_URL" --scope full --detail simple --doc-format markdown --json
lark-cli docs +fetch --as bot --doc "$DOC03_URL" --scope full --detail simple --doc-format markdown --json
lark-cli docs +fetch --as bot --doc "$DOC04_URL" --scope full --detail simple --doc-format markdown --json
```

Expected: all three calls succeed and return the same titles and section structure. If any bot read fails, stop before creating Base rows and correct the folder-level application access outside this release transaction; do not publish a user-only document.

- [ ] **Step 4: Compare exported content to the local gate**

Apply the same forbidden-pattern, section and reading-time rules to the Markdown content returned by Feishu. If Feishu conversion changed structure or dropped meaningful content, create corrected replacement documents rather than publishing the defective versions. Do not edit or link any Base record yet.

### Task 4: Create articles 03–04 as draft Base records and verify them

**Files:** none in the repository.

- [ ] **Step 1: Confirm required select options exist**

Use `+field-list` or `+field-search-options` to confirm the existing structural options `技术`, `博客搭建手记`, `草稿` and `已发布`, plus the existing tags `飞书发布` and `自动化`. The release intentionally introduces the tag options `安全`, `GitHub Actions`, `静态部署` and `维护`; allow only those four missing tag options to be created by the draft write. Stop rather than implicitly creating any unexpected category, column, status or tag option.

- [ ] **Step 2: Create both draft records in one batch**

Re-resolve `BASE_TOKEN` and `TABLE_ID` with the Task 1 read-only commands if the shell session changed.

First query `feishu-sync-safety` and `github-pages-maintenance` by Slug and require zero existing records. If either Slug already exists, read and reconcile that row instead of creating a duplicate.

Build the payload from the verified document URLs:

```bash
DRAFT_ROWS_PAYLOAD="$(jq -nc \
  --arg doc03 "$DOC03_URL" \
  --arg doc04 "$DOC04_URL" \
  '{
    fields:["标题","文档链接","Slug","摘要","标签","分类","专栏","专栏序号","发布日期","状态","精选"],
    rows:[
      [
        "飞书同步失败时，怎样保证博客不发布半成品",
        $doc03,
        "feishu-sync-safety",
        "拆解飞书内容同步的失败边界，介绍校验、文档修订检查、原子替换和失败回滚如何保护上一版站点。",
        ["飞书发布","自动化","安全"],
        "技术",
        "博客搭建手记",
        3,
        "2026-07-13 00:00:00",
        "草稿",
        false
      ],
      [
        "GitHub Pages 上线后的部署、维护与恢复清单",
        $doc04,
        "github-pages-maintenance",
        "以真实的 GitHub Actions 和 Pages 部署过程为基础，整理上线验证、无变更同步、失败排查和安全恢复的日常清单。",
        ["GitHub Actions","静态部署","维护"],
        "技术",
        "博客搭建手记",
        4,
        "2026-07-13 00:00:00",
        "草稿",
        false
      ]
    ]
  }')"
DRAFT_CREATE_RESPONSE="$(lark-cli base +record-batch-create --as user --base-token "$BASE_TOKEN" \
  --table-id "$TABLE_ID" --json "$DRAFT_ROWS_PAYLOAD")"
ARTICLE03_RECORD_ID="$(printf '%s' "$DRAFT_CREATE_RESPONSE" | jq -er '.data.record_id_list | if length == 2 then .[0] else error("expected two created records") end')"
ARTICLE04_RECORD_ID="$(printf '%s' "$DRAFT_CREATE_RESPONSE" | jq -er '.data.record_id_list | if length == 2 then .[1] else error("expected two created records") end')"
ROLLBACK_NEXT="$RELEASE_STATE_DIR/rollback.next.json"
jq --arg r3 "$ARTICLE03_RECORD_ID" --arg r4 "$ARTICLE04_RECORD_ID" \
  '.draft_record_ids={article03:$r3,article04:$r4}' \
  "$ROLLBACK_FILE" > "$ROLLBACK_NEXT" && chmod 600 "$ROLLBACK_NEXT" && mv "$ROLLBACK_NEXT" "$ROLLBACK_FILE"
```

Expected: two distinct record IDs are returned. Keep them in the private shell session as `ARTICLE03_RECORD_ID` and `ARTICLE04_RECORD_ID` in row order.

- [ ] **Step 3: Read back the drafts by slug**

Use `+record-list` with a filter matching both new Slugs and project all public metadata fields. Verify:

- Both statuses are `草稿`.
- Titles, summaries, document links, categories, columns, orders, tags and featured values exactly match the table above.
- Both cover cells are empty.
- `published-from-feishu` still points to `ARTICLE02_OLD_DOC_URL` and therefore the public content set has not changed.

The Base automation may dispatch a workflow because a new row's status became `草稿`. If that happens, watch it to completion and require a successful no-change sync; draft records must not enter generated content or alter the live site.

### Task 5: Enforce one featured source article and deploy that invariant first

**Files:**

- Create: `tests/content-metadata.test.mjs`
- Modify: `src/content/posts/manual/welcome.md`

- [ ] **Step 1: Write the failing source-metadata test**

Create `tests/content-metadata.test.mjs` with a small recursive directory walk. Parse each Markdown frontmatter block with `yaml`, collect entries whose `featured` is exactly `true`, and assert:

```js
assert.deepEqual(
  featuredPosts.map(({ slug }) => slug).sort(),
  ['published-from-feishu'],
);
```

Also assert that every parsed post has a non-empty string Slug so a missing Slug cannot make the featured count appear valid accidentally.

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
PATH="/opt/homebrew/bin:$PATH" node --experimental-strip-types --test tests/content-metadata.test.mjs
```

Expected: FAIL because both `welcome` and `published-from-feishu` are currently featured.

- [ ] **Step 3: Change only the welcome article's featured value**

Use `apply_patch` to change:

```yaml
featured: true
```

to:

```yaml
featured: false
```

Do not change the welcome article title, body, tags, category, column, order, date or slug.

- [ ] **Step 4: Verify GREEN and prove the body is unchanged**

Run:

```bash
PATH="/opt/homebrew/bin:$PATH" node --experimental-strip-types --test tests/content-metadata.test.mjs
git diff -- src/content/posts/manual/welcome.md tests/content-metadata.test.mjs
PATH="/opt/homebrew/bin:$PATH" npm run verify
git diff --check
```

Expected: the focused test and all tests pass, Astro reports zero diagnostics, the build still contains 16 pages, and the welcome diff contains only the one frontmatter value.

- [ ] **Step 5: Commit only the permanent repository change**

Run:

```bash
git add tests/content-metadata.test.mjs src/content/posts/manual/welcome.md
git diff --cached --name-only
git commit -m "content: keep one featured blog article"
```

Expected: the staged file list contains exactly the two paths above. The untracked `.release/` drafts are not committed.

- [ ] **Step 6: Integrate into main and deploy before content release**

Use `requesting-code-review`, address any substantive finding, then run in `/Users/xmo/Documents/Blog`:

```bash
git status --short --branch
git merge --ff-only feat/blog-column-v1
PATH="/opt/homebrew/bin:$PATH" npm run verify
git push origin main
```

Find and watch the resulting deployment:

```bash
DEPLOY_RUN_ID="$(gh run list --workflow deploy.yml --branch main --limit 5 \
  --json databaseId,headSha,status,conclusion,createdAt \
  --jq 'map(select(.status != "completed" or .conclusion == null))[0].databaseId // .[0].databaseId')"
gh run watch "$DEPLOY_RUN_ID" --exit-status
```

Expected: the push deployment succeeds before any Base record is published. Confirm the selected run's head SHA equals the pushed main SHA; if it does not, select the exact matching run before watching.

### Task 6: Execute the short Base release transaction

**Files:** none in the repository.

- [ ] **Step 1: Re-run all pre-release gates immediately before the write window**

Reload every release identifier from the mode-`0600` package so this task does not depend on a surviving shell session:

```bash
RELEASE_STATE_DIR="${TMPDIR:-/tmp}/xmo-blog-column-v1"
ROLLBACK_FILE="$RELEASE_STATE_DIR/rollback.json"
test "$(stat -f '%Lp' "$RELEASE_STATE_DIR")" = "700"
test "$(stat -f '%Lp' "$ROLLBACK_FILE")" = "600"
BASE_TOKEN="$(lark-cli base +title-resolve --as user --title '博客发布中心' --json | jq -er '.data.base_token')"
TABLE_ID="$(lark-cli base +table-list --as user --base-token "$BASE_TOKEN" --json | jq -er '.data.tables[] | select(.name == "博客文章") | .id')"
ARTICLE02_SNAPSHOT="$(jq -cer '.article02_snapshot' "$ROLLBACK_FILE")"
ARTICLE02_RECORD_ID="$(jq -er '.article02_snapshot.record_id' "$ROLLBACK_FILE")"
ARTICLE02_OLD_DOC_URL="$(jq -er '.article02_snapshot["文档链接"]' "$ROLLBACK_FILE")"
DOC02_URL="$(jq -er '.reviewed_documents.article02.url' "$ROLLBACK_FILE")"
DOC03_URL="$(jq -er '.reviewed_documents.article03.url' "$ROLLBACK_FILE")"
DOC04_URL="$(jq -er '.reviewed_documents.article04.url' "$ROLLBACK_FILE")"
ARTICLE03_RECORD_ID="$(jq -er '.draft_record_ids.article03' "$ROLLBACK_FILE")"
ARTICLE04_RECORD_ID="$(jq -er '.draft_record_ids.article04' "$ROLLBACK_FILE")"
```

From the isolated worktree, run:

```bash
PATH="/opt/homebrew/bin:$PATH" node --experimental-strip-types .release/blog-column-v1/validate-drafts.mjs
PATH="/opt/homebrew/bin:$PATH" npm run verify
git status --short --branch
```

Read the three replacement/new Feishu documents and all three Base rows again. Also read the still-linked old article 02 document. Require:

- The current projected article 02 row is byte-for-byte equal as JSON to `article02_snapshot` after normalizing object key order.
- Articles 03–04 remain `草稿` with the exact document links and metadata accepted in Task 4.
- Each replacement/new document's current `revision_id` and Markdown SHA-256 equal the corresponding values under `reviewed_documents`.
- The old article 02 document's current `revision_id` and Markdown SHA-256 equal `article02_old_document`.

Any mismatch means another edit occurred after review. Stop the release window, re-review the changed content or metadata and write a fresh rollback package; never overwrite the parallel change with the stale snapshot.

- [ ] **Step 2: Ensure there is no active synchronization and enough time before the next schedule boundary**

Run:

```bash
gh run list --workflow sync-feishu.yml --branch main --limit 20 \
  --json databaseId,status,conclusion,event,createdAt,updatedAt
node -e 'const d=new Date(); const m=d.getUTCMinutes(); const next=(m<30?30:60); const seconds=(next-m)*60-d.getUTCSeconds(); console.log(`${seconds}s to next 00/30 UTC boundary`); process.exit(seconds>=600?0:1)'
```

Require no `queued`, `in_progress`, `waiting`, `requested` or `pending` sync run and at least 600 seconds until the next UTC `:00` or `:30` boundary. If either condition fails, wait for the active run to finish and use the next safe window. Poll in intervals no longer than 30 seconds and keep the user updated at least once per minute.

After the gate passes, save the complete current sync-run ID set in the rollback package:

```bash
PRE_RELEASE_SYNC_IDS="$(gh run list --workflow sync-feishu.yml --branch main --limit 100 \
  --json databaseId --jq 'map(.databaseId)')"
ROLLBACK_NEXT="$RELEASE_STATE_DIR/rollback.next.json"
jq --argjson ids "$PRE_RELEASE_SYNC_IDS" '.pre_release_sync_run_ids=$ids' \
  "$ROLLBACK_FILE" > "$ROLLBACK_NEXT" && chmod 600 "$ROLLBACK_NEXT" && mv "$ROLLBACK_NEXT" "$ROLLBACK_FILE"
```

- [ ] **Step 3: Prepare the release and rollback payloads before writing**

Build article 02's release payload:

```bash
ARTICLE02_RELEASE_PAYLOAD="$(jq -nc --arg doc "$DOC02_URL" '{
  "标题":"从飞书到博客：一条可回滚的静态发布链路",
  "文档链接":$doc,
  "摘要":"记录飞书文档、多维表格、GitHub Actions 与 Astro 之间的静态发布链路，以及为什么它能安全失败和回滚。",
  "标签":["飞书发布","自动化","静态部署"],
  "分类":"技术",
  "专栏":"博客搭建手记",
  "专栏序号":2,
  "精选":true
}')"
ARTICLE02_ROLLBACK_PAYLOAD="$(printf '%s' "$ARTICLE02_SNAPSHOT" | jq -c '{
  "标题":.["标题"],
  "文档链接":.["文档链接"],
  "摘要":.["摘要"],
  "标签":.["标签"],
  "分类":.["分类"],
  "专栏":.["专栏"],
  "专栏序号":.["专栏序号"],
  "精选":.["精选"]
}')"
DRAFT_RECORD_IDS="$(jq -nc --arg r3 "$ARTICLE03_RECORD_ID" --arg r4 "$ARTICLE04_RECORD_ID" '[$r3,$r4]')"
ROLLBACK_NEXT="$RELEASE_STATE_DIR/rollback.next.json"
jq --argjson release "$ARTICLE02_RELEASE_PAYLOAD" --argjson rollback "$ARTICLE02_ROLLBACK_PAYLOAD" \
  --argjson draft_ids "$DRAFT_RECORD_IDS" \
  '.article02_release_payload=$release | .article02_rollback_payload=$rollback | .draft_record_id_list=$draft_ids' \
  "$ROLLBACK_FILE" > "$ROLLBACK_NEXT" && chmod 600 "$ROLLBACK_NEXT" && mv "$ROLLBACK_NEXT" "$ROLLBACK_FILE"
```

Expected: both payloads validate as JSON; the release payload does not contain `Slug`, `发布日期`, `状态` or `封面`, so those cells remain unchanged.

- [ ] **Step 4: Switch article 02 and batch-publish articles 03–04**

Run these two writes serially with no unrelated work between them:

```bash
lark-cli base +record-upsert --as user --base-token "$BASE_TOKEN" --table-id "$TABLE_ID" \
  --record-id "$ARTICLE02_RECORD_ID" --json "$ARTICLE02_RELEASE_PAYLOAD"
lark-cli base +record-batch-update --as user --base-token "$BASE_TOKEN" --table-id "$TABLE_ID" \
  --json "$(jq -nc --argjson ids "$DRAFT_RECORD_IDS" '{record_id_list:$ids,patch:{"状态":"已发布"}}')"
```

Expected: both writes succeed. Status automation may enqueue duplicate sync runs; duplicate dispatch is acceptable because the synchronization is idempotent.

- [ ] **Step 5: Read back all three records immediately**

Use one projected `+record-list` call for the three Slugs. Require:

- Article 02 uses `DOC02_URL`, retains slug `published-from-feishu`, retains its original publication date and cover, and is `已发布`, order 2 and featured.
- Articles 03–04 use their verified document URLs, are `已发布`, orders 3–4 and not featured.
- Orders 2, 3 and 4 are unique; together with manual order 1 they form `01–04`.

If the write or any read-back assertion fails, execute this rollback immediately:

```bash
lark-cli base +record-batch-update --as user --base-token "$BASE_TOKEN" --table-id "$TABLE_ID" \
  --json "$(jq -nc --argjson ids "$DRAFT_RECORD_IDS" '{record_id_list:$ids,patch:{"状态":"草稿"}}')"
lark-cli base +record-upsert --as user --base-token "$BASE_TOKEN" --table-id "$TABLE_ID" \
  --record-id "$ARTICLE02_RECORD_ID" --json "$ARTICLE02_ROLLBACK_PAYLOAD"
```

Read all three rows back and require article 02 to equal the saved snapshot while articles 03–04 are `草稿`. Only after that strict read-back succeeds, dispatch synchronization, use the new-run set procedure in Step 6, verify the public site has the previous two-article content set, and stop the implementation with the failed gate clearly reported.

- [ ] **Step 6: Dispatch one explicit synchronization**

After successful read-back, run:

```bash
gh workflow run sync-feishu.yml --ref main
PRE_RELEASE_SYNC_IDS="$(jq -cer '.pre_release_sync_run_ids' "$ROLLBACK_FILE")"
NEW_SYNC_RUNS="$(gh run list --workflow sync-feishu.yml --branch main --limit 100 \
  --json databaseId,status,conclusion,event,createdAt,headSha | \
  jq -c --argjson before "$PRE_RELEASE_SYNC_IDS" '[.[] | select((.databaseId as $id | $before | index($id)) == null)]')"
```

If `NEW_SYNC_RUNS` is empty because GitHub has not indexed the dispatch yet, poll at intervals of 10 seconds or less until at least one post-release run appears. The new set can contain the explicit dispatch plus one or more Base-automation dispatches. Watch every returned ID, not merely the newest run:

```bash
for run_id in $(printf '%s' "$NEW_SYNC_RUNS" | jq -r '.[].databaseId'); do
  gh run watch "$run_id" --exit-status
done
```

Poll the workflow list until the set of post-release IDs is unchanged across two consecutive checks and none has an active status. Expected: one sync verifies the site, creates one generated-content commit and completes a Pages deployment; every later duplicate succeeds as a no-change run without another generated-content commit.

If synchronization fails before committing generated content, inspect the run log, correct only the failing document or Base metadata and rerun while the previous Pages deployment remains live. If the fault cannot be corrected in the same execution session, run the rollback commands from Step 5, dispatch another sync and prove the scheduled workflow is healthy before stopping. If generated content commits but the Pages deployment fails, keep working through the generic `deploy.yml` run or rerun the verified deployment; do not claim release completion until at least one deployment of the generated commit succeeds.

### Task 7: Pull the generated commit and verify the complete static product

**Files:**

- Verify generated: `src/content/posts/feishu/published-from-feishu.md`
- Verify generated: `src/content/posts/feishu/feishu-sync-safety.md`
- Verify generated: `src/content/posts/feishu/github-pages-maintenance.md`
- Verify generated: `.feishu-manifest.json`
- Verify generated: `dist/search-index.json`
- Verify generated: `dist/rss.xml`
- Verify generated: `dist/sitemap-0.xml`

- [ ] **Step 1: Fast-forward local main to the automation commit**

Run in `/Users/xmo/Documents/Blog`:

```bash
git fetch origin
git pull --ff-only origin main
git status --short --branch
```

Expected: local `main` equals `origin/main`; only the pre-existing `.playwright-cli/` path remains untracked.

- [ ] **Step 2: Inspect generated content without editing it**

Run:

```bash
rg -n "^title:|^description:|^category:|^column:|^columnOrder:|^featured:|^cover:|^slug:" src/content/posts/feishu
rg -n "用于验证|测试文章更新|测试文章|以后补充|TODO|TBD|record_id|document_id|file_token|recvp|/Users/|my\.feishu\.cn" src/content/posts/feishu .feishu-manifest.json
```

Expected: three generated Feishu files have exact metadata; only article 02 is featured and has a cover; the forbidden scan returns no matches. The manifest contains only public slugs and content-addressed asset metadata, never Feishu identifiers.

- [ ] **Step 3: Run the full local verification on the generated state**

Run:

```bash
PATH="/opt/homebrew/bin:$PATH" npm ci
PATH="/opt/homebrew/bin:$PATH" npm run verify
git diff --check
```

Expected: all tests pass, Astro reports zero diagnostics and the production build contains 22 pages: the prior 16 plus two article routes and four new tag routes (`安全`, `GitHub Actions`, `静态部署`, `维护`). If taxonomy output differs, require the actual count to be explained and every route to build successfully.

- [ ] **Step 4: Verify final content metadata, structure and reading time**

Run the final mode of the temporary validator against the updated main worktree:

```bash
PATH="/opt/homebrew/bin:$PATH" node --experimental-strip-types \
  .worktrees/blog-column-v1/.release/blog-column-v1/validate-drafts.mjs \
  --generated-root /Users/xmo/Documents/Blog
```

Expected: the four exact Slugs and orders pass, article 02 is the only featured article and the only Feishu article with a cover, every practical article retains its five required H2 sections and reports at least 3 minutes, and each core tag (`飞书发布`, `自动化`, `静态部署`) covers at least two articles.

- [ ] **Step 5: Verify search ranking from the production index**

Run a Node assertion that imports `searchEntries` from `src/lib/search.ts`, loads `dist/search-index.json`, requires exactly four public entries, and checks the target article is within the first three results for each query:

| Query | Required target slug |
| --- | --- |
| 飞书发布 | `published-from-feishu` or `feishu-sync-safety` |
| GitHub Actions | `github-pages-maintenance` |
| 失败恢复 | `feishu-sync-safety` or `github-pages-maintenance` |
| 静态部署 | `published-from-feishu` or `github-pages-maintenance` |

Also assert no search-index string contains the forbidden patterns from Task 2.

- [ ] **Step 6: Verify the public HTTP surface**

Run with retry to allow Pages propagation:

```bash
curl --fail --location --retry 12 --retry-delay 10 https://xmo2004.github.io/posts/published-from-feishu/ -o /dev/null
curl --fail --location --retry 12 --retry-delay 10 https://xmo2004.github.io/posts/feishu-sync-safety/ -o /dev/null
curl --fail --location --retry 12 --retry-delay 10 https://xmo2004.github.io/posts/github-pages-maintenance/ -o /dev/null
curl --fail --location --retry 12 --retry-delay 10 'https://xmo2004.github.io/columns/%E5%8D%9A%E5%AE%A2%E6%90%AD%E5%BB%BA%E6%89%8B%E8%AE%B0/' -o /dev/null
curl --fail --location --retry 12 --retry-delay 10 https://xmo2004.github.io/rss.xml -o /dev/null
curl --fail --location --retry 12 --retry-delay 10 https://xmo2004.github.io/sitemap-0.xml -o /dev/null
```

Expected: every actual route returns HTTP 200.

### Task 8: Browser acceptance, rollback audit and cleanup

**Files:**

- Delete temporary, untracked: `.release/blog-column-v1/02-publishing-chain.md`
- Delete temporary, untracked: `.release/blog-column-v1/03-sync-safety.md`
- Delete temporary, untracked: `.release/blog-column-v1/04-pages-maintenance.md`
- Delete temporary, untracked: `.release/blog-column-v1/validate-drafts.mjs`

- [ ] **Step 1: Run desktop browser acceptance**

Use the browser-control skill against the live site at a desktop viewport. Verify:

- The archive contains exactly four articles.
- The column page shows `01 / 04` through `04 / 04` in order.
- Article 02 keeps `/posts/published-from-feishu/`; its new title wraps naturally with no overflow or one-character orphan and occupies no more than two lines at 1117px and 1440px.
- Article 02's existing cover remains visible on the home/archive card and present in generated frontmatter; the article layout itself is not required to render a hero cover.
- Articles 03–04 have no broken cover placeholders.
- Previous/next series links traverse 01 → 02 → 03 → 04 and back without a broken link.
- Search finds the target articles for the four queries in Task 7.
- RSS and sitemap include all four article URLs.
- There are no console errors.

- [ ] **Step 2: Run mobile reading acceptance**

At a 320px-wide viewport, open articles 02–04 and the column page. Verify no horizontal overflow, readable heading wrapping, usable capsule tags, a compact table of contents and tappable series links. Do not add a visual redesign in this task; record any density improvement idea for the next project.

- [ ] **Step 3: Perform three timed findability checks**

Starting from the home page, confirm each answer can be reached within two clicks and approximately 30 seconds:

1. Where is the status that allows a Feishu row to publish?
2. What protects the previous site when document synchronization fails?
3. What should be checked after a GitHub Pages deployment?

Expected: each answer is present in the intended article and can be found through home, search or the column page.

- [ ] **Step 4: Audit the rollback path without mutating production**

Confirm the mode-`0600` rollback package still contains:

- `ARTICLE02_OLD_DOC_URL` and the old row snapshot.
- The exact two-record status rollback command.
- The exact article 02 metadata restore payload.
- The successful release and sync run IDs.

Do not delete the old article 02 Feishu document. It is the retained source for an emergency rollback. Do not execute the rollback after successful acceptance.

If browser or public-output acceptance exposes a broken route, leaked identifier, wrong content set, incorrect series order or failed search gate, fix forward only when the correction is narrow and can be fully reverified in the same session. Otherwise execute the saved Base rollback, strictly read it back, dispatch synchronization, wait for all new runs and verify the previous two-article site before reporting the failed release. Cosmetic observations outside the approved scope are recorded for the next project and do not justify mutating this release.

- [ ] **Step 5: Delete temporary drafts and finish the branch**

Use `apply_patch` to delete the four `.release/blog-column-v1/` files, then run:

```bash
git status --short --branch
git log --oneline --decorate -8
git rev-parse main
git rev-parse origin/main
```

Expected: in the main worktree, `main` equals `origin/main` and only `.playwright-cli/` remains untracked. The feature worktree contains no uncommitted tracked or untracked release files.

After recording only the non-sensitive run IDs and verification results in the completion report, delete `ROLLBACK_FILE` and remove the now-empty `RELEASE_STATE_DIR`. These paths were created by this plan, are outside the repository and contain no credentials; never delete any other temporary directory.

Use `finishing-a-development-branch` to remove the merged `feat/blog-column-v1` worktree and branch only after all verification has passed. Never delete `.playwright-cli/`.

## Completion report

Report the following evidence to the user:

- The four public titles and URLs.
- The successful permanent-code deployment run and Feishu sync/deployment run IDs.
- The final test count, Astro diagnostic count and built-page count.
- Confirmation that article 02 kept its public URL and cover.
- Confirmation that only article 02 is featured and the series is `01–04`.
- Confirmation that the two new articles were published through Feishu documents and Base, not hand-written generated Markdown.
- Confirmation that the previous article 02 source was retained for rollback, without exposing its private URL or any internal ID.
- Any separate next-project recommendation, limited to responsive image optimization, social cards, density re-measurement or real-browser CI.
