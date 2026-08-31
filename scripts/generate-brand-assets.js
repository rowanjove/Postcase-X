// Render the editable vector into Chromium-compatible PNGs. No external fonts/assets.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');

async function main() {
  const root = path.resolve(__dirname, '..');
  const svg = fs.readFileSync(path.join(root, 'icons/postcase.svg'), 'utf8');
  const uiPath = path.join(root, 'content-ui.js');
  const uiSource = fs.readFileSync(uiPath, 'utf8');
  const marker = /\/\* postcase-mark:start \*\/[\s\S]*?\/\* postcase-mark:end \*\//;
  if (!marker.test(uiSource)) throw new Error('Missing inline brand mark slot');
  const inlineSvg = svg.trim().replace('<svg ', '<svg class="xpd-brand-mark" aria-hidden="true" ');
  fs.writeFileSync(uiPath, uiSource.replace(marker, () =>
    `/* postcase-mark:start */\n    const brandMark = ${JSON.stringify(inlineSvg)};\n    /* postcase-mark:end */`
  ));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
    for (const size of [16, 32, 48, 128]) {
      const data = await page.evaluate(async ({ svg, size }) => {
        const image = new Image();
        // Avoid crowding the 16px toolbar icon with a second text line.
        image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
          size === 16 ? svg.replace('M24 25H39M24 31H34', 'M24 27H39') : svg
        );
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        canvas.getContext('2d').drawImage(image, 0, 0, size, size);
        return canvas.toDataURL('image/png').split(',')[1];
      }, { svg, size });
      fs.writeFileSync(path.join(root, `icons/icon${size}.png`), Buffer.from(data, 'base64'));
    }
    await page.setContent(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>
      *{box-sizing:border-box}body{margin:0;background:#F2F8FD;color:#234A66;font-family:"Segoe UI","Microsoft YaHei",sans-serif}
      main{padding:64px 76px;width:1200px;height:630px;position:relative}
      .top{display:flex;align-items:center;gap:30px}.mark{width:112px;height:112px}.mark svg{width:100%;height:100%}
      .name{font-size:64px;font-weight:650;letter-spacing:-2px}.en{font-size:27px;letter-spacing:0;font-weight:400;margin-left:22px}
      h1{font-size:44px;font-weight:500;letter-spacing:-1px;margin:48px 0 12px}p{font-size:21px;color:#536F83;margin:0;line-height:1.7}
      footer{position:absolute;bottom:55px;left:76px;right:76px;border-top:1px solid #CDDDEA;padding-top:24px;display:flex;justify-content:space-between;align-items:center;font-size:15px;color:#536F83}
      .samples{display:flex;gap:16px;align-items:center}.sample{width:32px;height:32px}.sample svg{width:100%;height:100%}
      .sizes{font-variant-numeric:tabular-nums;margin-left:8px}
    </style><main><div class="top"><div class="mark">${svg}</div><div class="name">X帖匣<span class="en">· Postcase</span></div></div>
      <h1>把帖子，收进自己的文件。</h1><p>将 X 推文与长文保存为 Markdown。<br>复制文本 · 内嵌图片 · ZIP 打包</p>
      <footer><span>X → Markdown &nbsp; / &nbsp; 在浏览器本地处理</span><div class="samples"><div class="sample">${svg}</div><span class="sizes">16 · 32 · 48 · 128 px</span></div></footer></main></html>`);
    await page.screenshot({ path: path.join(root, 'assets/social-preview.png') });
  } finally {
    await browser.close();
  }
  console.log('Generated Postcase icons (16/32/48/128) and social preview from icons/postcase.svg');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
