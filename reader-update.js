(function () {
  "use strict";

  var STYLE_ID = "translation-mode-style";
  var LOG_PREFIX = "[dual-translation]";
  var HOVER_FEATURE_FLAG = "DUAL_TRANSLATION_HOVER_WORD_MAP";
  var INTER_FONT_ID = "translation-hover-inter-font";
  var HOVER_POPOVER_ID = "translation-hover-popover-root";
  var state = {
    translator: null,
    translatedParagraphs: null,
    isTranslating: false,
    lastJobId: 0,
    isOpen: false,
    inlineWrap: null,
    sourceNodes: [],
    rowMap: new WeakMap(),
    activeHighlight: null,
    hoverTranslationCache: new Map(),
    hoverRequestId: 0,
    hoverPopoverEl: null,
    audio: {
      text: "",
      totalChars: 0,
      currentChar: 0,
      isPlaying: false,
      isPaused: false,
      rate: 1,
      lang: "en-US",
      ui: null
    }
  };

  function logDebug(event, payload) {
    try {
      console.debug(LOG_PREFIX, event, payload || {});
    } catch (_e) {}
  }

  function logWarn(event, payload) {
    try {
      console.warn(LOG_PREFIX, event, payload || {});
    } catch (_e) {}
  }

  function printConsoleHelp() {
    try {
      console.info(
        [
          "[dual-translation] Help",
          "- Word hover popovers work on the tokenized text after dual translation is ON.",
          "  Use the sparkle button (next to dark mode) to enable/disable hover hints.",
          "  Or: window.DUAL_TRANSLATION_HOVER_WORD_MAP = true|false",
          "- Toggle auto-open dual mode on load (default: true for file:// only):",
          "  window.DUAL_TRANSLATION_AUTO_OPEN = true|false",
          "- Current hover flag:",
          "  window.DUAL_TRANSLATION_HOVER_WORD_MAP = " + String(window[HOVER_FEATURE_FLAG]),
          "- More commands can be added here later."
        ].join("\n")
      );
    } catch (_e) {}
  }

  function isHoverWordMappingEnabled() {
    if (typeof window[HOVER_FEATURE_FLAG] === "undefined") return true;
    return Boolean(window[HOVER_FEATURE_FLAG]);
  }

  function shouldAutoOpenDualOnLoad() {
    if (typeof window.DUAL_TRANSLATION_AUTO_OPEN !== "undefined") {
      return Boolean(window.DUAL_TRANSLATION_AUTO_OPEN);
    }
    try {
      return window.location.protocol === "file:";
    } catch (_e) {
      return false;
    }
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent =
      ".translation-mode-button{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;width:32px;min-width:32px;height:32px;margin:0;padding:0;border:none;border-radius:6px;background:transparent;color:var(--text-base-secondary,#607d8b);cursor:pointer;flex-shrink:0;align-self:center;-webkit-tap-highlight-color:transparent}" +
      ".translation-mode-button:hover{background:var(--line-gray-secondary,#eaeef1)}" +
      ".translation-mode-button:focus-visible{outline:2px solid var(--new-blue-700,#2a8bdf);outline-offset:2px}" +
      ".translation-mode-button_active{background:var(--new-blue-150,#e8f3fc);color:var(--new-blue-700,#2a8bdf)}" +
      ".translation-mode-logo{display:block;width:16px;height:16px}" +
      ".translation-source-hidden{display:none!important}" +
      ".translation-inline-wrap{display:none!important;margin:0}" +
      ".translation-inline-wrap.translation-inline-wrap_open{display:block!important}" +
      ".translation-inline-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,0fr);column-gap:24px;align-items:start;transition:grid-template-columns .28s ease}" +
      ".translation-inline-row+.translation-inline-row{margin-top:12px}" +
      ".translation-inline-wrap_open .translation-inline-row{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}" +
      ".translation-inline-col{min-width:0}" +
      ".translation-inline-col p{margin:0;line-height:1.65;text-align:start;white-space:pre-wrap;overflow-wrap:anywhere}" +
      ".translation-token{border-radius:4px;padding:0 1px;transition:background-color .12s ease}" +
      ".translation-inline-orig .translation-token{cursor:pointer}" +
      "body.translation-hover-disabled .translation-inline-wrap .translation-token{cursor:default}" +
      ".translation-token_src{background:rgba(21,124,213,.2)}" +
      ".translation-token_tgt{background:rgba(255,190,92,.35)}" +
      ".translation-token_pop{background:#fef9c3!important;border-radius:4px}" +
      ".translation-hover-popover{position:fixed;z-index:100000;box-sizing:border-box;width:min(280px,calc(100vw - 24px));max-width:280px;padding:20px;background:#fff;border-radius:18px;box-shadow:0 4px 12px rgba(0,0,0,.1),0 12px 28px rgba(0,0,0,.06);font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:15px;line-height:1.45;color:#1f2937;pointer-events:none;opacity:0;visibility:hidden;transition:opacity .12s ease}" +
      ".translation-hover-popover_visible{opacity:1;visibility:visible}" +
      ".translation-hover-popover__head{display:flex;align-items:center;gap:8px;margin:0 0 6px}" +
      ".translation-hover-popover__sparkle{flex:0 0 auto;color:#2352a3;width:18px;height:18px}" +
      ".translation-hover-popover__title{font-weight:700;font-size:15px;line-height:1.3;color:#2352a3;margin:0}" +
      ".translation-hover-popover__head_only-title{margin-left:26px}" +
      ".translation-hover-popover__def{margin:0 0 0 26px;font-weight:400;font-size:15px;line-height:1.45;color:#1f2937}" +
      ".translation-hover-popover__section+.translation-hover-popover__section{margin-top:16px}" +
      ".translation-hover-popover__footer{margin:18px 0 0;font-size:13px;font-style:italic;color:#64748b}" +
      ".translation-hover-popover__loading{opacity:.85}" +
      ".translation-sentence_tgt{background:rgba(255,190,92,.16);border-radius:6px;padding:1px 2px}" +
      ".translation-inline-trans{overflow:hidden}" +
      ".translation-inline-trans p{opacity:0;transform:translateX(24px);transition:transform .28s ease,opacity .24s ease}" +
      ".translation-inline-wrap_open .translation-inline-trans p{opacity:1;transform:translateX(0)}" +
      ".translation-audio-player{position:fixed;left:0;right:0;bottom:0;z-index:9999;background:var(--bg-primary,#fff);border-top:1px solid var(--line-gray-primary,#d4d9e3);box-shadow:0 -6px 20px rgba(0,0,0,.08);padding:10px 14px;display:none}" +
      ".translation-audio-player_visible{display:block}" +
      ".translation-audio-player__row{display:flex;align-items:center;gap:10px;max-width:1080px;margin:0 auto}" +
      ".translation-audio-player__btn{height:34px;min-width:34px;border-radius:999px;border:1px solid var(--line-gray-primary,#d4d9e3);background:var(--bg-primary,#fff);cursor:pointer;padding:0 10px;font:inherit}" +
      ".translation-audio-player__btn:hover{background:var(--surface-elevated,#f7f9fc)}" +
      ".translation-audio-player__time{min-width:46px;font:12px/1.2 sans-serif;color:var(--text-base-secondary,#5a6175)}" +
      ".translation-audio-player__seek{flex:1;accent-color:var(--new-blue-700,#2a8bdf)}" +
      "body.translation-dual-open{overflow-x:hidden!important}" +
      "body.translation-dual-open .main-content_full-width,body.translation-dual-open .reading-list__container,body.translation-dual-open app-reader-view-content{max-width:100%!important;width:100%!important;box-sizing:border-box!important}" +
      "body.translation-dual-open .reader-view-page__main-container{max-width:none!important;width:100%!important;display:flex!important;align-items:stretch;gap:0}" +
      "body.translation-dual-open .translation-inline-wrap{width:100%!important;max-width:none!important;box-sizing:border-box!important}" +
      "body.translation-dual-open .reader-view-page__view_with-sidebar,body.translation-dual-open .reader-view-page__view,body.translation-dual-open .main-content_full-width{flex:1 1 auto;min-width:0}" +
      "body.translation-dual-open .reader-view-page__history-sidebar,body.translation-dual-open app-reader-view-word-sidebar{flex:0 0 clamp(320px,28vw,420px)!important;width:clamp(320px,28vw,420px)!important;min-width:320px!important;max-width:420px!important}" +
      "body.translation-dual-open .reader-view-page__history-sidebar_hidden{display:none!important}" +
      "@media (max-width:900px){.translation-inline-row,.translation-inline-wrap_open .translation-inline-row{grid-template-columns:1fr}}";
    document.head.appendChild(style);
  }

  function sourceNodes() {
    if (state.sourceNodes.length) return state.sourceNodes;
    var selectors = [
      'p[dir="ltr"]',
      ".reading-text__content p",
      ".reading-text p",
      "app-reader-view-content p",
      ".reader-view-page__view p",
      "p"
    ];
    var seen = new Set();
    var nodes = [];
    selectors.forEach(function (selector) {
      Array.from(document.querySelectorAll(selector)).forEach(function (node) {
        if (seen.has(node)) return;
        var text = (node.textContent || "").trim();
        if (text.length < 35) return;
        if (node.closest(".translation-inline-wrap")) return;
        seen.add(node);
        nodes.push(node);
      });
    });
    state.sourceNodes = nodes;
    return state.sourceNodes;
  }

  function sourceParagraphs() {
    return sourceNodes().map(function (node) {
      return (node.textContent || "").trim();
    });
  }

  function supportsTranslatorApi() {
    return Boolean(window.Translator && typeof window.Translator.create === "function");
  }

  function normalizeWord(word) {
    return (word || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z]/g, "");
  }

  function stemEn(word) {
    return word.replace(/(ing|ed|es|s)$/i, "");
  }

  function stemFr(word) {
    return word.replace(/(ements|ement|ations|ation|ment|es|s|e)$/i, "");
  }

  function translationHints(word) {
    var hints = {
      war: ["guerre"],
      iran: ["iran"],
      signs: ["signes"],
      warning: ["alerte", "avertissement"],
      chart: ["graphique", "courbe"],
      trump: ["trump"],
      president: ["president"],
      people: ["personnes", "gens"],
      country: ["pays"],
      economy: ["economie"],
      market: ["marche"]
    };
    return hints[word] || [];
  }

  function scoreWordMatch(sourceNorm, targetNorm) {
    if (!sourceNorm || !targetNorm) return 0;
    var score = 0;
    if (sourceNorm === targetNorm) score += 1;
    if (stemEn(sourceNorm) === stemFr(targetNorm)) score += 0.7;
    if (sourceNorm.length > 3 && (targetNorm.indexOf(sourceNorm) >= 0 || sourceNorm.indexOf(targetNorm) >= 0)) {
      score += 0.45;
    }
    if (sourceNorm.slice(0, 3) && sourceNorm.slice(0, 3) === targetNorm.slice(0, 3)) score += 0.2;
    if (translationHints(sourceNorm).indexOf(targetNorm) >= 0) score += 0.95;
    return score;
  }

  async function translateHoverWord(rawWord) {
    var key = normalizeWord(rawWord);
    var empty = { display: "", normalized: "" };
    if (!key) return empty;
    if (state.hoverTranslationCache.has(key)) {
      var cached = state.hoverTranslationCache.get(key);
      logDebug("hover_translate_cache_hit", { rawWord: rawWord, normalized: key, cached: cached });
      return cached;
    }
    if (!supportsTranslatorApi()) {
      state.hoverTranslationCache.set(key, empty);
      logWarn("hover_translate_api_unavailable", { rawWord: rawWord, normalized: key });
      return empty;
    }
    try {
      var translator = await getTranslator();
      var translated = await withTimeout(translator.translate(rawWord), 1200);
      var normalized = normalizeWord(translated);
      var payload = { display: String(translated || "").trim(), normalized: normalized };
      state.hoverTranslationCache.set(key, payload);
      logDebug("hover_translate_ok", {
        rawWord: rawWord,
        normalized: key,
        translatedRaw: translated,
        translatedNormalized: normalized
      });
      return payload;
    } catch (_e) {
      state.hoverTranslationCache.set(key, empty);
      logWarn("hover_translate_error", { rawWord: rawWord, normalized: key });
      return empty;
    }
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function hoverSparklesSvg() {
    return (
      '<svg class="translation-hover-popover__sparkle" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">' +
      '<path d="M12 2.2L13.35 6.2 17.4 7.5 13.35 8.8 12 12.8 10.65 8.8 6.6 7.5 10.65 6.2 12 2.2zM20.2 11.3l.85 2.55 2.55.85-2.55.85-.85 2.55-.85-2.55-2.55-.85 2.55-.85.85-2.55zM5.4 13.6l.75 2.2 2.2.75-2.2.75-.75 2.2-.75-2.2-2.2-.75 2.2-.75.75-2.2z"/>' +
      "</svg>"
    );
  }

  function ensureInterFont() {
    if (document.getElementById(INTER_FONT_ID)) return;
    var link = document.createElement("link");
    link.id = INTER_FONT_ID;
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap";
    document.head.appendChild(link);
  }

  function ensureHoverPopover() {
    if (state.hoverPopoverEl) return state.hoverPopoverEl;
    ensureInterFont();
    var el = document.createElement("div");
    el.id = HOVER_POPOVER_ID;
    el.className = "translation-hover-popover";
    el.setAttribute("role", "tooltip");
    document.body.appendChild(el);
    state.hoverPopoverEl = el;
    return el;
  }

  function hideHoverPopover() {
    if (!state.hoverPopoverEl) return;
    state.hoverPopoverEl.classList.remove("translation-hover-popover_visible");
  }

  function positionHoverPopover(anchorEl) {
    if (!anchorEl || !anchorEl.getBoundingClientRect) return;
    var pop = ensureHoverPopover();
    var pad = 10;
    var gap = 10;
    var place = function () {
      var rect = anchorEl.getBoundingClientRect();
      var pw = pop.offsetWidth || 280;
      var ph = pop.offsetHeight || 120;
      var cx = rect.left + rect.width / 2;
      var left = Math.round(cx - pw / 2);
      var minL = pad;
      var maxL = Math.max(pad, window.innerWidth - pad - pw);
      left = Math.min(Math.max(left, minL), maxL);
      var top = rect.top - ph - gap;
      if (top < pad) {
        top = rect.bottom + gap;
      }
      if (top + ph > window.innerHeight - pad) {
        top = Math.max(pad, window.innerHeight - pad - ph);
      }
      pop.style.left = left + "px";
      pop.style.top = Math.round(top) + "px";
    };
    pop.classList.add("translation-hover-popover_visible");
    place();
    requestAnimationFrame(place);
  }

  function setHoverPopoverContent(anchorEl, opts) {
    var pop = ensureHoverPopover();
    var title1 = opts.title1 || "";
    var def1 = opts.def1 || "";
    var title2 = opts.title2 || "";
    var def2 = opts.def2 || "";
    var loading = Boolean(opts.loading);
    var sec2 = "";
    if (title2 && def2) {
      sec2 =
        '<div class="translation-hover-popover__section">' +
        '<div class="translation-hover-popover__head translation-hover-popover__head_only-title">' +
        '<span class="translation-hover-popover__title">' +
        escapeHtml(title2) +
        "</span></div>" +
        '<p class="translation-hover-popover__def">' +
        escapeHtml(def2) +
        "</p></div>";
    }
    pop.innerHTML =
      '<div class="translation-hover-popover__inner' +
      (loading ? " translation-hover-popover__loading" : "") +
      '">' +
      '<div class="translation-hover-popover__section">' +
      '<div class="translation-hover-popover__head">' +
      hoverSparklesSvg() +
      '<span class="translation-hover-popover__title">' +
      escapeHtml(title1) +
      "</span></div>" +
      '<p class="translation-hover-popover__def">' +
      escapeHtml(def1) +
      "</p></div>" +
      sec2 +
      '<p class="translation-hover-popover__footer">Click to see more</p></div>';
    positionHoverPopover(anchorEl);
  }

  function tokenizeText(text) {
    var re = /([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’-]*)/g;
    var out = [];
    var last = 0;
    var match;
    while ((match = re.exec(text)) !== null) {
      if (match.index > last) out.push({ type: "sep", value: text.slice(last, match.index) });
      out.push({ type: "word", value: match[0] });
      last = re.lastIndex;
    }
    if (last < text.length) out.push({ type: "sep", value: text.slice(last) });
    return out;
  }

  function renderTokenizedParagraph(pEl, text, side, rowIdx) {
    pEl.innerHTML = "";
    pEl.classList.remove("translation-sentence_tgt");
    var tokens = [];
    var parts = tokenizeText(text);
    var tokenIdx = 0;
    for (var i = 0; i < parts.length; i += 1) {
      if (parts[i].type === "word") {
        var span = document.createElement("span");
        span.className = "translation-token";
        span.setAttribute("data-row-index", String(rowIdx));
        span.setAttribute("data-side", side);
        span.setAttribute("data-token-index", String(tokenIdx));
        span.textContent = parts[i].value;
        pEl.appendChild(span);
        tokens.push({
          el: span,
          raw: parts[i].value,
          norm: normalizeWord(parts[i].value)
        });
        tokenIdx += 1;
      } else {
        pEl.appendChild(document.createTextNode(parts[i].value));
      }
    }
    return tokens;
  }

  function withTimeout(promise, timeoutMs) {
    return Promise.race([
      promise,
      new Promise(function (_, reject) {
        setTimeout(function () {
          reject(new Error("timeout"));
        }, timeoutMs);
      })
    ]);
  }

  function supportsChromeTts() {
    return Boolean(window.chrome && chrome.tts && typeof chrome.tts.speak === "function");
  }

  function getListenButton() {
    return (
      document.querySelector("app-listen-button button") ||
      document.querySelector(".listen-button button") ||
      document.querySelector(".listen-service button")
    );
  }

  function formatTime(seconds) {
    var safe = Math.max(0, Math.floor(seconds || 0));
    var m = Math.floor(safe / 60);
    var s = String(safe % 60).padStart(2, "0");
    return m + ":" + s;
  }

  function getEstimatedTotalSeconds() {
    var cps = 13 * (state.audio.rate || 1);
    if (!state.audio.totalChars || cps <= 0) return 0;
    return state.audio.totalChars / cps;
  }

  function getEstimatedCurrentSeconds() {
    var total = getEstimatedTotalSeconds();
    if (!state.audio.totalChars) return 0;
    return (state.audio.currentChar / state.audio.totalChars) * total;
  }

  function updateAudioUi() {
    if (!state.audio.ui) return;
    var seek = state.audio.ui.seek;
    var current = state.audio.ui.current;
    var total = state.audio.ui.total;
    var playPause = state.audio.ui.playPause;
    seek.max = String(Math.max(0, state.audio.totalChars));
    seek.value = String(Math.max(0, Math.min(state.audio.currentChar, state.audio.totalChars)));
    current.textContent = formatTime(getEstimatedCurrentSeconds());
    total.textContent = formatTime(getEstimatedTotalSeconds());
    playPause.textContent = state.audio.isPlaying && !state.audio.isPaused ? "Pause" : "Play";
  }

  function ensureAudioText() {
    if (state.audio.text) return state.audio.text;
    state.audio.text = sourceParagraphs().join("\n\n");
    state.audio.totalChars = state.audio.text.length;
    return state.audio.text;
  }

  function showAudioPlayer() {
    if (!state.audio.ui || !state.audio.ui.root) return;
    state.audio.ui.root.classList.add("translation-audio-player_visible");
  }

  function stopAudioPlayback() {
    if (supportsChromeTts() && typeof chrome.tts.stop === "function") {
      try {
        chrome.tts.stop();
      } catch (_e) {}
    }
    state.audio.isPlaying = false;
    state.audio.isPaused = false;
    updateAudioUi();
  }

  function speakFrom(charIndex) {
    var text = ensureAudioText();
    if (!text.length || !supportsChromeTts()) return;
    var start = Math.max(0, Math.min(charIndex || 0, text.length));
    state.audio.currentChar = start;
    if (typeof chrome.tts.stop === "function") {
      try {
        chrome.tts.stop();
      } catch (_e) {}
    }
    state.audio.isPlaying = true;
    state.audio.isPaused = false;
    updateAudioUi();
    chrome.tts.speak(text.slice(start), {
      lang: state.audio.lang,
      rate: state.audio.rate,
      enqueue: false,
      onEvent: function (event) {
        if (event && typeof event.charIndex === "number") {
          state.audio.currentChar = Math.min(state.audio.totalChars, start + event.charIndex);
          updateAudioUi();
        }
        if (!event || !event.type) return;
        if (event.type === "end") {
          state.audio.currentChar = state.audio.totalChars;
          state.audio.isPlaying = false;
          state.audio.isPaused = false;
          updateAudioUi();
        } else if (
          event.type === "interrupted" ||
          event.type === "cancelled" ||
          event.type === "error"
        ) {
          state.audio.isPlaying = false;
          state.audio.isPaused = false;
          updateAudioUi();
        } else if (event.type === "pause") {
          state.audio.isPaused = true;
          updateAudioUi();
        } else if (event.type === "resume") {
          state.audio.isPaused = false;
          state.audio.isPlaying = true;
          updateAudioUi();
        }
      }
    });
  }

  function pauseOrResumeAudio() {
    if (!supportsChromeTts()) return;
    if (state.audio.isPlaying && !state.audio.isPaused && typeof chrome.tts.pause === "function") {
      chrome.tts.pause();
      state.audio.isPaused = true;
      updateAudioUi();
      return;
    }
    if (state.audio.isPlaying && state.audio.isPaused && typeof chrome.tts.resume === "function") {
      chrome.tts.resume();
      state.audio.isPaused = false;
      updateAudioUi();
      return;
    }
    speakFrom(state.audio.currentChar || 0);
  }

  function seekAudioTo(charIndex) {
    var bounded = Math.max(0, Math.min(charIndex || 0, state.audio.totalChars));
    state.audio.currentChar = bounded;
    updateAudioUi();
    if (state.audio.isPlaying || state.audio.isPaused) speakFrom(bounded);
  }

  function ensureAudioPlayer() {
    if (state.audio.ui) return state.audio.ui;
    var root = document.createElement("div");
    root.className = "translation-audio-player";
    root.innerHTML =
      '<div class="translation-audio-player__row">' +
      '<button type="button" class="translation-audio-player__btn" data-audio-action="back">-15s</button>' +
      '<button type="button" class="translation-audio-player__btn" data-audio-action="play-pause">Play</button>' +
      '<button type="button" class="translation-audio-player__btn" data-audio-action="forward">+15s</button>' +
      '<span class="translation-audio-player__time" data-audio-time="current">0:00</span>' +
      '<input class="translation-audio-player__seek" type="range" min="0" max="0" value="0" step="1" data-audio-seek="1" />' +
      '<span class="translation-audio-player__time" data-audio-time="total">0:00</span>' +
      '<button type="button" class="translation-audio-player__btn" data-audio-action="stop">Stop</button>' +
      "</div>";
    document.body.appendChild(root);
    state.audio.ui = {
      root: root,
      playPause: root.querySelector('[data-audio-action="play-pause"]'),
      back: root.querySelector('[data-audio-action="back"]'),
      forward: root.querySelector('[data-audio-action="forward"]'),
      stop: root.querySelector('[data-audio-action="stop"]'),
      seek: root.querySelector('[data-audio-seek="1"]'),
      current: root.querySelector('[data-audio-time="current"]'),
      total: root.querySelector('[data-audio-time="total"]')
    };
    state.audio.ui.playPause.addEventListener("click", pauseOrResumeAudio);
    state.audio.ui.back.addEventListener("click", function () {
      var jumpChars = Math.round(15 * 13 * state.audio.rate);
      seekAudioTo(state.audio.currentChar - jumpChars);
    });
    state.audio.ui.forward.addEventListener("click", function () {
      var jumpChars = Math.round(15 * 13 * state.audio.rate);
      seekAudioTo(state.audio.currentChar + jumpChars);
    });
    state.audio.ui.stop.addEventListener("click", function () {
      stopAudioPlayback();
      state.audio.currentChar = 0;
      updateAudioUi();
    });
    state.audio.ui.seek.addEventListener("input", function (event) {
      state.audio.currentChar = Number(event.target.value) || 0;
      updateAudioUi();
    });
    state.audio.ui.seek.addEventListener("change", function (event) {
      seekAudioTo(Number(event.target.value) || 0);
    });
    updateAudioUi();
    return state.audio.ui;
  }

  function installListenButtonAudio() {
    if (!supportsChromeTts()) {
      logWarn("chrome_tts_unavailable");
      return;
    }
    var listenBtn = getListenButton();
    if (!listenBtn) return;
    if (listenBtn.dataset.dualTranslationAudioBound === "1") return;
    listenBtn.dataset.dualTranslationAudioBound = "1";
    listenBtn.addEventListener(
      "click",
      function (event) {
        event.preventDefault();
        event.stopPropagation();
        ensureAudioPlayer();
        showAudioPlayer();
        ensureAudioText();
        speakFrom(state.audio.currentChar || 0);
      },
      true
    );
  }

  function installListenButtonAudioWatcher() {
    installListenButtonAudio();
    var observer = new MutationObserver(function () {
      installListenButtonAudio();
    });
    observer.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true
    });
  }

  async function getTranslator() {
    if (state.translator) return state.translator;
    state.translator = await withTimeout(
      window.Translator.create({ sourceLanguage: "en", targetLanguage: "fr" }),
      4000
    );
    return state.translator;
  }

  async function buildTranslatedParagraphs() {
    if (state.translatedParagraphs) return state.translatedParagraphs;
    var original = sourceParagraphs();
    var translator = await getTranslator();
    var out = [];
    for (var i = 0; i < original.length; i += 1) {
      out.push(await withTimeout(translator.translate(original[i]), 2500));
    }
    state.translatedParagraphs = out;
    return out;
  }

  function createToggleButton() {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "translation-mode-button";
    button.setAttribute("aria-label", "Toggle side-by-side French translation");
    button.setAttribute("aria-expanded", "false");
    button.innerHTML =
      '<svg class="translation-mode-logo" aria-hidden="true" viewBox="0 0 24 24" fill="none">' +
      '<rect x="2.5" y="4.5" width="8" height="15" rx="2" stroke="currentColor" stroke-width="1.7"/>' +
      '<rect x="13.5" y="4.5" width="8" height="15" rx="2" stroke="currentColor" stroke-width="1.7"/>' +
      '<path d="M12 4v16" stroke="currentColor" stroke-width="1.7"/>' +
      '<path d="M5.5 9.5h2.2M6.6 8.4v5.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
      '<path d="M16.2 14.5h2.8M16.2 11.5h2.8M16.2 8.5h2.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
      "</svg>";
    return button;
  }

  function createHoverToggleButton() {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "translation-mode-button";
    button.setAttribute("aria-label", "Toggle word hover hints and translation popover");
    button.setAttribute("aria-pressed", "true");
    button.innerHTML =
      '<svg class="translation-mode-logo" aria-hidden="true" viewBox="0 0 24 24" fill="currentColor">' +
      '<path d="M12 2.2L13.35 6.2 17.4 7.5 13.35 8.8 12 12.8 10.65 8.8 6.6 7.5 10.65 6.2 12 2.2z"/>' +
      '<path d="M20.2 11.3l.85 2.55 2.55.85-2.55.85-.85 2.55-.85-2.55-2.55-.85 2.55-.85.85-2.55z" opacity=".88"/>' +
      '<path d="M5.4 14l.75 2.25 2.25.75-2.25.75-.75 2.25-.75-2.25-2.25-.75 2.25-.75.75-2.25z" opacity=".72"/>' +
      "</svg>";
    return button;
  }

  function syncHoverToggleUi(hoverBtn) {
    if (!hoverBtn) return;
    var on = isHoverWordMappingEnabled();
    hoverBtn.setAttribute("aria-pressed", on ? "true" : "false");
    hoverBtn.classList.toggle("translation-mode-button_active", on);
    document.body.classList.toggle("translation-hover-disabled", !on);
  }

  function findDarkModeBtn() {
    var iconHost = document.querySelector("app-icon-dark-mode");
    if (iconHost && typeof iconHost.closest === "function") {
      var byIcon = iconHost.closest("button");
      if (byIcon) return byIcon;
    }
    return Array.from(document.querySelectorAll("button")).find(function (btn) {
      var txt = (btn.textContent || "").toLowerCase();
      var lbl = (btn.getAttribute("aria-label") || "").toLowerCase();
      return txt.indexOf("switch to dark mode") >= 0 || lbl.indexOf("switch to dark mode") >= 0;
    });
  }

  function ensureInlineWrap() {
    if (state.inlineWrap) return state.inlineWrap;
    var nodes = sourceNodes();
    if (!nodes.length) return null;

    var wrap = document.createElement("div");
    wrap.className = "translation-inline-wrap";

    for (var i = 0; i < nodes.length; i += 1) {
      var row = document.createElement("div");
      row.className = "translation-inline-row";

      var left = document.createElement("div");
      left.className = "translation-inline-col translation-inline-orig";
      var right = document.createElement("div");
      right.className = "translation-inline-col translation-inline-trans";

      var pL = document.createElement("p");
      pL.setAttribute("data-side", "source");
      pL.setAttribute("data-row-index", String(i));
      var pR = document.createElement("p");
      pR.setAttribute("data-translation-target", String(i));
      pR.setAttribute("data-side", "target");
      pR.setAttribute("data-row-index", String(i));
      pR.textContent = "";

      left.appendChild(pL);
      right.appendChild(pR);
      row.appendChild(left);
      row.appendChild(right);
      wrap.appendChild(row);

      var sourceText = (nodes[i].textContent || "").trim();
      var sourceTokens = renderTokenizedParagraph(pL, sourceText, "source", i);
      state.rowMap.set(row, {
        sourceP: pL,
        targetP: pR,
        sourceTokens: sourceTokens,
        targetTokens: []
      });
    }

    nodes[0].parentNode.insertBefore(wrap, nodes[0]);
    state.inlineWrap = wrap;
    attachHoverHandlers(wrap);
    return wrap;
  }

  function setSourceVisibility(hidden) {
    sourceNodes().forEach(function (n) {
      n.classList.toggle("translation-source-hidden", hidden);
    });
  }

  function setOpen(isOpen, button) {
    state.isOpen = isOpen;
    if (button) {
      button.setAttribute("aria-expanded", isOpen ? "true" : "false");
      button.classList.toggle("translation-mode-button_active", isOpen);
    }
    document.body.classList.toggle("translation-dual-open", isOpen);
    if (!isOpen) {
      clearActiveHighlight();
    }
    if (!state.inlineWrap) return;
    state.inlineWrap.classList.toggle("translation-inline-wrap_open", isOpen);
    setSourceVisibility(isOpen);
  }

  function renderRightColumn(paragraphs) {
    if (!state.inlineWrap) return;
    var rows = state.inlineWrap.querySelectorAll(".translation-inline-row");
    for (var i = 0; i < rows.length; i += 1) {
      var rowData = state.rowMap.get(rows[i]);
      if (!rowData) continue;
      rowData.targetTokens = renderTokenizedParagraph(rowData.targetP, paragraphs[i] || "", "target", i);
      state.rowMap.set(rows[i], rowData);
    }
  }

  function clearActiveHighlight() {
    hideHoverPopover();
    if (state.inlineWrap) {
      Array.prototype.forEach.call(
        state.inlineWrap.querySelectorAll(".translation-token_pop"),
        function (el) {
          el.classList.remove("translation-token_pop");
        }
      );
    }
    if (!state.activeHighlight) return;
    var h = state.activeHighlight;
    if (h.sourceEl) h.sourceEl.classList.remove("translation-token_src");
    if (h.targetEl) h.targetEl.classList.remove("translation-token_tgt");
    if (h.targetSentenceEl) h.targetSentenceEl.classList.remove("translation-sentence_tgt");
    state.activeHighlight = null;
  }

  function findBestMatchIndex(sourceTokenNorm, targetTokens, translatedNorm) {
    if (translatedNorm) {
      for (var exactIdx = 0; exactIdx < targetTokens.length; exactIdx += 1) {
        if (targetTokens[exactIdx].norm === translatedNorm && translatedNorm.length >= 2) {
          logDebug("candidate_search_exact_translation_match", {
            sourceTokenNorm: sourceTokenNorm,
            translatedNorm: translatedNorm,
            exactIdx: exactIdx,
            targetRaw: targetTokens[exactIdx].raw
          });
          return exactIdx;
        }
      }
    }

    var bestIdx = -1;
    var bestScore = 0;
    for (var i = 0; i < targetTokens.length; i += 1) {
      if (!targetTokens[i].norm || targetTokens[i].norm.length < 2) continue;
      var score = scoreWordMatch(sourceTokenNorm, targetTokens[i].norm);
      if (translatedNorm && targetTokens[i].norm === translatedNorm) score += 1.5;
      if (
        translatedNorm &&
        translatedNorm.length >= 4 &&
        targetTokens[i].norm.length >= 4
      ) {
        if (targetTokens[i].norm.indexOf(translatedNorm) >= 0 || translatedNorm.indexOf(targetTokens[i].norm) >= 0) {
          score += 0.6;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    logDebug("candidate_search_done", {
      sourceTokenNorm: sourceTokenNorm,
      translatedNorm: translatedNorm || "",
      targetTokenCount: targetTokens.length,
      bestIdx: bestIdx,
      bestScore: bestScore
    });
    return bestScore >= 0.6 ? bestIdx : -1;
  }

  async function applyHighlight(tokenEl) {
    if (!isHoverWordMappingEnabled()) return;
    var rowEl = tokenEl.closest(".translation-inline-row");
    if (!rowEl) return;
    var rowData = state.rowMap.get(rowEl);
    if (!rowData) return;
    var side = tokenEl.getAttribute("data-side");
    var tokenIndex = Number(tokenEl.getAttribute("data-token-index"));
    var sourceToken;
    var targetMatchIdx = -1;
    tokenEl.classList.add("translation-token_pop");
    if (side === "source") {
      sourceToken = rowData.sourceTokens[tokenIndex];
      if (!sourceToken) return;
      logDebug("hover_source_token", {
        rowIndex: tokenEl.getAttribute("data-row-index"),
        tokenIndex: tokenIndex,
        raw: sourceToken.raw,
        norm: sourceToken.norm
      });
      var requestId = ++state.hoverRequestId;
      setHoverPopoverContent(tokenEl, {
        title1: sourceToken.raw,
        def1: "Translating…",
        loading: true
      });
      var translated = await translateHoverWord(sourceToken.raw);
      var translatedNorm = translated.normalized || "";
      if (requestId !== state.hoverRequestId) {
        logDebug("hover_request_stale", { requestId: requestId, currentRequestId: state.hoverRequestId });
        return;
      }
      targetMatchIdx = findBestMatchIndex(sourceToken.norm, rowData.targetTokens, translatedNorm);
      tokenEl.classList.add("translation-token_src");
      var defPrimary =
        translated.display ||
        (!supportsTranslatorApi()
          ? "Translation unavailable in this browser."
          : "No quick translation returned for this word.");
      var title2 = "";
      var def2 = "";
      if (targetMatchIdx >= 0 && rowData.targetTokens[targetMatchIdx]) {
        var tw = rowData.targetTokens[targetMatchIdx].raw;
        title2 = tw;
        def2 = "Aligned word in the French column for this sentence.";
      }
      setHoverPopoverContent(tokenEl, {
        title1: sourceToken.raw,
        def1: defPrimary,
        title2: title2,
        def2: def2,
        loading: false
      });
      if (targetMatchIdx >= 0 && rowData.targetTokens[targetMatchIdx]) {
        rowData.targetTokens[targetMatchIdx].el.classList.add("translation-token_tgt");
        logDebug("hover_match_token", {
          sourceRaw: sourceToken.raw,
          translatedNorm: translatedNorm,
          targetRaw: rowData.targetTokens[targetMatchIdx].raw,
          targetNorm: rowData.targetTokens[targetMatchIdx].norm,
          targetIndex: targetMatchIdx
        });
        state.activeHighlight = { sourceEl: tokenEl, targetEl: rowData.targetTokens[targetMatchIdx].el };
      } else {
        rowData.targetP.classList.add("translation-sentence_tgt");
        logWarn("hover_match_fallback_sentence", {
          sourceRaw: sourceToken.raw,
          sourceNorm: sourceToken.norm,
          translatedNorm: translatedNorm
        });
        state.activeHighlight = { sourceEl: tokenEl, targetSentenceEl: rowData.targetP };
      }
    } else {
      var targetToken = rowData.targetTokens[tokenIndex];
      if (!targetToken) return;
      logDebug("hover_target_token", {
        rowIndex: tokenEl.getAttribute("data-row-index"),
        tokenIndex: tokenIndex,
        raw: targetToken.raw,
        norm: targetToken.norm
      });
      targetMatchIdx = findBestMatchIndex(targetToken.norm, rowData.sourceTokens, "");
      tokenEl.classList.add("translation-token_tgt");
      var tTitle2 = "";
      var tDef2 = "";
      var tDef1 = "No single-word match in the English column for this sentence.";
      if (targetMatchIdx >= 0 && rowData.sourceTokens[targetMatchIdx]) {
        var sw = rowData.sourceTokens[targetMatchIdx].raw;
        tDef1 = "Aligned English word for this sentence: " + sw + ".";
        tTitle2 = sw;
        tDef2 = "French token you hovered: " + targetToken.raw + ".";
      }
      setHoverPopoverContent(tokenEl, {
        title1: targetToken.raw,
        def1: tDef1,
        title2: tTitle2,
        def2: tDef2,
        loading: false
      });
      if (targetMatchIdx >= 0 && rowData.sourceTokens[targetMatchIdx]) {
        rowData.sourceTokens[targetMatchIdx].el.classList.add("translation-token_src");
        logDebug("hover_reverse_match_token", {
          targetRaw: targetToken.raw,
          sourceRaw: rowData.sourceTokens[targetMatchIdx].raw,
          sourceIndex: targetMatchIdx
        });
        state.activeHighlight = {
          sourceEl: rowData.sourceTokens[targetMatchIdx].el,
          targetEl: tokenEl
        };
      } else {
        logWarn("hover_reverse_no_match", { targetRaw: targetToken.raw, targetNorm: targetToken.norm });
        state.activeHighlight = { targetEl: tokenEl };
      }
    }
  }

  function attachHoverHandlers(wrap) {
    wrap.addEventListener("mouseover", function (event) {
      if (!isHoverWordMappingEnabled()) return;
      var tokenEl = event.target.closest(".translation-token");
      if (!tokenEl || !wrap.contains(tokenEl)) return;
      clearActiveHighlight();
      applyHighlight(tokenEl);
    });
    wrap.addEventListener("mouseleave", function () {
      clearActiveHighlight();
    });
  }

  async function openMode(button) {
    var wrap = ensureInlineWrap();
    if (!wrap) return;
    setOpen(true, button);
    if (state.isTranslating) return;
    state.isTranslating = true;
    var originals = sourceParagraphs();
    var jobId = ++state.lastJobId;
    try {
      if (!supportsTranslatorApi()) {
        renderRightColumn(originals);
        return;
      }
      var translated = await buildTranslatedParagraphs();
      if (jobId !== state.lastJobId) return;
      renderRightColumn(translated);
    } catch (_err) {
      renderRightColumn(originals);
    } finally {
      if (jobId === state.lastJobId) state.isTranslating = false;
    }
  }

  function closeMode(button) {
    setOpen(false, button);
  }

  function getHistorySidebarElement() {
    return (
      document.querySelector(".reader-view-page__history-sidebar") ||
      document.querySelector("app-reader-view-word-sidebar")
    );
  }

  function isSidebarHidden(sidebar) {
    if (!sidebar) return true;
    return (
      sidebar.classList.contains("reader-view-page__history-sidebar_hidden") ||
      window.getComputedStyle(sidebar).display === "none"
    );
  }

  function toggleSidebarFallback() {
    var sidebar = getHistorySidebarElement();
    if (!sidebar) return;
    var hidden = isSidebarHidden(sidebar);
    sidebar.classList.toggle("reader-view-page__history-sidebar_hidden", !hidden);

    var view = document.querySelector(".reader-view-page__view, .reader-view-page__view_with-sidebar");
    if (view) {
      view.classList.toggle("reader-view-page__view_with-sidebar", hidden);
    }

    var header = document.querySelector("header.reading-view-header");
    if (header) {
      header.classList.toggle("reading-view-header_with-sidebar", hidden);
    }

    logDebug("history_sidebar_fallback_toggle", { becameVisible: hidden });
  }

  function installHistoryToggleFix() {
    var historyButton = document
      .querySelector("app-icon-double-chevron")
      ?.closest("button");
    if (!historyButton) return;
    if (historyButton.dataset.dualTranslationHistoryFixInstalled === "1") return;
    historyButton.dataset.dualTranslationHistoryFixInstalled = "1";

    historyButton.addEventListener("click", function () {
      var sidebar = getHistorySidebarElement();
      var before = isSidebarHidden(sidebar);
      setTimeout(function () {
        var sidebarAfter = getHistorySidebarElement();
        var after = isSidebarHidden(sidebarAfter);
        if (before === after) {
          toggleSidebarFallback();
        }
      }, 80);
    });
  }

  function install() {
    ensureStyles();
    if (typeof window[HOVER_FEATURE_FLAG] === "undefined") {
      window[HOVER_FEATURE_FLAG] = true;
    }
    printConsoleHelp();
    logDebug("feature_flags", { hoverWordMap: isHoverWordMappingEnabled(), flagName: HOVER_FEATURE_FLAG });

    var openBtn = createToggleButton();
    var hoverBtn = createHoverToggleButton();
    var darkBtn = findDarkModeBtn();
    var darkHost = darkBtn && typeof darkBtn.closest === "function" ? darkBtn.closest("app-button") : null;
    if (darkHost && darkHost.parentElement) {
      darkHost.insertAdjacentElement("afterend", hoverBtn);
      hoverBtn.insertAdjacentElement("afterend", openBtn);
    } else if (darkBtn && darkBtn.parentElement) {
      darkBtn.insertAdjacentElement("afterend", hoverBtn);
      hoverBtn.insertAdjacentElement("afterend", openBtn);
    } else {
      var header = document.querySelector("header.reading-view-header") || document.querySelector("header");
      if (header) {
        header.appendChild(hoverBtn);
        header.appendChild(openBtn);
      } else {
        document.body.appendChild(hoverBtn);
        document.body.appendChild(openBtn);
      }
    }

    syncHoverToggleUi(hoverBtn);

    hoverBtn.addEventListener("click", function () {
      window[HOVER_FEATURE_FLAG] = !isHoverWordMappingEnabled();
      syncHoverToggleUi(hoverBtn);
      clearActiveHighlight();
      logDebug("hover_toggle_click", { enabled: isHoverWordMappingEnabled() });
    });

    openBtn.addEventListener("click", function () {
      if (state.isOpen) closeMode(openBtn);
      else openMode(openBtn);
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && state.isOpen) closeMode(openBtn);
    });

    installHistoryToggleFix();
    installListenButtonAudioWatcher();

    if (shouldAutoOpenDualOnLoad()) {
      requestAnimationFrame(function () {
        openMode(openBtn);
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
})();
