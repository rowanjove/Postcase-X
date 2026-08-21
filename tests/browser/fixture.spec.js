const { test, expect } = require('@playwright/test');

async function openPanel(page) {
  await page.goto('/');
  await page.getByRole('button', {
    name: 'X Markdown Exporter, drag to move',
    exact: true,
  }).click();
  await expect(page.locator('[data-role="statusText"]')).toHaveText(
    'Ready to export this content'
  );
}

test('copies structured Markdown and privacy-safe diagnostics', async ({ page }) => {
  await openPanel(page);
  await page.getByRole('button', { name: 'Image links', exact: true }).click();
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(page.locator('[data-role="result"]')).toHaveText('Markdown copied');

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
