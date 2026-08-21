// X Markdown Exporter - Entry Point
// Message listener, orchestration, and initialization.

(function () {
  'use strict';

  const _XPD = window._XPD;
  const core = _XPD.core;
  const exp = _XPD.exp;
  const ui = _XPD.ui;
  const t = _XPD.t || ((key, fallback) => fallback);

  const DEFAULT_EXPORT_OPTIONS = Object.freeze({
    includeTime: true,
    includeAuthor: true,
    includeStats: false,
    includeComments: false,
  });
  let activeExportController = null;

  // Progress bridge

  function sendProgress(text, progress = null) {
    ui.updateProgressText(text, progress);
    chrome.runtime.sendMessage({ type: 'XPD_PROGRESS', text, progress }).catch(() => {});
  }

  // Expose sendProgress so core and export modules can call it.
  _XPD.sendProgress = sendProgress;

  // Options normalization

  /**
   * Merge caller options with defaults.
   * Currently the UI does not expose includeAuthor / includeTime toggles,
   * so they always default to true via DEFAULT_EXPORT_OPTIONS.
   * When UI toggles are added, they will flow through naturally.
   */
  function normalizeOptions(options) {
    return { ...DEFAULT_EXPORT_OPTIONS, ...(options || {}) };
  }

  // Core extraction / action orchestrators

  function throwIfCancelled(signal) {
    if (!signal?.aborted) return;
    const error = new Error(t('export_cancelled', '导出已取消'));
    error.name = 'AbortError';
    error.code = 'EXPORT_CANCELLED';
    throw error;
  }

  async function runExportJob(operation) {
    if (activeExportController) {
      const error = new Error(t('export_busy', '已有导出任务正在进行'));
      error.code = 'EXPORT_BUSY';
      throw error;
    }
    const controller = new AbortController();
    activeExportController = controller;
    try {
      return await operation(controller.signal);
    } finally {
      if (activeExportController === controller) activeExportController = null;
    }
  }

  function cancelActiveExport() {
    if (!activeExportController) return false;
    activeExportController.abort('user');
    sendProgress(t('export_cancelling', '正在取消导出...'));
    return true;
  }

  async function buildExportPayload(options, signal) {
    throwIfCancelled(signal);
    const exportOptions = normalizeOptions(options);
    exportOptions.isArticle = core.detectArticlePage();
    exportOptions.sourceUrl = core.getSourceUrl();

    sendProgress(t('progress_searching', '正在查找内容...'));

    console.log('[XPD] Page type:', exportOptions.isArticle ? 'ARTICLE' : 'TWEET');

    let blocks;
    let author;
    let time;
    let stats;
    let thread;

    if (exportOptions.isArticle) {
      const articleData = core.extractArticle();
      throwIfCancelled(signal);
      core.validateExtracted(articleData, 'note');
      blocks = articleData.blocks;
      author = articleData.author;
      time = articleData.time;
      stats = { replies: '0', retweets: '0', likes: '0' };
      thread = [];
    } else {
      const mainTweetEl = core.getMainTweet();
      if (!mainTweetEl) {
        throw new core.ExtractionError(
          'MAIN_TWEET_NOT_FOUND',
          `${t('main_tweet_not_found', '未找到当前推文正文。请确认已打开具体推文详情页，并等待内容加载完成；如果一直失败，请刷新页面后重试，或到 GitHub 提 Issue:')} ${core.GITHUB_ISSUES_URL}`
        );
      }

      sendProgress(t('progress_extracting_body', '正在提取正文...'));
      const extracted = core.extractRichContent(mainTweetEl);
      throwIfCancelled(signal);
      core.validateExtracted(extracted, 'tweet');
      blocks = extracted.blocks;
      author = core.extractAuthorInfo(mainTweetEl);
      time = core.extractTime(mainTweetEl);
      stats = core.extractStats(mainTweetEl);
      thread = core.extractThreadTweets(mainTweetEl);
    }
    throwIfCancelled(signal);

    console.log('[XPD] Extracted:', {
      textLen: core.contentBlocksToPlainText(blocks).length,
      images: core.collectImageUrlsFromBlocks(blocks, []).length,
      thread: thread.length,
    });

    const documentModel = core.createPostDocument({
      kind: exportOptions.isArticle ? 'article' : 'tweet',
      title: core.deriveTitleFromBlocks(blocks),
      author,
      publishedAt: time,
      stats,
      sourceUrl: exportOptions.sourceUrl,
      blocks,
      thread,
      comments: exportOptions.includeComments ? core.extractComments() : [],
    });

    return { documentModel, exportOptions };
  }

  async function writeTextToClipboard(text, signal) {
    throwIfCancelled(signal);
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        throwIfCancelled(signal);
        return;
      } catch (error) {
        console.warn('[XPD] navigator.clipboard failed, falling back:', error.message);
      }
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-1000px';
    textarea.style.left = '-1000px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    try {
      const copied = document.execCommand('copy');
      if (!copied) throw new Error('copy command returned false');
    } finally {
      textarea.remove();
    }
  }

  async function handleExtractAndDownload(options, mode) {
    return runExportJob(async (signal) => {
      const payload = await buildExportPayload(options, signal);
      const { documentModel, exportOptions } = payload;
      let exportResult;

      if (mode === 'zip') {
        exportResult = await exp.downloadAsZip(documentModel, exportOptions, null, signal);
      } else if (mode === 'embed') {
        exportResult = await exp.downloadAsEmbed(documentModel, exportOptions, signal);
      } else {
        exportResult = exp.downloadAsLink(documentModel, exportOptions, signal);
      }

      return { success: true, ...(exportResult || {}) };
    });
  }

  async function handleExtractAndCopy(options) {
    return runExportJob(async (signal) => {
      const payload = await buildExportPayload(options, signal);
      const { documentModel, exportOptions } = payload;
      _XPD.sendProgress?.(t('copy_progress', '正在复制 Markdown...'));
      const markdown = exp.buildMarkdownAsLink(documentModel, exportOptions);
      await writeTextToClipboard(markdown, signal);
      return { success: true };
    });
  }

  async function copyDiagnosticReport() {
    const report = core.serializeDiagnosticReport();
    await writeTextToClipboard(report);
    return { success: true, report };
  }

  // Expose so UI module can call actions from the floating panel buttons.
  _XPD.handleExtractAndDownload = handleExtractAndDownload;
  _XPD.handleExtractAndCopy = handleExtractAndCopy;
  _XPD.cancelActiveExport = cancelActiveExport;
  _XPD.copyDiagnosticReport = copyDiagnosticReport;

  // Message listener

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'PING') {
      const availability = ui.evaluatePageAvailability();
      sendResponse({ ok: availability.ready, ...availability });
      return false;
    }

    if (message.type === 'CANCEL_EXPORT') {
      sendResponse({ success: true, cancelled: cancelActiveExport() });
      return false;
    }

    if (message.type === 'COPY_DIAGNOSTICS') {
      copyDiagnosticReport()
        .then(() => sendResponse({ success: true }))
        .catch(() => sendResponse({
          success: false,
          error: t('diagnostics_failed', '诊断报告复制失败'),
        }));
      return true;
    }

    if (message.type === 'EXTRACT_AND_DOWNLOAD') {
      ui.beginUiWork();
      handleExtractAndDownload(message.options, message.mode)
        .then((result) => sendResponse(result))
        .catch((error) => {
          if (error?.code !== 'EXPORT_CANCELLED') console.error('[XPD] Error:', error);
          sendResponse({
            success: false,
            cancelled: error?.code === 'EXPORT_CANCELLED',
            error: error.message,
          });
        })
        .finally(() => {
          ui.endUiWork();
          ui.refreshPanelStatus();
        });
      return true;
    }

    if (message.type === 'EXTRACT_AND_COPY') {
      ui.beginUiWork();
      handleExtractAndCopy(message.options)
        .then((result) => sendResponse(result))
        .catch((error) => {
          if (error?.code !== 'EXPORT_CANCELLED') console.error('[XPD] Error:', error);
          sendResponse({
            success: false,
            cancelled: error?.code === 'EXPORT_CANCELLED',
            error: error.message,
          });
        })
        .finally(() => {
          ui.endUiWork();
          ui.refreshPanelStatus();
        });
      return true;
    }

    return false;
  });

  // Bootstrap

  ui.initFloatingUi();
  ui.startUrlWatcher();
  ui.schedulePanelStatusRefresh();

  console.log('[XPD] X Markdown Exporter content script loaded');
})();
