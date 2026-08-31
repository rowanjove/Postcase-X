const { test, expect } = require('@playwright/test');

async function openPanel(page) {
  await page.goto('/');
  await page.getByRole('button', {
    name: 'X帖匣 · Postcase, drag to move',
    exact: true,
  }).click();
  await expect(page.locator('[data-role="statusText"]')).toHaveText(
    'Ready to export'
  );
}

async function holdImageRequests(page) {
  await page.evaluate(() => {
    const fixture = window.__XPD_FIXTURE__;
    const sendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);
    fixture.heldImageRequests = [];
    chrome.runtime.sendMessage = (message, callback) => {
      if (message?.type !== 'FETCH_IMAGE') return sendMessage(message, callback);
      return new Promise((resolve, reject) => {
        fixture.heldImageRequests.push(() => sendMessage(message, callback).then(resolve, reject));
      });
    };
  });
}

async function releaseImageRequests(page) {
  await page.evaluate(async () => {
    const requests = window.__XPD_FIXTURE__.heldImageRequests.splice(0);
    await Promise.all(requests.map((release) => release()));
  });
}

function visibleFeedback(page) {
  return page.locator('#xpd-floating-root [data-role="result"]:visible, #xpd-floating-root [data-role="toast"]:visible');
}

test('copies structured Markdown and privacy-safe diagnostics', async ({ page }) => {
  await openPanel(page);
  await page.getByRole('button', { name: 'Image links', exact: true }).click();
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(page.locator('[data-role="result"]')).toHaveText('Markdown copied');
  await expect(visibleFeedback(page)).toHaveCount(1);
  await expect(page.locator('[data-role="toast"]')).not.toBeVisible();

  const markdown = await page.locator('#fixture-output').textContent();
  expect(markdown).toContain('**Author**: Fixture Author (@fixture\\_author)');
  expect(markdown).toContain('[一个链接](<https://example.com/reference>)');
  expect(markdown).toContain(
    '![Fixture image](<https://pbs.twimg.com/media/fixture.jpg?format=jpg&name=large>)'
  );
  expect(markdown).not.toContain('__IMG_');

  await page.getByRole('button', { name: 'Copy diagnostics', exact: true }).click();
  await expect(page.locator('[data-role="result"]')).toHaveText('Diagnostic report copied');
  const diagnosticText = await page.locator('#fixture-output').textContent();
  const report = JSON.parse(diagnosticText);
  expect(report.selectorVersion).toBe(1);
  expect(report.page.kind).toBe('other');
  expect(report.privacy).toEqual({
    includesBodyText: false,
    includesAccount: false,
    includesStatusId: false,
    includesFullUrl: false,
  });
  expect(diagnosticText).not.toContain('Fixture 正文');
  expect(diagnosticText).not.toContain('fixture_author');
  expect(diagnosticText).not.toContain('987654321');
});

test('real DOM extraction preserves block boundaries and nested list semantics', async ({ page }) => {
  await page.goto('/');

  const extracted = await page.evaluate(() => {
    const root = document.createElement('div');
    root.innerHTML = '<div data-block="true"><h2>Section</h2><p>First</p><p>Second</p><ol start="3"><li>Third<ul><li>Nested</li></ul></li></ol><pre class="language-js">const x = 1;\nreturn x;</pre></div>';
    const result = window._XPD.core.extractRichContent(root);
    return {
      types: result.blocks.map((block) => block.type),
      ordered: result.blocks[3].ordered,
      start: result.blocks[3].start,
      nested: window._XPD.core.contentBlocksToPlainText(result.blocks[3].items[0].blocks),
      codeLanguage: result.blocks[4].language,
      markdown: window._XPD.exp.renderContentBlocks(result.blocks),
    };
  });

  expect(extracted.types).toEqual(['heading', 'paragraph', 'paragraph', 'list', 'code']);
  expect(extracted.ordered).toBe(true);
  expect(extracted.start).toBe(3);
  expect(extracted.nested).toBe('Third\nNested');
  expect(extracted.codeLanguage).toBe('js');
  expect(extracted.markdown).toContain('3. Third\n   \n   - Nested');
  expect(extracted.markdown).toContain('```js\nconst x = 1;\nreturn x;\n```');
});

