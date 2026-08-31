// Postcase - Background Service Worker
// Handles cross-origin image fetching with URL whitelist validation.

const ALLOWED_IMAGE_HOSTS = new Set(['pbs.twimg.com']);
const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const IMAGE_FETCH_TIMEOUT_MS = 20_000;
const GLOBAL_IMAGE_CONCURRENCY_LIMIT = 6;
const GLOBAL_IMAGE_QUEUE_LIMIT = 96;
const activeImageFetches = new Map();
const queuedImageFetches = [];
const imageRequestEntries = new Map();
const imageQueueStats = {
  maxQueueDepth: 0,
  queuedCompleted: 0,
  maxWaitMs: 0,
  rejected: 0,
};
let activeImageFetchCount = 0;
let imageRequestSequence = 0;

function getImageFetchQueueStats() {
  return {
    active: activeImageFetchCount,
    queued: queuedImageFetches.length,
    queueLimit: GLOBAL_IMAGE_QUEUE_LIMIT,
    ...imageQueueStats,
  };
}

function getImageRequestKey(sender, requestId) {
  if (sender?.tab?.id == null || !requestId) return '';
  return `${sender.tab.id}:${requestId}`;
}

function cancelImageFetchesForTab(tabId) {
  for (const [entryKey, entry] of imageRequestEntries) {
    if (entry.tabId !== tabId) continue;
    if (entry.started) entry.controller.abort('cancelled');
    else cancelQueuedImageFetch(entry);
  }
}

function respondToImageRequest(entry, response) {
  if (entry.responded) return;
  entry.responded = true;
  try {
    entry.sendResponse(response);
  } catch {
    // The sender may have closed its tab while the request was in flight.
  }
}

function removeImageRequestEntry(entry) {
  if (entry.entryKey && imageRequestEntries.get(entry.entryKey) === entry) {
    imageRequestEntries.delete(entry.entryKey);
  }
  if (entry.requestKey && activeImageFetches.get(entry.requestKey) === entry.controller) {
    activeImageFetches.delete(entry.requestKey);
  }
}

function cancelQueuedImageFetch(entry) {
  if (!entry || entry.started || entry.responded) return false;
  entry.controller.abort('cancelled');
  const queueIndex = queuedImageFetches.indexOf(entry);
  if (queueIndex >= 0) queuedImageFetches.splice(queueIndex, 1);
  respondToImageRequest(entry, {
    success: false,
    cancelled: true,
    error: 'Image fetch cancelled',
  });
  removeImageRequestEntry(entry);
  return true;
}

function drainImageFetchQueue() {
  while (activeImageFetchCount < GLOBAL_IMAGE_CONCURRENCY_LIMIT && queuedImageFetches.length) {
    const entry = queuedImageFetches.shift();
    if (!entry || entry.responded) continue;
    if (entry.controller.signal.aborted) {
      cancelQueuedImageFetch(entry);
      continue;
    }
    startImageFetch(entry);
  }
}

function startImageFetch(entry) {
  if (!entry || entry.responded || entry.controller.signal.aborted) {
    cancelQueuedImageFetch(entry);
    return;
  }
  entry.started = true;
  if (entry.enqueuedAt) {
    imageQueueStats.queuedCompleted += 1;
    imageQueueStats.maxWaitMs = Math.max(
      imageQueueStats.maxWaitMs,
      Math.max(0, Date.now() - entry.enqueuedAt)
    );
  }
  activeImageFetchCount += 1;
  fetchAsBase64(entry.url, entry.controller)
    .then((data) => respondToImageRequest(entry, { success: true, data }))
    .catch((err) => respondToImageRequest(entry, {
      success: false,
      cancelled: err?.code === 'CANCELLED',
      error: err?.message || 'Image fetch failed',
    }))
    .finally(() => {
      activeImageFetchCount = Math.max(0, activeImageFetchCount - 1);
      removeImageRequestEntry(entry);
      drainImageFetchQueue();
    });
}

function isAllowedImageUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && ALLOWED_IMAGE_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

