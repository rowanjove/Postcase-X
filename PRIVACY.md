# Privacy Policy / 隐私政策

Last updated: 2026-08-21

## 中文

X Markdown Exporter 是一个用于将 X/Twitter 推文、线程和 Note 转换为 Markdown 的浏览器扩展。

本扩展会在受支持的 X/Twitter 页面中进行轻量的本地页面检测，用于判断当前页面类型、内容是否已加载，以及是否包含线程、图片、引用推文或外链卡片。完整正文提取和 Markdown 转换仅在用户主动点击“复制”或“下载”时进行。

上述检测和转换均在本地浏览器中完成，不会因此向扩展开发者或第三方服务器发送页面内容。

本扩展可能处理以下当前页面内容：

- 推文、线程或 Note 正文
- 作者名称和账号
- 发布时间
- 来源 URL
- 图片 URL
- 引用推文和外链卡片信息

本扩展不会：

- 上传导出内容到第三方服务器
- 出售用户数据
- 将用户数据用于广告或画像
- 收集账号密码、支付信息、位置、浏览历史或私人通信内容

本扩展使用 `storage` 权限，仅用于在本地保存导出模式和悬浮按钮位置等界面偏好。

图片资源仅从 X/Twitter 官方资源域名读取，用于生成用户主动请求的 Markdown、内嵌图片文件或 ZIP 文件。

用户可以主动复制一份本地诊断报告，用于排查 X 页面结构变化。该报告只包含扩展版本、选择器版本、页面类别、相关节点数量和布尔状态，不包含正文、作者账号、状态 ID、完整页面 URL 或浏览历史；扩展不会自动上传或发送该报告。

如果你对本隐私政策有疑问，可以通过 GitHub 仓库提交 issue：

https://github.com/rowanjove/x-markdown-exporter/issues

## English

X Markdown Exporter is a browser extension that converts X/Twitter posts, threads, and Notes into Markdown.

On supported X/Twitter pages, the extension performs lightweight local page checks to determine the page type, loading state, and whether the page contains a thread, images, a quoted post, or a link card. Full-text extraction and Markdown conversion occur only when the user explicitly clicks "Copy" or "Download".

These checks and conversions run locally in the browser and do not send page content to the extension developer or third-party servers.

The extension may process the following current-page content:

- Post, thread, or Note text
- Author name and handle
- Publish time
- Source URL
- Image URLs
- Quoted posts and external link-card information

The extension does not:

- Upload exported content to third-party servers
- Sell user data
- Use user data for advertising or profiling
- Collect passwords, payment information, location, browsing history, or private communication content

The `storage` permission is used only to save local UI preferences such as export mode and floating button position.

Image assets are fetched only from official X/Twitter asset domains to generate Markdown, embedded-image files, or ZIP files requested by the user.

Users may explicitly copy a local diagnostic report to troubleshoot X page-structure changes. The report contains only extension/selector versions, page category, relevant node counts, and boolean states. It excludes body text, author accounts, status IDs, full page URLs, and browsing history, and is never uploaded or sent automatically.

If you have questions about this privacy policy, you can open an issue in the GitHub repository:

https://github.com/rowanjove/x-markdown-exporter/issues