test('wrapped timestamps do not remove bodies or quoted posts', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => {
    const root = document.createElement('article');
    root.innerHTML = '<div><div><a href="/alice/status/1"><span><time datetime="2026-08-31">Main timestamp</time></span></a></div><div data-testid="tweetText">Main body</div><article data-testid="tweet"><div><a href="/bob/status/2"><time datetime="2026-08-30">Quote timestamp</time></a><div data-testid="tweetText">Quoted body</div></div></article></div>';
    const { core, exp } = window._XPD;
    const extracted = core.extractRichContent(root);
    return { types: extracted.blocks.map((block) => block.type), markdown: exp.renderContentBlocks(extracted.blocks) };
  });
  expect(result.types).toEqual(['paragraph', 'quote']);
  expect(result.markdown).toContain('Main body');
  expect(result.markdown).toContain('> Quoted body');
  expect(result.markdown).not.toContain('Main timestamp');
  expect(result.markdown).not.toContain('Quote timestamp');
});

test('direct and captioned images remain in every export model', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => {
    const root = document.createElement('div');
    root.innerHTML = '<img src="https://pbs.twimg.com/media/direct?format=png" alt="Direct"><figure><img src="https://pbs.twimg.com/media/figure?format=png" alt="Figure"><figcaption>Caption</figcaption></figure><div data-testid="tweetPhoto"><a href="/alice/status/1/photo/1"><img src="https://pbs.twimg.com/media/linked?format=png" alt="Linked"></a></div>';
    const { core, exp } = window._XPD;
    const extracted = core.extractRichContent(root);
    const model = core.createPostDocument({ blocks: extracted.blocks });
    return { images: extracted.images, modelImages: core.collectImageUrlsFromBlocks(model.blocks), markdown: exp.renderContentBlocks(model.blocks) };
  });
  expect(result.images).toHaveLength(3);
  expect(result.modelImages).toEqual(result.images);
  expect(result.markdown).toContain('![Direct]');
  expect(result.markdown).toContain('![Figure]');
  expect(result.markdown).toContain('![Linked]');
  expect(result.markdown.indexOf('![Figure]')).toBeLessThan(result.markdown.indexOf('Caption'));
});

test('list blocks preserve DOM order and code whitespace through extraction and rendering', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => {
    const root = document.createElement('div');
    root.innerHTML = '<ol start="10"><li>Before<ul><li>Nested</li></ul><p>After</p>Tail<pre class="language-js"></pre></li></ol>';
    const code = 'const text = `a\n\n\nb`;  \n\n\n';
    root.querySelector('pre').textContent = code;
    const { core, exp } = window._XPD;
    const extracted = core.extractRichContent(root);
    return { code, text: core.contentBlocksToPlainText(extracted.blocks), markdown: exp.renderContentBlocks(extracted.blocks) };
  });
  expect(result.text).toBe(`Before\nNested\nAfter\nTail\n${result.code}`);
  expect(result.markdown).toBe([
    '10. Before', '    ', '    - Nested', '    ', '    After', '    ', '    Tail', '    ',
    '    ```js', ...result.code.split('\n').slice(0, -1).map((line) => `    ${line}`), '    ```',
  ].join('\n'));
});

test('shows determinate embed progress and produces an embedded Markdown file', async ({ page }) => {
  await openPanel(page);
  await page.getByRole('button', { name: 'Embed images', exact: true }).click();
  await page.getByRole('button', { name: 'Download', exact: true }).click();

  const progress = page.locator('[data-role="progressBar"]');
  await expect(progress).toHaveAttribute('aria-label', '1/2');
  await expect(page.locator('[data-role="result"]')).toHaveText('Download complete');
  await expect(page.locator('#fixture-download')).toContainText('hasEmbeddedImage');

  const download = JSON.parse(await page.locator('#fixture-download').textContent());
  expect(download.filename).toMatch(/^Post_\d{8}_\d{6}\.md$/);
  expect(download.mimeType).toBe('text/markdown');
  expect(download.hasEmbeddedImage).toBe(true);
  expect(download.size).toBeGreaterThan(0);
});

