/**
 * Restores the blue full-sentence subtitle translation shown on word hover.
 * Word-level tooltip is handled by the main content script; this patch adds
 * machine translation of the entire current subtitle line underneath it.
 */
(function () {
  const TRANSLATED_ID = 'Reverso_extension__subtitle-translated';
  const INNER_ID = 'Reverso_extension__subtitle-inner';
  const CONTAINER_ID = 'Reverso_extension__subtitle-container';
  const MT_URL = 'https://api.reverso.net/translate/v1/Translation';
  const ORIGIN = 'reverso.ext.chrome';

  const LANG_MAP = {
    en: 'eng', es: 'spa', fr: 'fra', de: 'ger', it: 'ita', nl: 'dut',
    pl: 'pol', ru: 'rus', uk: 'ukr', ar: 'ara', pe: 'per', he: 'heb',
    ja: 'jpn', ko: 'kor', tr: 'tur', zh: 'chi', pt: 'por', ro: 'rum',
    cz: 'cze', fa: 'fas',
  };

  let abortController = null;
  let debounceTimer = null;
  let activeSentence = '';
  let cachedSentence = '';
  let cachedTranslation = '';
  let innerObserver = null;
  let isHoveringWord = false;

  function injectStyles() {
    if (document.getElementById('reverso-subtitle-sentence-styles')) return;
    const style = document.createElement('style');
    style.id = 'reverso-subtitle-sentence-styles';
    style.textContent = `
      #${TRANSLATED_ID} {
        display: none;
        color: #7CBCF4;
        white-space: pre-wrap;
        width: 100%;
        margin-top: 6px;
        padding-top: 2px;
        font-size: inherit;
        line-height: inherit;
        text-align: left;
        user-select: none;
      }
      #${TRANSLATED_ID}.visible {
        display: block;
      }
      #${TRANSLATED_ID}.loading {
        opacity: 0.45;
      }
    `;
    document.head.appendChild(style);
  }

  function getSettings() {
    return new Promise((resolve) => {
      if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
        resolve({});
        return;
      }
      chrome.runtime.sendMessage({ getSettings: true }, (settings) => {
        resolve(settings || {});
      });
    });
  }

  function mapLang(code) {
    if (!code) return code;
    return LANG_MAP[code] || code;
  }

  function getFullSubtitleText() {
    const oneclick = document.querySelector('oneclick.subtitle-oneclick');
    if (oneclick) return oneclick.textContent.replace(/\s+/g, ' ').trim();
    const inner = document.getElementById(INNER_ID);
    if (!inner) return '';
    const clone = inner.cloneNode(true);
    const translated = clone.querySelector(`#${TRANSLATED_ID}`);
    if (translated) translated.remove();
    return clone.textContent.replace(/\s+/g, ' ').trim();
  }

  function getSubtitleDir() {
    const inner = document.getElementById(INNER_ID);
    return inner?.getAttribute('dir') || '';
  }

  function ensureTranslatedElement() {
    const inner = document.getElementById(INNER_ID);
    if (!inner) return null;

    let el = document.getElementById(TRANSLATED_ID);
    if (!el || !inner.contains(el)) {
      el = document.createElement('div');
      el.id = TRANSLATED_ID;
      inner.appendChild(el);
    }
    return el;
  }

  function updateContainerHeight() {
    const container = document.getElementById(CONTAINER_ID);
    const inner = document.getElementById(INNER_ID);
    if (!container || !inner) return;
    container.style.height = inner.offsetHeight + 'px';
    inner.style.top = 'calc(50% - ' + inner.offsetHeight / 2 + 'px)';
  }

  function hideTranslated() {
    activeSentence = '';
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    const el = document.getElementById(TRANSLATED_ID);
    if (el) {
      el.textContent = '';
      el.classList.remove('visible', 'loading');
    }
    updateContainerHeight();
  }

  async function translateSentence(sentence, langSource, langTarget) {
    const body = JSON.stringify({
      format: 'text',
      from: mapLang(langSource),
      to: mapLang(langTarget),
      input: sentence,
      options: {
        sentenceSplitter: false,
        origin: ORIGIN,
        contextResults: false,
        languageDetection: true,
      },
    });

    const response = await fetch(MT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'x-reverso-origin': ORIGIN,
      },
      body,
      signal: abortController?.signal,
    });

    if (!response.ok) throw new Error('Translation failed: ' + response.status);

    const data = await response.json();
    return (data.translation || []).join('').trim();
  }

  async function showSentenceTranslation(sentence) {
    if (!sentence || !isHoveringWord) return;

    if (sentence === cachedSentence && cachedTranslation) {
      const el = ensureTranslatedElement();
      if (!el) return;
      el.textContent = cachedTranslation;
      el.classList.add('visible');
      el.classList.remove('loading');
      const dir = getSubtitleDir();
      if (dir) el.setAttribute('dir', dir);
      updateContainerHeight();
      return;
    }

    if (sentence === activeSentence) return;
    activeSentence = sentence;

    if (abortController) abortController.abort();
    abortController = new AbortController();

    const el = ensureTranslatedElement();
    if (!el) return;

    el.classList.add('visible', 'loading');
    el.textContent = '';
    const dir = getSubtitleDir();
    if (dir) el.setAttribute('dir', dir);
    updateContainerHeight();

    try {
      const settings = await getSettings();
      const langSource = settings.settings_source_lang;
      const langTarget = settings.settings_target_lang;
      if (!langSource || !langTarget) {
        hideTranslated();
        return;
      }

      const translated = await translateSentence(sentence, langSource, langTarget);
      if (!isHoveringWord || activeSentence !== sentence) return;

      cachedSentence = sentence;
      cachedTranslation = translated;
      el.textContent = translated;
      el.classList.remove('loading');
      updateContainerHeight();
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.warn('[Reverso] sentence subtitle translation failed:', err);
      if (activeSentence === sentence) hideTranslated();
    }
  }

  function onWordHover() {
    const sentence = getFullSubtitleText();
    if (!sentence) return;

    if (cachedSentence && sentence !== cachedSentence) {
      cachedSentence = '';
      cachedTranslation = '';
    }

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => showSentenceTranslation(sentence), 80);
  }

  function isWordTarget(target) {
    if (!target) return false;
    const tag = target.nodeName;
    return tag === 'ONECLICKELEMENT' || tag === 'oneclickelement';
  }

  function observeInner() {
    const inner = document.getElementById(INNER_ID);
    if (!inner || inner.dataset.sentencePatchInner) return;
    inner.dataset.sentencePatchInner = '1';

    innerObserver = new MutationObserver(() => {
      const el = document.getElementById(TRANSLATED_ID);
      if (isHoveringWord && activeSentence && el && !inner.contains(el)) {
        const restored = ensureTranslatedElement();
        if (restored && cachedTranslation && cachedSentence === getFullSubtitleText()) {
          restored.textContent = cachedTranslation;
          restored.classList.add('visible');
          updateContainerHeight();
        }
      }

      const current = getFullSubtitleText();
      if (current && cachedSentence && current !== cachedSentence) {
        cachedSentence = '';
        cachedTranslation = '';
        if (isHoveringWord) {
          activeSentence = '';
          onWordHover();
        } else {
          hideTranslated();
        }
      }
    });

    innerObserver.observe(inner, { childList: true, subtree: true, characterData: true });
  }

  function setupListeners() {
    const container = document.getElementById(CONTAINER_ID);
    if (!container || container.dataset.sentencePatch) return;
    container.dataset.sentencePatch = '1';

    observeInner();

    container.addEventListener(
      'mouseenter',
      (e) => {
        if (isWordTarget(e.target)) {
          isHoveringWord = true;
          onWordHover();
        }
      },
      true
    );

    container.addEventListener(
      'mousemove',
      (e) => {
        if (isWordTarget(e.target)) {
          if (!isHoveringWord) isHoveringWord = true;
          onWordHover();
        }
      },
      true
    );

    container.addEventListener(
      'mouseleave',
      (e) => {
        if (!container.contains(e.relatedTarget)) {
          isHoveringWord = false;
          clearTimeout(debounceTimer);
          hideTranslated();
        }
      },
      true
    );

    const hint = document.getElementById('Reverso_extension__translate_sub_hint');
    if (hint) {
      const hintObserver = new MutationObserver(() => {
        if (!hint.classList.contains('active') && !isHoveringWord) {
          hideTranslated();
        }
      });
      hintObserver.observe(hint, { attributes: true, attributeFilter: ['class'] });
    }

    const classObserver = new MutationObserver(() => {
      if (!container.classList.contains('Reverso_extension__subtitle_show')) {
        isHoveringWord = false;
        clearTimeout(debounceTimer);
        hideTranslated();
      }
    });
    classObserver.observe(container, { attributes: true, attributeFilter: ['class'] });
  }

  function init() {
    injectStyles();
    setupListeners();
    if (!document.getElementById(CONTAINER_ID)) return false;
    return true;
  }

  if (init()) return;

  const poll = setInterval(() => {
    if (init()) clearInterval(poll);
  }, 1000);
})();
