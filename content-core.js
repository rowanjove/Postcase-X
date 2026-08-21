// X Markdown Exporter - Core Module
// Utilities, escaping helpers, and DOM extraction logic.

(function () {
  'use strict';

  const _XPD = (window._XPD = window._XPD || {});
  const dom = _XPD.dom;
  if (!dom) throw new Error('XPD DOM selector adapter is not loaded');

  function t(key, fallback) {
    try {
      return chrome.i18n?.getMessage(key) || fallback;
    } catch {
      return fallback;
    }
  }

  _XPD.t = t;

  // ── Constants ──────────────────────────────────────────────────────

  const MAX_IMAGE_WIDTH = 1200;
  const JPEG_QUALITY = 0.7;
  const POST_DETAIL_URL_RE =
    /^https:\/\/(?:x\.com|twitter\.com)\/(?:[^/]+\/status|i\/web\/status)\/\d+(?:[/?#]|$)/i;
  const ARTICLE_DETAIL_PATH_RE = /^\/i\/(?:article|notes?)\/\d+(?:\/|$)/i;
  const GITHUB_ISSUES_URL = 'https://github.com/rowanjove/x-markdown-exporter/issues';

  // ── Escaping helpers ───────────────────────────────────────────────

  function escapeHtml(text) {
    return (text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeMarkdownText(text) {
    return String(text || '')
      .replace(/\\/g, '\\\\')
      .replace(/([*_`~\[\]<>#!|])/g, '\\$1')
      .replace(/^(\s*)([-+=])(?=(?:\s|[-+=]))/gm, '$1\\$2')
      .replace(/^(\s*)(\d+)\.(?=\s)/gm, '$1$2\\.');
  }

  function escapeMarkdownLinkLabel(text) {
    return escapeMarkdownText(text || 'Link').replace(/\r?\n/g, ' ');
  }

  function escapeMarkdownUrl(url) {
    return String(url || '')
      .replace(/[\r\n]/g, '')
      .replace(/</g, '%3C')
      .replace(/>/g, '%3E');
  }

  // ── Text stripping ────────────────────────────────────────────────

  function stripImageMarkdown(text) {
    return (text || '')
      .replace(/!\[[^\]]*\]\([^)]+\)/g, '\n');
  }

  function stripMarkdownSyntax(text) {
    return (text || '')
      .replace(/\\([\\*_`~\[\]<>#!|])/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^>\s?/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/^\s*\d+\.\s+/gm, '')
      .replace(/[*_`~]/g, '')
      .replace(/\r/g, '')
      .replace(/\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function looksLikeImageLabel(text) {
    return /^(image|图片)\s*\d*$/i.test((text || '').trim());
  }

  function deriveTitleText(markdownText) {
    const imageFreeText = stripImageMarkdown(markdownText);
    const lines = imageFreeText
      .split(/\n+/)
      .map((line) => stripMarkdownSyntax(line))
      .filter((line) => line && !looksLikeImageLabel(line));

    const fallbackTitle = stripMarkdownSyntax(
      (document.title || '').replace(/\s*[|｜/-]\s*X\s*$/i, '')
    );
    const title =
      lines[0] || stripMarkdownSyntax(imageFreeText) || fallbackTitle || 'Post';
    return title.substring(0, 100).trim();
  }

  // ── URL helpers ────────────────────────────────────────────────────

  function upgradeImageUrl(src) {
    if (src.includes('pbs.twimg.com/media')) {
      src = src.replace(/&name=\w+/, '&name=large');
      if (!src.includes('name=')) {
        src += (src.includes('?') ? '&' : '?') + 'name=large';
      }
    }
    return src;
  }

  function normalizeAnchorUrl(href) {
    if (!href) return '';
    if (href.startsWith('http://') || href.startsWith('https://')) return href;
    if (href.startsWith('//')) return `https:${href}`;
    if (href.startsWith('/')) return `https://x.com${href}`;
    return '';
  }

  function classifyPageRoute(href = window.location.href) {
    try {
      const parsed = new URL(href);
      const hostname = parsed.hostname.replace(/^www\./i, '').toLowerCase();
      if (hostname !== 'x.com' && hostname !== 'twitter.com') {
        return { kind: 'other', statusId: null };
      }

      const statusMatch = parsed.pathname.match(
        /^\/(?:[^/]+\/status|i\/web\/status)\/(\d+)(?:\/|$)/i
      );
      if (statusMatch) return { kind: 'tweet', statusId: statusMatch[1] };
      if (ARTICLE_DETAIL_PATH_RE.test(parsed.pathname)) {
        return { kind: 'article', statusId: null };
      }
      return { kind: 'other', statusId: null };
    } catch {
      return { kind: 'other', statusId: null };
    }
  }

  function getSourceUrl(href = window.location.href) {
    try {
      const parsed = new URL(href);
      return `${parsed.origin}${parsed.pathname}`;
    } catch {
      return String(href || '').split('#')[0];
    }
  }

  class ExtractionError extends Error {
    constructor(code, message) {
      super(message);
      this.name = 'ExtractionError';
      this.code = code;
    }
  }

  function hasMeaningfulExtractedText(text) {
    return stripMarkdownSyntax(stripImageMarkdown(text || '')).length > 0;
  }

  function inlineNodesToPlainText(inlines) {
    return (inlines || []).map((inline) => {
      if (inline?.type === 'text') return inline.text || '';
      if (inline?.type === 'link') return inline.label || '';
      if (inline?.type === 'image') return inline.alt || '';
      return '';
    }).join('');
  }

  function contentBlocksToPlainText(blocks) {
    return (blocks || []).map((block) => {
      if (!block) return '';
      if (block.type === 'paragraph' || block.type === 'heading' ||
          block.type === 'listItem' || block.type === 'blockquote') {
        return inlineNodesToPlainText(block.inlines);
      }
      if (block.type === 'card') {
        return [block.title, block.summary, block.domain].filter(Boolean).join(' ');
      }
      if (block.type === 'quote') return contentBlocksToPlainText(block.blocks);
      return '';
    }).filter(Boolean).join('\n');
  }

  function hasMeaningfulContentBlocks(blocks) {
    if (contentBlocksToPlainText(blocks).trim()) return true;
    return (blocks || []).some((block) => {
      if (block?.type === 'image' || block?.type === 'card') return true;
      if (block?.type === 'quote') return hasMeaningfulContentBlocks(block.blocks);
      return (block?.inlines || []).some((inline) => inline?.type === 'image');
    });
  }

  function deriveTitleFromBlocks(blocks) {
    return deriveTitleText(contentBlocksToPlainText(blocks));
  }

  function buildExtractionRetryHint(pageKind) {
    if (pageKind === 'tweet') return t('retry_tweet', '请先打开推文详情页后重试');
    if (pageKind === 'note') return t('retry_note', '请先打开 Note 页面后重试');
    return t('retry_page', '请刷新页面后重试');
  }

  function buildExtractionFailureMessage(pageKind) {
    const pageLabel = pageKind === 'tweet'
      ? t('kind_tweet', '推文')
      : pageKind === 'note'
        ? t('label_note_page', 'Note 页面')
        : t('label_current_page', '当前页面');
    const retryHint = buildExtractionRetryHint(pageKind);
    return `${pageLabel}${t('extraction_empty', '内容提取为空，可能是 X 页面结构已更新。')}${retryHint}；${t('issue_if_persistent', '如果仍然失败，请到 GitHub 提 Issue:')} ${GITHUB_ISSUES_URL}`;
  }

  function validateExtracted(result, pageKind = 'page') {
    const text = result?.text ?? '';
    const images = result?.images ?? [];
    const hasText = Array.isArray(result?.blocks)
      ? hasMeaningfulContentBlocks(result.blocks)
      : hasMeaningfulExtractedText(text);
    const hasMedia = Array.isArray(images) && images.length > 0;

    if (!hasText && !hasMedia) {
      throw new ExtractionError('DOM_EMPTY', buildExtractionFailureMessage(pageKind));
    }
  }

  function getArticleContainers(root = document) {
    return dom.articleContainers(root);
  }

  function getTopLevelTweetArticles(root = document) {
    return dom.topLevelTweets(root);
  }

  function isTweetMediaImage(src) {
    return Boolean(src && src.includes('pbs.twimg.com/media'));
  }

  function createImageNode(src, imageState, alt = '') {
    if (!imageState || !isTweetMediaImage(src)) return null;

    let nextSrc = src;
    if (
      nextSrc.includes('profile_images') ||
      nextSrc.includes('emoji') ||
      nextSrc.includes('icon')
    ) {
      return null;
    }

    nextSrc = upgradeImageUrl(nextSrc);
    if (imageState.imageSet.has(nextSrc)) return null;

    imageState.imageSet.add(nextSrc);
    imageState.images.push(nextSrc);
    const imageNode = {
      type: 'image',
      url: nextSrc,
      alt: alt || `${t('md_image', '图片')}${imageState.imgIndex + 1}`,
    };
    imageState.imgIndex += 1;
    return imageNode;
  }

  // ── Link card helpers ──────────────────────────────────────────────

  function sanitizeCardText(text) {
    return (text || '').replace(/\s+/g, ' ').replace(/\u200b/g, '').trim();
  }

  function isNoiseCardText(text) {
    if (!text) return true;
    if (/^(open|view|show more)$/i.test(text)) return true;
    if (/^[\d\s.,/:_-]+$/.test(text)) return true;
    return false;
  }

  function isLikelyDomainText(text) {
    return /^[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s]+)?$/i.test((text || '').trim());
  }

  function deriveCardDomain(url, texts) {
    const explicitDomain = (texts || []).find((t) => isLikelyDomainText(t));
    if (explicitDomain) return explicitDomain.toLowerCase();
    try {
      return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
    } catch {
      return '';
    }
  }

  function looksLikeCardDestination(url, rawHref) {
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname.replace(/^www\./i, '').toLowerCase();
      if (hostname === 't.co') return true;
      if (hostname === 'x.com' || hostname === 'twitter.com') {
        return (
          !/^\/(home|explore|search|messages|notifications|i\/|compose)/i.test(rawHref || '') &&
          !/\/status\/\d+/i.test(parsed.pathname)
        );
      }
      return true;
    } catch {
      return false;
    }
  }

  function collectPreviewCardTexts(anchor) {
    const texts = [];
    const nodes = anchor.querySelectorAll('span, div');
    for (const node of nodes) {
      if (!(node instanceof Element)) continue;
      if (node.querySelector('img, video, svg')) continue;
      const text = sanitizeCardText(node.textContent);
      if (!text || text.length > 220 || isNoiseCardText(text)) continue;
      if (
        texts.some(
          (existing) => existing === text || existing.includes(text) || text.includes(existing)
        )
      ) {
        continue;
      }
      texts.push(text);
    }
    if (!texts.length) {
      const fallback = sanitizeCardText(anchor.textContent);
      if (fallback && !isNoiseCardText(fallback)) texts.push(fallback);
    }
    return texts;
  }

  function isPreviewCardAnchor(anchor) {
    if (!(anchor instanceof Element)) return false;
    if (anchor.closest(dom.css.tweetText)) return false;
    if (anchor.closest(dom.css.author)) return false;
    if (anchor.closest(dom.css.actionGroup)) return false;
    if (anchor.querySelector('time')) return false;

    const rawHref = anchor.getAttribute('href') || anchor.href || '';
    const url = normalizeAnchorUrl(rawHref);
    if (!url || !looksLikeCardDestination(url, rawHref)) return false;

    const texts = collectPreviewCardTexts(anchor);
    const hasMedia = Boolean(anchor.querySelector('img, video'));
    const hasCardMarker =
      anchor.matches(dom.css.cardMarker) ||
      Boolean(anchor.querySelector(dom.css.cardMarker));
    const hasEnoughText = texts.join(' ').length >= 18;
    return hasCardMarker || hasMedia || texts.length >= 2 || hasEnoughText;
  }

  function extractPreviewCard(anchor, seenCardLinks) {
    if (!isPreviewCardAnchor(anchor)) return null;
    const url = normalizeAnchorUrl(anchor.getAttribute('href') || anchor.href || '');
    if (!url || seenCardLinks.has(url)) return null;
    seenCardLinks.add(url);

    const texts = collectPreviewCardTexts(anchor);
    const domain = deriveCardDomain(url, texts);
    const title = sanitizeCardText(
      texts.find((t) => !isLikelyDomainText(t) && t.length >= 4) || domain || url
    );
    const summary = sanitizeCardText(
      texts.find((t) => t !== title && !isLikelyDomainText(t))
    );

    return { type: 'card', url, title, summary, domain };
  }

  // ── DOM text walking ───────────────────────────────────────────────

  function appendInlineNode(inlines, node) {
    if (!node) return;
    if (node.type === 'text' && !node.text) return;
    const previous = inlines[inlines.length - 1];
    if (node.type === 'text' && previous?.type === 'text') {
      previous.text += node.text;
      return;
    }
    inlines.push(node);
  }

  function extractInlineNodes(el, imageState) {
    if (!el) return [];
    const inlines = [];

    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        appendInlineNode(inlines, { type: 'text', text: node.textContent || '' });
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const tag = node.tagName.toLowerCase();

      if (tag === 'br') {
        appendInlineNode(inlines, { type: 'text', text: '\n' });
        return;
      }
      if (tag === 'a') {
        const href = node.getAttribute('href') || '';
        const linkText = node.textContent.trim();
        const normalizedUrl = normalizeAnchorUrl(href);
        if (normalizedUrl) {
          appendInlineNode(inlines, { type: 'link', label: linkText, url: normalizedUrl });
        } else {
          appendInlineNode(inlines, { type: 'text', text: node.textContent.trim() });
        }
        return;
      }
      if (tag === 'img') {
        const alt = node.getAttribute('alt') || '';
        const imageNode = createImageNode(node.getAttribute('src') || node.src, imageState, alt);
        if (imageNode) {
          appendInlineNode(inlines, imageNode);
          return;
        }
        if (alt && !alt.includes('Image')) {
          appendInlineNode(inlines, { type: 'text', text: alt });
        }
        return;
      }
      node.childNodes.forEach(walk);
    };

    el.childNodes.forEach(walk);
    if (inlines[0]?.type === 'text') inlines[0].text = inlines[0].text.trimStart();
    const last = inlines[inlines.length - 1];
    if (last?.type === 'text') last.text = last.text.trimEnd();
    return inlines.filter((inline) => inline.type !== 'text' || inline.text);
  }

  // ── Content extraction ─────────────────────────────────────────────

  /** Filter out elements that are nested inside other matched elements. O(n*d) */
  function filterTopLevelElements(elements) {
    const result = [];
    const seen = new Set();
    for (const el of elements) {
      let dominated = false;
      let parent = el.parentElement;
      while (parent) {
        if (seen.has(parent)) {
          dominated = true;
          break;
        }
        parent = parent.parentElement;
      }
      if (!dominated) {
        result.push(el);
        // Non-card anchors often wrap richer descendants such as quoted tweets.
        // Let those descendants survive the top-level filter so we do not drop
        // quoted text or images during export.
        if (el.tagName?.toLowerCase() !== 'a' || isPreviewCardAnchor(el)) {
          seen.add(el);
        }
      }
    }
    return result;
  }

  function extractQuotedTweetBlock(article, imageOffset) {
    if (!(article instanceof Element)) {
      return { block: null, images: [] };
    }

    const author = extractAuthorInfo(article);
    const time = extractTime(article);
    const quoteContent = extractRichContent(article, imageOffset, {
      includeQuotedTweets: false,
    });

    return {
      block: {
        type: 'quote',
        label: t('md_quoted_post', '引用推文'),
        author,
        time,
        blocks: quoteContent.blocks,
      },
      images: quoteContent.images,
    };
  }

  function extractRichContent(container, imageOffset = 0, options = {}) {
    const includeQuotedTweets = options.includeQuotedTweets !== false;
    const blocks = [];
    const images = [];
    const imageSet = new Set();
    const seenCardLinks = new Set();
    const imageState = {
      images,
      imageSet,
      imgIndex: imageOffset,
    };

    const rawElements = container.querySelectorAll(
      dom.richContentCandidates(includeQuotedTweets)
    );
    const elements = filterTopLevelElements(rawElements);

    for (const el of elements) {
      const tag = el.tagName.toLowerCase();

      if (tag === 'a') {
        const card = extractPreviewCard(el, seenCardLinks);
        if (card) blocks.push(card);
        continue;
      }

      if (tag === 'img') {
        const imageNode = createImageNode(el.src, imageState, el.getAttribute('alt') || '');
        if (imageNode) blocks.push(imageNode);
        continue;
      }

      if (tag === 'article' && el.matches(dom.css.tweetArticle)) {
        const quotedTweet = extractQuotedTweetBlock(el, imageState.imgIndex);
        if (quotedTweet.block) {
          blocks.push(quotedTweet.block);
          for (const img of quotedTweet.images) {
            if (!imageState.imageSet.has(img)) {
              imageState.imageSet.add(img);
              imageState.images.push(img);
            }
          }
          imageState.imgIndex = imageOffset + imageState.images.length;
        }
        continue;
      }

      const inlines = extractInlineNodes(el, imageState);
      if (!inlines.length) continue;

      if (/^h[1-6]$/.test(tag)) {
        blocks.push({ type: 'heading', level: Number(tag.slice(1)), inlines });
      } else if (tag === 'blockquote') {
        blocks.push({ type: 'blockquote', inlines });
      } else if (tag === 'li') {
        blocks.push({ type: 'listItem', inlines });
      } else {
        blocks.push({ type: 'paragraph', inlines });
      }
    }

    return { blocks, images };
  }

  function detectArticlePage() {
    const articleContainers = getArticleContainers();
    if (articleContainers.length === 0) return false;

    // Rich-text containers also occur in composers and timeline UI. Only
    // accept them on an explicit status/article detail route.
    const route = classifyPageRoute();
    return route.kind === 'tweet' || route.kind === 'article';
  }

  function getMainTweet() {
    const route = classifyPageRoute();
    if (route.kind !== 'tweet' || !route.statusId) return null;
    const statusId = route.statusId;
    const articles = getTopLevelTweetArticles();

    for (const article of articles) {
      const links = article.querySelectorAll(`a[href*="/status/${statusId}"]`);
      for (const link of links) {
        if (link.querySelector('time')) return article;
      }
    }
    // Do not silently export an unrelated article when X changes its DOM.
    return null;
  }

  function extractAuthorInfo(tweetEl) {
    const el = tweetEl.querySelector(dom.css.author);
    if (!el) return { displayName: 'Unknown', handle: '@unknown' };

    let handle = '';
    let displayName = '';
    const links = el.querySelectorAll('a[href]');
    for (const link of links) {
      const href = link.getAttribute('href') || '';
      const handleMatch = href.match(/^\/([A-Za-z0-9_]{1,15})\/?$/);
      if (handleMatch) {
        handle = '@' + handleMatch[1];
        break;
      }
    }
    const firstLink = el.querySelector('a');
    if (firstLink) {
      const clone = firstLink.cloneNode(true);
      clone.querySelectorAll('svg').forEach((svg) => svg.remove());
      displayName = clone.textContent.trim();
    }
    return {
      displayName: displayName || 'Unknown',
      handle: handle || '@unknown',
    };
  }

  function extractTime(tweetEl) {
    const timeEl = tweetEl.querySelector(dom.css.time);
    if (!timeEl) return null;
    const datetime = timeEl.getAttribute('datetime');
    if (!datetime) return timeEl.textContent.trim();
    const date = new Date(datetime);
    const pad = (v) => String(v).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function extractStats(tweetEl) {
    const stats = { replies: '0', retweets: '0', likes: '0' };
    const actionGroup = tweetEl.querySelector(dom.css.actionGroup);
    if (!actionGroup) return stats;
    const buttons = actionGroup.querySelectorAll(dom.css.actionButton);
    const labels = ['replies', 'retweets', 'likes'];
    buttons.forEach((btn, idx) => {
      if (idx >= labels.length) return;
      const ariaLabel = btn.getAttribute('aria-label') || '';
      const matchedNumber = ariaLabel.match(/[\d,.]+[KkMm]?/);
      if (matchedNumber) {
        stats[labels[idx]] = matchedNumber[0];
        return;
      }
      const span = btn.querySelector('span span');
      if (span && span.textContent.trim()) {
        stats[labels[idx]] = span.textContent.trim();
      }
    });
    return stats;
  }

  function extractThreadTweets(mainTweetEl) {
    const author = extractAuthorInfo(mainTweetEl);
    if (!author.handle || author.handle === '@unknown') return [];
    const allArticles = getTopLevelTweetArticles();
    const mainIdx = Array.from(allArticles).indexOf(mainTweetEl);
    if (mainIdx < 0) return [];
    const tweets = [];
    for (let i = mainIdx + 1; i < allArticles.length; i += 1) {
      const article = allArticles[i];
      const nextAuthor = extractAuthorInfo(article);
      if (nextAuthor.handle === author.handle && nextAuthor.handle !== '@unknown') {
        const extracted = extractRichContent(article);
        if (!hasMeaningfulContentBlocks(extracted.blocks) && extracted.images.length === 0) break;
        tweets.push(extracted);
      } else {
        break;
      }
    }
    return tweets;
  }

  function extractArticle() {
    _XPD.sendProgress?.(t('progress_extracting_article', '正在提取长文内容...'));
    const blocks = [];
    let images = [];
    let author = { displayName: 'Unknown', handle: '@unknown' };
    let time = null;

    const firstArticle = getTopLevelTweetArticles()[0];
    if (firstArticle) {
      author = extractAuthorInfo(firstArticle);
      time = extractTime(firstArticle);
    }

    const knownContainers = getArticleContainers();
    if (knownContainers.length > 0) {
      for (const container of knownContainers) {
        const extracted = extractRichContent(container, images.length);
        blocks.push(...extracted.blocks);
        images.push(...extracted.images);
      }
    }
    return { blocks, images, author, time };
  }

  function extractComments() {
    const mainTweetEl = getMainTweet();
    if (!mainTweetEl) return [];
    const author = extractAuthorInfo(mainTweetEl);
    const allArticles = getTopLevelTweetArticles();
    const mainIdx = Array.from(allArticles).indexOf(mainTweetEl);
    const comments = [];
    let pastThread = false;

    for (let i = mainIdx + 1; i < allArticles.length; i += 1) {
      const article = allArticles[i];
      const commentAuthor = extractAuthorInfo(article);
      if (!pastThread && commentAuthor.handle === author.handle) continue;
      pastThread = true;
      const textData = extractRichContent(article);
      if (hasMeaningfulContentBlocks(textData.blocks)) {
        comments.push({
          author: commentAuthor,
          blocks: textData.blocks,
          time: extractTime(article),
        });
      }
      if (comments.length >= 20) break;
    }
    return comments;
  }

  function collectImageUrlsFromBlocks(blocks, urls = []) {
    for (const block of blocks || []) {
      if (block?.type === 'image' && block.url) urls.push(block.url);
      for (const inline of block?.inlines || []) {
        if (inline?.type === 'image' && inline.url) urls.push(inline.url);
      }
      if (block?.type === 'quote') collectImageUrlsFromBlocks(block.blocks, urls);
    }
    return urls;
  }

  function createPostDocument(input) {
    const blocks = Array.isArray(input?.blocks) ? input.blocks : [];
    const thread = Array.isArray(input?.thread) ? input.thread : [];
    const comments = Array.isArray(input?.comments) ? input.comments : [];
    if (!hasMeaningfulContentBlocks(blocks)) {
      throw new ExtractionError('DOCUMENT_EMPTY', buildExtractionFailureMessage(input?.kind));
    }
    return {
      schemaVersion: 1,
      kind: input?.kind === 'article' ? 'article' : 'tweet',
      title: String(input?.title || deriveTitleFromBlocks(blocks)),
      author: input?.author || { displayName: 'Unknown', handle: '@unknown' },
      publishedAt: input?.publishedAt || null,
      stats: input?.stats || { replies: '0', retweets: '0', likes: '0' },
      sourceUrl: String(input?.sourceUrl || ''),
      blocks,
      thread: thread.map((entry) => ({ blocks: Array.isArray(entry?.blocks) ? entry.blocks : [] })),
      comments: comments.map((entry) => ({
        author: entry?.author || { displayName: 'Unknown', handle: '@unknown' },
        publishedAt: entry?.publishedAt || entry?.time || null,
        blocks: Array.isArray(entry?.blocks) ? entry.blocks : [],
      })),
    };
  }

  function buildDiagnosticReport() {
    const route = classifyPageRoute();
    const tweets = getTopLevelTweetArticles();
    const articleNodes = getArticleContainers();
    let site = 'unsupported';
    try {
      const hostname = new URL(window.location.href).hostname.replace(/^www\./i, '');
      if (hostname === 'x.com' || hostname === 'twitter.com') site = hostname;
    } catch {
      // Keep the non-identifying fallback.
    }
    let extensionVersion = 'unknown';
    try {
      extensionVersion = chrome.runtime.getManifest().version || 'unknown';
    } catch {
      // The browser fixture and unit tests may not expose a manifest.
    }

    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      extensionVersion,
      selectorVersion: dom.version,
      page: {
        site,
        kind: route.kind,
        articleDetected: detectArticlePage(),
        targetPostLocated: route.kind === 'tweet' ? Boolean(getMainTweet()) : false,
      },
      signals: {
        topLevelPostCount: tweets.length,
        articleContainerCount: articleNodes.length,
        mediaImageCount: document.querySelectorAll(dom.css.mediaImage).length,
        cardCandidateCount: document.querySelectorAll(dom.css.cardMarker).length,
        primaryColumnPresent: Boolean(document.querySelector(dom.css.primaryColumn)),
      },
      privacy: {
        includesBodyText: false,
        includesAccount: false,
        includesStatusId: false,
        includesFullUrl: false,
      },
    };
  }

  function serializeDiagnosticReport() {
    return JSON.stringify(buildDiagnosticReport(), null, 2);
  }

  function makeFilename(titleText, author, isArticle) {
    const pad = (v) => String(v).padStart(2, '0');
    const now = new Date();
    const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

    if (isArticle) {
      // 文章：直接用标题（纯文字，去图片）
      let title = stripMarkdownSyntax(stripImageMarkdown(titleText))
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
        .replace(/\.+$/g, '')
        .substring(0, 80)
        .trim();
      if (!title || looksLikeImageLabel(title)) {
        title = `${t('filename_article', '文章')}_${dateStr}`;
      }
      return title;
    }

    // 普通推文：推文 + 时间
    return `${t('filename_tweet', '推文')}_${dateStr}`;
  }

  // ── Export module ──────────────────────────────────────────────────

  _XPD.core = {
    MAX_IMAGE_WIDTH,
    JPEG_QUALITY,
    POST_DETAIL_URL_RE,
    classifyPageRoute,
    escapeHtml,
    escapeMarkdownText,
    escapeMarkdownLinkLabel,
    escapeMarkdownUrl,
    stripImageMarkdown,
    stripMarkdownSyntax,
    contentBlocksToPlainText,
    hasMeaningfulContentBlocks,
    deriveTitleFromBlocks,
    collectImageUrlsFromBlocks,
    createPostDocument,
    buildDiagnosticReport,
    serializeDiagnosticReport,
    looksLikeImageLabel,
    deriveTitleText,
    upgradeImageUrl,
    normalizeAnchorUrl,
    getSourceUrl,
    ExtractionError,
    validateExtracted,
    GITHUB_ISSUES_URL,
    detectArticlePage,
    getMainTweet,
    extractArticle,
    extractRichContent,
    extractAuthorInfo,
    extractTime,
    extractStats,
    extractThreadTweets,
    extractComments,
    makeFilename,
  };
})();