test('Escape restores launcher focus and the closed panel is skipped by Tab', async ({ page }) => {
  await openPanel(page);
  const launcher = page.locator('[data-role="launcher"]');
  const panel = page.locator('[data-role="panel"]');
  await expect(page.locator('[data-role="closeBtn"]')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('[data-mode="link"]')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(launcher).toBeFocused();
  await expect(launcher).toHaveAttribute('aria-expanded', 'false');
  await expect(panel).toHaveAttribute('inert', '');
  await expect(panel).not.toBeVisible();

  await page.evaluate(() => {
    const root = document.getElementById('xpd-floating-root');
    const before = document.createElement('button');
    before.id = 'fixture-focus-before';
    before.textContent = 'Before extension';
    const after = document.createElement('button');
    after.id = 'fixture-focus-after';
    after.textContent = 'After extension';
    root.before(before);
    root.after(after);
  });
  await page.locator('#fixture-focus-before').focus();
  await page.keyboard.press('Tab');
  await expect(launcher).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#fixture-focus-after')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(launcher).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(panel).toBeVisible();
  await expect(panel).not.toHaveAttribute('inert', '');
  await expect(page.locator('[data-role="closeBtn"]')).toBeFocused();
});

test('an export finishing while collapsed shows one toast and restores its result on open', async ({ page }) => {
  await openPanel(page);
  await holdImageRequests(page);
  await page.getByRole('button', { name: 'Embed images', exact: true }).click();
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__XPD_FIXTURE__.heldImageRequests.length)).toBe(2);
  await expect(page.locator('[data-role="cancelBtn"]')).toBeEnabled();
  await page.locator('[data-role="closeBtn"]').click();
  await expect(page.locator('[data-role="panel"]')).not.toBeVisible();

  await releaseImageRequests(page);
  await expect(page.locator('[data-role="toast"]')).toHaveText('Download complete');
  await expect(page.locator('[data-role="toast"]')).toBeVisible();
  await expect(visibleFeedback(page)).toHaveCount(1);
  await expect(page.locator('#fixture-download')).toContainText('hasEmbeddedImage');

  await page.locator('[data-role="launcher"]').click();
  await expect(page.locator('[data-role="result"]')).toHaveText('Download complete');
  await expect(page.locator('[data-role="result"]')).toBeVisible();
  await expect(page.locator('[data-role="toast"]')).not.toBeVisible();
  await expect(visibleFeedback(page)).toHaveCount(1);
});

test('an active export locks format and refresh controls until completion', async ({ page }) => {
  await openPanel(page);
  await holdImageRequests(page);
  const embed = page.getByRole('button', { name: 'Embed images', exact: true });
  const zip = page.getByRole('button', { name: 'ZIP archive', exact: true });
  const refresh = page.locator('[data-role="refreshBtn"]');
  await embed.click();
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__XPD_FIXTURE__.heldImageRequests.length)).toBe(2);

  for (const mode of ['link', 'embed', 'zip']) {
    await expect(page.locator(`[data-mode="${mode}"]`)).toBeDisabled();
  }
  await expect(refresh).toBeDisabled();
  await expect(page.locator('[data-role="copyBtn"]')).toBeDisabled();
  await expect(page.locator('[data-role="downloadBtn"]')).toBeDisabled();
  await zip.click({ force: true });
  await refresh.click({ force: true });
  await expect(embed).toHaveAttribute('aria-pressed', 'true');
  await expect(zip).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-role="progress"]')).toBeVisible();

  await releaseImageRequests(page);
  await expect(page.locator('[data-role="result"]')).toHaveText('Download complete');
  await expect(refresh).toBeEnabled();
  for (const mode of ['link', 'embed', 'zip']) {
    await expect(page.locator(`[data-mode="${mode}"]`)).toBeEnabled();
  }
  await expect(embed).toHaveAttribute('aria-pressed', 'true');
});

