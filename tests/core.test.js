const test = require('node:test');
const assert = require('node:assert/strict');

const { createBaseContext, loadScript } = require('./helpers/load-extension-module');

function loadCore(overrides) {
  const context = createBaseContext(overrides);
  loadScript(context, 'content-selectors.js');
  loadScript(context, 'content-core.js');
  return { context, core: context.window._XPD.core };
}

// Small DOM doubles expose the same ownership relationships as a detail page;
// selectors return descendants while closest() identifies their owning tweet.
function tweetFixture(statusId, handle = 'alice') {
  const handleLink = {
    getAttribute: () => `/${handle}`,
    cloneNode: () => ({ textContent: handle, querySelectorAll: () => [] }),
  };
  const author = {
    querySelectorAll: () => [handleLink],
    querySelector: () => handleLink,
  };
  const time = { getAttribute: () => '2026-08-20T10:30:00Z' };
  const tweet = {
    parentElement: null,
    containers: [],
    links: [],
    closest: (selector) => selector === 'article[data-testid="tweet"]' ? tweet : null,
    querySelector: (selector) => selector === '[data-testid="User-Name"]' ? author : time,
    querySelectorAll: (selector) => {
      if (selector === 'a[href]') return tweet.links;
      if (selector.includes('[data-testid="article-content"]')) return tweet.containers;
      return [];
    },
  };
  tweet.links.push({
    getAttribute: () => `/${handle}/status/${statusId}`,
    closest: (selector) => selector === 'article[data-testid="tweet"]' ? tweet : null,
    querySelector: (selector) => selector === 'time' ? time : null,
  });
  return tweet;
}

function articleBodyFixture(text, owner = null, { editable = false, explicit = true } = {}) {
  const container = {
    parentElement: owner,
    closest: (selector) => {
      if (selector === 'article[data-testid="tweet"]') return owner;
      if (selector.includes('contenteditable') && editable) return container;
      return null;
    },
    matches: (selector) => selector.includes('[data-testid="noteContent"]') && explicit,
    querySelectorAll: () => [paragraph],
  };
  const paragraph = {
    tagName: 'P',
    parentElement: container,
    childNodes: [{ nodeType: 3, textContent: text }],
  };
  return container;
}

function detailDocument(tweets, containers = [], primaryColumn = null) {
  return {
    title: '',
    querySelector: (selector) => selector === '[data-testid="primaryColumn"]' ? primaryColumn : null,
    querySelectorAll: (selector) => selector === 'article[data-testid="tweet"]'
      ? tweets
      : selector.includes('[data-testid="article-content"]') ? containers : [],
  };
}

class RichElement {
  constructor(tagName, attributes = {}, children = []) {
    this.nodeType = 1;
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map(Object.entries(attributes));
    this.className = attributes.class || '';
    this.childNodes = [];
    children.forEach((child) => this.appendChild(child));
  }

  appendChild(child) {
    child.parentElement = this;
    this.childNodes.push(child);
    return child;
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  matches(selector) {
    return selector.split(',').some((part) => {
      const normalized = part.trim();
      const tag = normalized.match(/^([a-z0-9]+)/i)?.[1];
      if (tag && this.tagName.toLowerCase() !== tag.toLowerCase()) return false;
      const attr = normalized.match(/\[([^=\]]+)(?:=["']?([^\]"']+)["']?)?\]/);
      if (!attr) return Boolean(tag);
      const value = this.getAttribute(attr[1]);
      return value !== null && (attr[2] === undefined || value === attr[2]);
    });
  }