function isAllowedSender(sender) {
  if (!sender?.tab?.url) return false;
  try {
    const host = new URL(sender.tab.url).hostname.replace(/^www\./, '');
    return host === 'x.com' || host === 'twitter.com';
  } catch {
    return false;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CANCEL_IMAGE_FETCH') {
    if (!isAllowedSender(sender)) return false;
    const requestKey = getImageRequestKey(sender, message.requestId);
    const entry = imageRequestEntries.get(requestKey);
    if (entry?.started) entry.controller.abort('cancelled');
    else if (entry) cancelQueuedImageFetch(entry);
    sendResponse({ success: true, cancelled: Boolean(entry) });
    return false;
  }

  if (message.type !== 'FETCH_IMAGE') return false;

  if (!isAllowedSender(sender)) {
    sendResponse({ success: false, error: 'Unauthorized sender' });
    return false;
  }

  if (!isAllowedImageUrl(message.url)) {
    sendResponse({ success: false, error: 'URL not in allowed hosts' });
    return false;
  }

  const requestKey = getImageRequestKey(sender, message.requestId);
  const controller = new AbortController();
  const entry = {
    entryKey: requestKey || `tab:${sender.tab.id}:anonymous-${++imageRequestSequence}`,
    tabId: sender.tab.id,
    requestKey,
    url: message.url,
    controller,
    sendResponse,
    started: false,
    responded: false,
  };
  imageRequestEntries.set(entry.entryKey, entry);
  if (requestKey) activeImageFetches.set(requestKey, controller);
  if (activeImageFetchCount < GLOBAL_IMAGE_CONCURRENCY_LIMIT) {
    startImageFetch(entry);
    return true;
  }
  if (queuedImageFetches.length >= GLOBAL_IMAGE_QUEUE_LIMIT) {
    imageQueueStats.rejected += 1;
    respondToImageRequest(entry, {
      success: false,
      error: 'Image fetch queue is full',
    });
    removeImageRequestEntry(entry);
    return false;
  }
  // FIFO ordering gives each tab a stable turn while the global cap provides
  // backpressure instead of allowing an unbounded callback queue to grow.
  entry.enqueuedAt = Date.now();
  queuedImageFetches.push(entry);
  imageQueueStats.maxQueueDepth = Math.max(
    imageQueueStats.maxQueueDepth,
    queuedImageFetches.length
  );
  return true;
});

chrome.tabs?.onRemoved?.addListener((tabId) => cancelImageFetchesForTab(tabId));
chrome.tabs?.onUpdated?.addListener((tabId, changeInfo) => {
  if (changeInfo?.status === 'loading' || changeInfo?.url) cancelImageFetchesForTab(tabId);
});

async function fetchAsBase64(url, controller = new AbortController()) {
  const parsedUrl = new URL(url);
  if (parsedUrl.hostname === 'pbs.twimg.com' && parsedUrl.pathname.startsWith('/media/')) {
    parsedUrl.searchParams.set('name', 'large');
  }
  const fetchUrl = parsedUrl.toString();

  const timeoutId = setTimeout(() => controller.abort('timeout'), IMAGE_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(fetchUrl, {
      credentials: 'omit',
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (!isAllowedImageUrl(response.url)) throw new Error('Redirected outside allowed hosts');

    const contentType = (response.headers.get('content-type') || '')
      .split(';', 1)[0]
      .trim()
      .toLowerCase();
    if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
      throw new Error(`Unsupported image type: ${contentType || 'unknown'}`);
    }

    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
      throw new Error('Image exceeds 25 MB limit');
    }

    const uint8Array = await readImageBytes(response);

    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, uint8Array.subarray(i, i + chunkSize));
    }

    return {
      base64: btoa(binary),
      contentType,
    };
  } catch (error) {
    // Fetch rejects with signal.reason, which can be a string when abort()
    // was given a custom reason instead of the default AbortError.
    if (controller.signal.aborted || error?.name === 'AbortError') {
      if (controller.signal.reason === 'cancelled') {
        const cancelledError = new Error('Image fetch cancelled');
        cancelledError.code = 'CANCELLED';
        throw cancelledError;
      }
      throw new Error('Image fetch timed out');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function readImageBytes(response) {
  if (!response.body?.getReader) {
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_IMAGE_BYTES) {
      throw new Error('Image exceeds 25 MB limit');
    }
    return new Uint8Array(arrayBuffer);
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_IMAGE_BYTES) {
        // Stop the network read before retaining an unbounded response body.
        await reader.cancel().catch(() => {});
        throw new Error('Image exceeds 25 MB limit');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