test('the panel stays within a narrow viewport after dragging to either side and the bottom', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 480 });
  await page.clock.install();
  await page.goto('/');
  const launcher = page.locator('[data-role="launcher"]');
  const panel = page.locator('[data-role="panel"]');
  await expect(launcher).toBeVisible();

  for (const [edge, x, y] of [['left', 0, 200], ['right', 319, 200], ['bottom', 160, 479]]) {
    await test.step(`drag to ${edge}`, async () => {
      const start = await launcher.boundingBox();
      expect(start).not.toBeNull();
      await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
      await page.mouse.down();
      await page.mouse.move(x, y, { steps: 8 });
      await page.mouse.up();
      // Advance the intentional post-drag click suppression without a wall-clock sleep.
      await page.clock.runFor(260);
      const moved = await launcher.boundingBox();
      if (edge === 'left') expect(moved.x).toBeLessThanOrEqual(13);
      if (edge === 'right') expect(moved.x + moved.width).toBeGreaterThanOrEqual(307);
      if (edge === 'bottom') expect(moved.y + moved.height).toBeGreaterThanOrEqual(467);

      await launcher.click();
      await expect(panel).toBeVisible();
      await expect.poll(() => panel.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return Math.max(0, -rect.left, -rect.top, rect.right - innerWidth, rect.bottom - innerHeight);
      })).toBeLessThanOrEqual(1);
      await page.locator('[data-role="closeBtn"]').click();
      await expect(panel).not.toBeVisible();
      await expect(launcher).toBeFocused();
    });
  }
});

test('content appearing after the initial refresh window becomes exportable without a manual refresh', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await page.evaluate(() => {
    const fixture = window.__XPD_FIXTURE__;
    fixture.delayedArticle = document.querySelector('article[data-testid="tweet"]');
    fixture.delayedArticle.remove();
  });
  await page.locator('[data-role="launcher"]').click();
  await expect(page.locator('[data-role="downloadBtn"]')).toBeDisabled();
  await expect(page.locator('[data-role="statusText"]')).not.toHaveText('Ready to export');

  // Let all 0/700/1600 ms startup checks finish while the body is absent.
  await page.clock.runFor(2000);
  await expect(page.locator('[data-role="downloadBtn"]')).toBeDisabled();
  await page.evaluate(() => {
    document.querySelector('main').prepend(window.__XPD_FIXTURE__.delayedArticle);
  });
  await page.clock.runFor(300);
  await expect(page.locator('[data-role="statusText"]')).toHaveText('Ready to export');
  await expect(page.locator('[data-role="downloadBtn"]')).toBeEnabled();
  await expect(page.locator('[data-role="copyBtn"]')).toBeEnabled();
});

test('cancels an active export without creating a partial download', async ({ page }) => {
  await openPanel(page);
  await page.getByRole('button', { name: 'Embed images', exact: true }).click();
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const cancel = page.getByRole('button', { name: 'Cancel', exact: true });
  await expect(cancel).toBeEnabled();
  await cancel.click();

  await expect(page.locator('[data-role="result"]')).toHaveText('Export cancelled');
  await expect(page.locator('[data-role="progress"]')).not.toBeVisible();
  await expect(page.locator('#fixture-download')).toBeEmpty();
});

test('packages structured Markdown and images as ZIP', async ({ page }) => {
  await openPanel(page);
  await page.getByRole('button', { name: 'ZIP archive', exact: true }).click();
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  await expect(page.locator('[data-role="result"]')).toHaveText('Download complete');
  await expect(page.locator('#fixture-download')).toContainText('application/zip');

  const download = JSON.parse(await page.locator('#fixture-download').textContent());
  expect(download.filename).toMatch(/^Post_\d{8}_\d{6}\.zip$/);
  expect(download.mimeType).toBe('application/zip');
  expect(download.size).toBeGreaterThan(0);
});
