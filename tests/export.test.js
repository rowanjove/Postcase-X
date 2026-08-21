const test = require('node:test');
const assert = require('node:assert/strict');

const { createBaseContext, loadScript } = require('./helpers/load-extension-module');

function loadExportModule() {
  const context = createBaseContext({
    window: { _XPD: { core: {} }, location: { href: 'https://x.com/home' } },
  });
  loadScript(context, 'content-export.js');
  return context.window._XPD.exp;
}

test('structured image nodes cannot consume placeholder-like post text', () => {
  const context = createBaseContext();
  loadScript(context, 'content-selectors.js');
  loadScript(context, 'content-core.js');
  loadScript(context, 'content-export.js');
  const documentModel = context.window._XPD.core.createPostDocument({
    title: 'Structured post',
    blocks: [
      { type: 'paragraph', inlines: [{ type: 'text', text: 'literal __IMG_0__' }] },
      { type: 'image', url: 'https://pbs.twimg.com/media/test', alt: 'image' },
    ],
  });

  const markdown = context.window._XPD.exp.buildMarkdownAsLink(documentModel, {
    includeAuthor: false,
    includeTime: false,
    includeStats: false,
    includeComments: false,
  });

  assert.match(markdown, /literal \\_\\_IMG\\_0\\_\\_/);
  assert.match(markdown, /!\[image\]\(<https:\/\/pbs\.twimg\.com\/media\/test>\)/);
});

test('generated Markdown escapes an untrusted title', () => {
  const context = createBaseContext();
  loadScript(context, 'content-selectors.js');
  loadScript(context, 'content-core.js');
  loadScript(context, 'content-export.js');

  const documentModel = context.window._XPD.core.createPostDocument({
    title: '<img src=x onerror=alert(1)>',
    blocks: [{ type: 'paragraph', inlines: [{ type: 'text', text: 'body' }] }],
  });
  const markdown = context.window._XPD.exp.buildMarkdownAsLink(documentModel, {
    includeAuthor: false,
    includeTime: false,
    includeStats: false,
    includeComments: false,
  });

  assert.match(markdown, /^# \\<img src=x onerror=alert\(1\)\\>/);
});

test('generated Markdown uses chrome.i18n metadata labels', () => {
  const translations = { md_author: 'Author', md_time: 'Time', md_stats: 'Engagement' };
  const context = createBaseContext({
    globals: {
      chrome: { i18n: { getMessage: (key) => translations[key] || '' } },
    },
  });
  loadScript(context, 'content-selectors.js');
  loadScript(context, 'content-core.js');
  loadScript(context, 'content-export.js');

  const documentModel = context.window._XPD.core.createPostDocument({
    title: 'Localized post',
    blocks: [{ type: 'paragraph', inlines: [{ type: 'text', text: 'body' }] }],
    author: { displayName: 'Alice', handle: '@alice' },
    publishedAt: '2026-08-20',
    stats: { replies: '1', retweets: '2', likes: '3' },
  });
  const markdown = context.window._XPD.exp.buildMarkdownAsLink(documentModel, {
    includeAuthor: true,
    includeTime: true,
    includeStats: true,
    includeComments: false,
  });

  assert.match(markdown, /\*\*Author\*\*: Alice/);
  assert.match(markdown, /\*\*Time\*\*: 2026-08-20/);
  assert.match(markdown, /\*\*Engagement\*\*:/);
});

test('structured renderer preserves block order and resolves nested images', () => {
  const context = createBaseContext();
  loadScript(context, 'content-selectors.js');
  loadScript(context, 'content-core.js');
  loadScript(context, 'content-export.js');
  const exp = context.window._XPD.exp;
  const blocks = [
    { type: 'heading', level: 2, inlines: [{ type: 'text', text: 'Section' }] },
    { type: 'paragraph', inlines: [{ type: 'text', text: 'Before' }] },
    { type: 'image', url: 'https://pbs.twimg.com/media/main', alt: 'Main image' },
    {
      type: 'quote',
      label: 'Quoted post',
      author: { displayName: 'Bob', handle: '@bob' },
      time: null,
      blocks: [{
        type: 'paragraph',
        inlines: [
          { type: 'text', text: 'Quoted body ' },
          { type: 'image', url: 'https://pbs.twimg.com/media/quote', alt: 'Quote image' },
        ],
      }],
    },
    {
      type: 'card',
      title: 'Example',
      summary: 'Summary',
      domain: 'example.com',
      url: 'https://example.com/',
    },
  ];

  const markdown = exp.renderContentBlocks(
    blocks,
    (url) => `images/${url.split('/').pop()}.png`
  );

  assert.ok(markdown.indexOf('## Section') < markdown.indexOf('Before'));
  assert.ok(markdown.indexOf('Before') < markdown.indexOf('images/main.png'));
  assert.match(markdown, /> Quoted post · Bob \(@bob\)/);
  assert.match(markdown, /> !\[Quote image\]\(<images\/quote\.png>\)/);
  assert.match(markdown, /\[Example\]\(<https:\/\/example\.com\/>\)/);
});

test('image work respects the concurrency limit and reports total progress', async () => {
  const context = createBaseContext({ globals: { setTimeout } });
  loadScript(context, 'content-export.js');
  const exp = context.window._XPD.exp;
  let active = 0;
  let maxActive = 0;
  const progress = [];

  const results = await exp.mapWithConcurrency(
    [1, 2, 3, 4, 5, 6, 7],
    3,
    async (value) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return value * 2;
    },
    new AbortController().signal,
    (completed, total) => progress.push([completed, total])
  );

  assert.equal(maxActive, 3);
  assert.deepEqual(Array.from(results), [2, 4, 6, 8, 10, 12, 14]);
  assert.deepEqual(Array.from(progress.at(-1)), [7, 7]);
});

test('concurrent image work stops after cancellation', async () => {
  const context = createBaseContext({ globals: { setTimeout } });
  loadScript(context, 'content-export.js');
  const exp = context.window._XPD.exp;
  const controller = new AbortController();
  let started = 0;

  const work = exp.mapWithConcurrency(
    [1, 2, 3, 4, 5],
    2,
    async () => {
      started += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
    },
    controller.signal
  );
  setTimeout(() => controller.abort('test'), 1);

  await assert.rejects(work, (error) => exp.isCancelledError(error));
  assert.ok(started <= 2);
});
