/*!
 * OU Summary Plugin v2.6
 * - Header config via ?ouConfig=mode:load|loadCount:9|buttonText:...|buttonBgColor:#333|buttonTextColor:#fff
 * - Server aggregator + cache at /api/summary with automatic client fallback
 * - Load More with live Category/Tag filters that preserve visible count
 * - Squarespace SPA-safe + late-injection safe
 */

(function () {
  const SELECTOR_BLOCK = '.sqs-block-summary-v2';
  const BLOCK_FLAG = 'data-ou-summary-initialized';
  const DEBUG = false;
  const log = (...a) => DEBUG && console.log('[OU Summary]', ...a);
  const warn = (...a) => console.warn('[OU Summary]', ...a);
  const err = (...a) => console.error('[OU Summary]', ...a);

  // ---------------- Events (SPA / late injection safe)
  document.addEventListener('DOMContentLoaded', init);
  window.addEventListener('mercury:load', init);
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(init, 0);
  }
  const mo = new MutationObserver(() => debounce(init, 100)());
  mo.observe(document.documentElement, { childList: true, subtree: true });
  let debounceTimer;
  function debounce(fn, wait) { return function () { clearTimeout(debounceTimer); debounceTimer = setTimeout(fn, wait); }; }

  // ---------------- State helpers
  const OU_SUMMARY_STATE = new WeakMap();
  function uniqueStrings(arr) { return Array.from(new Set(arr.filter(Boolean))); }

  // ---------------- Header config parser
  function parseOUConfigFromHeader(headerText) {
    const [base, cfgRaw] = String(headerText || '').split('?ouConfig=');
    const cfg = {};
    if (cfgRaw) {
      cfgRaw.split('|').forEach(pair => {
        const [rawKey, rawVal] = pair.split(':');
        if (!rawKey) return;
        const key = rawKey.trim();
        if (rawVal === undefined) return;
        let val = rawVal;
        try { val = decodeURIComponent(rawVal); } catch {}
        const v = String(val).trim();
        if (v === 'true') cfg[key] = true;
        else if (v === 'false') cfg[key] = false;
        else if (v !== '' && !isNaN(Number(v))) cfg[key] = Number(v);
        else cfg[key] = v;
      });
    }
    return { baseUrl: base || '', config: cfg };
  }

  // ---------------- Filtering + rendering helpers
  function filterItems(items, cat, tag) {
    return items.filter(it => {
      let ok = true;
      if (cat) ok = ok && (it.categories || []).includes(cat);
      if (ok && tag) ok = ok && (it.tags || []).includes(tag);
      return ok;
    });
  }

  function renderList(container, templateItem, items, start, count, baseUrl) {
    container.innerHTML = '';
    const end = Math.min(items.length, start + count);
    for (let i = start; i < end; i++) {
      container.appendChild(createSummaryItemClone(items[i], templateItem, baseUrl));
    }
  }

  function remainingItemsCount(state) {
    return Math.max(0, state.filteredItems.length - state.rendered);
  }

  function updateLoadMoreUI(block, container, state, templateItem, baseUrl) {
    // place the wrapper after the list
    let wrap = block.querySelector('.ou-summary-load-more-wrapper');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'ou-summary-load-more-wrapper';
      container.parentElement && container.parentElement.appendChild(wrap);
    }
    let btn = wrap.querySelector('.ou-summary-load-more');
    if (!btn) {
      btn = document.createElement('p');
      btn.className = 'ou-summary-load-more';
      wrap.appendChild(btn);
    }
    // label + colors from state.ui
    btn.textContent = state.ui.text;
    btn.style.backgroundColor = state.ui.bg;
    btn.style.color = state.ui.fg;

    // visibility by remaining items
    const remaining = remainingItemsCount(state);
    wrap.style.display = remaining > 0 ? 'block' : 'none';

    // replace listener cleanly
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);

    newBtn.addEventListener('click', () => {
      const start = state.rendered;
      const nextCount = Math.min(state.loadCount, remainingItemsCount(state));
      const end = start + nextCount;

      for (let i = start; i < end; i++) {
        container.appendChild(createSummaryItemClone(state.filteredItems[i], templateItem, baseUrl));
      }
      state.rendered = end;

      const left = remainingItemsCount(state);
      wrap.style.display = left > 0 ? 'block' : 'none';
      window.dispatchEvent(new Event('resize'));
    });
  }

  function buildFilterBar(block, items, onChange) {
    const allCats = uniqueStrings(items.flatMap(i => i.categories || []));
    const allTags = uniqueStrings(items.flatMap(i => i.tags || []));
    if (!allCats.length && !allTags.length) return;

    let bar = block.querySelector('.ou-summary-filterbar');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'ou-summary-filterbar';
      const contentWrap = block.querySelector('.sqs-block-content') || block;
      contentWrap.insertBefore(bar, contentWrap.firstChild);
    } else {
      bar.innerHTML = '';
    }

    const catSelect = document.createElement('select');
    const tagSelect = document.createElement('select');

    function fillSelect(select, label, values) {
      select.innerHTML = '';
      const any = document.createElement('option');
      any.value = '';
      any.textContent = `All ${label}`;
      select.appendChild(any);
      values.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v;
        opt.textContent = v;
        select.appendChild(opt);
      });
    }

    if (allCats.length) fillSelect(catSelect, 'Categories', allCats);
    if (allTags.length) fillSelect(tagSelect, 'Tags', allTags);

    bar.style.display = 'flex';
    bar.style.gap = '10px';
    bar.style.margin = '0 0 12px';

    if (allCats.length) { catSelect.className = 'ou-summary-filter ou-summary-filter--cat'; bar.appendChild(catSelect); }
    if (allTags.length) { tagSelect.className = 'ou-summary-filter ou-summary-filter--tag'; bar.appendChild(tagSelect); }

    function handleChange() {
      const nextCat = catSelect ? catSelect.value || null : null;
      const nextTag = tagSelect ? tagSelect.value || null : null;
      onChange(nextCat, nextTag);
    }
    if (allCats.length) catSelect.addEventListener('change', handleChange);
    if (allTags.length) tagSelect.addEventListener('change', handleChange);
  }

  // ---------------- Main block processor
  async function processBlock(block) {
    const jsonAttr = block.getAttribute('data-block-json');
    if (!jsonAttr) return;

    let config;
    try { config = JSON.parse(jsonAttr); } catch { return; }

    if (config.pageSize !== 30 || !config.collectionId || !config.headerText) {
      log('skip block (requirements not met)');
      return;
    }

    // Header config
    const { baseUrl, config: inlineCfg } = parseOUConfigFromHeader(config.headerText || '');
    const defaults = {
      mode: 'load',
      loadCount: 6,
      buttonText: 'Load More...',
      buttonBgColor: '#333333',
      buttonTextColor: '#ffffff'
    };
    const ouCfg = Object.assign({}, defaults, inlineCfg);
    if (config.design === 'carousel') ouCfg.mode = 'all';

    const listEl = block.querySelector('.summary-item-list');
    if (!listEl) return;

    block.classList.add('ou-summary', 'slideIn');
    const loader = document.createElement('div');
    loader.className = 'ou-summary-loading';
    loader.textContent = 'Loading...';
    listEl.appendChild(loader);

    // Build initial URL with native filters + ?format=json
    const qp = [];
    if (config.filter?.category) qp.push(`category=${encodeURIComponent(config.filter.category)}`);
    if (config.filter?.tag)      qp.push(`tag=${encodeURIComponent(config.filter.tag)}`);

    let initialUrl = baseUrl || '';
    if (!initialUrl) initialUrl = config.headerText || '';
    if (qp.length) initialUrl += (initialUrl.includes('?') ? '&' : '?') + qp.join('&');
    if (!initialUrl.includes('format=json')) initialUrl += (initialUrl.includes('?') ? '&' : '?') + 'format=json';

    // Prepare container + template before we clear
    const container = listEl;
    const templateItem = container.querySelector('.summary-item');
    if (!templateItem) { loader.remove(); warn('No template .summary-item found'); return; }

    // Clear and prep
    container.innerHTML = '';
    container.classList.add('ou-carousel-container');
    container.style.overflow = 'hidden';

    // ------------ Aggregate via server API with guaranteed fallback
    const apiBase = 'https://ss-summary-access-production.up.railway.app/api/summary';
    const currentDomain = window.location.hostname.replace(/\.$/, ''); // keep www, strip trailing dot only
    const apiParams = new URLSearchParams();
    apiParams.set('domain', currentDomain);
    apiParams.set('base', baseUrl || config.headerText || '/');
    if (config.filter?.category) apiParams.set('category', config.filter.category);
    if (config.filter?.tag)      apiParams.set('tag', config.filter.tag);
    if (config.filter?.featured === true) apiParams.set('featured', 'true');
    const apiUrl = `${apiBase}?${apiParams.toString()}`;

    async function fetchWithTimeout(url, opts = {}, ms = 6000) {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), ms);
      try { return await fetch(url, { ...opts, signal: controller.signal }); }
      finally { clearTimeout(t); }
    }
    async function fetchAllPagesClient(url, out) {
      try {
        const r = await fetch(url, { credentials: 'same-origin' });
        if (!r.ok) throw new Error(`client ${r.status}`);
        const j = await r.json();
        (j.items || []).forEach(i => out.push(i));
        const next = j.pagination?.nextPage && j.pagination?.nextPageUrl;
        if (next) {
          const u = new URL(next, window.location.origin);
          if (!u.searchParams.has('format')) u.searchParams.set('format', 'json');
          await fetchAllPagesClient(u.toString(), out);
        }
      } catch (e) {
        console.error('Client fetchAllPages failed:', url, e);
      }
    }

    let items = [];
    let usedFallback = false;
    try {
      const res = await fetchWithTimeout(apiUrl, { credentials: 'omit' }, 6000);
      if (!res.ok) throw new Error(`api ${res.status}`);
      const json = await res.json();
      items = Array.isArray(json.items) ? json.items : [];
    } catch (e) {
      console.warn('Summary API failed, falling back:', e.message);
      usedFallback = true;
      const clientItems = [];
      await fetchAllPagesClient(initialUrl, clientItems);
      items = clientItems;
    }
    log(`Loaded ${items.length} items (${usedFallback ? 'fallback' : 'server cache'})`);

    // Respect "featured" if not already server-filtered
    let allItems = items;
    if (config.filter?.featured === true && !usedFallback) {
      // server already did it; if fallback, ensure it now
      allItems = items;
    } else if (config.filter?.featured === true && usedFallback) {
      allItems = items.filter(i => i.starred === true);
    }

    // -------- Filter + Load More aware rendering
    const state = {
      allItems,
      filteredItems: allItems,
      rendered: 0,
      loadCount: Number(ouCfg.loadCount) || 6,
      activeCategory: null,
      activeTag: null,
      ui: {
        text: String(ouCfg.buttonText || 'Load More...'),
        bg: String(ouCfg.buttonBgColor || '#333333'),
        fg: String(ouCfg.buttonTextColor || '#ffffff')
      }
    };
    OU_SUMMARY_STATE.set(block, state);

    // Build filter bar (only in load mode)
    if (ouCfg.mode !== 'all') {
      buildFilterBar(block, state.allItems, (nextCat, nextTag) => {
        state.activeCategory = nextCat || null;
        state.activeTag = nextTag || null;
        state.filteredItems = filterItems(state.allItems, state.activeCategory, state.activeTag);

        const keep = Math.min(state.rendered, state.filteredItems.length);
        renderList(container, templateItem, state.filteredItems, 0, keep, baseUrl);
        state.rendered = keep;

        updateLoadMoreUI(block, container, state, templateItem, baseUrl);
        window.dispatchEvent(new Event('resize'));
      });
    }

    // Initial render
    if (ouCfg.mode === 'all') {
      renderList(container, templateItem, state.filteredItems, 0, state.filteredItems.length, baseUrl);
      state.rendered = state.filteredItems.length;
    } else {
      renderList(container, templateItem, state.filteredItems, 0, state.loadCount, baseUrl);
      state.rendered = Math.min(state.loadCount, state.filteredItems.length);
      updateLoadMoreUI(block, container, state, templateItem, baseUrl);
    }

    // Done loading
    loader.remove();

    // Optional carousel
    if (config.design === 'carousel' && config.slidesPerRow) {
      setupCustomCarousel(block, Number(config.slidesPerRow) || 1);
      injectOUStyles();
    }

    window.dispatchEvent(new Event('resize'));
  }

  // ---------------- Squarespace item clone
  function createSummaryItemClone(item, templateItem, baseUrl) {
    const clone = templateItem.cloneNode(true);
    const url = normalizeUrl(item);

    const titleEl = clone.querySelector('.summary-title');
    if (titleEl) titleEl.innerHTML = `<a href="${url}" class="summary-title-link">${escapeHTML(item.title || '')}</a>`;

    const excerptEl = clone.querySelector('.summary-excerpt');
    if (excerptEl) excerptEl.innerHTML = item.excerpt || '';

    const linkEl = clone.querySelector('.summary-read-more-link');
    if (linkEl) { linkEl.setAttribute('href', url); linkEl.textContent = 'Read More →'; }

    const imageLinkEl = clone.querySelector('.summary-thumbnail-outer-container a');
    const imageEl = clone.querySelector('.summary-thumbnail-outer-container img');
    const imageWrapper = clone.querySelector('.summary-thumbnail-outer-container');
    if (imageLinkEl) imageLinkEl.setAttribute('href', url);
    if (imageEl) {
      if (item.assetUrl) {
        imageEl.setAttribute('src', item.assetUrl);
        imageEl.setAttribute('alt', item.title || '');
        imageEl.classList.add('loaded');
        if (imageWrapper) imageWrapper.classList.add('slideIn');
      } else {
        imageEl.remove();
      }
    }

    const dateEls = clone.querySelectorAll('.summary-metadata-item--date, time.summary-metadata-item--date');
    if (item.publishOn && dateEls.length) {
      const date = new Date(item.publishOn);
      const formatted = date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
      dateEls.forEach(el => {
        el.textContent = formatted;
        if (el.tagName === 'TIME') el.setAttribute('datetime', date.toISOString().split('T')[0]);
      });
    }

    const encodePlus = s => (s || '').trim().replace(/ /g, '+');
    const cats = item.categories || [];
    const tags = item.tags || [];

    const catsEls = clone.querySelectorAll('.summary-metadata-item--cats');
    if (catsEls.length) {
      if (cats.length) {
        const html = cats.map(c => `<a href="${baseUrl}?category=${encodePlus(c)}">${escapeHTML(c)}</a>`).join(', ');
        catsEls.forEach(el => (el.innerHTML = html));
      } else {
        catsEls.forEach(el => el.remove());
      }
    }

    const tagsEls = clone.querySelectorAll('.summary-metadata-item--tags');
    if (tagsEls.length) {
      if (tags.length) {
        const html = tags.map(t => `<a href="${baseUrl}?tag=${encodePlus(t)}">${escapeHTML(t)}</a>`).join(', ');
        tagsEls.forEach(el => (el.innerHTML = html));
      } else {
        tagsEls.forEach(el => el.remove());
      }
    }

    clone.classList.add('slideIn');
    return clone;
  }

  function normalizeUrl(item) {
    if (item?.sourceUrl) return item.sourceUrl.startsWith('http') ? item.sourceUrl : `http://${item.sourceUrl}`;
    if (item?.fullUrl) return item.fullUrl;
    return '#';
  }
  function escapeHTML(str) {
    return String(str)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  // ---------------- Carousel + styles
  function setupCustomCarousel(block, slidesPerRow = 1) {
    const container = block.querySelector('.summary-item-list');
    const pager = block.querySelector('.summary-carousel-pager');
    if (!container || !pager) return;

    container.classList.add('ou-carousel-container');
    pager.innerHTML = `
      <span class="ou-carousel-prev" aria-label="Previous"></span>
      <span class="ou-carousel-next" aria-label="Next"></span>
    `;

    const prevBtn = pager.querySelector('.ou-carousel-prev');
    const nextBtn = pager.querySelector('.ou-carousel-next');

    container.style.overflowX = 'auto';
    container.style.scrollBehavior = 'smooth';
    container.style.display = 'flex';
    container.style.flexWrap = 'nowrap';

    const items = container.querySelectorAll('.summary-item');

    const setItemWidths = () => {
      const containerWidth = container.clientWidth;
      const itemWidth = containerWidth / slidesPerRow;
      items.forEach(item => {
        item.style.flex = `0 0 ${itemWidth}px`;
        item.style.maxWidth = `${itemWidth}px`;
      });
    };
    setItemWidths();

    const pageScroll = () => container.clientWidth;
    function updateArrows() {
      const maxScroll = container.scrollWidth - container.clientWidth;
      prevBtn.classList.toggle('sqs-disabled', container.scrollLeft <= 0);
      nextBtn.classList.toggle('sqs-disabled', container.scrollLeft >= maxScroll - 1);
    }

    prevBtn.addEventListener('click', () => container.scrollBy({ left: -pageScroll(), behavior: 'smooth' }));
    nextBtn.addEventListener('click', () => container.scrollBy({ left: pageScroll(), behavior: 'smooth' }));
    container.addEventListener('scroll', updateArrows);
    window.addEventListener('resize', () => { setItemWidths(); updateArrows(); });

    setTimeout(updateArrows, 120);
  }

  function injectOUStyles() {
    if (document.getElementById('ou-summary-styles')) return;
    const style = document.createElement('style');
    style.id = 'ou-summary-styles';
    style.textContent = `
      .ou-summary .summary-item-list {
        scrollbar-width: none !important;
        -ms-overflow-style: none !important;
        overflow: hidden !important;
      }
      .ou-summary .summary-item-list::-webkit-scrollbar,
      .ou-summary .summary-item-list *::-webkit-scrollbar {
        display: none !important;
      }
      .ou-summary .ou-carousel-prev,
      .ou-summary .ou-carousel-next {
        font-size: 16px;
        background: transparent;
        cursor: pointer;
        color: inherit;
        margin-bottom: 15px;
      }
      .ou-summary .ou-carousel-prev:before { content: "\\E02C"; font-family: 'squarespace-ui-font'; }
      .ou-summary .ou-carousel-next:before { content: "\\E02D"; font-family: 'squarespace-ui-font'; }

      .ou-summary-loading {
        padding: 2em;
        font-style: italic;
        text-align: center;
        opacity: 0.6;
      }
      .ou-summary-load-more {
        display: inline-block;
        margin: 1em auto;
        padding: 0.8em 2em;
        font-size: 1rem;
        background: #333;
        color: #fff;
        border: none;
        border-radius: 4px;
        cursor: pointer;
      }
      .ou-summary-load-more:hover { background: #111; }
      .ou-summary .ou-summary-load-more-wrapper { text-align: center; }

      .ou-summary .summary-item-list { display: flex; flex-wrap: wrap; }
      .ou-summary .summary-item { clear: initial !important; float: initial !important; }

      .ou-summary-filterbar select {
        padding: 6px 8px;
        border: 1px solid rgba(0,0,0,.2);
        border-radius: 4px;
        background: #fff;
      }
    `;
    document.head.appendChild(style);
  }

  // ---------------- Init
  async function init() {
    try {
      const blocks = Array.from(document.querySelectorAll(SELECTOR_BLOCK))
        .filter(b => !b.hasAttribute(BLOCK_FLAG));
      if (!blocks.length) return;

      injectOUStyles();

      for (const block of blocks) {
        block.setAttribute(BLOCK_FLAG, '1');
        processBlock(block).catch(e => err('processBlock failed', e));
      }
    } catch (e) { err('init error', e); }
  }
})();
