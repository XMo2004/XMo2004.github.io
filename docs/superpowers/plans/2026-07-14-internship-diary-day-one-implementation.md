# Internship Diary Day One Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the first illustrated article in a new `实习日记` column, with a fact-checked first-person account of the author's first day on the automotive production floor.

**Architecture:** Add one manually maintained Markdown post and one project-local image directory. Existing Astro content collection and taxonomy builders will derive the new column, route, search entry, RSS entry, and series metadata from frontmatter without page or schema changes.

**Tech Stack:** Astro 7 content collections, Markdown, generated raster artwork, Sharp/WebP, Node.js tests

---

### Task 1: Generate and prepare the three article illustrations

**Files:**
- Create: `public/media/manual/internship-day-one/day-one-workshop.webp`
- Create: `public/media/manual/internship-day-one/day-one-workshop-320.webp`
- Create: `public/media/manual/internship-day-one/day-one-workshop-640.webp`
- Create: `public/media/manual/internship-day-one/day-one-workshop-960.webp`
- Create: `public/media/manual/internship-day-one/camera-repair.webp`
- Create: `public/media/manual/internship-day-one/measurement-and-checklist.webp`

- [ ] **Step 1: Generate the workshop cover with the built-in image tool**

Use this prompt:

```text
Use case: illustration-story
Asset type: Chinese personal blog header and first inline image
Primary request: a young automotive engineering intern on his first day in a modern vehicle final-assembly workshop, standing beside an experienced repair technician and carefully observing a rugged SUV at the delivery-and-repair station
Scene/backdrop: spacious clean automotive assembly hall with realistic production equipment and several unfinished vehicles in the distance
Style/medium: realistic editorial illustration, natural human proportions, subtle hand-painted texture
Composition/framing: wide 16:9 composition, intern visibly observing rather than performing the repair, clear foreground and deep workshop scale
Lighting/mood: soft industrial daylight, curious and slightly nervous first-day mood
Color palette: industrial gray, muted blue, restrained warm orange accents
Constraints: generic unbranded vehicle; no company logo; no vehicle badge; no readable text; no watermark; no dramatic sparks; correct PPE
```

Expected: one landscape image saved under the built-in image generator's normal `$CODEX_HOME/generated_images/` location.

- [ ] **Step 2: Generate the camera-repair illustration**

Use this prompt:

```text
Use case: illustration-story
Asset type: inline image for a Chinese internship diary
Primary request: an experienced automotive repair technician wearing gloves inspecting and replacing a small front camera module on a generic rugged SUV while a young intern watches closely and takes notes
Scene/backdrop: vehicle delivery-and-repair area inside a modern final-assembly workshop
Style/medium: realistic editorial illustration matching the workshop cover, natural proportions and believable tools
Composition/framing: horizontal medium shot focused on hands, camera module and the intern's attentive observation
Lighting/mood: clean workshop lighting, calm concentration
Color palette: industrial gray, muted blue, restrained warm orange accents
Constraints: generic unbranded vehicle; intern does not touch the repair; no company logo; no vehicle badge; no readable text; no watermark; no exposed confidential diagrams
```

Expected: one horizontal image in the generator output directory.

- [ ] **Step 3: Generate the measurement-and-checklist illustration**

Use this prompt:

```text
Use case: illustration-story
Asset type: inline image for a Chinese internship diary
Primary request: a quality engineer crouching beside the underside edge of a generic SUV, using a precision caliper while another hand holds a paper vehicle inspection checklist and signs one item
Scene/backdrop: modern automotive delivery inspection area, vehicle safely stationary on a professional inspection platform
Style/medium: realistic editorial illustration matching the other two images, technically plausible but not tied to a specific vehicle component
Composition/framing: horizontal close-to-medium shot showing the measuring tool, underside structure, checklist and signing gesture without readable values
Lighting/mood: precise, quiet, procedural
Color palette: industrial gray, muted blue, restrained warm orange accents
Constraints: no company logo; no vehicle badge; no readable text or numbers; no watermark; do not imply a specific measured component; safe working posture
```

Expected: one horizontal image in the generator output directory.

- [ ] **Step 4: Copy outputs into the manual media directory and create WebP assets**

Copy the selected generated files into `public/media/manual/internship-day-one/`. Use the installed `sharp` dependency to crop the cover to 16:9 and emit widths 320, 640, 960, and 1440; convert both inline images to WebP at a maximum width of 1280 without enlargement.

