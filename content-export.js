// Postcase - Export Module
// Markdown assembly, image processing, and download logic.

(function () {
  'use strict';

  const _XPD = window._XPD;
  const core = _XPD.core;
  const t = _XPD.t || ((key, fallback) => fallback);

  const EMBED_WARN_THRESHOLD_BYTES = 12 * 1024 * 1024;
  const EMBED_HARD_LIMIT_BYTES = 40 * 1024 * 1024;
  const MEDIA_TOTAL_BUDGET_BYTES = 64 * 1024 * 1024;
  const MAX_ARCHIVE_IMAGE_COUNT = 500;
  const MAX_IMAGE_PIXELS = 8 * 1024 * 1024;
  const IMAGE_CONCURRENCY_LIMIT = 3;
  let imageRequestSequence = 0;

  function createMediaBudget(limit = MEDIA_TOTAL_BUDGET_BYTES) {
    return {
      limit,
      totalBytes: 0,
      accounted: new Set(),
      add(key, bytes) {
        if (this.accounted.has(key)) return true;
        const size = Number(bytes);
        if (!Number.isFinite(size) || size < 0 || this.totalBytes + size > this.limit) return false;
        this.totalBytes += size;
        this.accounted.add(key);
        return true;
      },
    };
  }

  function createMediaBudgetError(kind = 'bytes') {
    const error = new Error(
      kind === 'count'
        ? t('media_count_limit', 'This export contains more than 500 images')
        : t('media_budget_exceeded', 'This export exceeds the 64 MiB media budget')
    );
    error.code = kind === 'count' ? 'MEDIA_IMAGE_COUNT_LIMIT' : 'MEDIA_BUDGET_EXCEEDED';
    return error;
  }

  function validateImageWorkload(imageUrls) {
    const uniqueImages = [...new Set(imageUrls || [])];
    if (uniqueImages.length > MAX_ARCHIVE_IMAGE_COUNT) throw createMediaBudgetError('count');
    return uniqueImages;
  }

  function estimateBase64Bytes(base64) {
    const text = String(base64 || '');
    if (!text) return 0;
    const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor((text.length * 3) / 4) - padding);
  }

  function createCancelledError() {
    const error = new Error(t('export_cancelled', '导出已取消'));
    error.name = 'AbortError';
    error.code = 'EXPORT_CANCELLED';
    return error;
  }

  function isCancelledError(error) {
    return error?.name === 'AbortError' || error?.code === 'EXPORT_CANCELLED' ||
      error?.code === 'CANCELLED';
  }

  function throwIfCancelled(signal) {
    if (signal?.aborted) throw createCancelledError();
  }

  // Metadata & comments assembly

  function buildMetadata(documentModel, options) {
    let md = '';
    if (options.includeAuthor) {
      const name = core.escapeMarkdownText(documentModel.author.displayName);
      const handle = core.escapeMarkdownText(documentModel.author.handle);
      md += `**${t('md_author', '作者')}**: ${name} (${handle})\n\n`;
    }
    if (options.includeTime && documentModel.publishedAt) {
      md += `**${t('md_time', '时间')}**: ${core.escapeMarkdownText(documentModel.publishedAt)}\n\n`;
    }
    if (documentModel.sourceUrl) {
      md += `**source_url**: <${String(documentModel.sourceUrl).replace(/>/g, '%3E')}>\n\n`;
    }
    if (options.includeStats) {
      const stats = documentModel.stats;
      md += `**${t('md_stats', '互动')}**: ❤️ ${stats.likes} | 🔁 ${stats.retweets} | 💬 ${stats.replies}\n\n`;
    }
    if (md) md += '---\n\n';
    return md;
  }

  function buildComments(documentModel, options, resolveImage) {
    if (!options.includeComments) return '';
    const comments = documentModel.comments || [];
    if (!comments.length) return '';

    let md = `---\n\n## ${t('md_comments', '评论')}\n\n`;
    for (const comment of comments) {
      const name = core.escapeMarkdownText(comment.author.displayName);
      const handle = core.escapeMarkdownText(comment.author.handle);
      const timeText = comment.publishedAt
        ? ` _(${core.escapeMarkdownText(comment.publishedAt)})_`
        : '';
      const body = prefixMarkdownLines(
        renderContentBlocks(comment.blocks, resolveImage).trim(),
        '> '
      );
      md += `> **${name}** (${handle})${timeText}\n>\n${body}\n\n`;
    }
    return md;
  }

  // Structured document rendering

  function prefixMarkdownLines(text, prefix) {
    return String(text || '').split('\n').map((line) => `${prefix}${line}`).join('\n');
  }

  function renderCodeBlock(block) {
    const text = String(block.text || '').replace(/\r\n?/g, '\n');
    if (!text) return '';
    const longestFence = Math.max(
      3,
      ...Array.from(text.matchAll(/`+/g), (match) => match[0].length + 1)
    );
    const fence = '`'.repeat(longestFence);
    const language = String(block.language || '').replace(/[^a-z0-9_-]/gi, '');
    return `${fence}${language}\n${text}${text.endsWith('\n') ? '' : '\n'}${fence}`;
  }

  function renderListBlock(block, resolveImage, indent = '') {
    const items = Array.isArray(block.items) ? block.items : [];
    const ordered = block.ordered === true;
    const parsedStart = Number.isInteger(block.start) ? block.start : 1;
    const lines = [];

    items.forEach((item, index) => {
      // New items use ordered blocks; accept legacy inlines/children as well.
      const blocks = [
        ...(item?.inlines?.length ? [{ type: 'paragraph', inlines: item.inlines }] : []),
        ...(item?.blocks || []),
        ...(item?.children || []),
      ];
      const body = renderContentBlocks(blocks, resolveImage);
      const marker = ordered ? `${parsedStart + index}.` : '-';
      const continuationIndent = indent + ' '.repeat(marker.length + 1);
      const bodyLines = body ? body.split('\n') : [''];
      lines.push(`${indent}${marker}${bodyLines[0] ? ` ${bodyLines[0]}` : ''}`);
      for (const line of bodyLines.slice(1)) lines.push(`${continuationIndent}${line}`);
    });

    return lines.join('\n');
  }

  function renderInlineNodes(inlines, resolveImage) {
    return (inlines || []).map((inline) => {
      if (inline?.type === 'text') return core.escapeMarkdownText(inline.text);
      if (inline?.type === 'link') {
        return `[${core.escapeMarkdownLinkLabel(inline.label)}](<${core.escapeMarkdownUrl(inline.url)}>)`;
      }
      if (inline?.type === 'image') {
        const destination = core.escapeMarkdownUrl(resolveImage(inline.url));
        return `\n\n![${core.escapeMarkdownLinkLabel(inline.alt || t('md_image', '图片'))}](<${destination}>)\n\n`;
      }
      return '';
    }).join('').replace(/\n{3,}/g, '\n\n');
  }

  function renderContentBlock(block, resolveImage) {
    if (!block) return '';
    if (block.type === 'image') {
      const destination = core.escapeMarkdownUrl(resolveImage(block.url));
      return `![${core.escapeMarkdownLinkLabel(block.alt || t('md_image', '图片'))}](<${destination}>)`;
    }
    if (block.type === 'card') {
      let markdown = `[${core.escapeMarkdownLinkLabel(block.title || block.domain || block.url)}](<${core.escapeMarkdownUrl(block.url)}>)`;
      if (block.summary) markdown += `\n> ${core.escapeMarkdownText(block.summary)}`;
      if (block.domain && block.domain !== block.title && block.domain !== block.summary) {
        markdown += `\n> ${core.escapeMarkdownText(block.domain)}`;
      }
      return markdown;
    }
    if (block.type === 'quote') {
      const metaParts = [block.label || t('md_quoted_post', '引用推文')];
      if (block.author?.displayName || block.author?.handle) {
        metaParts.push(
          `${core.escapeMarkdownText(block.author.displayName)} (${core.escapeMarkdownText(block.author.handle)})`
        );
      }
      if (block.time) metaParts.push(core.escapeMarkdownText(block.time));
      const body = renderContentBlocks(block.blocks, resolveImage).trim() ||
        `[${t('md_no_body', '无可提取正文')}]`;
      return `> ${metaParts.join(' · ')}\n>\n${prefixMarkdownLines(body, '> ')}`;
    }
    if (block.type === 'list') return renderListBlock(block, resolveImage);
    if (block.type === 'listItem') return renderListBlock({ items: [block] }, resolveImage);
    if (block.type === 'code') return renderCodeBlock(block);
    if (block.type === 'blockquote') {
      const content = renderInlineNodes(block.inlines, resolveImage).trim();
      const body = block.blocks?.length
        ? renderContentBlocks(block.blocks, resolveImage).trim()
        : content;
      return body ? prefixMarkdownLines(body, '> ') : '';
    }

    const content = renderInlineNodes(block.inlines, resolveImage).trim();
    if (!content) return '';
    if (block.type === 'heading') {
      const level = Math.min(6, Math.max(1, Number(block.level) || 1));
      return `${'#'.repeat(level)} ${content}`;
    }
    return content;
  }

  function renderContentBlocks(blocks, resolveImage = (url) => url) {
    return (blocks || [])
      .map((block) => renderContentBlock(block, resolveImage))
      .filter(Boolean)
      .join('\n\n');
  }

  function composeMarkdown(documentModel, options, resolveImage = (url) => url) {
    let md = `# ${core.escapeMarkdownText(documentModel.title)}\n\n`;
    md += buildMetadata(documentModel, options);
    md += renderContentBlocks(documentModel.blocks, resolveImage) + '\n\n';
    if (documentModel.thread.length) {
      md += '---\n\n';
      for (const entry of documentModel.thread) {
        md += renderContentBlocks(entry.blocks, resolveImage) + '\n\n';
      }
    }
    md += buildComments(documentModel, options, resolveImage);
    return md.replace(/\n{3,}/g, '\n\n');
  }

  // Image processing

  function fetchImageViaBackground(url, signal) {
    return new Promise((resolve, reject) => {
      throwIfCancelled(signal);
      imageRequestSequence += 1;
      const requestId = `${Date.now()}-${imageRequestSequence}`;
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', handleAbort);
        callback(value);
      };
      const handleAbort = () => {
        const cancellation = chrome.runtime.sendMessage({ type: 'CANCEL_IMAGE_FETCH', requestId });
        cancellation?.catch?.(() => {});
        finish(reject, createCancelledError());
      };
      signal?.addEventListener('abort', handleAbort, { once: true });

      chrome.runtime.sendMessage({ type: 'FETCH_IMAGE', url, requestId }, (resp) => {
        if (chrome.runtime.lastError) {
          finish(reject, new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!resp || !resp.success) {
          if (resp?.cancelled) {
            finish(reject, createCancelledError());
          } else {
            finish(reject, new Error(resp?.error || 'fetch failed'));
          }
          return;
        }
        finish(resolve, resp.data);
      });
    });
  }

  async function mapWithConcurrency(items, limit, worker, signal, onProgress) {
    if (!items.length) return [];
    const results = new Array(items.length);
    let nextIndex = 0;
    let completed = 0;

    async function runWorker() {
      while (true) {
        throwIfCancelled(signal);
        const index = nextIndex;
        nextIndex += 1;
        if (index >= items.length) return;
        results[index] = await worker(items[index], index);
        completed += 1;
        onProgress?.(completed, items.length);
      }
    }

    const workerCount = Math.min(Math.max(1, limit), items.length);
    await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
    return results;
  }

  function compressImage(base64, contentType) {
    return new Promise((resolve) => {
      const normalizedContentType = (contentType || 'image/jpeg').toLowerCase();
      const dataUrl = `data:${normalizedContentType};base64,${base64}`;
      if (normalizedContentType === 'image/gif') {
        resolve(dataUrl);
        return;
      }
      const img = new Image();

      img.onload = () => {
        let canvas = null;
        try {
          canvas = document.createElement('canvas');
          const { width, height } = fitImageDimensions(img.width, img.height);
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext('2d');
          if (!context) throw new Error('Canvas 2D context unavailable');
          context.drawImage(img, 0, 0, width, height);
          const outputType = normalizedContentType === 'image/png'
            ? 'image/png'
            : normalizedContentType === 'image/webp'
              ? 'image/webp'
              : 'image/jpeg';
          const output = canvas.toDataURL(outputType, core.JPEG_QUALITY);
          resolve(output);
        } catch (error) {
          console.warn('[XPD] Image compression failed, using original:', error.message);
          resolve(dataUrl);
        } finally {
          if (canvas) {
            // Release the canvas backing store before the next image starts.
            canvas.width = 0;
            canvas.height = 0;
          }
          img.onload = null;
          img.onerror = null;
          img.src = '';
        }
      };

      img.onerror = () => {
        console.warn('[XPD] Image load failed, using original data URL');
        resolve(dataUrl);
      };
      img.src = dataUrl;
    });
  }

  function fitImageDimensions(width, height) {
    const sourceWidth = Number(width);
    const sourceHeight = Number(height);
    if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) ||
        sourceWidth <= 0 || sourceHeight <= 0) {
      return { width: 1, height: 1 };
    }

    const widthScale = Math.min(1, core.MAX_IMAGE_WIDTH / sourceWidth);
    let nextWidth = Math.max(1, Math.round(sourceWidth * widthScale));
    let nextHeight = Math.max(1, Math.round(sourceHeight * widthScale));
    const pixels = nextWidth * nextHeight;
    if (pixels > MAX_IMAGE_PIXELS) {
      const pixelScale = Math.sqrt(MAX_IMAGE_PIXELS / pixels);
      nextWidth = Math.max(1, Math.floor(nextWidth * pixelScale));
      nextHeight = Math.max(1, Math.floor(nextHeight * pixelScale));
    }
    return { width: nextWidth, height: nextHeight };
  }

  /** Determine file extension from content-type for ZIP packaging. */
  function getImageExtension(contentType) {
    if (!contentType) return '.jpg';
    if (contentType.includes('png')) return '.png';
    if (contentType.includes('gif')) return '.gif';
    if (contentType.includes('webp')) return '.webp';
    return '.jpg';
  }

  function getDataUrlContentType(dataUrl) {
    const matched = /^data:([^;]+);base64,/i.exec(dataUrl || '');
    return matched?.[1]?.toLowerCase() || '';
  }

  function isDataUrl(value) {
    return /^data:[^;]+;base64,/i.test(value || '');
  }

  function collectAllImages(documentModel) {
    const allImages = core.collectImageUrlsFromBlocks(documentModel.blocks, []);
    for (const entry of documentModel.thread || []) {
      core.collectImageUrlsFromBlocks(entry.blocks, allImages);
    }
    for (const comment of documentModel.comments || []) {
      core.collectImageUrlsFromBlocks(comment.blocks, allImages);
    }
    return allImages;
  }

  async function prepareProcessedImages(
    imageUrls,
    progressLabel,
    signal,
    mediaBudget = createMediaBudget()
  ) {
    const uniqueImages = validateImageWorkload(imageUrls);
    const processedImages = {};
    const failedImages = [];
    let processedBytes = 0;
    const workController = new AbortController();
    const cancelWork = () => workController.abort('cancelled');
    signal?.addEventListener('abort', cancelWork, { once: true });
    let hardLimitError = null;
    let mediaBudgetError = null;

    try {
      await mapWithConcurrency(
        uniqueImages,
        IMAGE_CONCURRENCY_LIMIT,
        async (url) => {
          try {
            const { base64, contentType } = await fetchImageViaBackground(
              url,
              workController.signal
            );
            processedImages[url] = await compressImage(base64, contentType);
            throwIfCancelled(workController.signal);
          } catch (error) {
            if (isCancelledError(error)) throw error;
            console.warn('[XPD] Image fetch failed, using URL:', error.message);
            processedImages[url] = url;
            failedImages.push(url);
          }

          if (isDataUrl(processedImages[url])) {
            const imageBytes = estimateMarkdownSize(processedImages[url]);
            if (!mediaBudget.add(url, imageBytes)) {
              mediaBudgetError = createMediaBudgetError();
              workController.abort('budget');
              throw mediaBudgetError;
            }
            processedBytes += imageBytes;
          }
          if (processedBytes > EMBED_HARD_LIMIT_BYTES && !hardLimitError) {
            hardLimitError = new Error('Embedded image data exceeds the 40 MB processing limit');
            hardLimitError.code = 'EMBED_HARD_LIMIT';
            hardLimitError.processedImages = processedImages;
            hardLimitError.failedImages = failedImages;
            workController.abort('hard-limit');
            throw hardLimitError;
          }
        },
        workController.signal,
        (completed, total) => {
          _XPD.sendProgress?.(`${progressLabel} ${completed}/${total}...`, {
            completed,
            total,
            phase: 'images',
          });
        }
      );
    } catch (error) {
      if (mediaBudgetError) throw mediaBudgetError;
      if (hardLimitError) throw hardLimitError;
      if (signal?.aborted || isCancelledError(error)) throw createCancelledError();
      throw error;
    } finally {
      signal?.removeEventListener('abort', cancelWork);
    }

    return { uniqueImages, processedImages, failedImages };
  }

  function estimateMarkdownSize(markdown) {
    return new Blob([markdown], { type: 'text/plain;charset=utf-8' }).size;
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function addDataUrlToZip(zip, dataUrl, index) {
    const outputContentType = getDataUrlContentType(dataUrl);
    const extension = getImageExtension(outputContentType);
    const localPath = `images/image_${index + 1}${extension}`;
    zip.file(localPath, dataUrl.split(',')[1], { base64: true });
    return localPath;
  }

  function addBase64ToZip(zip, base64, contentType, index) {
    const extension = getImageExtension(contentType);
    const localPath = `images/image_${index + 1}${extension}`;
    zip.file(localPath, base64, { base64: true });
    return localPath;
  }

  // Download modes

  function buildMarkdownAsLink(documentModel, options) {
    return composeMarkdown(documentModel, options, (url) => url);
  }

  function downloadAsLink(documentModel, options, signal) {
    throwIfCancelled(signal);
    const md = buildMarkdownAsLink(documentModel, options);
    throwIfCancelled(signal);
    triggerDownloadFile(
      md,
      core.makeFilename(documentModel.title, documentModel.author, documentModel.kind === 'article') + '.md'
    );
    return {};
  }

  async function downloadAsEmbed(documentModel, options, signal) {
    throwIfCancelled(signal);
    const allImages = collectAllImages(documentModel);
    const mediaBudget = createMediaBudget();
    validateImageWorkload(allImages);
    let processedImages;
    let failedImages;
    try {
      ({ processedImages, failedImages } = await prepareProcessedImages(
        allImages,
        t('progress_compressing_images', '正在压缩图片'),
        signal,
        mediaBudget
      ));
    } catch (error) {
      if (error?.code !== 'EMBED_HARD_LIMIT') throw error;
      _XPD.sendProgress?.(t('progress_embed_hard_switch', '内嵌数据超过安全上限，正在切换到 ZIP 打包...'));
      const zipResult = await downloadAsZip(
        documentModel,
        options,
        error.processedImages,
        signal,
        mediaBudget
      );
      return {
        ...zipResult,
        warning: zipResult.warning || t('warning_embed_hard_switch', '内嵌数据超过 40 MB，已自动改用 ZIP 打包。'),
      };
    }

    const finalMd = composeMarkdown(
      documentModel,
      options,
      (url) => processedImages[url] || url
    );
    const estimatedBytes = estimateMarkdownSize(finalMd);
    throwIfCancelled(signal);

    if (estimatedBytes > EMBED_WARN_THRESHOLD_BYTES) {
      const estimatedSize = formatBytes(estimatedBytes);
      _XPD.sendProgress?.(t('progress_embed_confirm', '内嵌文件较大，等待确认...'));
      const shouldContinueEmbed = window.confirm(
        `${t('embed_confirm_before', '预计导出的 Markdown 约')} ${estimatedSize}. ${t('embed_confirm_after', '继续使用 embed 模式可能导致编辑器卡顿。\n\n选择“确定”继续导出单文件；选择“取消”将自动改用 ZIP 打包。')}`
      );

      if (!shouldContinueEmbed) {
        _XPD.sendProgress?.(t('progress_embed_cancel_switch', '内嵌文件过大，正在切换到 ZIP 打包...'));
        return downloadAsZip(
          documentModel,
          options,
          processedImages,
          signal,
          mediaBudget
        );
      }
    }

    throwIfCancelled(signal);
    _XPD.sendProgress?.(t('progress_saving', '正在保存文件...'));
    triggerDownloadFile(
      finalMd,
      core.makeFilename(documentModel.title, documentModel.author, documentModel.kind === 'article') + '.md'
    );
    return failedImages.length
      ? { warning: `${failedImages.length} ${t('warning_image_remote_markdown', '张图片获取失败，Markdown 中保留了远程链接。')}` }
      : {};
  }

  async function downloadAsZip(
    documentModel,
    options,
    preparedImages = null,
    signal = null,
    mediaBudget = null
  ) {
    throwIfCancelled(signal);
    const zip = new JSZip();
    const uniqueImages = validateImageWorkload(collectAllImages(documentModel));
    const imageTargets = {};
    const failedImages = [];
    const budget = mediaBudget || createMediaBudget();
    const workController = new AbortController();
    const cancelWork = () => workController.abort(signal?.reason || 'cancelled');
    signal?.addEventListener('abort', cancelWork, { once: true });
    let mediaBudgetError = null;

    try {
      await mapWithConcurrency(
        uniqueImages,
        IMAGE_CONCURRENCY_LIMIT,
        async (url, index) => {
          const preparedDataUrl = preparedImages?.[url];
          if (isDataUrl(preparedDataUrl)) {
            if (!budget.add(url, estimateMarkdownSize(preparedDataUrl))) {
              mediaBudgetError = createMediaBudgetError();
              workController.abort('budget');
              throw mediaBudgetError;
            }
            imageTargets[url] = addDataUrlToZip(zip, preparedDataUrl, index);
            // The embed-to-ZIP fallback owns this temporary map; release each
            // data URL after JSZip has accepted it to reduce the peak live set.
            if (preparedImages) delete preparedImages[url];
            return;
          }

          if (preparedImages && Object.prototype.hasOwnProperty.call(preparedImages, url)) {
            imageTargets[url] = preparedDataUrl || url;
            failedImages.push(url);
            delete preparedImages[url];
            return;
          }

          try {
            const { base64, contentType } = await fetchImageViaBackground(
              url,
              workController.signal
            );
            if (!budget.add(url, estimateBase64Bytes(base64))) {
              mediaBudgetError = createMediaBudgetError();
              workController.abort('budget');
              throw mediaBudgetError;
            }
            imageTargets[url] = addBase64ToZip(zip, base64, contentType, index);
          } catch (error) {
            if (isCancelledError(error) || mediaBudgetError) throw error;
            console.warn(`[XPD] Failed to download image ${index + 1}:`, error.message);
            imageTargets[url] = url;
            failedImages.push(url);
          }
        },
        workController.signal,
        (completed, total) => {
          _XPD.sendProgress?.(
            `${t('progress_packaging_image', '正在打包图片')} ${completed}/${total}...`,
            { completed, total, phase: 'images' }
          );
        }
      );
    } catch (error) {
      if (mediaBudgetError) throw mediaBudgetError;
      if (signal?.aborted || isCancelledError(error)) throw createCancelledError();
      throw error;
    } finally {
      signal?.removeEventListener('abort', cancelWork);
    }

    const md = composeMarkdown(
      documentModel,
      options,
      (url) => imageTargets[url] || url
    );
    zip.file('post.md', md);

    throwIfCancelled(signal);
    _XPD.sendProgress?.(t('progress_packaging_zip', '正在打包 ZIP...'));
    const blob = await zip.generateAsync(
      { type: 'blob', streamFiles: true },
      (metadata) => {
        throwIfCancelled(signal);
        const percent = Math.max(0, Math.min(100, Math.round(Number(metadata?.percent) || 0)));
        _XPD.sendProgress?.(
          `${t('progress_packaging_zip', '正在打包 ZIP...')} ${percent}%`,
          { completed: percent, total: 100, phase: 'zip' }
        );
      }
    );
    throwIfCancelled(signal);
    triggerDownloadBlob(
      blob,
      core.makeFilename(documentModel.title, documentModel.author, documentModel.kind === 'article') + '.zip'
    );
    return failedImages.length
      ? { warning: `${failedImages.length} ${t('warning_image_remote_zip', '张图片获取失败，ZIP 中的 Markdown 保留了远程链接。')}` }
      : {};
  }

  // File download triggers

  function triggerDownloadFile(content, filename) {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    triggerDownloadBlob(blob, filename);
  }

  function triggerDownloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 1000);
  }

  // Export module

  _XPD.exp = {
    buildMetadata,
    buildComments,
    renderInlineNodes,
    renderContentBlocks,
    composeMarkdown,
    mapWithConcurrency,
    isCancelledError,
    buildMarkdownAsLink,
    downloadAsLink,
    downloadAsEmbed,
    downloadAsZip,
    createMediaBudget,
    validateImageWorkload,
    estimateBase64Bytes,
    fitImageDimensions,
    MEDIA_TOTAL_BUDGET_BYTES,
    MAX_ARCHIVE_IMAGE_COUNT,
    MAX_IMAGE_PIXELS,
  };
})();
