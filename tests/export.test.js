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

test('structured renderer preserves ordered and nested lists and fenced code', () => {
  const context = createBaseContext();
  loadScript(context, 'content-selectors.js');
  loadScript(context, 'content-core.js');
  loadScript(context, 'content-export.js');
  const exp = context.window._XPD.exp;

  const markdown = exp.renderContentBlocks([
    {
      type: 'list',
      ordered: true,
      start: 3,
      items: [
        {
          type: 'listItem',
          inlines: [{ type: 'text', text: 'Third item' }],
          children: [{
            type: 'list',
            ordered: false,
            items: [{
              type: 'listItem',
              inlines: [{ type: 'text', text: 'Nested item' }],
              children: [],
              blocks: [],
            }],
          }],
          blocks: [],
        },
      ],
    },
    { type: 'code', language: 'js', text: 'const value = `literal`;\nreturn value;' },
  ]);

  assert.match(markdown, /3\. Third item\n   \n   - Nested item/);
  assert.match(markdown, /```js\nconst value = `literal`;\nreturn value;\n```/);
});

test('ordered list continuation uses the marker width, including multiple digits', () => {
  const context = createBaseContext();
  loadScript(context, 'content-selectors.js');
  loadScript(context, 'content-core.js');
  loadScript(context, 'content-export.js');
  const paragraph = (text) => ({ type: 'paragraph', inlines: [{ type: 'text', text }] });
  const markdown = context.window._XPD.exp.renderContentBlocks([{
    type: 'list', ordered: true, start: 9,
    items: [9, 10].map((number) => ({
      type: 'listItem', blocks: [paragraph(`Item ${number}`), {
        type: 'list', items: [{ type: 'listItem', blocks: [paragraph('Child')] }],
      }, paragraph('After')],
    })),
  }]);
  assert.equal(markdown, [
    '9. Item 9', '   ', '   - Child', '   ', '   After',
    '10. Item 10', '    ', '    - Child', '    ', '    After',
  ].join('\n'));
});

test('fenced code preserves blank lines and trailing whitespace at every nesting level', () => {
  const context = createBaseContext();
  loadScript(context, 'content-selectors.js');
  loadScript(context, 'content-core.js');
  loadScript(context, 'content-export.js');
  const text = 'const text = `a\n\n\nb`;  \n\n\n';
  const code = { type: 'code', language: 'js', text };
  const exp = context.window._XPD.exp;
  const fenced = `\`\`\`js\n${text}\`\`\``;
  assert.equal(exp.renderContentBlocks([code]), fenced);
  assert.equal(exp.renderContentBlocks([{ type: 'blockquote', blocks: [code] }]),
    fenced.split('\n').map((line) => `> ${line}`).join('\n'));
  assert.equal(exp.renderContentBlocks([{
    type: 'list', ordered: true, start: 10, items: [{ type: 'listItem', blocks: [code] }],
  }]), '10. ' + fenced.split('\n').join('\n    '));
});

test('blockquote renderer prefixes every nested line', () => {
  const context = createBaseContext();
  loadScript(context, 'content-selectors.js');
  loadScript(context, 'content-core.js');
  loadScript(context, 'content-export.js');

  const markdown = context.window._XPD.exp.renderContentBlocks([
    {
      type: 'blockquote',
      blocks: [
        { type: 'paragraph', inlines: [{ type: 'text', text: 'Quoted first' }] },
        { type: 'paragraph', inlines: [{ type: 'text', text: 'Quoted second' }] },
      ],
    },
  ]);

  assert.equal(markdown, ['> Quoted first', '> ', '> Quoted second'].join('\n'));
});

test('media budget accounts each image once and rejects oversized workloads', () => {
  const context = createBaseContext();
  loadScript(context, 'content-selectors.js');
  loadScript(context, 'content-core.js');
  loadScript(context, 'content-export.js');
  const exp = context.window._XPD.exp;
  const budget = exp.createMediaBudget(10);

  assert.equal(budget.add('image-a', 6), true);
  assert.equal(budget.add('image-a', 6), true);
  assert.equal(budget.add('image-b', 5), false);
  assert.equal(budget.totalBytes, 6);
  assert.equal(exp.estimateBase64Bytes('AQI='), 2);
  assert.throws(
    () => exp.validateImageWorkload(Array.from(
      { length: exp.MAX_ARCHIVE_IMAGE_COUNT + 1 },
      (_, i) => 'image-' + i
    )),
    (error) => error.code === 'MEDIA_IMAGE_COUNT_LIMIT'
  );
});