Expected files are the six paths listed at the start of Task 1, and every file must decode successfully.

- [ ] **Step 5: Visually inspect the prepared assets**

Open all three full-size WebP images. Confirm consistent style, no logos or readable text, correct subject actions, no obvious anatomical/tool defects, and adequate contrast at blog width.

### Task 2: Add the fact-checked diary article and column metadata

**Files:**
- Create: `src/content/posts/manual/internship-day-one.md`

- [ ] **Step 1: Add exact frontmatter**

```yaml
---
title: 实习第一天的日志总结
description: 记录我在总装、交付与返修现场度过的实习第一天，以及从摄像头返修、测量精度和质量检查中学到的东西。
pubDate: 2026-07-14
category: 成长
column: 实习日记
columnOrder: 1
tags:
  - 实习
  - 汽车制造
  - 质量管理
featured: false
cover:
  src: /media/manual/internship-day-one/day-one-workshop.webp
  width: 1440
  height: 810
  variants:
    - src: /media/manual/internship-day-one/day-one-workshop-320.webp
      width: 320
    - src: /media/manual/internship-day-one/day-one-workshop-640.webp
      width: 640
    - src: /media/manual/internship-day-one/day-one-workshop-960.webp
      width: 960
    - src: /media/manual/internship-day-one/day-one-workshop.webp
      width: 1440
slug: internship-day-one
---
```

- [ ] **Step 2: Write the first-person diary body**

Write at least 1000 Chinese characters under these six H2 headings:

```markdown
## 从一线开始的第一天
## 跟着师傅看摄像头返修
## 0.1、0.01 与“大于 2.1”
## 一本检查册和一场争执
## 发动机舱里的粉色液体
## 今天真正学到的东西
```

Place the cover image after the opening paragraphs, the camera image in the second section, and the measurement image in the third section. Add concrete Chinese alt text and an italic caption after each image.

Include a short `资料核对` subsection at the end with direct links to the Chery TIGGO 7 official page, the official Chery TIGGO V page, the NIST measurement-resolution guidance, the IATF traceability overview, and Chevron's coolant-color explanation. Treat the T1E/TIGGO 7 mapping as public reporting and avoid claiming an official T1TP/TIGGO V mapping.

- [ ] **Step 3: Humanize and fact-check the final prose**

Remove AI praise, promotional claims, generic conclusions, stacked three-item slogans, excessive bolding, emojis, and invented expertise. Verify every sentence against one of four labels: direct observation, direct hearsay, cited public fact, or explicitly marked uncertainty.

Expected self-score using the humanizer-zh rubric: at least 45/50.

### Task 3: Verify content, generated routes, and visual rendering

**Files:**
- Verify: `src/content/posts/manual/internship-day-one.md`
- Verify: `public/media/manual/internship-day-one/*.webp`
- Verify generated output under `dist/`

- [ ] **Step 1: Check article length, metadata, and asset references**

Run a local script that counts Han characters in the Markdown body, extracts all `/media/manual/internship-day-one/*.webp` references, and verifies each referenced file exists. Expected: at least 1000 Han characters and no missing assets.

- [ ] **Step 2: Run the full repository verification**

Run:

```sh
npm run verify
```

Expected: Node tests report zero failures, Astro check reports zero errors, and the static build exits with code 0.

- [ ] **Step 3: Inspect generated pages and source links**

Confirm these generated files exist and contain the expected labels and image URLs:

```text
dist/posts/internship-day-one/index.html
dist/columns/实习日记/index.html
dist/columns/index.html
```

Expected: the article page contains all six H2 headings and three inline images; the column index links to `实习日记`; the column page lists `实习第一天的日志总结` with order `1`.

- [ ] **Step 4: Preview at desktop and mobile widths**

Start the production preview with `npm exec -- astro preview --host 127.0.0.1`, open the article and column pages, and inspect at approximately 1440px and 390px widths. Expected: images load, captions remain legible, the table of contents works, and there is no horizontal overflow.

- [ ] **Step 5: Review the final diff without touching unrelated work**

Run `git status --short`, `git diff --check`, and a targeted diff of the new design, plan, article, and media directory. Confirm the pre-existing untracked `.playwright-cli/` directory remains untouched.

