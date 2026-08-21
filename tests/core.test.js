const test = require('node:test');
const assert = require('node:assert/strict');

const { createBaseContext, loadScript } = require('./helpers/load-extension-module');

function loadCore(overrides) {
  const context = createBaseContext(overrides);
  loadScript(context, 'content-selectors.js');
  loadScript(context, 'content-core.js');
  return { context, core: context.window._XPD.core };
}

test('classifyPageRoute supports both public and canonical status URLs', () => {
  const { core } = loadCore();

  assert.deepEqual(
    { ...core.classifyPageRoute('https://x.com/alice/status/123') },
    { kind: 'tweet', statusId: '123' }
  );
  assert.deepEqual(
    { ...core.classifyPageRoute('https://x.com/i/web/status/456') },
    { kind: 'tweet', statusId: '456' }
  );
  assert.deepEqual(
    { ...core.classifyPageRoute('https://twitter.com/i/web/status/789') },
    { kind: 'tweet', statusId: '789' }
  );
});

test('article detection rejects rich-text containers on non-detail pages', () => {
  const articleContainer = { parentElement: null };
  const document = {
    title: '',
    querySelector: () => null,
    querySelectorAll: (selector) =>
      selector.includes('[data-testid="article-content"]') ? [articleContainer] : [],
  };
  const window = { _XPD: {}, location: { href: 'https://x.com/home' } };
  const { core } = loadCore({ document, window });

  assert.equal(core.detectArticlePage(), false);
  window.location.href = 'https://x.com/alice/status/123';
  assert.equal(core.detectArticlePage(), true);
});

test('getMainTweet fails closed when the target status id is absent', () => {
  const unrelatedArticle = {
    parentElement: null,
    querySelectorAll: () => [],
  };
  const document = {
    title: '',
    querySelector: () => null,
    querySelectorAll: (selector) =>
      selector === 'article[data-testid="tweet"]' ? [unrelatedArticle] : [],
  };
  const window = { _XPD: {}, location: { href: 'https://x.com/alice/status/123' } };
  const { core } = loadCore({ document, window });

  assert.equal(core.getMainTweet(), null);
});

test('thread extraction does not group entries whose authors are unknown', () => {
  const makeArticle = () => ({
    parentElement: null,
    querySelector: () => null,
    querySelectorAll: () => [],
  });
  const articles = [makeArticle(), makeArticle(), makeArticle()];
  const document = {
    title: '',
    querySelector: () => null,
    querySelectorAll: (selector) =>
      selector === 'article[data-testid="tweet"]' ? articles : [],
  };
  const { core } = loadCore({ document });

  assert.equal(core.extractThreadTweets(articles[0]).length, 0);
});

test('untrusted text is escaped before it becomes Markdown', () => {
  const { core } = loadCore();
  const escaped = core.escapeMarkdownText('<img src=x onerror=alert(1)>\n---\n# heading');

  assert.equal(
    escaped,
    '\\<img src=x onerror=alert(1)\\>\n\\---\n\\# heading'
  );
  assert.equal(core.deriveTitleText(core.escapeMarkdownText('Hello *world*')), 'Hello world');
});

test('PostDocument rejects empty bodies and collects nested image nodes', () => {
  const { core } = loadCore();

  assert.throws(
    () => core.createPostDocument({ kind: 'tweet', blocks: [] }),
    (error) => error.code === 'DOCUMENT_EMPTY'
  );

  const documentModel = core.createPostDocument({
    kind: 'tweet',
    blocks: [
      { type: 'paragraph', inlines: [{ type: 'text', text: 'body' }] },
      {
        type: 'quote',
        blocks: [{ type: 'image', url: 'https://pbs.twimg.com/media/quoted', alt: 'quote' }],
      },
    ],
    thread: [{
      blocks: [{
        type: 'paragraph',
        inlines: [{ type: 'image', url: 'https://pbs.twimg.com/media/thread', alt: 'thread' }],
      }],
    }],
  });

  const imageUrls = core.collectImageUrlsFromBlocks(documentModel.blocks, []);
  core.collectImageUrlsFromBlocks(documentModel.thread[0].blocks, imageUrls);
  assert.deepEqual(Array.from(imageUrls), [
    'https://pbs.twimg.com/media/quoted',
    'https://pbs.twimg.com/media/thread',
  ]);
  assert.equal(documentModel.schemaVersion, 1);
});

test('diagnostic report exposes selector signals without page content or identifiers', () => {
  const secretBody = 'private fixture body';
  const document = {
    title: secretBody,
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const window = {
    _XPD: {},
    location: { href: 'https://x.com/secret_author/status/987654321' },
  };
  const { core, context } = loadCore({
    document,
    window,
    globals: {
      chrome: { runtime: { getManifest: () => ({ version: '1.7.0' }) } },
    },
  });

  const report = core.buildDiagnosticReport();
  const serialized = context.window._XPD.core.serializeDiagnosticReport();
  assert.equal(report.selectorVersion, 1);
  assert.equal(report.extensionVersion, '1.7.0');
  assert.equal(report.page.kind, 'tweet');
  assert.equal(report.page.site, 'x.com');
  assert.equal(report.privacy.includesBodyText, false);
  for (const secret of [secretBody, 'secret_author', '987654321', window.location.href]) {
    assert.equal(serialized.includes(secret), false, `Diagnostic leaked ${secret}`);
  }
});

test('selector adapter is versioned and owns X DOM selector literals', () => {
  const context = createBaseContext();
  loadScript(context, 'content-selectors.js');
  const adapter = context.window._XPD.dom;

  assert.equal(adapter.version, 1);
  assert.equal(adapter.css.tweetArticle, 'article[data-testid="tweet"]');
  assert.equal(typeof adapter.richContentCandidates(true), 'string');
  assert.match(adapter.richContentCandidates(true), /article\[data-testid="tweet"\]/);
});
