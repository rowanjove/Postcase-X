# X帖匣 · Postcase — 将 X 内容保存为 Markdown

[简体中文](README.md) | [English](README.en.md)

Postcase 是 Chrome／Edge 扩展，可将 X（Twitter）帖子、同作者线程和长文详情页中已加载的内容保存为 Markdown。正文、图片、引用和来源信息在浏览器本地整理，可复制文本、下载单文件或打包 ZIP，无需后端服务。

原名 X Markdown Exporter，仓库地址、扩展身份、安装包名前缀和已有设置保持兼容。**v1.8.1 已在 GitHub 发布**；商店安装与 GitHub 安装是不同渠道，版本以各自页面为准。

[GitHub 下载](https://github.com/rowanjove/x-markdown-exporter/releases/tag/v1.8.1) · [Chrome 商店](https://chromewebstore.google.com/detail/x-markdown-exporter/alicknocngkldhijfocddaepnfpgjlee) · [更新记录](CHANGELOG.md) · [问题反馈](https://github.com/rowanjove/x-markdown-exporter/issues)

![Postcase 浅色、深色和悬浮窗界面](assets/release-preview.png)

截图使用本地匿名示例数据，不含用户内容。v1.8.1 修复商店上传描述长度问题，并增加逐语言预检；导出功能和既有设置不变。

## 安装

### Chrome 商店

打开上方商店链接，按浏览器提示安装。商店可能仍显示旧名称或不同版本，不应据此判断 GitHub 版本未发布。

### GitHub 安装包

1. 从 v1.8.1 Release 下载 `x-markdown-exporter-v1.8.1.zip`，并解压到固定目录。
2. 打开 `chrome://extensions/` 或 `edge://extensions/`，开启开发者模式。
3. 点击“加载已解压的扩展程序”，选择含 `manifest.json` 的目录。

升级时先备份旧目录，再将新包解压到原目录，重新加载扩展并刷新 X 页面。不要先删除扩展；保持扩展 ID 和目录可保留既有设置。GitHub ZIP 不会自动升级商店安装的扩展。

也可以直接克隆并加载仓库目录：

```bash
git clone https://github.com/rowanjove/x-markdown-exporter.git
cd x-markdown-exporter
```

## 使用与导出格式

1. 打开具体帖子或长文（Note）详情页，等待内容加载。
2. 点击右侧可拖动悬浮按钮，或使用工具栏扩展弹窗。
3. 选择下载格式，点击“复制”或“下载”。
4. 导出期间可查看进度或取消；关闭后重新打开弹窗可继续查看当前任务。

**复制始终使用图片链接；格式选项只影响下载。**

| 格式 | 输出 | 适用场景 |
| --- | --- | --- |
| `link` | Markdown 中保留远程图片链接 | 快速复制、引用和小体积文件 |
| `embed` | 压缩图片后以 Base64 内嵌到单个 Markdown 文件 | 单文件保存；需确认阅读器支持 data URL |
| `zip` | Markdown 和图片分别保存，再打包 ZIP | 离线归档、管理独立图片文件 |

内嵌文件过大时可切换 ZIP。无法获取的图片可能保留远程链接，因此归档后仍应检查图片是否完整。

![Postcase Markdown 导出示例](assets/export-example.png)

## 功能与限制

- 使用结构化文档模型保留文本、图片、引用和链接卡片的顺序。
- 默认附带作者、发布时间和来源信息。
- 同作者线程要求内容已加载，且有明确回复或线程上下文；不保证整个会话完整。
- 时间线、搜索和个人主页不是直接导出入口，请先打开具体帖子。
- X 改动页面结构后，提取规则可能需要调整。
- 复杂表格、数学公式、编辑器专用节点和异常混合容器不保证完整保真。
- `embed`／`zip` 每次最多处理 **500 张独立图片、64 MiB 累计媒体数据**，超限会明确停止。
- 图片转码 canvas 最多 **8 MP**；这不是整个浏览器进程的内存上限。
- 后台跨标签最多同时抓取 **6 张图片**，等待队列最多 **96 项**；队列满时保留远程链接。
- 页面导航或标签关闭会清理相关抓取任务。
- 界面、进度与 Markdown 元数据提供简体中文和英文；实际峰值内存及真实页面队列等待仍需进一步测量。

详细复现、修复和未完成项见 [代码审查](CODE_REVIEW.md) 与 [改进计划](IMPROVEMENT_PLAN.md)。

## 隐私与网络请求

不上传帖子内容到第三方处理服务器，不要求外部后端。图片通过扩展后台从允许的 X／Twitter 资源地址获取；本地整理不等于断网也能下载尚未获取的媒体。诊断数据保存在本地，不作为遥测自动上传。

见 [隐私说明](PRIVACY.md)。保存与再分发内容时，请尊重原作者权利及平台规则。

## 开发与验证

需要 Node.js **>=20**。项目无需构建即可加载为已解压扩展；测试需要开发依赖：

```bash
npm ci
npm run check
npx playwright install chromium
npm run check:all
```

完整检查包含单元测试、Playwright 页面 fixture、真实 MV3 扩展安装／注入／下载／Service Worker 测试，以及发布一致性检查。

| 命令 | 用途 |
| --- | --- |
| `npm run verify:release` | 校验发布元数据与已有发布产物 |
| `npm run package` | 在 `dist/` 生成发布目录、ZIP 和 SHA-256 文件，不覆盖已有发布物 |
| `npm run fixture` | 启动本地 UI 测试页 |
| `npm run screenshots` | 重拍匿名示例截图 |

fixture 地址为 `http://127.0.0.1:4173/`。弹窗预览路径为 `/__fixture__/popup.html?lang=zh_CN&theme=light`，可将主题改为 `dark`。弹窗预览使用模拟扩展 API，不执行真实复制或下载；实际扩展行为由 MV3 测试另行验证。

主要模块包括 `content-core.js`（提取）、`content-export.js`（组装与媒体处理）、`content-ui.js`（悬浮界面）、`content.js`（编排）、`background.js`（图片抓取）和 `popup.js`（工具栏入口）。修改后需重新加载扩展并刷新 X 页面。

## 品牌与许可

名称、配色与图标规范见 [BRAND.md](BRAND.md)。代码采用 [MIT License](LICENSE)。
