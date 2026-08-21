// X Markdown Exporter - versioned X DOM selector adapter.

(function () {
  'use strict';

  const _XPD = (window._XPD = window._XPD || {});
  const css = Object.freeze({
    tweetArticle: 'article[data-testid="tweet"]',
    author: '[data-testid="User-Name"]',
    tweetText: '[data-testid="tweetText"]',
    tweetPhotoImage: '[data-testid="tweetPhoto"] img',
    mediaImage: 'img[src*="pbs.twimg.com/media"]',
    articleContent:
      '[data-testid="article-content"], ' +
      '[data-testid="noteContent"], ' +
      '[data-testid="richTextContainer"]',
    primaryColumn: '[data-testid="primaryColumn"]',
    actionGroup: '[role="group"][id]',
    actionButton: '[role="button"]',
    time: 'time[datetime]',
    cardMarker: '[data-testid*="card"]',
  });
  const attributes = Object.freeze({ testId: 'data-testid' });
  const tokens = Object.freeze({ card: 'card' });

  function topLevelTweets(root = document) {
    return Array.from(root.querySelectorAll(css.tweetArticle)).filter(
      (article) => !article.parentElement?.closest(css.tweetArticle)
    );
  }

  function articleContainers(root = document) {
    return Array.from(root.querySelectorAll(css.articleContent)).filter(
      (container) => !container.parentElement?.closest(css.articleContent)
    );
  }

  function richContentCandidates(includeQuotedTweets = true) {
    return [
      'p, h1, h2, h3, h4, h5, h6, li, blockquote',
      css.tweetText,
      css.tweetPhotoImage,
      css.mediaImage,
      'div[lang]',
      'div[data-block="true"]',
      includeQuotedTweets ? css.tweetArticle : '',
      'a[href]',
    ].filter(Boolean).join(', ');
  }

  _XPD.dom = Object.freeze({
    version: 1,
    css,
    attributes,
    tokens,
    topLevelTweets,
    articleContainers,
    richContentCandidates,
  });
})();