test('image dimensions stay within width and decoded pixel limits', () => {
  const context = createBaseContext();
  loadScript(context, 'content-selectors.js');
  loadScript(context, 'content-core.js');
  loadScript(context, 'content-export.js');
  const exp = context.window._XPD.exp;

  assert.deepEqual({ ...exp.fitImageDimensions(4000, 3000) }, { width: 1200, height: 900 });
  const tall = exp.fitImageDimensions(100, 100000);
  assert.ok(tall.width * tall.height <= exp.MAX_IMAGE_PIXELS);
  assert.ok(tall.width >= 1 && tall.height >= 1);
  assert.deepEqual({ ...exp.fitImageDimensions(0, 500) }, { width: 1, height: 1 });
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

test('ZIP generation checks cancellation during compression updates', async () => {
  const controller = new AbortController();
  let generateCalled = false;
  let downloadTriggered = false;
  class FakeZip {
    file() {}

    generateAsync(_options, onUpdate) {
      generateCalled = true;
      controller.abort('test');
      onUpdate({ percent: 50 });
      return Promise.resolve(new Blob(['unreachable']));
    }
  }
  const context = createBaseContext({
    globals: {
      JSZip: FakeZip,
      AbortController,
      URL: { createObjectURL: () => 'blob:fixture', revokeObjectURL: () => {} },
      setTimeout,
      clearTimeout,
    },
    document: {
      title: '',
      createElement: () => {
        downloadTriggered = true;
        return { style: {}, setAttribute() {}, click() {}, remove() {} };
      },
      body: { appendChild() {} },
    },
  });
  loadScript(context, 'content-selectors.js');
  loadScript(context, 'content-core.js');
  loadScript(context, 'content-export.js');

  const model = {
    title: 'Fixture',
    author: { displayName: '', handle: '' },
    kind: 'tweet',
    sourceUrl: '',
    blocks: [],
    thread: [],
    comments: [],
  };
  await assert.rejects(
    context.window._XPD.exp.downloadAsZip(model, {}, null, controller.signal),
    (error) => error.code === 'EXPORT_CANCELLED'
  );
  assert.equal(generateCalled, true);
  assert.equal(downloadTriggered, false);
});

test('ZIP fallback consumes prepared data URLs to keep its temporary live set small', async () => {
  const files = [];
  class FakeZip {
    file(path, value) {
      files.push({ path, value });
    }

    generateAsync() {
      return Promise.resolve(new Blob(['fixture zip']));
    }
  }
  const context = createBaseContext({
    globals: {
      JSZip: FakeZip,
      AbortController,
      URL: { createObjectURL: () => 'blob:fixture', revokeObjectURL: () => {} },
      setTimeout,
      clearTimeout,
    },
    document: {
      title: '',
      createElement: () => ({ style: {}, setAttribute() {}, click() {}, remove() {} }),
      body: { appendChild() {} },
    },
  });
  loadScript(context, 'content-selectors.js');
  loadScript(context, 'content-core.js');
  loadScript(context, 'content-export.js');

  const imageUrl = 'https://pbs.twimg.com/media/prepared';
  const preparedImages = { [imageUrl]: 'data:image/png;base64,AQ==' };
  const model = {
    title: 'Fixture',
    author: { displayName: '', handle: '' },
    kind: 'tweet',
    sourceUrl: '',
    blocks: [{ type: 'image', url: imageUrl, alt: 'Prepared' }],
    thread: [],
    comments: [],
  };

  await context.window._XPD.exp.downloadAsZip(model, {}, preparedImages);
  assert.deepEqual(Object.keys(preparedImages), []);
  assert.equal(files.some(({ path }) => path === 'images/image_1.png'), true);
});
