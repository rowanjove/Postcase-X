# X帖匣 · Postcase

中文短名：**X帖匣**。英文短名：**Postcase**。

完整扩展名称和界面名称统一为：`X帖匣 · Postcase`。
界面名称搭配功能说明 `X → Markdown`，避免在小窗口里重复一整句产品说明。

## 图形与颜色

标识由一张折角纸页和下方收纳匣组成，表达“将帖子保存为自己的文件”。不用 X 的官方标识、AI 星芒、渐变、玻璃或发光效果。

| 用途 | 色值 |
| --- | --- |
| 浅蓝底色 | `#A9D5F3` |
| 冷白纸页 | `#F7FBFF` |
| 折角蓝色 | `#669FC6` |
| 深蓝线条 | `#2B5D80` |

图标在明暗界面中保持相同配色，不把整个页面改成品牌色。16px 版只保留一条正文线，避免缩小后拥挤。

## 资产与维护

- `icons/postcase.svg`：可编辑的矢量源文件。
- `icons/icon16.png`、`icon32.png`、`icon48.png`、`icon128.png`：扩展工具栏和管理页图标。
- `assets/release-preview.png`：当前版本实际界面总览；运行 `npm run screenshots` 重新拍摄。
- `assets/social-preview.png`：1200 × 630 品牌预览图。
- `assets/popup-preview.png`、`assets/popup-dark-preview.png`：实际弹窗预览。
- `content-ui.js` 的标记区由矢量源同步生成，悬浮按钮和面板头部复用同一图形。

修改 SVG 后运行 `npm run brand:generate`，会重新生成 PNG、宣传预览图并同步悬浮窗内联 SVG。图标从矢量直接渲染，不依赖生成式位图或外部字体服务。

## 兼容性与发布边界

保留原仓库 URL、npm 包标识、制品文件名前缀和 `xpd_*` 设置键。README 中商店链接的旧名称用于准确描述尚未更新的公开版本。更新名称不会清空用户设置。

本品牌随 v1.8.0 在 GitHub 发布，未更新 Chrome 商店展示信息；未做商标或域名权利确认。
