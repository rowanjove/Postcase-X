const { test, expect } = require('@playwright/test');
const manifest = require('../../manifest.json');
const locales = {
  en: require('../../_locales/en/messages.json'),
  zh_CN: require('../../_locales/zh_CN/messages.json'),
};

for (const lang of ['en', 'zh_CN']) {
  for (const theme of ['light', 'dark']) {
    test(`popup preview uses real ${lang} strings and ${theme} tokens without overflowing`, async ({ page }) => {
      const messages = locales[lang];
      await page.setViewportSize({ width: 340, height: 600 });
      // The fixture query must override the system setting only inside this preview.
      await page.emulateMedia({ colorScheme: theme === 'dark' ? 'light' : 'dark' });
      await page.goto(`/__fixture__/popup.html?lang=${lang}&theme=${theme}`);
      await expect(page).toHaveTitle(/本地界面预览|Local UI preview/);
      await expect(page.locator('html')).toHaveAttribute('lang', lang === 'zh_CN' ? 'zh-CN' : 'en-US');
      await expect(page.locator('#versionText')).toHaveText(`v${manifest.version}`);
      await expect(page.locator('h1')).toHaveText(messages.brand_name.message);
      expect(await page.locator('.header-icon').evaluate((img) => img.complete && img.naturalWidth === 48)).toBe(true);
      await expect(page.locator('#statusText')).toHaveText(messages.ready.message);
      await expect(page.locator('#downloadBtn')).toBeEnabled();
      await expect(page.locator('#copyHint')).toHaveText(messages.copy_link_hint.message);
      await page.locator('[data-mode="zip"]').click();
      await expect(page.locator('[data-mode="zip"]')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('#modeDesc')).toHaveText(messages.mode_zip_desc.message);
      const layout = await page.locator('body').evaluate((body) => ({
        width: body.getBoundingClientRect().width,
        overflow: body.scrollWidth - body.clientWidth,
        colorScheme: getComputedStyle(body).colorScheme,
      }));
      expect(layout.width).toBe(340);
      expect(layout.overflow).toBeLessThanOrEqual(1);
      expect(layout.colorScheme).toBe(theme);
    });
  }
}

test('popup preview can inspect unavailable and occupied states without real downloads', async ({ page }) => {
  await page.goto('/__fixture__/popup.html?state=unavailable');
  await expect(page.locator('#downloadBtn')).toBeDisabled();
  await expect(page.locator('#statusText')).toContainText('Local preview');
  await page.goto('/__fixture__/popup.html');
  await expect(page.locator('#downloadBtn')).toBeEnabled();
  await page.evaluate(() => window.__XPD_POPUP_FIXTURE__.setState({
    busy: true, action: 'download', progressText: 'Local preview: example progress',
  }));
  await expect(page.locator('#downloadBtn')).toBeDisabled();
  await expect(page.locator('#refreshBtn')).toBeDisabled();
  await expect(page.locator('#progressText')).toContainText('Local preview');
  await page.evaluate(() => window.__XPD_POPUP_FIXTURE__.setState({ busy: false }));
  await expect(page.locator('#downloadBtn')).toBeEnabled();
  const downloads = [];
  page.on('download', (download) => downloads.push(download));
  await page.locator('#downloadBtn').click();
  await expect(page.locator('#result')).toHaveText('Local UI preview: no files are downloaded and nothing is copied.');
  expect(downloads).toHaveLength(0);
});

test('root fixture supports Chinese while the server denies unrelated repository files', async ({ page, request }) => {
  await page.goto('/?lang=zh_CN&theme=light');
  await page.locator('[data-role="launcher"]').click();
  await expect(page.locator('[data-role="statusText"]')).toHaveText(locales.zh_CN.ready.message);
  await expect(page.locator('[data-role="downloadBtn"]')).toHaveText(locales.zh_CN.download.message);
  for (const pathname of ['/package.json', '/.git/config', '/node_modules/@playwright/test/package.json', '/tests/popup.test.js']) {
    const response = await request.get(pathname);
    expect(response.status()).toBe(404);
  }
});
