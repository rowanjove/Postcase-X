# Changelog

## v1.8.0 (2026-09-01)

### 中文

- 品牌更新为 **X帖匣 · Postcase**：浅蓝图标、统一弹窗与悬浮窗，支持明暗主题。
- 重构界面层级、键盘焦点、拖动定位和结果提示；两入口同步任务进度并锁定冲突操作。
- 修复时间戳误删正文与引用、图片遗漏、列表顺序和缩进、代码块空白丢失。
- 收紧目标帖子与文章范围、线程关系判断，改进互动统计与图片 URL 处理。
- 加入导出媒体预算、跨标签请求排队和背压，改进取消、ZIP 进度及资源释放。
- 发布新的实际界面截图、品牌源文件和可复现安装包；77 项单元测试、20 项浏览器测试通过。
- 保留仓库地址、安装包名前缀和已保存设置。此次为 GitHub 发布，Chrome 商店版本未同步。

### English

- Renamed the product to X帖匣 · Postcase, with a light-blue folded-page and storage-case mark, editable SVG source, and 16/32/48/128px icons. Existing settings, repository URLs, and release filenames remain compatible; the store listing has not been changed.
- Fixed timestamp filtering dropping wrapped bodies and quoted posts, and restored direct and captioned media images.
- Preserved mixed list content in DOM order, indented ordered-list continuations by marker width, and retained code-block blank lines and trailing whitespace.
- Reworked the popup and floating panel with shared light/dark colors, compact controls, and a simpler action hierarchy; removed gradients, glass effects, and duplicate in-panel notifications.
- Added reliable task reconnection, tab-scoped progress, export/diagnostic locking, persistent warnings, safe focus restoration, responsive panel placement, and late-content detection.
- Fixed target-post identity, quoted-content boundaries, article ownership, avatar card pollution, and image URL parameter handling.
- Fixed cancellation during clipboard fallback and background fetches; enforce the image byte limit while reading the response stream.
- Extended the structured document model to preserve wrapper-level paragraphs, headings, blockquotes, code blocks, ordered list starts, and nested lists across all export modes.
- Matched interaction statistics by semantic labels across native buttons, reordered controls, and common localized count formats.
- Tightened thread collection to require the same author plus an explicit reply or thread context; ambiguous adjacency now stays out of the export.
- Added versioned export state messages with task IDs, start timestamps, monotonic revisions, and stale-message rejection across popup reconnections.
- Added a per-export media budget of 500 unique images and 64 MiB of cumulative media bytes for `embed` / `zip` modes.
- Added a six-request global image-fetch cap with a cancellable cross-tab queue; navigation and tab close now clear that tab's active and queued requests.
- Added a 96-entry FIFO backpressure limit; a full queue returns an explicit failure so exports keep the remote image link instead of retaining unbounded callbacks.
- Added internal queue counters for active depth, high-water mark, completed wait, and rejected requests without collecting page content or sending telemetry.
- Added ZIP compression progress cancellation checks and released prepared embed data URLs as each image enters the archive; failed prepared images reuse their remote links instead of being fetched twice.
- Bounded image transcode canvases to 8 MP and cleared their pixel buffers after each conversion.
- Verify release directories and ZIP entries against the current source whitelist, including file bytes.
- Expanded regression coverage and documented remaining extraction and resource-budget work in CODE_REVIEW.md and IMPROVEMENT_PLAN.md.

## v1.7.0 (2026-08-22)

- Hardened page classification and added support for `/i/web/status/{id}` URLs.
- Changed tweet and thread extraction to fail closed when the target or author cannot be verified.
- Escaped untrusted Markdown/HTML text and narrowed image placeholder replacement.
- Added trusted-event checks for the injected page UI and aligned the privacy policy with local readiness checks.
- Added image fetch limits, redirect/MIME validation, original-format ZIP storage, embed safeguards, and partial-export warnings.
- Added Node regression tests, CI, reproducible release packaging, accessibility improvements, and minimum-permission checks.
- Added English and Simplified Chinese `chrome.i18n` resources for the manifest, popup, injected panel, progress/error messages, filenames, and Markdown metadata.
- Added an anonymized real-browser DOM fixture covering panel readiness, mode selection, Markdown copy, and Blob-backed download orchestration.
- Replaced indexed `__IMG_n__` string markers with structured content nodes for text, links, images, headings, cards, and quoted posts.
- Added a versioned `PostDocument` model so DOM extraction is separated from Markdown rendering across copy, link, embed, and ZIP exports.
- Added a three-request image concurrency limit, cancellable background fetches, cancel controls in both interfaces, and determinate image progress for embed/ZIP exports.
- Centralized X DOM selectors in a versioned adapter and added a user-triggered, privacy-safe local diagnostic report.
- Added five Playwright browser tests to CI for copy, diagnostics, embed progress, cancellation, ZIP export, and a real packaged MV3 extension install/injection/download flow with its service worker and popup.
- Added release metadata validation, byte-for-byte ZIP verification, deterministic archive timestamps, and SHA-256 sidecars.

## v1.6.1

### 中文

- 将主操作按钮文案从“下载 Markdown”缩短为“下载”，改善悬浮面板和弹窗中的按钮排版。

### English

- Shortened the primary action label from "Download Markdown" to "Download" to improve button fit in the floating panel and popup.

## v1.6.0

### 中文

- 新增一键复制 Markdown 文本，方便把推文、线程和 Note 直接投喂给 OpenClaw、Claude Code 等本地或代理式 AI 工具。
- 在可下载状态旁新增内容标签，可显示推文、文章、线程、图片数量、引用推文和外链卡片等信息。
- 针对时间线、搜索页、探索页、主页和未加载完成的详情页提供更明确的操作提示。
- 更新 README，强化插件定位：绕开网页反爬带来的复制/抓取摩擦，高效把高价值 X 内容转成 Markdown，用于 AI 上下文或本地归档。

### English

- Added one-click Markdown copying so posts, threads, and Notes can be fed directly into OpenClaw, Claude Code, and similar local or agentic AI tools.
- Added richer content labels next to the readiness state, including post, article, thread, image count, quoted post, and link-card hints.
- Added more actionable guidance for timeline, search, explore, profile, and still-loading detail pages.
- Updated the README to clarify the positioning: turn high-value X content into Markdown for AI context and local archiving without fighting web anti-scraping friction.

## v1.5.0

- Added explicit extraction validation so DOM breakages no longer silently export blank Markdown files.
- Added clearer failure messaging with recovery guidance and a GitHub issue link for tweet and Note exports.
- Added a `source_url` metadata line to exported Markdown across `link`, `embed`, and `zip` modes.
- Added a size guard for oversized `embed` exports with a user confirmation step and automatic ZIP fallback.
- Reused already-processed images when `embed` downgrades to ZIP so fallback exports stay fast and predictable.

## v1.4.1

- Fixed missing-content cases around quoted tweets, nested rich-text images, and some status-page misclassification paths.
- Improved ZIP export reliability so Markdown keeps valid image references even when a local image download fails.
- Added a `文章_YYYYMMDD_HHMMSS` filename fallback for untitled long-form exports.
- Updated the popup fallback flow so Note pages can be exported from the toolbar entry too.

## v1.4.0

- Added the draggable in-page floating launcher and compact export panel.
- Added remembered launcher position and improved in-page export workflow.
- Added supported external preview-card extraction.
