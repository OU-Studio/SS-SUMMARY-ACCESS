/*!
 * OU Summary Plugin v2.5 (with header config)
 * Header example:
 *   /full-portfolio?ouConfig=mode:load|loadCount:9|buttonText:Load%20More...|buttonBgColor:%2305f54d|buttonTextColor:%23000000
 *
 * Keys:
 *   mode: "all" | "load"
 *   loadCount: number
 *   buttonText: string
 *   buttonBgColor: CSS color (e.g. #333333)
 *   buttonTextColor: CSS color
 */

(function () {
  const SELECTOR_BLOCK = '.sqs-block-summary-v2';
  const BLOCK_FLAG = 'data-ou-summary-initialized';
  const DEBUG = false;
  const log = (...a) => DEBUG && console.log('[OU Summary]', ...a);
  const warn = (...a) => console.warn('[OU Summary]', ...a);
  const err = (...a) => console.error('[OU Summary]', ...a);

  // ---- Event wiring (SPA/late injection safe)
  document.addEventListener('DOMContentLoaded', init);
  window.addEventListener('mercury:load', init);
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(init, 0);
  }
  const mo = new MutationObserver(() => debounce(init, 100)());
  mo.observe(document.documentElement, { childList: true, subtree: true });

  let debounceTimer;
  function debounce(fn, wait) {
    return function () {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(fn, wait);
    };
  }

  async function init() {
    try {
      const blocks = Array.from(document.querySelectorAll(SELECTOR_BLOCK))
        .filter(b => !b.hasAttribute(BLOCK_FLAG));
      if (!blocks.length) return;

      for (const block of blocks) {
        block.setAttribute(BLOCK_FLAG, '1');
        processBlock(block).catch(e => err('processBlock failed', e));
      }
    } catch (e) {
      err('init error', e);
    }
  }

  function parseOUConfigFromHeader(headerText) {
    // headerText like: "/blog?ouConfig=mode:load|loadCount:9|buttonText:Load%20More..."
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

  async function processBlock(block) {
    const jsonAttr = block.getAttribute('data-block-json');
    if (!jsonAttr) return;

    let config;
    try { config = JSON.parse(jsonAttr); } catch { return; }

    if (config.pageSize !== 30 || !config.collectionId || !config.headerText) {
      log('skip block (requirements not met)');
      return;
    }

    // Parse header config
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

    // Build initial URL with native filters + format=json
    const qp = [];
    if (config.filter?.category) qp.push(`category=${encodeURIComponent(config.filter.category)}`);
    if (config.filter?.tag) qp.push(`tag=${encodeURIComponent(config.filter.tag)}`);

    let initialUrl = baseUrl || '';
    if (!initialUrl) {
      // Fallback to headerText as-is
      initialUrl = config.headerText;
    }
    if (qp.length) {
      initialUrl += (initialUrl.includes('?') ? '&' : '?') + qp.join('&');
    }
    if (!initialUrl.includes('format=json')) {
      initialUrl += (initialUrl.includes('?') ? '&' : '?') + 'format=json';
    }

    const items = [];
    await fetchAllPages(initialUrl, items);

    let allItems = items;
    if (config.filter?.featured === true) {
      allItems = allItems.filter(i => i.starred === true);
    }

    const templateItem = listEl.querySelector('.summary-item');
    listEl.innerHTML = '';
    listEl.classList.add('ou-carousel-container');
    listEl.style.overflow = 'hidden';

    if (!templateItem) {
      loader.remove();
      warn('No template .summary-item found');
      return;
    }

    if (ouCfg.mode === 'all') {
      allItems.forEach(item => {
        listEl.appendChild(createSummaryItemClone(item, templateItem, baseUrl));
      });
    } else {
      // load-more mode
      let rendered = 0;
      const loadCount = Number(ouCfg.loadCount) || 6;

      const wrap = document.createElement('div');
      wrap.className = 'ou-summary-load-more-wrapper';

      const btn = document.createElement('p');
      btn.className = 'ou-summary-load-more';
      btn.textContent = String(ouCfg.buttonText || 'Load More...');
      btn.style.backgroundColor = String(ouCfg.buttonBgColor || '#333333');
      btn.style.color = String(ouCfg.buttonTextColor || '#ffffff');
      wrap.appendChild(btn);

      (function renderNextBatch() {
        const next = allItems.slice(rendered, rendered + loadCount);
        next.forEach(item => listEl.appendChild(createSummaryItemClone(item, templateItem, baseUrl)));
        rendered += next.length;
        if (rendered >= allItems.length) wrap.style.display = 'none';
      })();

      btn.addEventListener('click', () => {
        const next = allItems.slice(rendered, rendered + loadCount);
        next.forEach(item => listEl.appendChild(createSummaryItemClone(item, templateItem, baseUrl)));
        rendered += next.length;
        if (rendered >= allItems.length) wrap.style.display = 'none';
        window.dispatchEvent(new Event('resize'));
      });

      // Insert wrapper after the list
      listEl.parentElement && listEl.parentElement.appendChild(wrap);
    }

    loader.remove();

    if (config.design === 'carousel' && config.slidesPerRow) {
      setupCustomCarousel(block, Number(config.slidesPerRow) || 1);
      injectOUCarouselStyles();
    }

    window.dispatchEvent(new Event('resize'));
  }

  async function fetchAllPages(url, out) {
    try {
      const res = await fetch(url, { credentials: 'same-origin' });
      const json = await res.json();
      const items = json.items || [];
      out.push(...items);

      const next = json.pagination?.nextPageUrl;
      if (json.pagination?.nextPage && next) {
        let nextUrl = next;
        if (!nextUrl.includes('format=json')) {
          nextUrl += (nextUrl.includes('?') ? '&' : '?') + 'format=json';
        }
        await fetchAllPages(nextUrl, out);
      }
    } catch (e) {
      err('fetchAllPages failed', url, e);
    }
  }

  function createSummaryItemClone(item, templateItem, baseUrl) {
    const clone = templateItem.cloneNode(true);
    const url = normalizeUrl(item);

    const titleEl = clone.querySelector('.summary-title');
    if (titleEl) {
      titleEl.innerHTML = `<a href="${url}" class="summary-title-link">${escapeHTML(item.title || '')}</a>`;
    }

    const excerptEl = clone.querySelector('.summary-excerpt');
    if (excerptEl) excerptEl.innerHTML = item.excerpt || '';

    const linkEl = clone.querySelector('.summary-read-more-link');
    if (linkEl) {
      linkEl.setAttribute('href', url);
      linkEl.textContent = 'Read More →';
    }

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
    if (item?.sourceUrl) {
      return item.sourceUrl.startsWith('http') ? item.sourceUrl : `http://${item.sourceUrl}`;
    }
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

  // ---- Carousel helpers
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

  function injectOUCarouselStyles() {
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
      .ou-summary .ou-carousel-prev:before {
        content: "\\E02C";
        font-family: 'squarespace-ui-font';
      }
      .ou-summary .ou-carousel-next:before {
        content: "\\E02D";
        font-family: 'squarespace-ui-font';
      }
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
    `;
    document.head.appendChild(style);
  }
})();
