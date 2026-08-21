const { test, expect, chromium } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const RELEASE_FILES = require('../../scripts/release-files.json');
const STATUS_ID = '987654321';

function copyExtensionFixture(targetDirectory) {
  fs.mkdirSync(targetDirectory, { recursive: true });
  for (const relativePath of RELEASE_FILES) {
    fs.cpSync(
      path.join(PROJECT_ROOT, relativePath),
      path.join(targetDirectory, relativePath),
      { recursive: true }
    );
  }
}

function anonymousTweetFixture() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Anonymous extension fixture / X</title>
  </head>
  <body>
    <main data-testid="primaryColumn">
      <article data-testid="tweet">
        <div data-testid="User-Name">
          <a href="/fixture_author">Fixture Author</a>
        </div>
        <a href="/fixture_author/status/${STATUS_ID}">
          <time datetime="2026-08-21T08:30:00.000Z">Aug 21</time>
        </a>
        <div data-testid="tweetText" lang="en">
          Extension-level export fixture with <a href="https://example.com/reference">a link</a>.
        </div>
      </article>
    </main>
  </body>
</html>`;
}

test('loads the packaged MV3 extension and exports through its injected UI', async () => {
  test.setTimeout(30_000);
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xpd-extension-test-'));
  const extensionDirectory = path.join(temporaryRoot, 'extension');
  const userDataDirectory = path.join(temporaryRoot, 'user-data');
  copyExtensionFixture(extensionDirectory);

  let context;
  try {
    context = await chromium.launchPersistentContext(userDataDirectory, {
      channel: 'chromium',
      headless: true,
      acceptDownloads: true,
      args: [
        `--disable-extensions-except=${extensionDirectory}`,
        `--load-extension=${extensionDirectory}`,
      ],
    });
    await context.route('https://x.com/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: anonymousTweetFixture(),
      })
    );

    const page = await context.newPage();
    await page.goto(`https://x.com/fixture_author/status/${STATUS_ID}`);

    const launcher = page.locator('#xpd-floating-root [data-role="launcher"]');
    await expect(launcher).toBeVisible();
    await launcher.click();
    await expect(page.locator('#xpd-floating-root [data-role="downloadBtn"]')).toBeEnabled();

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#xpd-floating-root [data-role="downloadBtn"]').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^.+_\d{8}_\d{6}\.md$/);
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    const markdown = fs.readFileSync(downloadPath, 'utf8');
    expect(markdown).toContain('Extension-level export fixture');
    expect(markdown).toContain('Fixture Author (@fixture\\_author)');
    expect(markdown).toContain(`https://x.com/fixture_author/status/${STATUS_ID}`);

    let serviceWorker = context.serviceWorkers()[0];
    if (!serviceWorker) serviceWorker = await context.waitForEvent('serviceworker');
    expect(serviceWorker.url()).toMatch(/^chrome-extension:\/\/.+\/background\.js$/);
    const extensionId = new URL(serviceWorker.url()).hostname;

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(popup.locator('#versionText')).toHaveText('v1.7.0');
    await expect(popup.locator('#downloadBtn')).toBeVisible();
  } finally {
    await context?.close();
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
