// Screenshots of the actual UI with anonymous fixtures; never use account data.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('@playwright/test');

async function main() {
  const root = path.resolve(__dirname, '..');
  const { version } = require('../manifest.json');
  const server = spawn(process.execPath, ['tests/browser/fixture-server.js'], {
    cwd: root, env: { ...process.env, XPD_FIXTURE_PORT: '0' },
    stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true,
  });
  let browser;
  try {
    const baseURL = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Preview server startup timed out')), 10000);
      let output = '';
      server.stdout.on('data', (chunk) => {
        output += chunk;
        const url = output.match(/http:\/\/127\.0\.0\.1:\d+\//)?.[0];
        if (url) { clearTimeout(timer); resolve(url); }
      });
      server.once('error', (error) => { clearTimeout(timer); reject(error); });
      server.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Preview server exited: ${code}`)); });
    });
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 2 });
    for (const [locale, theme, filename] of [
      ['zh_CN', 'light', 'popup-preview.png'],
      ['zh_CN', 'dark', 'popup-dark-preview.png'],
      ['en', 'light', 'popup-en-preview.png'],
    ]) {
      await page.goto(`${baseURL}__fixture__/popup.html?lang=${locale}&theme=${theme}`);
      await page.waitForFunction((version) => document.getElementById('versionText')?.textContent === `v${version}`, version);
      await page.locator('.header-icon').evaluate((img) => img.decode());
      await page.locator('body').screenshot({ path: path.join(root, 'assets', filename), animations: 'disabled' });
    }
    await page.goto(`${baseURL}?lang=zh_CN&theme=light`);
    await page.locator('[data-role="launcher"]').click();
    await page.locator('[data-role="panel"]').screenshot({ path: path.join(root, 'assets/floating-preview.png'), animations: 'disabled' });

    const png = (name) => `data:image/png;base64,${fs.readFileSync(path.join(root, name)).toString('base64')}`;
    const board = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    await board.setContent(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>
      *{box-sizing:border-box}body{margin:0;background:#F2F8FD;color:#234A66;font:15px "Segoe UI","Microsoft YaHei",sans-serif}
      main{padding:42px 64px}header{display:flex;align-items:center;gap:18px}header img{width:56px;height:56px}
      h1{font-size:30px;margin:0 0 4px;font-weight:650}p{margin:0;color:#536F83}.version{margin-left:auto;font-size:20px}
      .screens{display:flex;gap:48px;margin-top:34px;align-items:flex-start}figure{margin:0;width:352px}
      figure img{display:block;width:352px;height:auto;border:1px solid #D5E3ED;border-radius:10px}
      figcaption{margin:14px 0;font-size:15px;color:#536F83}footer{margin-top:30px;border-top:1px solid #CDDDEA;padding-top:20px;color:#536F83;font-size:13px}
    </style><main><header><img src="${png('icons/icon128.png')}" alt=""><div><h1>X帖匣 · Postcase</h1><p>X → Markdown · 复制文本 / 内嵌图片 / ZIP 打包</p></div><div class="version">v${version}</div></header>
    <div class="screens">${[
      ['popup-preview.png', '浅色弹窗 / Light'], ['popup-dark-preview.png', '深色弹窗 / Dark'], ['floating-preview.png', '页面悬浮窗 / In-page panel'],
    ].map(([file, label]) => `<figure><img src="${png(`assets/${file}`)}" alt="${label}"><figcaption>${label}</figcaption></figure>`).join('')}</div>
    <footer>实际界面代码截图 · 使用本地匿名示例数据，不包含用户账号或真实帖子。<br>Actual UI captured with anonymous local fixtures, not a signed-in X session.</footer></main></html>`);
    await board.locator('img').evaluateAll((images) => Promise.all(images.map((img) => img.decode())));
    await board.screenshot({ path: path.join(root, 'assets/release-preview.png') });
    console.log(`Captured v${version} light/dark/English popup, floating panel, and release overview`);
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
