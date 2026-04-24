// Mock host — chat iframe trigger.
// Clicking any element with [data-chat-trigger] toggles a right-docked
// sidebar iframe pointing at the Puma chat UI. On desktop, body padding
// reflows page content leftwards when the sidebar is open; on mobile
// the sidebar overlays full-width.
//
// The sidebar (and the iframe inside it) is recreated from scratch on
// every page load — no state persistence yet. That's the observation
// target. Once a persistence layer lands, this file is the place that
// would auto-reopen the sidebar when a conversation is in flight.
//
// Sidebar width is user-resizable via a handle on the left edge. The
// chosen width persists in sessionStorage across page loads in the
// same tab, so reopening the sidebar on the next page (once auto-open
// lands) will use the same width.

(function () {
  var CHAT_URL = 'http://localhost:5173';
  var WRAP_ID = 'mock-host-chat-wrap';
  var OPEN_CLASS = 'mock-chat-open';
  var WIDTH_KEY = 'mock-chat-sidebar-width';
  var DEFAULT_WIDTH = 420;
  var MIN_WIDTH = 320;
  var MAX_WIDTH_VW = 0.7;

  function currentMaxWidth() {
    return Math.max(MIN_WIDTH, Math.round(window.innerWidth * MAX_WIDTH_VW));
  }

  function clampWidth(n) {
    return Math.max(MIN_WIDTH, Math.min(n, currentMaxWidth()));
  }

  function getStoredWidth() {
    try {
      var raw = sessionStorage.getItem(WIDTH_KEY);
      var n = parseInt(raw, 10);
      if (Number.isFinite(n)) return clampWidth(n);
    } catch (_) {}
    return DEFAULT_WIDTH;
  }

  function storeWidth(n) {
    try { sessionStorage.setItem(WIDTH_KEY, String(n)); } catch (_) {}
  }

  function applyWidth(n) {
    var w = clampWidth(n);
    document.documentElement.style.setProperty('--mock-chat-width', w + 'px');
    return w;
  }

  function openChat() {
    if (document.getElementById(WRAP_ID)) return;
    applyWidth(getStoredWidth());
    var wrap = document.createElement('div');
    wrap.id = WRAP_ID;
    wrap.className = 'chat-iframe-wrap';
    wrap.innerHTML =
      '<div class="chat-iframe-resize-handle" role="separator" aria-orientation="vertical" aria-label="Resize chat sidebar" data-resize-handle></div>' +
      '<div class="chat-iframe-header">' +
      '<span>Swoop-ish — Chat to a specialist</span>' +
      '<button type="button" class="chat-iframe-close" aria-label="Close chat">&times;</button>' +
      '</div>' +
      '<iframe src="' + CHAT_URL + '" title="Puma chat" allow="clipboard-write"></iframe>';
    document.body.appendChild(wrap);
    document.body.classList.add(OPEN_CLASS);
    wrap.querySelector('.chat-iframe-close').addEventListener('click', closeChat);
    wireResize(wrap.querySelector('[data-resize-handle]'));
  }

  function closeChat() {
    var wrap = document.getElementById(WRAP_ID);
    if (wrap) wrap.remove();
    document.body.classList.remove(OPEN_CLASS);
  }

  function wireResize(handle) {
    if (!handle) return;
    var dragging = false;
    var overlay = null;

    function onMove(e) {
      if (!dragging) return;
      var w = applyWidth(window.innerWidth - e.clientX);
      e.preventDefault();
      // keep transient width accessible for onUp without re-reading the var
      handle.dataset.transientWidth = String(w);
    }

    function onUp() {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('dragging');
      if (overlay) { overlay.remove(); overlay = null; }
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      var w = parseInt(handle.dataset.transientWidth || '', 10);
      if (Number.isFinite(w)) storeWidth(w);
    }

    handle.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      dragging = true;
      handle.classList.add('dragging');
      // Full-viewport overlay prevents the iframe from swallowing
      // pointermove events while the user drags across it.
      overlay = document.createElement('div');
      overlay.style.cssText =
        'position:fixed;inset:0;z-index:200;cursor:col-resize;background:transparent;';
      document.body.appendChild(overlay);
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
      e.preventDefault();
    });
  }

  // If the viewport shrinks below the current sidebar width, clamp
  // so the sidebar never exceeds its max. No-op when sidebar is closed.
  window.addEventListener('resize', function () {
    if (!document.getElementById(WRAP_ID)) return;
    applyWidth(getStoredWidth());
  });

  document.addEventListener('click', function (e) {
    var t = e.target;
    while (t && t !== document) {
      if (t.dataset && 'chatTrigger' in t.dataset) {
        e.preventDefault();
        if (document.getElementById(WRAP_ID)) closeChat();
        else openChat();
        return;
      }
      t = t.parentNode;
    }
  });
})();
