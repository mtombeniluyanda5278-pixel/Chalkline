// Small previews use the same authenticated, scan-gated endpoints as the reader.
let running = 0;
const queue = [];
function schedule(work) {
  queue.push(work);
  drain();
}
function drain() {
  while (running < 2 && queue.length) {
    running++;
    Promise.resolve().then(queue.shift()).catch(() => {}).finally(() => {
      running--;
      drain();
    });
  }
}
export function youtubePoster(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase();
    let id;
    if (host === 'youtu.be') id = url.pathname.split('/')[1];
    else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'www.youtube-nocookie.com'].includes(host)) {
      const parts = url.pathname.split('/');
      id = parts[1] === 'watch' ? url.searchParams.get('v') : ['shorts', 'embed', 'live'].includes(parts[1]) ? parts[2] : null;
    }
    return /^[A-Za-z0-9_-]{11}$/.test(id || '') ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
  } catch { return null; }
}
export function resourceType(item) {
  if (item.external_url) return 'Video link';
  if (item.mime?.startsWith('image/')) return 'Image';
  if (item.mime === 'application/pdf') return 'PDF';
  if (item.mime?.includes('wordprocessingml')) return 'Word document';
  if (item.mime?.includes('presentationml')) return 'Presentation';
  if (item.mime?.includes('spreadsheetml')) return 'Spreadsheet';
  if (item.mime === 'text/plain') return 'Text';
  return 'File';
}
export function createResourcePreview({ item, el, api, eager = false }) {
  const type = resourceType(item);
  const root = el('div', { class: 'resource-preview', 'aria-label': `${type} preview: ${item.title}` });
  const fallback = (message = type) => root.replaceChildren(
    el('span', { class: 'resource-preview__symbol', 'aria-hidden': 'true' }, item.external_url ? '▶' : '▤'),
    el('span', { class: 'resource-preview__label' }, message),
  );
  fallback();
  let disposed = false, observer, task, renderTask;
  const showImage = (src, external = false) => {
    const img = el('img', { src, alt: item.title, loading: eager ? 'eager' : 'lazy', decoding: 'async', ...(external ? { referrerpolicy: 'no-referrer' } : {}) });
    img.addEventListener('error', () => { if (!disposed) fallback('Preview unavailable · ' + type); }, { once: true });
    root.replaceChildren(img);
    if (external) root.append(el('span', { class: 'resource-preview__play', 'aria-hidden': 'true' }, '▶'));
  };
  const load = async () => {
    if (disposed) return;
    if (item.external_url) {
      const poster = youtubePoster(item.external_url);
      if (poster) showImage(poster, true);
      else fallback('Video link · Open to watch');
      return;
    }
    if (item.status !== 'ready') {
      fallback(['quarantined', 'scan_failed'].includes(item.status) ? 'File blocked' : 'Preview available after file checks');
      return;
    }
    if (item.mime?.startsWith('image/')) {
      showImage(`/v1/resources/${encodeURIComponent(item.id)}/content`);
      return;
    }
    try {
      if (item.mime === 'application/pdf') {
        const pdfjs = await import('./vendor/pdf.mjs');
        if (disposed) return;
        pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.mjs', import.meta.url).href;
        task = pdfjs.getDocument({ url: `/v1/resources/${encodeURIComponent(item.id)}/content`, withCredentials: true, isEvalSupported: false, enableXfa: false, disableAutoFetch: true, disableStream: true, disableRange: true, useWorkerFetch: false, maxImageSize: 16000000 });
        const pdf = await task.promise;
        if (disposed) return;
        const page = await pdf.getPage(1);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(1, 600 / Math.max(base.width, base.height)) });
        const canvas = el('canvas', { role: 'img', 'aria-label': `First page of ${item.title}` });
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        if (disposed) return;
        renderTask = page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport });
        await renderTask.promise;
        if (!disposed) root.replaceChildren(canvas);
        page.cleanup();
      } else {
        const data = await api(`/v1/resources/${encodeURIComponent(item.id)}/preview`);
        if (disposed) return;
        const text = (data.sections || []).map(section => section.text || '').join('\n').trim();
        if (text) root.replaceChildren(el('pre', { class: 'resource-preview__excerpt' }, text.slice(0, 700)));
        else fallback(type + ' · Open to view');
      }
    } catch {
      if (!disposed) fallback('Preview unavailable · ' + type);
    } finally {
      if (task) await task.destroy().catch(() => {});
      task = null;
    }
  };
  if (eager || typeof IntersectionObserver === 'undefined') schedule(load);
  else {
    observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        observer.disconnect();
        schedule(load);
      }
    }, { rootMargin: '150px' });
    observer.observe(root);
  }
  return { element: root, dispose() {
    disposed = true;
    observer?.disconnect();
    renderTask?.cancel();
    if (task) void task.destroy().catch(() => {});
  } };
}