  querySelectorAll(selector) {
    const matches = [];
    const visit = (node) => {
      for (const child of node.childNodes || []) {
        if (child.nodeType === 1) {
          if (child.matches(selector)) matches.push(child);
          visit(child);
        }
      }
    };
    visit(this);
    return matches;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  get textContent() {
    return this.childNodes.map((child) => child.textContent || '').join('');
  }
}

function richText(text) {
  return { nodeType: 3, textContent: text, parentElement: null };
}

function richElement(tagName, attributes, children) {
  return new RichElement(tagName, attributes, children);
}

function threadArticle(statusId, handle, relationText, body) {
  const article = tweetFixture(statusId, handle);
  const paragraph = richElement('p', {}, [richText(body)]);
  const relation = {
    getAttribute: (name) => name === 'aria-label' ? relationText : null,
    textContent: relationText,
  };
  const author = article.querySelector('[data-testid="User-Name"]');
  const time = article.querySelector('time[datetime]');
  article.querySelector = (selector) => {
    if (selector === '[data-testid="User-Name"]') return author;
    if (selector === 'time[datetime]') return time;
    return null;
  };
  article.querySelectorAll = (selector) => {
    if (selector === '[data-testid="socialContext"]' || selector === '[aria-label]') {
      return relationText ? [relation] : [];
    }
    if (selector === 'a[href]') return article.links;
    return [paragraph];
  };
  return article;
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

test('article detection rejects unrelated rich-text containers, even on a detail route', () => {
  const tweet = tweetFixture('123');
  const articleContainer = articleBodyFixture('Unrelated draft');
  const document = detailDocument([tweet], [articleContainer]);
  const window = { _XPD: {}, location: { href: 'https://x.com/home' } };
  const { core } = loadCore({ document, window });

  assert.equal(core.detectArticlePage(), false);
  window.location.href = 'https://x.com/alice/status/123';
  assert.equal(core.detectArticlePage(), false);
  tweet.containers.push(articleBodyFixture('Target article', tweet));
  assert.equal(core.detectArticlePage(), true);
});

test('getMainTweet matches a complete status id owned by that tweet', () => {
  const prefixMatch = tweetFixture('1234', 'prefix');
  const quotedTarget = tweetFixture('123', 'quoted');
  const quoteWrapper = tweetFixture('999', 'wrapper');
  quoteWrapper.links.push(...quotedTarget.links);
  const actualTarget = tweetFixture('123');
  const { core } = loadCore({
    document: detailDocument([prefixMatch, quoteWrapper, actualTarget]),
    window: { _XPD: {}, location: { href: 'https://x.com/alice/status/123' } },
  });

  assert.equal(core.getMainTweet(), actualTarget);
});

test('a div quote cannot identify its wrapper as the target before the real post loads', () => {
  const wrapper = tweetFixture('999', 'wrapper');
  const quote = {
    parentElement: wrapper,
    closest: (selector) => selector.includes('[role="link"]')
      ? quote
      : selector === 'article[data-testid="tweet"]' ? wrapper : null,
  };
  wrapper.links.push({
    parentElement: quote,
    getAttribute: () => '/alice/status/123',
    closest: (selector) => selector === 'article[data-testid="tweet"]' ? wrapper : null,
    querySelector: (selector) => selector === 'time' ? {} : null,
  });
  const quotedBody = articleBodyFixture('Quoted article', wrapper);
  quotedBody.parentElement = quote;
  wrapper.containers.push(quotedBody);
  const tweets = [wrapper];
  const window = { _XPD: {}, location: { href: 'https://x.com/i/web/status/123' } };
  const { core } = loadCore({ document: detailDocument(tweets), window });

  assert.equal(core.getMainTweet(), null);
  assert.equal(core.detectArticlePage(), false);
  const ownTimestamp = wrapper.links.shift();
  assert.equal(core.getMainTweet(), null, 'a quote must not substitute for a missing own timestamp');
  wrapper.links.unshift(ownTimestamp);
  const target = tweetFixture('123');
  // An explicit role=link on the timestamp anchor itself is still a permalink.
  target.links[0].parentElement = target;
  target.links[0].getAttribute = () => '/i/web/status/123';
  const ownClosest = target.links[0].closest;
  target.links[0].closest = (selector) => selector.includes('[role="link"]')
    ? target.links[0]
    : ownClosest(selector);
  tweets.push(target);
  assert.equal(core.getMainTweet(), target);
  window.location.href = 'https://twitter.com/alice/status/123';
  assert.equal(core.getMainTweet(), target);
});

test('a quoted article does not make an unloaded main article appear ready', () => {
  const target = tweetFixture('123');
  const quote = {
    parentElement: target,
    closest: (selector) => selector.includes('[role="link"]')
      ? quote
      : selector === 'article[data-testid="tweet"]' ? target : null,
  };
  const quotedBody = articleBodyFixture('Quoted article', target);
  quotedBody.parentElement = quote;
  target.containers.push(quotedBody);
  const { core } = loadCore({
    document: detailDocument([target]),
    window: { _XPD: {}, location: { href: 'https://x.com/alice/status/123' } },
  });

  assert.equal(core.getMainTweet(), target);
  assert.equal(core.detectArticlePage(), false);
  assert.equal(core.extractArticle().blocks.length, 0);
  target.containers.push(articleBodyFixture('Main article now loaded', target));
  assert.equal(core.detectArticlePage(), true);
  assert.equal(core.contentBlocksToPlainText(core.extractArticle().blocks), 'Main article now loaded');
});

test('article extraction uses the target body and its author, excluding other page content', () => {
  const unrelatedTweet = tweetFixture('999', 'other');
  const target = tweetFixture('123', 'alice');
  const body = articleBodyFixture('Target body', target);
  const quotedBody = articleBodyFixture('Quoted article', tweetFixture('777', 'quoted'));
  const editor = articleBodyFixture('Private draft', target, { editable: true });
  target.containers.push(body, quotedBody, editor);
  const unrelatedBody = articleBodyFixture('Unrelated article', unrelatedTweet);
  const { core } = loadCore({
    document: detailDocument([unrelatedTweet, target], [unrelatedBody, body]),
    window: { _XPD: {}, location: { href: 'https://x.com/alice/status/123' } },
  });

  const result = core.extractArticle();
  assert.equal(core.contentBlocksToPlainText(result.blocks), 'Target body');
  assert.equal(result.author.handle, '@alice');
  assert.equal(core.getArticleContext().owner, target);
});

test('standalone article extraction limits its scope and rejects ambiguous bodies', () => {
  const unrelatedTweet = tweetFixture('999', 'other');
  const body = articleBodyFixture('Standalone body');
  const draft = articleBodyFixture('Draft', null, { editable: true, explicit: false });
  const primaryBodies = [body, draft];
  const primaryColumn = { querySelectorAll: () => primaryBodies };
  const { core } = loadCore({
    document: detailDocument([unrelatedTweet], [articleBodyFixture('Outside main column')], primaryColumn),
    window: { _XPD: {}, location: { href: 'https://x.com/i/article/123' } },
  });

  const result = core.extractArticle();
  assert.equal(core.contentBlocksToPlainText(result.blocks), 'Standalone body');
  assert.equal(result.author.handle, '@unknown');
  primaryBodies.push(articleBodyFixture('Another article'));
  assert.equal(core.detectArticlePage(), false);
  assert.equal(core.extractArticle().blocks.length, 0);
});

test('profile avatar links do not become preview cards or replace the post title', () => {
  class Anchor {
    constructor(href, hasMedia = true) { this.href = href; this.hasMedia = hasMedia; }
    tagName = 'A';
    parentElement = null;
    textContent = '';
    closest = () => null;
    matches = () => false;
    getAttribute = () => this.href;
    querySelectorAll = () => [];
    querySelector = (selector) => selector === 'img, video' && this.hasMedia ? {} : null;
  }
  const avatar = new Anchor('/alice');
  const externalCard = new Anchor('https://example.com/article');
  const body = articleBodyFixture('Actual body').querySelectorAll()[0];
  const { core } = loadCore({ Element: Anchor });
  const extracted = core.extractRichContent({ querySelectorAll: () => [avatar, body, externalCard] });

  assert.equal(core.deriveTitleFromBlocks(extracted.blocks), 'Actual body');
  assert.equal(extracted.blocks.filter((block) => block.type === 'card').length, 1);
  assert.equal(extracted.blocks.find((block) => block.type === 'card').url, 'https://example.com/article');
});

test('structured extraction preserves block boundaries and nested list semantics', () => {
  const root = richElement('div', { 'data-testid': 'article-content' }, [
    richElement('div', { 'data-block': 'true' }, [
      richElement('h2', {}, [richText('Section')]),
      richElement('p', {}, [richText('First paragraph')]),
      richElement('p', {}, [richText('Second paragraph')]),
      richElement('ol', { start: '3' }, [
        richElement('li', {}, [
          richText('Third item'),
          richElement('ul', {}, [richElement('li', {}, [richText('Nested item')])]),
        ]),
        richElement('li', {}, [richText('Fourth item')]),
      ]),
      richElement('pre', { class: 'language-js' }, [richText('const x = 1;\n  return x;')]),
    ]),
  ]);
  const { core } = loadCore({ Element: RichElement });

  const extracted = core.extractRichContent(root);

  assert.deepEqual(Array.from(extracted.blocks, (block) => block.type), [
    'heading', 'paragraph', 'paragraph', 'list', 'code',
  ]);
  assert.equal(extracted.blocks[3].ordered, true);
  assert.equal(extracted.blocks[3].start, 3);
  assert.equal(core.contentBlocksToPlainText(extracted.blocks[3].items[0].blocks), 'Third item\nNested item');
  assert.equal(extracted.blocks[4].language, 'js');
  assert.match(core.contentBlocksToPlainText(extracted.blocks), /First paragraph\nSecond paragraph/);
});

test('stats follow semantic labels across native buttons, reordering, and localized counts', () => {
  const actionGroup = richElement('div', { role: 'group', id: 'actions' }, [
    richElement('button', { 'aria-label': '5 Likes' }, [richText('5')]),
    richElement('button', { 'aria-label': '2 replies' }, [richText('2')]),
    richElement('button', { role: 'button', 'aria-label': '1.5万 转发' }, [richText('1.5万')]),
  ]);
  const tweet = richElement('article', { 'data-testid': 'tweet' }, [actionGroup]);
  const { core } = loadCore({ Element: RichElement });

  const stats = core.extractStats(tweet);
  assert.equal(stats.replies, '2');
  assert.equal(stats.retweets, '1.5万');
  assert.equal(stats.likes, '5');
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

test('thread extraction requires an explicit reply or thread relation', () => {
  const main = tweetFixture('100', 'alice');
  const verified = threadArticle('101', 'alice', 'Replying to @alice', 'Second post');
  const ambiguous = threadArticle('102', 'alice', '', 'Unrelated adjacent post');
  const { core } = loadCore({
    document: detailDocument([main, verified, ambiguous]),
    window: { _XPD: {}, location: { href: 'https://x.com/alice/status/100' } },
  });

  const thread = core.extractThreadTweets(main);
  assert.equal(thread.length, 1);
  assert.equal(core.hasVerifiedThreadRelation(verified, '@alice'), true);
  assert.equal(core.hasVerifiedThreadRelation(ambiguous, '@alice'), false);
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

test('image upgrades honor query parameter order and the exact media host', () => {
  const { core } = loadCore();
  for (const query of ['name=small&format=jpg', 'format=jpg&name=small', 'format=jpg']) {
    const upgraded = new URL(core.upgradeImageUrl(`https://pbs.twimg.com/media/example?${query}`));
    assert.equal(upgraded.searchParams.get('name'), 'large');
    assert.equal(upgraded.searchParams.get('format'), 'jpg');
  }
  const unrelated = 'https://example.com/pbs.twimg.com/media/example?name=small';
  assert.equal(core.upgradeImageUrl(unrelated), unrelated);
  const avatar = 'https://pbs.twimg.com/profile_images/example?name=small';
  assert.equal(core.upgradeImageUrl(avatar), avatar);
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
  assert.equal(documentModel.schemaVersion, 2);
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
