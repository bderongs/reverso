(function () {
  "use strict";

  var STYLE_ID = "translation-mode-style";
  var LOG_PREFIX = "[dual-translation]";
  var HOVER_FEATURE_FLAG = "DUAL_TRANSLATION_HOVER_WORD_MAP";
  var INTER_FONT_ID = "translation-hover-inter-font";
  var HOVER_POPOVER_ID = "translation-hover-popover-root";
  var READ_ALOUD_CONFIG = window.READ_ALOUD_VOICE_CONFIG || {};
  var READ_ALOUD_ENDPOINT = "/read-aloud/stream";
  var READ_ALOUD_MAX_CHUNK_CHARS = 2000;
  var READ_ALOUD_MODE = String(window.READ_ALOUD_MODE || "preGenerated");
  var READ_ALOUD_DEFAULT_LANGUAGE = READ_ALOUD_CONFIG.defaultLanguage || "en-US";
  var READ_ALOUD_DEFAULT_VOICE = READ_ALOUD_CONFIG.defaultVoice || "en_paul_neutral";
  var READ_ALOUD_VOICE_BY_LANGUAGE = READ_ALOUD_CONFIG.byLanguage || {};
  var listenInstallInfoLogged = { noConfig: false, noButton: false };
  /** Aligns with grid media query in ensureStyles: dual columns collapse at this width. */
  var MOBILE_DUAL_MAX_WIDTH = 900;
  var mobileDualMql =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(max-width: " + MOBILE_DUAL_MAX_WIDTH + "px)")
      : null;
  var state = {
    translator: null,
    translatedParagraphs: null,
    isTranslating: false,
    lastJobId: 0,
    isOpen: false,
    dualToggleButton: null,
    hoverToggleButton: null,
    inlineWrap: null,
    singleModeTokenized: false,
    paragraphPlayInstalled: false,
    singleRowByIndex: null,
    singleModeHoverListenerAttached: false,
    sourceNodes: [],
    rowMap: new WeakMap(),
    /** Row data by index when target tokens are not under `.translation-inline-row` (side-by-side stack). */
    dualRowByIndex: null,
    activeHighlight: null,
    hoverTranslationCache: new Map(),
    hoverRequestId: 0,
    hoverPopoverEl: null,
    historyWords: new Set(),
    audio: {
      text: "",
      totalChars: 0,
      currentChar: 0,
      isPlaying: false,
      isPaused: false,
      rate: 1,
      lang: "en-US",
      ui: null,
      backend: null,
      remoteEl: null,
      remoteDuration: 0,
      player: null,
      listenRequestGen: 0,
      activeChunkStart: 0,
      activeChunkLength: 0,
      selectedVoice: "",
      selectedLanguage: "",
      activeListenBtn: null,
      activeParagraphBtn: null,
      karaoke: {
        paragraphEl: null,
        tokenEls: [],
        mapByTimedWordIndex: [],
        activeDomTokenIndex: -1
      }
    }
  };

  function logDebug(event, payload) {
    try {
      console.debug(LOG_PREFIX, event, payload || {});
    } catch (_e) { }
  }

  function logWarn(event, payload) {
    try {
      console.warn(LOG_PREFIX, event, payload || {});
    } catch (_e) { }
  }

  function printConsoleHelp() {
    try {
      console.info(
        [
          "[dual-translation] Help",
          "- Word hover works in single-column reading and in dual mode (tokenized text).",
          "  Use the sparkle button (next to dark mode) to enable/disable hover hints.",
          "  Or: window.DUAL_TRANSLATION_HOVER_WORD_MAP = true|false",
          "- Auto-open dual mode on load is off by default. To enable:",
          "  window.DUAL_TRANSLATION_AUTO_OPEN = true",
          "- Dual translation mode (icon + side-by-side translation) is off by default. To enable:",
          "  window.DUAL_TRANSLATION_ENABLED = true",
          "- Current hover flag:",
          "  window.DUAL_TRANSLATION_HOVER_WORD_MAP = " + String(window[HOVER_FEATURE_FLAG]),
          "- Current dual mode flag:",
          "  window.DUAL_TRANSLATION_ENABLED = " + String(isDualTranslationEnabled()),
          "- Listen mode uses Mistral Voxtral TTS with streaming via /read-aloud/stream.",
          "- Read-aloud mode selector: window.READ_ALOUD_MODE = 'preGenerated' | 'streaming' (default: preGenerated).",
          "- More commands can be added here later."
        ].join("\n")
      );
    } catch (_e) { }
  }

  function isHoverWordMappingEnabled() {
    if (typeof window[HOVER_FEATURE_FLAG] === "undefined") return true;
    return Boolean(window[HOVER_FEATURE_FLAG]);
  }

  function shouldAutoOpenDualOnLoad() {
    if (typeof window.DUAL_TRANSLATION_AUTO_OPEN !== "undefined") {
      return Boolean(window.DUAL_TRANSLATION_AUTO_OPEN);
    }
    return false;
  }

  function isDualTranslationEnabled() {
    if (typeof window.DUAL_TRANSLATION_ENABLED !== "undefined") {
      return Boolean(window.DUAL_TRANSLATION_ENABLED);
    }
    return false;
  }

  function isMobileViewport() {
    if (mobileDualMql) return mobileDualMql.matches;
    return window.innerWidth <= MOBILE_DUAL_MAX_WIDTH;
  }

  function closeDualIfMobileViewport() {
    if (!isMobileViewport() || !state.isOpen) return;
    closeMode(state.dualToggleButton);
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
      ".translation-mode-button[data-tooltip]{position:relative}" +
      ".translation-mode-button[data-tooltip]:hover::after,.translation-mode-button[data-tooltip]:focus-visible::after{" +
      "content:attr(data-tooltip);position:absolute;left:50%;top:calc(100% + 8px);transform:translateX(-50%);" +
      "padding:6px 8px;border-radius:6px;background:rgba(20,24,31,.92);color:#fff;white-space:nowrap;" +
      "font:500 12px/1.2 Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;" +
      "z-index:100001;pointer-events:none;box-shadow:0 6px 18px rgba(0,0,0,.22)}" +
      ".translation-mode-logo{display:block;width:24px;height:24px}" +
      ".translation-source-hidden{display:none!important}" +
      ".translation-inline-wrap{display:none!important;margin:0}" +
      ".translation-inline-wrap.translation-inline-wrap_open{display:block!important}" +
      ".translation-inline-bisect{display:grid;grid-template-columns:minmax(0,1fr);row-gap:12px;width:100%;box-sizing:border-box;align-items:start}" +
      ".translation-inline-row{display:contents}" +
      ".translation-inline-col{min-width:0}" +
      ".translation-inline-col p{margin:0;line-height:1.65;text-align:start;white-space:pre-wrap;overflow-wrap:anywhere}" +
      ".translation-token{border-radius:4px;padding:0 1px;transition:background-color .12s ease}" +
      ".translation-inline-orig .translation-token{cursor:pointer}" +
      "body.translation-hover-disabled .translation-inline-wrap .translation-token{cursor:default}" +
      ".translation-token_src{background:rgba(21,124,213,.2)}" +
      ".translation-token_tgt{background:rgba(255,190,92,.35)}" +
      ".translation-token_karaoke{background:rgba(21,124,213,.28)!important}" +
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
      ".translation-inline-trans__title{" +
      "margin:0;padding:0 0 6px;line-height:1.3;" +
      "font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;" +
      "color:var(--text-base-secondary,#64748b)" +
      "}" +
      ".translation-inline-wrap_open .translation-inline-trans{" +
      "position:relative;z-index:1;box-sizing:border-box;" +
      "padding:2px 0 2px 18px;" +
      "border-left:3px solid rgba(148,124,91,.55);border-radius:0;" +
      "background:rgba(241,236,228,.55)!important" +
      "}" +
      ".translation-inline-wrap_open .translation-inline-trans p{" +
      "color:var(--text-base-primary,#1a1a1a)" +
      "}" +
      "@media (prefers-color-scheme:dark){" +
      ".translation-inline-wrap_open .translation-inline-trans{" +
      "border-left-color:rgba(212,176,122,.75);" +
      "background:rgba(251,191,36,.06)!important" +
      "}" +
      ".translation-inline-wrap_open .translation-inline-trans p{" +
      "color:var(--text-base-primary,rgba(250,250,250,.95))" +
      "}" +
      ".translation-inline-trans__title{color:var(--text-base-secondary,#94a3b8)}" +
      "}" +
      ".translation-inline-bisect>.translation-inline-trans__title,.translation-inline-trans p{" +
      "opacity:0;transform:translateX(24px);transition:transform .28s ease,opacity .24s ease" +
      "}" +
      ".translation-inline-wrap_open .translation-inline-bisect>.translation-inline-trans__title," +
      ".translation-inline-wrap_open .translation-inline-trans p{" +
      "opacity:1;transform:translateX(0)" +
      "}" +
      "@media (min-width:" +
      (MOBILE_DUAL_MAX_WIDTH + 1) +
      "px){.translation-inline-bisect{grid-template-columns:minmax(0,1fr) minmax(0,1fr);column-gap:24px;row-gap:0}" +
      ".translation-inline-wrap_open .translation-inline-bisect>.translation-inline-trans__title{margin-bottom:12px}" +
      ".translation-inline-wrap_open .translation-inline-orig,.translation-inline-wrap_open .translation-inline-trans{padding-bottom:12px}" +
      ".translation-inline-bisect .translation-inline-orig:last-of-type,.translation-inline-bisect .translation-inline-trans:last-of-type{padding-bottom:0}" +
      ".translation-inline-wrap_open .translation-inline-bisect>.translation-inline-trans__title{" +
      "grid-column:2;grid-row:1;padding-left:21px;align-self:start" +
      "}" +
      "}" +
      ".translation-audio-player{position:fixed;left:0;right:0;bottom:0;z-index:900;width:100%;display:none}" +
      ".translation-audio-player_visible{display:block}" +
      ".translation-audio-player__toolbar{display:flex;flex-direction:column;background:var(--background-base-secondary,#fcf4e9);box-shadow:0 -1px 16px 0 var(--light-grey-a-2,rgba(34,44,49,.1));padding:0 24px 8px}" +
      ".translation-audio-player__main{display:flex;align-items:center;justify-content:space-between;height:64px}" +
      ".translation-audio-player__adjustment,.translation-audio-player__close{display:flex;align-items:center;gap:12px}" +
      ".translation-audio-player__control{display:flex;align-items:center;justify-content:center;gap:16px}" +
      ".translation-audio-player__btn{height:44px;min-width:44px;border:0;border-radius:10px;background:transparent;color:var(--text-banner-placeholder,#7c7c7c);cursor:pointer;padding:0 10px;font:600 13px/1 Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif}" +
      ".translation-audio-player__btn:hover{background-color:var(--line-gray-secondary,#eaeef1)}" +
      ".translation-audio-player__btn:focus-visible{outline:2px solid var(--new-blue-700,#2a8bdf);outline-offset:2px}" +
      ".translation-audio-player__btn_square{width:44px;min-width:44px;padding:0}" +
      ".translation-audio-player__btn_dialect{display:inline-flex;align-items:center;justify-content:center;gap:4px;padding:0 8px}" +
      ".translation-audio-player__dialect-chevron{display:inline-flex;width:20px;height:20px;transform:rotate(270deg);color:var(--black-700,#7c7c7c)}" +
      ".translation-audio-player__btn_play{color:var(--text-banner-placeholder,#7c7c7c)}" +
      ".translation-audio-player__btn svg{display:block;width:28px;height:28px}" +
      ".translation-audio-player__progress{display:flex;align-items:center;gap:8px;padding:0 2px 2px}" +
      ".translation-audio-player__time{min-width:42px;font:12px/1 Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:var(--text-base-secondary,#607d8b)}" +
      ".translation-audio-player__time_total{text-align:right}" +
      ".translation-audio-player__seek{flex:1;min-width:0;height:14px;background:transparent;-webkit-appearance:none;appearance:none}" +
      ".translation-audio-player__seek:focus{outline:none}" +
      ".translation-audio-player__seek::-webkit-slider-runnable-track{height:4px;border-radius:999px;background:var(--line-gray-primary,#dee4e7)}" +
      ".translation-audio-player__seek::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:12px;height:12px;border-radius:50%;margin-top:-4px;background:var(--new-blue-700,#2a8bdf);border:0}" +
      ".translation-audio-player__seek::-moz-range-track{height:4px;border-radius:999px;background:var(--line-gray-primary,#dee4e7)}" +
      ".translation-audio-player__seek::-moz-range-thumb{width:12px;height:12px;border-radius:50%;background:var(--new-blue-700,#2a8bdf);border:0}" +
      "@media only screen and (max-width:567px){.translation-audio-player__toolbar{padding:0 8px 8px}.translation-audio-player__control{gap:8px}}" +
      ".translation-listen-spinner{display:inline-flex;align-items:center;vertical-align:middle;flex-shrink:0;margin-left:6px;width:18px;height:18px;opacity:0;pointer-events:none;transition:opacity .15s ease}" +
      ".translation-listen-spinner_visible{opacity:1}" +
      ".translation-listen-spinner__ring{width:16px;height:16px;border:2px solid var(--line-gray-primary,#d4d9e3);border-top-color:var(--new-blue-700,#2a8bdf);border-radius:50%;box-sizing:border-box;animation:translation-listen-spin .65s linear infinite}" +
      "@keyframes translation-listen-spin{to{transform:rotate(360deg)}}" +
      ".translation-paragraph-play-host{position:relative}" +
      ".translation-paragraph-play-host::before{" +
      "content:'';position:absolute;left:-44px;top:0;bottom:0;width:44px;" +
      "}" +
      ".translation-paragraph-play-host::after{" +
      "content:'';position:absolute;left:-12px;top:0;bottom:0;width:2px;border-radius:999px;" +
      "background:var(--new-blue-700,#2a8bdf);opacity:0;pointer-events:none;" +
      "transition:opacity .15s ease" +
      "}" +
      ".translation-paragraph-play-host:hover::after{opacity:.28}" +
      ".translation-paragraph-actions{" +
      "position:absolute;left:-44px;top:0;display:flex;flex-direction:column;gap:6px;z-index:3;" +
      "opacity:0;pointer-events:none;transition:opacity .12s ease" +
      "}" +
      ".translation-paragraph-play-host:hover .translation-paragraph-actions,.translation-paragraph-actions:focus-within{" +
      "opacity:1;pointer-events:auto" +
      "}" +
      ".translation-paragraph-play{" +
      "position:relative;left:auto;top:auto;transform:none;" +
      "width:26px;height:26px;border:1px solid var(--line-gray-primary,#d4d9e3);border-radius:999px;" +
      "display:inline-flex;align-items:center;justify-content:center;" +
      "background:#472c1f;color:#fff;" +
      "opacity:1;pointer-events:auto;cursor:pointer;z-index:1;" +
      "box-shadow:0 1px 3px rgba(0,0,0,.08);" +
      "transition:opacity .12s ease,background-color .12s ease,border-color .12s ease" +
      "}" +
      ".translation-paragraph-play:hover{opacity:.9}" +
      ".translation-paragraph-play svg{display:block;width:13px;height:13px}" +
      ".translation-paragraph-play:focus-visible{outline:2px solid var(--new-blue-700,#2a8bdf);outline-offset:1px}" +
      ".translation-paragraph-translate{" +
      "width:26px;height:26px;border:1px solid var(--line-gray-primary,#d4d9e3);border-radius:999px;" +
      "display:inline-flex;align-items:center;justify-content:center;background:#472c1f;color:#fff;" +
      "cursor:pointer;box-shadow:0 1px 2px rgba(0,0,0,.06);padding:0;overflow:hidden;" +
      "transition:background-color .12s ease,border-color .12s ease,color .12s ease,opacity .12s ease" +
      "}" +
      ".translation-paragraph-translate:hover{opacity:.9}" +
      ".translation-paragraph-translate svg{display:block;width:78%;height:78%}" +
      ".translation-paragraph-translate:focus-visible{outline:2px solid var(--new-blue-700,#2a8bdf);outline-offset:1px}" +
      ".translation-history-item_just-added .history-item{" +
      "animation:translation-history-item-flash 1.1s ease-out 1" +
      "}" +
      "@keyframes translation-history-item-flash{" +
      "0%{background:color-mix(in srgb, var(--background-base-primary,#e6eef6) 50%, transparent)}" +
      "100%{background:var(--background-history-item,#ffffff8f)}" +
      "}" +
      "body.translation-dual-open{overflow-x:hidden!important}" +
      "body.translation-dual-open .main-content_full-width,body.translation-dual-open .reading-list__container,body.translation-dual-open app-reader-view-content{max-width:100%!important;width:100%!important;box-sizing:border-box!important}" +
      "body.translation-dual-open .reader-view-page__main-container{max-width:none!important;width:100%!important;display:flex!important;align-items:stretch;gap:0}" +
      "body.translation-dual-open .translation-inline-wrap{width:100%!important;max-width:none!important;box-sizing:border-box!important}" +
      "body.translation-dual-open .reader-view-page__view_with-sidebar,body.translation-dual-open .reader-view-page__view,body.translation-dual-open .main-content_full-width{flex:1 1 auto;min-width:0}" +
      "body.translation-dual-open .reader-view-page__history-sidebar,body.translation-dual-open app-reader-view-word-sidebar{flex:0 0 clamp(320px,28vw,420px)!important;width:clamp(320px,28vw,420px)!important;min-width:320px!important;max-width:420px!important}" +
      "body.translation-dual-open .reader-view-page__history-sidebar_hidden{display:none!important}" +
      "@media (max-width:" +
      MOBILE_DUAL_MAX_WIDTH +
      "px){" +
      ".translation-inline-bisect .translation-inline-orig,.translation-inline-bisect .translation-inline-trans," +
      ".translation-inline-bisect>.translation-inline-trans__title{grid-column:1!important;grid-row:auto!important}" +
      ".translation-inline-wrap_open .translation-inline-trans{" +
      "border-left:none!important;border-top:3px solid rgba(148,124,91,.55)!important;" +
      "padding:14px 0 2px!important;background:rgba(241,236,228,.55)!important" +
      "}" +
      ".translation-inline-wrap_open .translation-inline-trans_first{margin-top:12px}" +
      ".translation-mode-button_dual{display:none!important}}" +
      "@media (max-width:" +
      MOBILE_DUAL_MAX_WIDTH +
      "px) and (prefers-color-scheme:dark){" +
      ".translation-inline-wrap_open .translation-inline-trans{border-top-color:rgba(212,176,122,.75)!important;background:rgba(251,191,36,.06)!important}" +
      "}";
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

  function getReadingHoverRoot() {
    var nodes = sourceNodes();
    if (!nodes.length) return null;
    return (
      nodes[0].closest(".reading-text__content") ||
      nodes[0].closest("app-reader-view-content") ||
      nodes[0].closest(".reader-view-page__view") ||
      nodes[0].parentElement
    );
  }

  function ensureSingleModeTokenization() {
    if (state.singleModeTokenized) return;
    state.sourceNodes = [];
    state.singleRowByIndex = Object.create(null);
    var nodes = sourceNodes();
    for (var i = 0; i < nodes.length; i += 1) {
      var p = nodes[i];
      var text = (p.textContent || "").trim();
      p.classList.add("translation-inline-orig");
      var sourceTokens = renderTokenizedParagraph(p, text, "source", i);
      state.singleRowByIndex[String(i)] = {
        sourceP: p,
        targetP: null,
        sourceTokens: sourceTokens,
        targetTokens: []
      };
    }
    state.singleModeTokenized = true;
  }

  function getRowDataForToken(tokenEl) {
    var rowEl = tokenEl.closest(".translation-inline-row");
    if (rowEl && state.rowMap.has(rowEl)) {
      return state.rowMap.get(rowEl);
    }
    if (tokenEl.closest(".translation-inline-wrap")) {
      var idxDual = tokenEl.getAttribute("data-row-index");
      if (idxDual != null && state.dualRowByIndex && state.dualRowByIndex[idxDual]) {
        return state.dualRowByIndex[idxDual];
      }
    }
    var idx = tokenEl.getAttribute("data-row-index");
    if (idx != null && state.singleRowByIndex && state.singleRowByIndex[idx]) {
      return state.singleRowByIndex[idx];
    }
    return null;
  }

  function onSingleReadingHoverMouseover(event) {
    if (!isHoverWordMappingEnabled()) return;
    if (state.isOpen) return;
    var root = getReadingHoverRoot();
    if (!root || !root.contains(event.target)) return;
    var tokenEl = event.target.closest(".translation-token");
    if (!tokenEl || !root.contains(tokenEl)) return;
    if (tokenEl.closest(".translation-inline-wrap")) return;
    clearActiveHighlight();
    applyHighlight(tokenEl);
  }

  function onSingleReadingHoverMouseleave() {
    if (!isHoverWordMappingEnabled()) return;
    if (state.isOpen) return;
    clearActiveHighlight();
  }

  function attachSingleModeHoverHandlers() {
    if (state.singleModeHoverListenerAttached) return;
    ensureSingleModeTokenization();
    var root = getReadingHoverRoot();
    if (!root) return;
    state.singleModeHoverListenerAttached = true;
    root.addEventListener("mouseover", onSingleReadingHoverMouseover);
    root.addEventListener("mouseleave", onSingleReadingHoverMouseleave);
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

  function getListenButton() {
    return (
      document.querySelector("app-listen-button button") ||
      document.querySelector(".listen-button button") ||
      document.querySelector(".listen-service button")
    );
  }

  function listenPauseIconSvg() {
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">' +
      '<path d="M6.5 4.8C6.5 4.36 6.86 4 7.3 4H8.9C9.34 4 9.7 4.36 9.7 4.8V15.2C9.7 15.64 9.34 16 8.9 16H7.3C6.86 16 6.5 15.64 6.5 15.2V4.8Z" fill="var(--text-banner-placeholder,#7c7c7c)"></path>' +
      '<path d="M10.3 4.8C10.3 4.36 10.66 4 11.1 4H12.7C13.14 4 13.5 4.36 13.5 4.8V15.2C13.5 15.64 13.14 16 12.7 16H11.1C10.66 16 10.3 15.64 10.3 15.2V4.8Z" fill="var(--text-banner-placeholder,#7c7c7c)"></path>' +
      "</svg>"
    );
  }

  function paragraphPauseIconSvg() {
    return (
      '<svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor">' +
      '<rect x="7" y="6" width="3.5" height="12" rx="1"></rect>' +
      '<rect x="13.5" y="6" width="3.5" height="12" rx="1"></rect>' +
      "</svg>"
    );
  }

  function setTopListenButtonVisual(listenBtn, isPause) {
    if (!listenBtn) return;
    if (!listenBtn.dataset.translationListenPlayHtml) {
      listenBtn.dataset.translationListenPlayHtml = listenBtn.innerHTML;
    }
    if (isPause) {
      listenBtn.innerHTML = "Stop";
      listenBtn.setAttribute("aria-label", "Stop");
      return;
    }
    if (listenBtn.dataset.translationListenPlayHtml) {
      listenBtn.innerHTML = listenBtn.dataset.translationListenPlayHtml;
    }
    listenBtn.setAttribute("aria-label", "Listen");
  }

  function setParagraphButtonVisual(btn, isPause) {
    if (!btn) return;
    btn.innerHTML = isPause ? paragraphPauseIconSvg() : paragraphPlayIconSvg();
    btn.setAttribute("aria-label", isPause ? "Pause reading" : "Read this paragraph aloud");
    btn.setAttribute("title", isPause ? "Pause reading" : "Read this paragraph aloud");
  }

  function clearActiveTriggerButtons() {
    setTopListenButtonVisual(state.audio.activeListenBtn, false);
    setParagraphButtonVisual(state.audio.activeParagraphBtn, false);
    state.audio.activeListenBtn = null;
    state.audio.activeParagraphBtn = null;
  }

  function clearKaraokeDomHighlight() {
    var karaoke = state.audio.karaoke;
    if (!karaoke || !karaoke.tokenEls || !karaoke.tokenEls.length) {
      if (karaoke) karaoke.activeDomTokenIndex = -1;
      return;
    }
    if (karaoke.activeDomTokenIndex >= 0 && karaoke.tokenEls[karaoke.activeDomTokenIndex]) {
      karaoke.tokenEls[karaoke.activeDomTokenIndex].classList.remove("translation-token_karaoke");
    }
    karaoke.activeDomTokenIndex = -1;
  }

  function resetKaraokeState() {
    clearKaraokeDomHighlight();
    state.audio.karaoke.paragraphEl = null;
    state.audio.karaoke.tokenEls = [];
    state.audio.karaoke.mapByTimedWordIndex = [];
  }

  function normalizeKaraokeToken(token) {
    var normalized = String(token || "")
      .toLowerCase()
      .replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, "")
      .trim();
    // Make transcript ordinals (e.g. 13th) align with rendered numeric tokens (e.g. 13).
    normalized = normalized.replace(/^(\d+)(st|nd|rd|th)$/i, "$1");
    return normalized;
  }

  function buildKaraokeDomMap(paragraphEl) {
    var tokenEls = Array.prototype.slice.call(paragraphEl.querySelectorAll(".translation-token"));
    var normalizedDomTokens = tokenEls.map(function (el) {
      return normalizeKaraokeToken(el.textContent || "");
    });
    return {
      tokenEls: tokenEls,
      normalizedDomTokens: normalizedDomTokens
    };
  }

  function createTimedWordToDomIndexMap(normalizedDomTokens, paragraphText) {
    var paragraphTokens = String(paragraphText || "")
      .match(/[a-z0-9']+/gi) || [];
    var normalizedParaTokens = paragraphTokens.map(normalizeKaraokeToken).filter(Boolean);
    var map = [];
    var domIdx = 0;
    var LOOKAHEAD = 10;
    for (var i = 0; i < normalizedParaTokens.length; i += 1) {
      var token = normalizedParaTokens[i];
      var found = -1;
      var maxIdx = Math.min(normalizedDomTokens.length - 1, domIdx + LOOKAHEAD);
      for (var scan = domIdx; scan <= maxIdx; scan += 1) {
        if (normalizedDomTokens[scan] === token) {
          found = scan;
          break;
        }
      }
      if (found < 0) {
        map.push(-1);
      } else {
        map.push(found);
        domIdx = found + 1;
      }
    }
    return map;
  }

  function onKaraokeWordChange(word) {
    var karaoke = state.audio.karaoke;
    if (!karaoke) return;
    if (!word || typeof word.index !== "number") return;
    var domIdx = karaoke.mapByTimedWordIndex[word.index];
    if (typeof domIdx !== "number" || domIdx < 0 || !karaoke.tokenEls[domIdx]) return;
    clearKaraokeDomHighlight();
    karaoke.tokenEls[domIdx].classList.add("translation-token_karaoke");
    karaoke.activeDomTokenIndex = domIdx;
  }

  function setActiveListenTriggerButton(btn) {
    if (state.audio.activeParagraphBtn && state.audio.activeParagraphBtn !== btn) {
      setParagraphButtonVisual(state.audio.activeParagraphBtn, false);
    }
    if (state.audio.activeListenBtn && state.audio.activeListenBtn !== btn) {
      setTopListenButtonVisual(state.audio.activeListenBtn, false);
    }
    state.audio.activeParagraphBtn = null;
    state.audio.activeListenBtn = btn || null;
  }

  function setActiveParagraphTriggerButton(btn) {
    if (state.audio.activeListenBtn && state.audio.activeListenBtn !== btn) {
      setTopListenButtonVisual(state.audio.activeListenBtn, false);
    }
    if (state.audio.activeParagraphBtn && state.audio.activeParagraphBtn !== btn) {
      setParagraphButtonVisual(state.audio.activeParagraphBtn, false);
    }
    state.audio.activeListenBtn = null;
    state.audio.activeParagraphBtn = btn || null;
  }

  function syncTriggerButtonsUi() {
    var shouldShowPause = state.audio.isPlaying && !state.audio.isPaused;
    setTopListenButtonVisual(state.audio.activeListenBtn, shouldShowPause);
    setParagraphButtonVisual(state.audio.activeParagraphBtn, shouldShowPause);
  }

  function ensureListenSpinnerBesideButton(listenBtn) {
    var next = listenBtn.nextElementSibling;
    if (next && next.classList && next.classList.contains("translation-listen-spinner")) return next;
    var sp = document.createElement("span");
    sp.className = "translation-listen-spinner";
    sp.setAttribute("role", "status");
    sp.setAttribute("aria-live", "polite");
    sp.setAttribute("aria-label", "Loading speech");
    var ring = document.createElement("span");
    ring.className = "translation-listen-spinner__ring";
    sp.appendChild(ring);
    listenBtn.insertAdjacentElement("afterend", sp);
    return sp;
  }

  function setListenLoading(listenBtn, on) {
    if (!listenBtn) return;
    var sp = ensureListenSpinnerBesideButton(listenBtn);
    if (on) {
      sp.classList.add("translation-listen-spinner_visible");
      listenBtn.setAttribute("aria-busy", "true");
    } else {
      sp.classList.remove("translation-listen-spinner_visible");
      listenBtn.removeAttribute("aria-busy");
    }
  }

  function sentenceCandidates(text) {
    var out = [];
    String(text || "").replace(/[^.!?]+(?:[.!?]+|$)/g, function (m) {
      out.push(String(m || "").trim());
      return m;
    });
    if (!out.length && String(text || "").trim()) out.push(String(text || "").trim());
    return out.filter(Boolean);
  }

  function splitLongByWords(text, maxChars) {
    var words = String(text || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!words.length) return [];
    var chunks = [];
    var current = "";
    for (var i = 0; i < words.length; i += 1) {
      var word = words[i];
      if (word.length > maxChars) {
        if (current) {
          chunks.push(current);
          current = "";
        }
        // Edge case: a single "word" can exceed the API limit; hard-cut to avoid request failure.
        for (var j = 0; j < word.length; j += maxChars) {
          chunks.push(word.slice(j, j + maxChars));
        }
        continue;
      }
      var next = current ? current + " " + word : word;
      if (next.length <= maxChars) {
        current = next;
      } else {
        if (current) chunks.push(current);
        current = word;
      }
    }
    if (current) chunks.push(current);
    return chunks;
  }

  function splitTextForVoiceApi(rawText, maxChars) {
    var normalized = String(rawText || "").replace(/\s+/g, " ").trim();
    if (!normalized) return [];
    var sentenceLike = sentenceCandidates(normalized);
    var chunks = [];
    for (var i = 0; i < sentenceLike.length; i += 1) {
      var sentence = sentenceLike[i];
      if (!sentence) continue;
      if (sentence.length <= maxChars) {
        chunks.push(sentence);
      } else {
        var byWords = splitLongByWords(sentence, maxChars);
        for (var k = 0; k < byWords.length; k += 1) chunks.push(byWords[k]);
      }
    }
    var merged = [];
    for (var m = 0; m < chunks.length; m += 1) {
      var current = chunks[m];
      if (!merged.length) {
        merged.push(current);
        continue;
      }
      var last = merged[merged.length - 1];
      var candidate = last + " " + current;
      if (candidate.length <= maxChars) {
        merged[merged.length - 1] = candidate;
      } else {
        merged.push(current);
      }
    }
    return merged;
  }

  /**
   * Gradio SSE consumer matching the early-return behavior of a known-good client:
   * return on first `data:` JSON where `!Array.isArray(parsed) || parsed.length > 0`.
   * Buffers across chunk boundaries so `data: …` lines are not split incorrectly.
   */
  async function gradioSseReadUntilFirstPayload(url, signal) {
    var sseRes = await fetch(url, { signal: signal });
    if (!sseRes.ok) throw new Error("SSE open failed: " + sseRes.status);
    if (!sseRes.body || !sseRes.body.getReader) throw new Error("SSE body unreadable");
    var reader = sseRes.body.getReader();
    var decoder = new TextDecoder();
    var carry = "";

    function processLine(line) {
      if (line.indexOf("event: ") === 0) {
        try {
          console.log(LOG_PREFIX + " Gradio SSE event type:", line.slice(7).trim());
        } catch (_e) { }
        return null;
      }
      if (line.indexOf("data: ") !== 0) return null;
      var raw = line.slice(6).trim();
      if (!raw || raw === "[DONE]") return null;
      try {
        var parsed = JSON.parse(raw);
        try {
          console.log(LOG_PREFIX + " Gradio SSE parsed data:", parsed);
        } catch (_e2) { }
        if (!Array.isArray(parsed) || parsed.length > 0) {
          return parsed;
        }
      } catch (_parse) { }
      return null;
    }

    while (true) {
      var read = await reader.read();
      if (read.done) break;
      var chunk = decoder.decode(read.value, { stream: true });
      try {
        console.log(LOG_PREFIX + " Gradio SSE raw chunk:", chunk);
      } catch (_e3) { }
      carry += chunk;
      var lines = carry.split("\n");
      carry = lines.pop() || "";
      for (var i = 0; i < lines.length; i++) {
        var out = processLine(lines[i]);
        if (out !== null) return out;
      }
    }
    if (carry.trim()) {
      var tail = processLine(carry);
      if (tail !== null) return tail;
    }
    throw new Error("Gradio SSE stream ended without a usable data payload");
  }

  async function gradioPredict(baseUrl, endpoint, data, signal) {
    var base = String(baseUrl).replace(/\/$/, "");
    var submitUrl = base + "/gradio_api/call/" + endpoint;
    try {
      console.log(
        LOG_PREFIX + " Gradio TTS request →",
        submitUrl,
        "(string field lengths: " +
        data.map(function (x) {
          return typeof x === "string" ? x.length : "-";
        }) +
        ")"
      );
    } catch (_logE) { }
    var postRes = await fetch(submitUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: data }),
      signal: signal
    });
    if (!postRes.ok) {
      throw new Error("Submit failed: " + postRes.status + " " + (await postRes.text()));
    }
    var submitJson = await postRes.json();
    var event_id = submitJson.event_id;
    if (event_id == null) throw new Error("Missing event_id from Gradio");
    try {
      console.log(LOG_PREFIX + " Gradio event_id:", event_id);
    } catch (_eLog) { }
    var result = await gradioSseReadUntilFirstPayload(
      base + "/gradio_api/call/" + endpoint + "/" + event_id,
      signal
    );
    try {
      console.log(LOG_PREFIX + " Gradio TTS response ←", result);
    } catch (_logE2) { }
    return result;
  }

  function audioUrlFromGradioResult(baseUrl, result) {
    if (!result || !Array.isArray(result) || !result.length) return "";
    var first = result[0];
    var base = String(baseUrl).replace(/\/$/, "");
    if (typeof first === "string") {
      if (/^https?:\/\//i.test(first)) return first;
      if (first.charAt(0) === "/") return base + first;
      return base + "/file=" + encodeURIComponent(first);
    }
    if (first && typeof first === "object") {
      if (typeof first.url === "string" && /^https?:\/\//i.test(first.url)) return first.url;
      if (typeof first.url === "string" && first.url.charAt(0) === "/") return base + first.url;
      if (typeof first.path === "string") return base + "/file=" + encodeURIComponent(first.path);
    }
    return "";
  }

  function formatTime(seconds) {
    var safe = Math.max(0, Math.floor(seconds || 0));
    var m = Math.floor(safe / 60);
    var s = String(safe % 60).padStart(2, "0");
    return m + ":" + s;
  }

  function getEstimatedTotalSeconds() {
    if (state.audio.backend === "remote" && state.audio.remoteDuration > 0) {
      return state.audio.remoteDuration;
    }
    var cps = 13 * (state.audio.rate || 1);
    if (!state.audio.totalChars || cps <= 0) return 0;
    return state.audio.totalChars / cps;
  }

  function getEstimatedCurrentSeconds() {
    if (state.audio.backend === "remote" && state.audio.remoteDuration > 0 && state.audio.totalChars > 0) {
      return (state.audio.currentChar / state.audio.totalChars) * state.audio.remoteDuration;
    }
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
    syncTriggerButtonsUi();
  }

  function ensureAudioText() {
    if (state.audio.text) return state.audio.text;
    state.audio.text = sourceParagraphs().join("\n\n");
    state.audio.totalChars = state.audio.text.length;
    return state.audio.text;
  }

  function normalizeLanguageCode(input) {
    var raw = String(input || "").trim().replace(/_/g, "-");
    if (!raw) return "";
    var parts = raw.split("-").filter(Boolean);
    if (!parts.length) return "";
    var lang = parts[0].toLowerCase();
    var region = parts[1] ? parts[1].toUpperCase() : "";
    return region ? lang + "-" + region : lang;
  }

  function guessLanguageFromPage() {
    var htmlLang = normalizeLanguageCode(
      (document.documentElement && document.documentElement.lang) || ""
    );
    if (htmlLang) return htmlLang;
    var ogLocale = document.querySelector('meta[property="og:locale"]');
    var ogLang = normalizeLanguageCode(ogLocale ? ogLocale.getAttribute("content") : "");
    if (ogLang) return ogLang;
    return READ_ALOUD_DEFAULT_LANGUAGE;
  }

  function resolveVoiceForLanguage(languageCode) {
    var normalized = normalizeLanguageCode(languageCode) || READ_ALOUD_DEFAULT_LANGUAGE;
    var keyExact = normalized.toLowerCase();
    if (READ_ALOUD_VOICE_BY_LANGUAGE[keyExact]) return READ_ALOUD_VOICE_BY_LANGUAGE[keyExact];
    var base = keyExact.split("-")[0];
    if (READ_ALOUD_VOICE_BY_LANGUAGE[base]) return READ_ALOUD_VOICE_BY_LANGUAGE[base];
    return READ_ALOUD_VOICE_BY_LANGUAGE.en || READ_ALOUD_DEFAULT_VOICE;
  }

  function showAudioPlayer() {
    if (!state.audio.ui || !state.audio.ui.root) return;
    state.audio.ui.root.classList.add("translation-audio-player_visible");
  }

  function onRemoteAudioTimeUpdate() {
    if (state.audio.backend !== "remote" || !state.audio.remoteEl) return;
    var el = state.audio.remoteEl;
    var d = el.duration;
    if (!state.audio.totalChars || !isFinite(d) || d <= 0) return;
    var activeLen = Math.max(0, state.audio.activeChunkLength || 0);
    var activeStart = Math.max(0, state.audio.activeChunkStart || 0);
    if (activeLen > 0) {
      state.audio.currentChar = Math.min(
        state.audio.totalChars,
        activeStart + Math.round((el.currentTime / d) * activeLen)
      );
    }
    updateAudioUi();
  }

  function onRemoteAudioLoadedMetadata() {
    if (state.audio.backend !== "remote" || !state.audio.remoteEl) return;
    var d = state.audio.remoteEl.duration;
    if (isFinite(d) && d > 0) state.audio.remoteDuration = d;
    updateAudioUi();
  }

  function onRemoteAudioEnded() {
    if (state.audio.backend !== "remote") return;
    if (state.audio.currentChar >= state.audio.totalChars) {
      state.audio.isPlaying = false;
      state.audio.isPaused = false;
    }
    updateAudioUi();
  }

  function ensureRemoteAudioEl() {
    if (state.audio.remoteEl) return state.audio.remoteEl;
    var el = new Audio();
    el.preload = "auto";
    el.muted = false;
    el.volume = 1;
    el.addEventListener("timeupdate", onRemoteAudioTimeUpdate);
    el.addEventListener("loadedmetadata", onRemoteAudioLoadedMetadata);
    el.addEventListener("ended", onRemoteAudioEnded);
    el.addEventListener("playing", function () {
      logDebug("remote_audio_playing", {
        currentTime: el.currentTime,
        duration: el.duration,
        muted: el.muted,
        volume: el.volume,
        readyState: el.readyState
      });
    });
    el.addEventListener("error", function () {
      var mediaErr = el.error;
      logWarn("remote_audio_error", {
        code: mediaErr ? mediaErr.code : null,
        message: mediaErr && mediaErr.message ? mediaErr.message : "",
        currentSrc: el.currentSrc || ""
      });
    });
    state.audio.remoteEl = el;
    return el;
  }

  function stopAudioPlayback() {
    if (state.audio.player && typeof state.audio.player.stop === "function") {
      try {
        state.audio.player.stop();
      } catch (_e) { }
    }
    if (state.audio.remoteEl) {
      try {
        state.audio.remoteEl.pause();
        state.audio.remoteEl.removeAttribute("src");
        state.audio.remoteEl.load();
      } catch (_e) { }
    }
    state.audio.backend = null;
    state.audio.remoteDuration = 0;
    state.audio.isPlaying = false;
    state.audio.isPaused = false;
    state.audio.activeChunkStart = 0;
    state.audio.activeChunkLength = 0;
    resetKaraokeState();
    clearActiveTriggerButtons();
    updateAudioUi();
  }

  function ensureReadAloudPlayer(voice, language) {
    var nextVoice = String(voice || "").trim() || resolveVoiceForLanguage(language);
    var nextLanguage = normalizeLanguageCode(language) || READ_ALOUD_DEFAULT_LANGUAGE;
    if (
      state.audio.player &&
      state.audio.selectedVoice === nextVoice &&
      state.audio.selectedLanguage === nextLanguage
    ) {
      return state.audio.player;
    }
    if (state.audio.player && typeof state.audio.player.stop === "function") {
      try {
        state.audio.player.stop();
      } catch (_e) { }
    }
    if (
      !window.DualTranslationReadAloud ||
      typeof window.DualTranslationReadAloud.createMistralReadAloud !== "function"
    ) {
      throw new Error("read_aloud.js is not loaded.");
    }
    var player = window.DualTranslationReadAloud.createMistralReadAloud({
      mode: READ_ALOUD_MODE === "streaming" ? "streaming" : "preGenerated",
      endpoint: READ_ALOUD_ENDPOINT,
      format: "mp3",
      voice: nextVoice,
      language: nextLanguage,
      maxChunkChars: READ_ALOUD_MAX_CHUNK_CHARS,
      audio: ensureRemoteAudioEl()
    });
    state.audio.player = player;
    state.audio.selectedVoice = nextVoice;
    state.audio.selectedLanguage = nextLanguage;
    return player;
  }

  function waitForAudioEndOrAbort(el, signal) {
    return new Promise(function (resolve, reject) {
      var done = false;
      function cleanup() {
        el.removeEventListener("ended", onEnded);
        el.removeEventListener("error", onError);
        signal.removeEventListener("abort", onAbort);
      }
      function onEnded() {
        if (done) return;
        done = true;
        cleanup();
        resolve();
      }
      function onError() {
        if (done) return;
        done = true;
        cleanup();
        reject(new Error("Audio playback error"));
      }
      function onAbort() {
        if (done) return;
        done = true;
        cleanup();
        try {
          el.pause();
        } catch (_e) { }
        reject(new DOMException("Aborted", "AbortError"));
      }
      el.addEventListener("ended", onEnded);
      el.addEventListener("error", onError);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  async function playMistralFromListen() {
    var text = ensureAudioText();
    await playMistralText(text);
  }

  async function playMistralText(text) {
    text = String(text || "").trim();
    if (!text.length) throw new Error("No text to read");
    state.audio.text = text;
    state.audio.totalChars = text.length;
    state.audio.currentChar = 0;
    var language = guessLanguageFromPage();
    var voice = resolveVoiceForLanguage(language);
    var player = ensureReadAloudPlayer(voice, language);
    logDebug("mistral_play_start", {
      totalChars: text.length,
      hasRemoteEl: Boolean(state.audio.remoteEl),
      endpoint: READ_ALOUD_ENDPOINT,
      language: language,
      voice: voice
    });
    state.audio.backend = "remote";
    state.audio.isPlaying = true;
    state.audio.isPaused = false;
    state.audio.remoteDuration = 0;
    state.audio.activeChunkStart = 0;
    state.audio.activeChunkLength = state.audio.totalChars;
    updateAudioUi();
    await player.playText(text, {
      onChunkStart: function (ctx) {
        state.audio.backend = "remote";
        state.audio.activeChunkStart = Math.max(0, ctx.startChar || 0);
        state.audio.activeChunkLength = (ctx.chunkText || "").length;
        state.audio.currentChar = state.audio.activeChunkStart;
        state.audio.isPlaying = true;
        state.audio.isPaused = false;
        updateAudioUi();
      },
      onChunkEnd: function (ctx) {
        state.audio.currentChar = Math.min(state.audio.totalChars, Math.max(0, ctx.playedChars || 0));
        updateAudioUi();
      }
    });
    state.audio.currentChar = state.audio.totalChars;
    state.audio.isPlaying = false;
    state.audio.isPaused = false;
    state.audio.activeChunkStart = state.audio.totalChars;
    state.audio.activeChunkLength = 0;
    updateAudioUi();
  }

  function paragraphPlayIconSvg() {
    return (
      '<svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor">' +
      '<path d="M8 6.5v11a1 1 0 0 0 1.53.85l8.5-5.5a1 1 0 0 0 0-1.7l-8.5-5.5A1 1 0 0 0 8 6.5z"/>' +
      "</svg>"
    );
  }

  function createParagraphPlayButton() {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "translation-paragraph-play";
    btn.setAttribute("aria-label", "Read this paragraph aloud");
    btn.setAttribute("title", "Read this paragraph aloud");
    btn.innerHTML = paragraphPlayIconSvg();
    return btn;
  }

  function paragraphTranslateIconSvg() {
    return (
      '<svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<path d="M14.7886 17.8604C14.9264 17.4915 14.8348 17.0761 14.5547 16.7993L12.0517 14.3258L12.0867 14.2908C14.1167 12.0275 15.5634 9.42583 16.415 6.6725H18.8334C19.3856 6.6725 19.8334 6.22479 19.8334 5.6725V5.33333C19.8334 4.78105 19.3856 4.33333 18.8334 4.33333H11.6667V3C11.6667 2.44772 11.219 2 10.6667 2H10.3334C9.78107 2 9.33335 2.44772 9.33335 3V4.33333H2.16669C1.6144 4.33333 1.16669 4.78105 1.16669 5.33333V5.655C1.16669 6.20728 1.6144 6.655 2.16669 6.655H14.1984C13.4109 8.90667 12.18 11.0417 10.5 12.9083C9.55647 11.8583 8.75408 10.7288 8.09287 9.53905C7.91062 9.21113 7.56906 9 7.1939 9H7.01525C6.29036 9 5.81007 9.74616 6.15675 10.3828C6.91475 11.7747 7.84862 13.0971 8.94835 14.32L3.73138 19.4754C3.33689 19.8652 3.33501 20.5017 3.72717 20.8938L3.95958 21.1262C4.3501 21.5168 4.98327 21.5168 5.37379 21.1262L10.5 16L13.0286 18.5286C13.5433 19.0433 14.4178 18.8532 14.6725 18.1713L14.7886 17.8604ZM21.8267 11.9822C21.6803 11.5919 21.3072 11.3333 20.8904 11.3333H19.943C19.5262 11.3333 19.1531 11.5919 19.0067 11.9822L14.5067 23.9822C14.2615 24.636 14.7448 25.3333 15.443 25.3333H15.6404C16.0572 25.3333 16.4303 25.0748 16.5767 24.6845L17.6459 21.8333H23.1875L24.2567 24.6845C24.4031 25.0748 24.7762 25.3333 25.193 25.3333H25.3904C26.0886 25.3333 26.5718 24.636 26.3267 23.9822L21.8267 11.9822ZM18.5209 19.5L20.4167 14.4425L22.3125 19.5H18.5209Z" fill="var(--white,#fff)"></path>' +
      "</svg>"
    );
  }

  function createParagraphTranslateButton() {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "translation-paragraph-translate";
    btn.setAttribute("aria-label", "Translate this paragraph");
    btn.setAttribute("title", "Translate this paragraph");
    btn.innerHTML = paragraphTranslateIconSvg();
    return btn;
  }

  function openParagraphTranslationModal(p) {
    if (!p) return;
    var text = (p.textContent || "").trim();
    if (!text) return;
    var selection = window.getSelection ? window.getSelection() : null;
    if (!selection) return;
    try {
      selection.removeAllRanges();
      var range = document.createRange();
      range.selectNodeContents(p);
      selection.addRange(range);
      ["mouseup", "click", "dblclick"].forEach(function (eventName) {
        p.dispatchEvent(new MouseEvent(eventName, { bubbles: true, cancelable: true, view: window }));
      });
    } catch (_e) { }
  }

  function getParagraphPlainText(p) {
    if (!p) return "";
    var clone = p.cloneNode(true);
    var actions = clone.querySelector(".translation-paragraph-actions");
    if (actions && actions.parentNode) actions.parentNode.removeChild(actions);
    return String(clone.textContent || "").trim();
  }

  function installParagraphPlayButtons() {
    if (state.paragraphPlayInstalled) return;
    var nodes = sourceNodes();
    if (!nodes.length) return;
    state.paragraphPlayInstalled = true;
    nodes.forEach(function (p, paragraphIndex) {
      if (p.dataset.translationParagraphPlayBound === "1") return;
      p.dataset.translationParagraphPlayBound = "1";
      p.classList.add("translation-paragraph-play-host");
      var actions = document.createElement("div");
      actions.className = "translation-paragraph-actions";
      var btn = createParagraphPlayButton();
      var translateBtn = createParagraphTranslateButton();
      btn.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        var text = getParagraphPlainText(p);
        logDebug("paragraph_click", {
          paragraphIndex: paragraphIndex,
          textStart: String(text || "").slice(0, 140),
          textLength: String(text || "").length
        });
        if (!text) return;
        if (state.audio.activeParagraphBtn === btn && state.audio.remoteEl && state.audio.remoteEl.src) {
          pauseOrResumeAudio();
          return;
        }
        setActiveParagraphTriggerButton(btn);
        ensureAudioPlayer();
        showAudioPlayer();
        stopAudioPlayback();
        setActiveParagraphTriggerButton(btn);
        var karaokeDom = buildKaraokeDomMap(p);
        state.audio.karaoke.paragraphEl = p;
        state.audio.karaoke.tokenEls = karaokeDom.tokenEls;
        state.audio.karaoke.mapByTimedWordIndex = createTimedWordToDomIndexMap(
          karaokeDom.normalizedDomTokens,
          text
        );
        var paragraphLanguage = guessLanguageFromPage();
        var paragraphVoice = resolveVoiceForLanguage(paragraphLanguage);
        var player = ensureReadAloudPlayer(paragraphVoice, paragraphLanguage);
        logDebug("paragraph_player_ready", {
          paragraphIndex: paragraphIndex,
          mode: (player && typeof player.getMode === "function") ? player.getMode() : "unknown",
          language: paragraphLanguage,
          voice: paragraphVoice
        });
        if (player && typeof player.playParagraph === "function") {
          state.audio.backend = "remote";
          state.audio.isPlaying = true;
          state.audio.isPaused = false;
          state.audio.currentChar = 0;
          state.audio.text = text;
          state.audio.totalChars = text.length;
          updateAudioUi();
          player.playParagraph(text, {
            onWordChange: onKaraokeWordChange,
            paragraphIndex: paragraphIndex
          }).then(function () {
            logDebug("paragraph_play_done", { paragraphIndex: paragraphIndex });
            state.audio.currentChar = state.audio.totalChars;
            state.audio.isPlaying = false;
            state.audio.isPaused = false;
            updateAudioUi();
          }).catch(function (err) {
            if (err && err.name === "AbortError") return;
            var msg = err && err.message ? String(err.message) : String(err);
            console.error(LOG_PREFIX, "Paragraph read aloud failed:", msg);
            logWarn("paragraph_tts_error", { message: msg });
            state.audio.isPlaying = false;
            state.audio.isPaused = false;
            state.audio.backend = null;
            resetKaraokeState();
            updateAudioUi();
          });
          return;
        }
        playMistralText(text).catch(function (err) {
          if (err && err.name === "AbortError") return;
          var msg = err && err.message ? String(err.message) : String(err);
          console.error(LOG_PREFIX, "Paragraph read aloud failed:", msg);
          logWarn("paragraph_tts_error", { message: msg });
          state.audio.isPlaying = false;
          state.audio.isPaused = false;
          state.audio.backend = null;
          resetKaraokeState();
          updateAudioUi();
        });
      });
      translateBtn.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        openParagraphTranslationModal(p);
      });
      actions.appendChild(btn);
      actions.appendChild(translateBtn);
      p.appendChild(actions);
    });
  }

  function pauseOrResumeAudio() {
    if (!(state.audio.remoteEl && state.audio.remoteEl.src)) return;
    var rel = state.audio.remoteEl;
    if (state.audio.backend === "remote") {
      if (state.audio.isPlaying && !state.audio.isPaused) {
        rel.pause();
        state.audio.isPaused = true;
        updateAudioUi();
        return;
      }
      if (state.audio.isPaused || (!state.audio.isPlaying && rel.currentTime > 0)) {
        state.audio.isPlaying = true;
        state.audio.isPaused = false;
        rel.play().catch(function () { });
        updateAudioUi();
        return;
      }
    }
  }

  function seekAudioTo(charIndex) {
    var bounded = Math.max(0, Math.min(charIndex || 0, state.audio.totalChars));
    state.audio.currentChar = bounded;
    updateAudioUi();
    if (
      state.audio.backend === "remote" &&
      state.audio.remoteEl &&
      state.audio.remoteDuration > 0 &&
      state.audio.totalChars > 0
    ) {
      var rel = state.audio.remoteEl;
      var t = (bounded / state.audio.totalChars) * state.audio.remoteDuration;
      var cap = isFinite(rel.duration) && rel.duration > 0 ? rel.duration : state.audio.remoteDuration;
      try {
        rel.currentTime = Math.max(0, Math.min(t, cap));
      } catch (_e) { }
    }
  }

  function ensureAudioPlayer() {
    if (state.audio.ui) return state.audio.ui;
    var root = document.createElement("div");
    root.className = "translation-audio-player";
    root.innerHTML =
      '<div class="translation-audio-player__toolbar">' +
      '<div class="translation-audio-player__main">' +
      '<div class="translation-audio-player__adjustment">' +
      '<button type="button" class="translation-audio-player__btn translation-audio-player__btn_dialect" data-audio-action="dialect" aria-label="Dialect">' +
      "<span>EN</span>" +
      '<span class="translation-audio-player__dialect-chevron" aria-hidden="true">&#8250;</span>' +
      "</button>" +
      "</div>" +
      '<div class="translation-audio-player__control">' +
      '<button type="button" class="translation-audio-player__btn translation-audio-player__btn_square" data-audio-action="back" aria-label="Back 15 seconds">' +
      '<svg viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M14.9604 22.2852C14.4131 22.2852 14.0234 21.9048 14.0234 21.3574C14.0234 20.8193 14.4131 20.4668 14.9604 20.4668C18.5601 20.4668 21.4453 17.5908 21.4453 14.0005C21.4453 10.4102 18.5601 7.53418 14.9604 7.53418C11.3423 7.53418 8.47559 10.3823 8.47559 13.9727C8.47559 14.585 8.52197 15.1509 8.62402 15.624L11.1289 13.1006C11.3052 12.9336 11.5 12.8408 11.7412 12.8408C12.2515 12.8408 12.6411 13.2305 12.6411 13.7222C12.6411 13.9912 12.5576 14.2046 12.3906 14.3623L8.5498 18.166C8.35498 18.3608 8.13232 18.4536 7.88184 18.4536C7.64062 18.4536 7.39941 18.3516 7.21387 18.166L3.34521 14.3623C3.16895 14.2046 3.07617 13.9819 3.07617 13.7222C3.07617 13.2305 3.48438 12.8408 3.98535 12.8408C4.22656 12.8408 4.43994 12.9336 4.60693 13.0913L6.82422 15.3364C6.74072 14.9282 6.69434 14.4551 6.69434 13.9727C6.69434 9.38037 10.3682 5.71582 14.9604 5.71582C19.562 5.71582 23.2637 9.4082 23.2637 14.0005C23.2637 18.5928 19.562 22.2852 14.9604 22.2852Z" fill="currentColor"></path></svg>' +
      "</button>" +
      '<button type="button" class="translation-audio-player__btn translation-audio-player__btn_play" data-audio-action="play-pause" aria-label="Play or pause">Play</button>' +
      '<button type="button" class="translation-audio-player__btn translation-audio-player__btn_square" data-audio-action="stop" aria-label="Stop playback">' +
      '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="5.5" y="5.5" width="9" height="9" rx="1.5" fill="currentColor"></rect></svg>' +
      "</button>" +
      '<button type="button" class="translation-audio-player__btn translation-audio-player__btn_square" data-audio-action="forward" aria-label="Forward 15 seconds">' +
      '<svg viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M13.0396 5.71484C17.6318 5.71484 21.3057 9.38867 21.3057 13.9717C21.3057 14.4541 21.2593 14.9272 21.1758 15.3354L23.3931 13.0903C23.5601 12.9326 23.7734 12.8491 24.0146 12.8491C24.5156 12.8491 24.9238 13.2295 24.9238 13.7305C24.9238 13.9902 24.8311 14.2036 24.6548 14.3613L20.7861 18.1743C20.6006 18.3599 20.3594 18.4619 20.1182 18.4619C19.8677 18.4619 19.645 18.3691 19.4502 18.1743L15.6094 14.3613C15.4424 14.2036 15.3589 13.9902 15.3589 13.7305C15.3589 13.2295 15.7485 12.8491 16.2588 12.8491C16.5 12.8491 16.6948 12.9326 16.8711 13.0996L19.376 15.623C19.478 15.1499 19.5244 14.584 19.5244 13.9717C19.5244 10.3906 16.6577 7.5332 13.0396 7.5332C9.43994 7.5332 6.55469 10.4092 6.55469 13.9995C6.55469 17.5898 9.43994 20.4751 13.0396 20.4751C13.5869 20.4751 13.9766 20.8276 13.9766 21.3564C13.9766 21.9038 13.5869 22.2842 13.0396 22.2842C8.43799 22.2842 4.73633 18.5918 4.73633 13.9995C4.73633 9.40723 8.43799 5.71484 13.0396 5.71484Z" fill="currentColor"></path></svg>' +
      "</button>" +
      "</div>" +
      '<div class="translation-audio-player__close">' +
      '<button type="button" class="translation-audio-player__btn translation-audio-player__btn_square" data-audio-action="close" aria-label="Close player">' +
      '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M12.7141 4.22865C12.9744 3.9683 12.9744 3.54619 12.7141 3.28584C12.4537 3.02549 12.0316 3.02549 11.7712 3.28584L8.00001 7.05708L4.22877 3.28584C3.96842 3.02549 3.54631 3.02549 3.28596 3.28584C3.02561 3.54619 3.02561 3.9683 3.28596 4.22865L7.0572 7.99988L3.28596 11.7711C3.02561 12.0315 3.02561 12.4536 3.28596 12.7139C3.54631 12.9743 3.96842 12.9743 4.22877 12.7139L8.00001 8.94269L11.7712 12.7139C12.0316 12.9743 12.4537 12.9743 12.7141 12.7139C12.9744 12.4536 12.9744 12.0315 12.7141 11.7711L8.94281 7.99988L12.7141 4.22865Z" fill="currentColor"></path></svg>' +
      "</button>" +
      "</div>" +
      "</div>" +
      '<div class="translation-audio-player__progress">' +
      '<span class="translation-audio-player__time" data-audio-time="current">0:00</span>' +
      '<input class="translation-audio-player__seek" type="range" min="0" max="0" value="0" step="1" data-audio-seek="1" aria-label="Playback progress" />' +
      '<span class="translation-audio-player__time translation-audio-player__time_total" data-audio-time="total">0:00</span>' +
      "</div>" +
      "</div>";
    document.body.appendChild(root);
    state.audio.ui = {
      root: root,
      playPause: root.querySelector('[data-audio-action="play-pause"]'),
      back: root.querySelector('[data-audio-action="back"]'),
      forward: root.querySelector('[data-audio-action="forward"]'),
      stop: root.querySelector('[data-audio-action="stop"]'),
      close: root.querySelector('[data-audio-action="close"]'),
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
    if (state.audio.ui.stop) {
      state.audio.ui.stop.addEventListener("click", function () {
        stopAudioPlayback();
        state.audio.currentChar = 0;
        updateAudioUi();
      });
    }
    if (state.audio.ui.close) {
      state.audio.ui.close.addEventListener("click", function () {
        stopAudioPlayback();
        state.audio.currentChar = 0;
        root.classList.remove("translation-audio-player_visible");
        updateAudioUi();
      });
    }
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
    var listenBtn = getListenButton();
    if (!listenBtn) {
      if (!listenInstallInfoLogged.noButton) {
        listenInstallInfoLogged.noButton = true;
        console.info(
          LOG_PREFIX +
          " Listen: Gradio is configured but the Listen button was not found yet (will retry). " +
          "If this never binds, check devtools for app-listen-button or .listen-button."
        );
      }
      return;
    }
    if (listenBtn.dataset.dualTranslationAudioBound === "1") return;
    listenBtn.dataset.dualTranslationAudioBound = "1";
    console.info(LOG_PREFIX + " Listen: Voice API hook attached to button.");
    listenBtn.addEventListener(
      "click",
      function (event) {
        event.preventDefault();
        event.stopPropagation();
        if (state.audio.activeListenBtn === listenBtn && state.audio.remoteEl && state.audio.remoteEl.src) {
          stopAudioPlayback();
          state.audio.currentChar = 0;
          updateAudioUi();
          return;
        }
        setActiveListenTriggerButton(listenBtn);
        console.log(LOG_PREFIX + " Listen click — calling Mistral Voxtral streaming TTS.");
        var reqGen = ++state.audio.listenRequestGen;
        setListenLoading(listenBtn, true);
        ensureAudioPlayer();
        showAudioPlayer();
        ensureAudioText();
        stopAudioPlayback();
        setActiveListenTriggerButton(listenBtn);
        playMistralFromListen()
          .catch(function (err) {
            if (err && err.name === "AbortError") return;
            var msg = err && err.message ? String(err.message) : String(err);
            console.error(LOG_PREFIX, "Mistral Voxtral TTS failed:", msg);
            logWarn("mistral_tts_error", { message: msg });
            state.audio.isPlaying = false;
            state.audio.isPaused = false;
            state.audio.backend = null;
            updateAudioUi();
          })
          .finally(function () {
            if (reqGen === state.audio.listenRequestGen) {
              setListenLoading(listenBtn, false);
            }
          });
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
    button.className = "translation-mode-button translation-mode-button_dual";
    button.setAttribute("aria-label", "Toggle side-by-side French translation");
    button.setAttribute("title", "Toggle side-by-side translation");
    button.setAttribute("data-tooltip", "Toggle side-by-side translation");
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
    button.setAttribute("title", "Toggle interactive mode");
    button.setAttribute("data-tooltip", "Toggle interactive mode");
    button.setAttribute("aria-pressed", "true");
    button.innerHTML =
      '<svg class="translation-mode-logo" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">' +
      '<g clip-path="url(#translation-interactive-icon-clip)">' +
      '<path d="M6 16H9.33333M16 6V9.33333M11.3333 11.3333L8.88889 8.88889M20.6667 11.3333L23.1111 8.88889M11.3333 20.6667L8.88889 23.1111M16 16L26 19.3333L21.5556 21.5556L19.3333 26L16 16Z" stroke="#607D8B" stroke-width="2.22222" stroke-linecap="round" stroke-linejoin="round"></path>' +
      "</g>" +
      "<defs>" +
      '<clipPath id="translation-interactive-icon-clip"><rect width="24" height="24" fill="white" transform="translate(4 4)"></rect></clipPath>' +
      "</defs>" +
      "</svg>";
    return button;
  }

  function syncHoverToggleUi(hoverBtn) {
    var btn = hoverBtn || state.hoverToggleButton;
    if (!btn) return;
    var on = isHoverWordMappingEnabled();
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.classList.toggle("translation-mode-button_active", on);
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

    state.dualRowByIndex = Object.create(null);

    var wrap = document.createElement("div");
    wrap.className = "translation-inline-wrap";

    var bisect = document.createElement("div");
    bisect.className = "translation-inline-bisect";

    var titleEl = document.createElement("div");
    titleEl.className = "translation-inline-trans__title";
    titleEl.setAttribute("role", "heading");
    titleEl.setAttribute("aria-level", "2");
    titleEl.textContent = "Translation";
    bisect.appendChild(titleEl);

    for (var i = 0; i < nodes.length; i += 1) {
      var row = document.createElement("div");
      row.className = "translation-inline-row";

      var left = document.createElement("div");
      left.className = "translation-inline-col translation-inline-orig";
      var right = document.createElement("div");
      right.className = "translation-inline-col translation-inline-trans";
      if (i === 0) right.classList.add("translation-inline-trans_first");

      var gridRow = String(i + 2);
      left.style.gridColumn = "1";
      left.style.gridRow = gridRow;
      right.style.gridColumn = "2";
      right.style.gridRow = gridRow;

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
      bisect.appendChild(row);

      var sourceText = (nodes[i].textContent || "").trim();
      var sourceTokens = renderTokenizedParagraph(pL, sourceText, "source", i);
      var rowData = {
        sourceP: pL,
        targetP: pR,
        sourceTokens: sourceTokens,
        targetTokens: []
      };
      state.rowMap.set(row, rowData);
      state.dualRowByIndex[String(i)] = rowData;
    }
    wrap.appendChild(bisect);

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
    if (state.inlineWrap) {
      state.inlineWrap.classList.toggle("translation-inline-wrap_open", isOpen);
      setSourceVisibility(isOpen);
    }
    syncHoverToggleUi();
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
    var rowData = getRowDataForToken(tokenEl);
    if (!rowData) return;
    var side = tokenEl.getAttribute("data-side");
    var tokenIndex = Number(tokenEl.getAttribute("data-token-index"));
    var sourceToken;
    var targetMatchIdx = -1;
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
        logDebug("hover_match_token", {
          sourceRaw: sourceToken.raw,
          translatedNorm: translatedNorm,
          targetRaw: rowData.targetTokens[targetMatchIdx].raw,
          targetNorm: rowData.targetTokens[targetMatchIdx].norm,
          targetIndex: targetMatchIdx
        });
        state.activeHighlight = null;
      } else if (rowData.targetP) {
        logWarn("hover_match_fallback_sentence", {
          sourceRaw: sourceToken.raw,
          sourceNorm: sourceToken.norm,
          translatedNorm: translatedNorm
        });
        state.activeHighlight = null;
      } else {
        state.activeHighlight = null;
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
        logDebug("hover_reverse_match_token", {
          targetRaw: targetToken.raw,
          sourceRaw: rowData.sourceTokens[targetMatchIdx].raw,
          sourceIndex: targetMatchIdx
        });
        state.activeHighlight = null;
      } else {
        logWarn("hover_reverse_no_match", { targetRaw: targetToken.raw, targetNorm: targetToken.norm });
        state.activeHighlight = null;
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

  function normalizeHistoryWord(word) {
    return String(word || "")
      .trim()
      .toLowerCase();
  }

  function createHistoryItemElement(word) {
    var template = document.querySelector(".history-sidebar__list app-history-item");
    var host = template
      ? template.cloneNode(true)
      : document.createElement("app-history-item");
    if (!template) {
      var scope = getHistoryItemScopeAttrs();
      host.innerHTML =
        '<div class="history-item">' +
        '<div class="history-item__top">' +
        '<div class="history-item__top-left"><span class="history-item__word"></span></div>' +
        "</div>" +
        '<div class="history-item__bottom"><span class="history-item__translations"></span></div>' +
        "</div>";
      if (scope.hostAttr) host.setAttribute(scope.hostAttr, "");
      if (scope.contentAttr) applyScopedContentAttr(host, scope.contentAttr);
    }
    var wordEl = host.querySelector(".history-item__word");
    if (wordEl) wordEl.textContent = word;
    var translationsEl = host.querySelector(".history-item__translations");
    if (translationsEl && !String(translationsEl.textContent || "").trim()) {
      translationsEl.textContent = " ";
    }
    return host;
  }

  function applyScopedContentAttr(root, attrName) {
    if (!root || !attrName) return;
    if (root.setAttribute) root.setAttribute(attrName, "");
    var all = root.querySelectorAll ? root.querySelectorAll("*") : [];
    Array.prototype.forEach.call(all, function (el) {
      el.setAttribute(attrName, "");
    });
  }

  function getHistoryItemScopeAttrs() {
    var out = { hostAttr: "", contentAttr: "" };
    var styleTags = document.querySelectorAll("style");
    var re = /\[_nghost-([^\]]+)\]\s+\.history-item__word\[_ngcontent-\1\]/;
    for (var i = 0; i < styleTags.length; i += 1) {
      var css = styleTags[i].textContent || "";
      var m = css.match(re);
      if (!m || !m[1]) continue;
      out.hostAttr = "_nghost-" + m[1];
      out.contentAttr = "_ngcontent-" + m[1];
      return out;
    }
    return out;
  }

  function ensureHistoryWordCacheFromDom() {
    var words = document.querySelectorAll(".history-item__word");
    Array.prototype.forEach.call(words, function (el) {
      var key = normalizeHistoryWord(el.textContent);
      if (key) state.historyWords.add(key);
    });
  }

  function syncHistoryCountFromDom() {
    var list = document.querySelector(".history-sidebar__list");
    if (!list) return;
    var countEl = document.querySelector(".reading-view-header__history-count");
    if (!countEl) return;
    var itemCount = list.querySelectorAll("app-history-item .history-item__word").length;
    countEl.textContent = String(itemCount);
  }

  function removeDuplicateHistoryEntries() {
    var list = document.querySelector(".history-sidebar__list");
    if (!list) return;
    var items = list.querySelectorAll("app-history-item");
    var seen = new Set();
    Array.prototype.forEach.call(items, function (item) {
      var wordEl = item.querySelector(".history-item__word");
      var key = normalizeHistoryWord(wordEl ? wordEl.textContent : "");
      if (!key) return;
      if (seen.has(key)) {
        item.remove();
        return;
      }
      seen.add(key);
    });
    state.historyWords = seen;
    syncHistoryCountFromDom();
  }

  function addWordToHistorySidebar(word) {
    var clean = String(word || "").trim();
    if (!clean) return;
    var key = normalizeHistoryWord(clean);
    if (!key) return;
    removeDuplicateHistoryEntries();
    ensureHistoryWordCacheFromDom();
    if (state.historyWords.has(key)) return;
    var list = document.querySelector(".history-sidebar__list");
    if (!list) return;
    var added = createHistoryItemElement(clean);
    list.appendChild(added);
    added.classList.add("translation-history-item_just-added");
    // Keep latest added word visible when list overflows.
    if (typeof added.scrollIntoView === "function") {
      added.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
    if (typeof list.scrollTop === "number" && typeof list.scrollHeight === "number") {
      list.scrollTop = list.scrollHeight;
    }
    setTimeout(function () {
      added.classList.remove("translation-history-item_just-added");
    }, 1200);
    state.historyWords.add(key);
    syncHistoryCountFromDom();
  }

  function installHistoryDedupObserver() {
    var list = document.querySelector(".history-sidebar__list");
    if (!list || list.dataset.dualTranslationDedupInstalled === "1") return;
    list.dataset.dualTranslationDedupInstalled = "1";
    removeDuplicateHistoryEntries();
    var observer = new MutationObserver(function () {
      removeDuplicateHistoryEntries();
    });
    observer.observe(list, { childList: true, subtree: true });
  }

  function readWordFromClickEvent(event) {
    var selected = String(window.getSelection ? window.getSelection().toString() : "").trim();
    if (selected) {
      var first = selected.split(/\s+/)[0] || "";
      return first.replace(/^[^A-Za-zÀ-ÿ']+|[^A-Za-zÀ-ÿ']+$/g, "");
    }
    var tokenEl = event && event.target && event.target.closest
      ? event.target.closest(".translation-token")
      : null;
    if (tokenEl) return String(tokenEl.textContent || "").trim();
    return "";
  }

  function onReaderWordActivate(event) {
    if (
      event &&
      event.target &&
      event.target.closest &&
      (
        event.target.closest(".translation-paragraph-play") ||
        event.target.closest(".translation-paragraph-translate")
      )
    ) {
      return;
    }
    var root = getReadingHoverRoot();
    if (!root || !root.contains(event.target)) return;
    // Single-click selection can be applied after the event dispatch.
    setTimeout(function () {
      var word = readWordFromClickEvent(event);
      if (!word) return;
      addWordToHistorySidebar(word);
    }, 0);
  }

  async function openMode(button) {
    if (!isDualTranslationEnabled()) return;
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

    var hoverBtn = createHoverToggleButton();
    var openBtn = isDualTranslationEnabled() ? createToggleButton() : null;
    var darkBtn = findDarkModeBtn();
    var darkHost = darkBtn && typeof darkBtn.closest === "function" ? darkBtn.closest("app-button") : null;
    if (darkHost && darkHost.parentElement) {
      darkHost.insertAdjacentElement("afterend", hoverBtn);
      if (openBtn) hoverBtn.insertAdjacentElement("afterend", openBtn);
    } else if (darkBtn && darkBtn.parentElement) {
      darkBtn.insertAdjacentElement("afterend", hoverBtn);
      if (openBtn) hoverBtn.insertAdjacentElement("afterend", openBtn);
    } else {
      var header = document.querySelector("header.reading-view-header") || document.querySelector("header");
      if (header) {
        header.appendChild(hoverBtn);
        if (openBtn) header.appendChild(openBtn);
      } else {
        document.body.appendChild(hoverBtn);
        if (openBtn) document.body.appendChild(openBtn);
      }
    }

    state.hoverToggleButton = hoverBtn;
    state.dualToggleButton = openBtn;
    syncHoverToggleUi();

    function onMobileDualViewportChange() {
      closeDualIfMobileViewport();
    }
    if (mobileDualMql) {
      if (typeof mobileDualMql.addEventListener === "function") {
        mobileDualMql.addEventListener("change", onMobileDualViewportChange);
      } else if (typeof mobileDualMql.addListener === "function") {
        mobileDualMql.addListener(onMobileDualViewportChange);
      }
    } else {
      window.addEventListener("resize", onMobileDualViewportChange);
    }
    onMobileDualViewportChange();

    hoverBtn.addEventListener("click", function () {
      window[HOVER_FEATURE_FLAG] = !isHoverWordMappingEnabled();
      syncHoverToggleUi();
      clearActiveHighlight();
      logDebug("hover_toggle_click", { enabled: isHoverWordMappingEnabled() });
    });

    if (openBtn) {
      openBtn.addEventListener("click", function () {
        if (isMobileViewport()) return;
        if (state.isOpen) closeMode(openBtn);
        else openMode(openBtn);
      });
    }

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && state.isOpen) closeMode(openBtn);
    });
    document.addEventListener("click", onReaderWordActivate, true);
    document.addEventListener("dblclick", onReaderWordActivate, true);

    installHistoryToggleFix();
    installHistoryDedupObserver();
    installListenButtonAudioWatcher();
    attachSingleModeHoverHandlers();
    installParagraphPlayButtons();

    if (openBtn && shouldAutoOpenDualOnLoad() && !isMobileViewport()) {
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
