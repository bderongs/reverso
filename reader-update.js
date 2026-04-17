(function () {
  "use strict";

  var STYLE_ID = "translation-mode-style";
  var LOG_PREFIX = "[dual-translation]";
  var HOVER_FEATURE_FLAG = "DUAL_TRANSLATION_HOVER_WORD_MAP";
  var INTER_FONT_ID = "translation-hover-inter-font";
  var HOVER_POPOVER_ID = "translation-hover-popover-root";
  var QUICK_SEARCH_IMAGE_PATH = "quick_search.png";
  var QUICK_SEARCH_DEMO_MODAL_ID = "translation-quick-search-demo-modal-root";
  var PARAGRAPH_SEARCH_IMAGE_PATH = "paragraph_search.png";
  var PARAGRAPH_DEMO_MODAL_ID = "translation-paragraph-demo-modal-root";
  var ARTICLE_VOCAB_GLOBAL = "READER_ARTICLE_VOCAB";
  var VOCAB_MARKUP_CLASS = "vocab-word";
  var VOCAB_MARKUP_INDEX_ATTR = "data-vocab-index";
  var VOCAB_TOOLTIP_TEXT = "This word comes from a vocabulary list";
  var PRACTICE_SAVED_WORDS_MIN = 3;
  var READ_ALOUD_CONFIG = window.READ_ALOUD_VOICE_CONFIG || {};
  var READ_ALOUD_ENDPOINT = "/read-aloud/stream";
  var READ_ALOUD_MAX_CHUNK_CHARS = 2000;
  var READ_ALOUD_MODE = String(window.READ_ALOUD_MODE || "preGenerated");
  var READ_ALOUD_DEFAULT_LANGUAGE = READ_ALOUD_CONFIG.defaultLanguage || "en-US";
  var READ_ALOUD_DEFAULT_VOICE = READ_ALOUD_CONFIG.defaultVoice || "en_paul_neutral";
  var READ_ALOUD_VOICE_BY_LANGUAGE = READ_ALOUD_CONFIG.byLanguage || {};
  var READ_ALOUD_PREGENERATED_AUDIO_URL = READ_ALOUD_CONFIG.preGeneratedAudioUrl || "/reader_v2.mp3";
  var READ_ALOUD_PREGENERATED_AUDIO_BY_LANGUAGE =
    READ_ALOUD_CONFIG.preGeneratedAudioByLanguage || {
      "en-us": READ_ALOUD_CONFIG.preGeneratedAudioUrlUs || "/reader_v2_us.mp3",
      "en-gb": READ_ALOUD_PREGENERATED_AUDIO_URL
    };
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
    quickSearchDemoModalEl: null,
    paragraphDemoModalEl: null,
    historyWords: new Set(),
    articleVocab: null,
    vocabPreview: {
      tokenEl: null,
      vocabIndex: null
    },
    mobileSelection: {
      installed: false,
      selectedParagraph: null,
      locked: false,
      /** Helps avoid flicker when scrolling. */
      lastSelectedAtMs: 0
    },
    mobileCommandBar: {
      installed: false,
      root: null,
      playBtn: null,
      accentBtn: null,
      speedBtn: null,
      translateBtn: null,
      collapseBtn: null,
      expandBtn: null,
      collapsed: false,
      lastPlayedParagraph: null
    },
    mobileTranslateSheet: {
      installed: false,
      open: false
    },
    mobileHeaderAutoHide: {
      installed: false,
      hidden: false
    },
    audio: {
      text: "",
      totalChars: 0,
      currentChar: 0,
      isPlaying: false,
      isPaused: false,
      rate: 1,
      accent: "US",
      lang: "en-US",
      ui: null,
      backend: null,
      remoteEl: null,
      remoteDuration: 0,
      player: null,
      listenRequestGen: 0,
      activeChunkStart: 0,
      activeChunkLength: 0,
      /** When > 0, map `currentTime` between these seconds for progress (paragraph / slice playback). */
      progressMediaStart: 0,
      progressMediaEnd: 0,
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
          "  Hover hints are enabled by default.",
          "  You can still override via: window.DUAL_TRANSLATION_HOVER_WORD_MAP = true|false",
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
      ".translation-token_vocab{background:#c9e3fb}" +
      ".translation-token_vocab-focus{background:#b7daf9!important;box-shadow:0 0 0 2px rgba(102,153,204,.35);border-radius:6px}" +
      ".translation-token_karaoke{background:rgba(21,124,213,.28)!important}" +
      ".translation-token_pop{background:#fef9c3!important;border-radius:4px}" +
      ".translation-token_saved{background:#e6dfd5!important;border-radius:4px}" +
      ".translation-hover-popover{position:fixed;z-index:100000;box-sizing:border-box;width:min(360px,calc(100vw - 24px));max-width:360px;padding:10px;background:#fff;border-radius:18px;box-shadow:0 4px 12px rgba(0,0,0,.1),0 12px 28px rgba(0,0,0,.06);font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:15px;line-height:1.45;color:#1f2937;pointer-events:auto;opacity:0;visibility:hidden;transition:opacity .12s ease}" +
      ".translation-hover-popover_visible{opacity:1;visibility:visible}" +
      ".translation-hover-popover__demo-wrap{display:block}" +
      ".translation-hover-popover__demo-header{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 2px 8px;flex-shrink:0}" +
      ".translation-hover-popover__demo-label{font:600 12px/1.2 Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:var(--text-base-secondary,#607d8b)}" +
      ".translation-hover-popover__demo-close{border:none;background:transparent;padding:0;margin:0;font:600 12px/1.2 Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:var(--new-blue-700,#2a8bdf);text-decoration:underline;cursor:pointer}" +
      ".translation-hover-popover__demo-toggle{display:none}" +
      ".translation-hover-popover__demo-image{display:block;width:100%;height:auto;border-radius:12px}" +
      ".translation-hover-popover__demo-caption{margin:8px 4px 2px;font-size:12px;line-height:1.3;color:var(--text-base-secondary,#607d8b);text-align:center}" +
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
      ".translation-audio-player{position:fixed;left:0;right:clamp(320px,28vw,420px);bottom:0;z-index:900;display:none;box-sizing:border-box}" +
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
      "@media only screen and (max-width:1023px){" +
      ".translation-audio-player{" +
      "left:0!important;right:0!important;width:100vw!important;max-width:100vw!important;min-width:0!important;" +
      "margin:0!important;overflow-x:hidden!important;box-sizing:border-box!important" +
      "}" +
      ".translation-audio-player__toolbar{padding:0 8px 8px;box-sizing:border-box!important;overflow-x:hidden!important}" +
      ".translation-audio-player__main,.translation-audio-player__progress{min-width:0;max-width:100%;box-sizing:border-box}" +
      ".translation-audio-player__control{gap:8px}" +
      ".highlight-overlay{" +
      "left:0!important;right:0!important;width:100vw!important;max-width:100vw!important;" +
      "overflow-x:hidden!important;pointer-events:none!important;box-sizing:border-box!important" +
      "}" +
      ".highlight-overlay .listening-highlight-element{" +
      "max-width:calc(100vw - 12px)!important;box-sizing:border-box!important" +
      "}" +
      "}" +
      ".translation-listen-spinner{display:inline-flex;align-items:center;vertical-align:middle;flex-shrink:0;margin-left:6px;width:18px;height:18px;opacity:0;pointer-events:none;transition:opacity .15s ease}" +
      ".translation-listen-spinner_visible{opacity:1}" +
      ".translation-listen-spinner__ring{width:16px;height:16px;border:2px solid var(--line-gray-primary,#d4d9e3);border-top-color:var(--new-blue-700,#2a8bdf);border-radius:50%;box-sizing:border-box;animation:translation-listen-spin .65s linear infinite}" +
      "@keyframes translation-listen-spin{to{transform:rotate(360deg)}}" +
      ".translation-paragraph-play-host{position:relative}" +
      ".translation-paragraph-play-host::before{" +
      "content:'';position:absolute;left:-44px;top:0;bottom:0;width:44px;" +
      "}" +
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
      ".translation-history-vocab-badge{" +
      "display:inline-flex;align-items:center;justify-content:center;" +
      "width:16px;height:16px;margin-left:6px;border:0;border-radius:999px;background:transparent;color:#0A6CC2;cursor:help;position:relative;padding:0;vertical-align:middle;" +
      "}" +
      ".translation-history-vocab-badge svg{display:block;width:14px;height:14px}" +
      ".translation-history-vocab-badge[data-tooltip]:hover::after,.translation-history-vocab-badge[data-tooltip]:focus-visible::after{" +
      "content:attr(data-tooltip);position:absolute;left:50%;top:calc(100% + 6px);transform:translateX(-50%);" +
      "padding:5px 8px;border-radius:6px;background:rgba(20,24,31,.92);color:#fff;white-space:nowrap;" +
      "font:500 12px/1.2 Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;" +
      "z-index:100001;pointer-events:none;box-shadow:0 6px 18px rgba(0,0,0,.22)" +
      "}" +
      ".translation-history-vocab-badge:focus-visible{outline:2px solid var(--new-blue-700,#2a8bdf);outline-offset:1px}" +
      ".translation-vocab-section{" +
      "display:block;margin-top:14px;padding:12px 0 8px;border-top:1px solid var(--line-gray-primary,#dee4e7);" +
      "height:auto;max-height:none;overflow:visible" +
      "}" +
      ".translation-vocab-section__title{" +
      "margin:0 0 10px;font:700 12px/1.2 Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;" +
      "letter-spacing:.04em;text-transform:uppercase;color:#3f5f7a" +
      "}" +
      ".translation-vocab-section__list{" +
      "display:flex;flex-wrap:wrap;gap:8px;align-items:flex-start;overflow:visible;" +
      "height:auto;max-height:none" +
      "}" +
      ".translation-vocab-item{" +
      "display:inline-flex;align-items:center;box-sizing:border-box;height:auto;min-height:0;" +
      "border-radius:12px;padding:6px 14px;" +
      "font:600 13px/1.2 Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;" +
      "white-space:nowrap;color:#3d4d5d;background:#e8f2fb;border:1px solid #d8e8f7;cursor:pointer;transition:background-color .12s ease,color .12s ease,box-shadow .12s ease" +
      "}" +
      ".translation-vocab-item:hover{background:#deecf9}" +
      ".translation-vocab-item:focus-visible{outline:2px solid #7aa7d1;outline-offset:1px}" +
      ".translation-reading-stats{" +
      "margin:20px 0 10px;padding:16px;border:1px solid #d9e9f8;border-radius:16px;background:linear-gradient(180deg,#f8fcff 0%,#f2f9ff 100%);" +
      "box-shadow:0 2px 8px rgba(10,108,194,.08)" +
      "}" +
      ".translation-reading-stats__top{display:flex;align-items:center;gap:14px}" +
      ".translation-reading-stats__ring{" +
      "width:56px;height:56px;border-radius:999px;display:flex;align-items:center;justify-content:center;position:relative;flex:0 0 56px;" +
      "background:conic-gradient(#0a6cc2 var(--reading-stats-progress,0%), #d7e8f9 0%)" +
      "}" +
      ".translation-reading-stats__ring::after{" +
      "content:'';position:absolute;inset:6px;border-radius:999px;background:#fff" +
      "}" +
      ".translation-reading-stats__ring-value{" +
      "position:relative;z-index:1;font:700 14px/1 Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#0a6cc2" +
      "}" +
      ".translation-reading-stats__badge{" +
      "display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:999px;" +
      "background:#e8f3fc;color:#0a6cc2;margin-bottom:4px" +
      "}" +
      ".translation-reading-stats__badge svg{display:block;width:14px;height:14px}" +
      ".translation-reading-stats__title-row{display:flex;align-items:center;gap:8px}" +
      ".translation-reading-stats__title{" +
      "margin:0;font:700 17px/1.25 Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#0f3556" +
      "}" +
      ".translation-reading-stats__subtitle{" +
      "margin:2px 0 0;font:500 13px/1.35 Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#4f6b82" +
      "}" +
      ".translation-reading-stats__cta{" +
      "width:100%;margin-top:14px;border:0;border-radius:999px;min-height:42px;padding:10px 16px;cursor:pointer;" +
      "font:700 14px/1.2 Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;" +
      "background:linear-gradient(90deg,#0a6cc2 0%,#157cd5 100%);color:#fff;transition:filter .15s ease,opacity .15s ease" +
      "}" +
      ".translation-reading-stats__cta:hover{filter:brightness(1.04)}" +
      ".translation-reading-stats__cta:focus-visible{outline:2px solid #7aa7d1;outline-offset:2px}" +
      ".translation-reading-stats__cta:disabled,.translation-reading-stats__cta_disabled{" +
      "cursor:not-allowed;background:#c8d8e8;color:#35506a;filter:none" +
      "}" +
      ".translation-reading-stats__hint{" +
      "margin:8px 2px 0;font:500 12px/1.3 Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#607d96" +
      "}" +
      ".translation-reading-stats_mastered{border-color:#cde8d6;background:linear-gradient(180deg,#f6fff9 0%,#eefbf3 100%);box-shadow:0 2px 10px rgba(10,152,89,.12)}" +
      ".translation-reading-stats_mastered .translation-reading-stats__ring{background:conic-gradient(#10b981 var(--reading-stats-progress,0%), #d9f1e3 0%)}" +
      ".translation-reading-stats_mastered .translation-reading-stats__ring-value{color:#0e9a58}" +
      ".translation-reading-stats_mastered .translation-reading-stats__badge{background:#dcfce7;color:#0e9a58}" +
      ".translation-reading-stats_mastered .translation-reading-stats__title{color:#0f5132}" +
      ".translation-reading-stats_mastered .translation-reading-stats__subtitle{color:#2d6a4f}" +
      ".translation-reading-stats_mastered .translation-reading-stats__cta{background:linear-gradient(90deg,#0e9a58 0%,#13b56a 100%)}" +
      ".history-sidebar .history-sidebar__list{overflow:auto}" +
      ".translation-paragraph_selected{position:relative;background:rgba(250,204,21,.10);border-radius:10px}" +
      ".translation-paragraph_selected::before{content:'';position:absolute;left:-12px;top:8px;bottom:8px;width:3px;border-radius:999px;background:rgba(250,204,21,.55)}" +
      "body.translation-mobile-commandbar-open .reading-list__content{padding-bottom:132px}" +
      "body.translation-mobile-commandbar-open.translation-mobile-commandbar-collapsed .reading-list__content{padding-bottom:72px}" +
      ".translation-mobile-commandbar{position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom, 0px));z-index:950;display:none;box-sizing:border-box;max-width:calc(100vw - 24px);overflow-x:hidden}" +
      ".translation-mobile-commandbar_visible{display:block}" +
      ".translation-mobile-commandbar_collapsed{left:50%;right:auto;transform:translateX(-50%);max-width:unset;overflow:visible}" +
      ".translation-mobile-commandbar__inner{" +
      "display:flex;align-items:center;justify-content:space-between;gap:10px;" +
      "position:relative;" +
      "padding:12px 12px 10px;border-radius:16px;" +
      "background:var(--background-base-secondary,#fcf4e9);color:var(--text-base-primary,#1a1a1a);" +
      "border:1px solid var(--line-gray-primary,#dee4e7);" +
      "box-shadow:0 -1px 16px 0 var(--light-grey-a-2,rgba(34,44,49,.1));" +
      "max-width:100%;box-sizing:border-box;overflow:hidden" +
      "}" +
      ".translation-mobile-commandbar_collapsed .translation-mobile-commandbar__inner{display:none}" +
      ".translation-mobile-commandbar__hint{font:600 13px/1.2 Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:var(--text-base-secondary,#607d8b);margin-right:auto;padding-right:30px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".translation-mobile-commandbar__collapse{" +
      "appearance:none;border:0;background:transparent;color:var(--text-base-secondary,#607d8b);" +
      "position:absolute;top:6px;right:6px;" +
      "width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;border-radius:999px;cursor:pointer" +
      "}" +
      ".translation-mobile-commandbar__collapse:hover{background:var(--line-gray-secondary,#eaeef1)}" +
      ".translation-mobile-commandbar__collapse svg{display:block;width:18px;height:18px}" +
      ".translation-mobile-commandbar__expand{" +
      "display:none;appearance:none;border:1px solid var(--line-gray-primary,#d4d9e3);" +
      "background:#472c1f;color:#fff;border-radius:999px;" +
      "width:44px;height:44px;align-items:center;justify-content:center;cursor:pointer;" +
      "box-shadow:0 -1px 16px 0 var(--light-grey-a-2,rgba(34,44,49,.18));-webkit-tap-highlight-color:transparent" +
      "}" +
      ".translation-mobile-commandbar__expand svg{display:block;width:18px;height:18px}" +
      ".translation-mobile-commandbar_collapsed .translation-mobile-commandbar__expand{display:inline-flex}" +
      ".translation-mobile-commandbar__group{display:flex;align-items:center;gap:10px}" +
      ".translation-mobile-commandbar__btn{" +
      "appearance:none;" +
      "width:44px;min-width:44px;height:44px;" +
      "border:1px solid var(--line-gray-primary,#d4d9e3);" +
      "border-radius:999px;" +
      "display:inline-flex;align-items:center;justify-content:center;" +
      "background:#472c1f;color:#fff;" +
      "cursor:pointer;box-shadow:0 1px 2px rgba(0,0,0,.06);" +
      "-webkit-tap-highlight-color:transparent" +
      "}" +
      ".translation-mobile-commandbar__btn:hover{opacity:.95}" +
      ".translation-mobile-commandbar__btn:active{transform:translateY(1px)}" +
      ".translation-mobile-commandbar__btn:focus-visible{outline:2px solid var(--new-blue-700,#2a8bdf);outline-offset:2px}" +
      ".translation-mobile-commandbar__btn svg{display:block;width:22px;height:22px}" +
      "body.translation-mobile-header-hidden app-reader-view-header{display:none!important}" +
      "body.translation-mobile-header-hidden app-header{display:none!important}" +
      "body.translation-mobile-header-hidden router-outlet.page{padding-top:0!important}" +
      "body.translation-mobile-header-hidden app-reader-view-tabs{top:0!important}" +
      "body.translation-mobile-header-hidden .reader-view-tabs__button{overflow:visible!important}" +
      "body.translation-mobile-header-hidden .translation-words-tab_has-new::before{display:block!important;visibility:visible!important;opacity:1!important;z-index:1}" +
      "body.translation-mobile-sheet-open{overflow:hidden;overflow-x:hidden!important}" +
      "body.translation-mobile-sheet-open .popup-menu-backdrop{opacity:.5!important}" +
      "body.translation-mobile-sheet-open .reverso-context-block," +
      "body.translation-mobile-sheet-open [class*='reverso-context']," +
      "body.translation-mobile-sheet-open [class*='context-block']," +
      "body.translation-mobile-sheet-open [role='dialog'][aria-modal='true']{" +
      "position:fixed!important;left:0!important;right:0!important;bottom:0!important;top:auto!important;" +
      "width:100vw!important;max-width:100vw!important;min-width:0!important;" +
      "margin:0!important;box-sizing:border-box!important;" +
      "max-height:82vh!important;overflow:auto!important;overflow-x:hidden!important;" +
      "border-radius:18px 18px 0 0!important;" +
      "transform:translateY(0)!important;" +
      "box-shadow:0 -12px 40px rgba(0,0,0,.35)!important;" +
      "}" +
      "body.translation-mobile-sheet-open .reverso-context-block *," +
      "body.translation-mobile-sheet-open [class*='reverso-context'] *," +
      "body.translation-mobile-sheet-open [class*='context-block'] *," +
      "body.translation-mobile-sheet-open [role='dialog'][aria-modal='true'] *{" +
      "max-width:100%!important;min-width:0!important;box-sizing:border-box!important" +
      "}" +
      "body.translation-mobile-sheet-open .reverso-context-block img," +
      "body.translation-mobile-sheet-open [class*='reverso-context'] img," +
      "body.translation-mobile-sheet-open [class*='context-block'] img," +
      "body.translation-mobile-sheet-open [role='dialog'][aria-modal='true'] img{" +
      "height:auto!important" +
      "}" +
      ".translation-mobile-sheet-close{" +
      "position:sticky;top:0;display:flex;justify-content:flex-end;" +
      "padding:10px 10px 0;z-index:3;" +
      "}" +
      ".translation-mobile-sheet-close__btn{" +
      "width:40px;height:40px;border-radius:999px;border:1px solid var(--line-gray-primary,#d4d9e3);" +
      "background:rgba(252,244,233,.95);color:var(--text-base-secondary,#607d8b);" +
      "display:inline-flex;align-items:center;justify-content:center;cursor:pointer;" +
      "box-shadow:0 1px 2px rgba(0,0,0,.06);-webkit-tap-highlight-color:transparent" +
      "}" +
      ".translation-mobile-sheet-close__btn:active{transform:translateY(1px)}" +
      ".translation-mobile-sheet-close__btn:focus-visible{outline:2px solid var(--new-blue-700,#2a8bdf);outline-offset:2px}" +
      ".translation-mobile-sheet-close__btn svg{width:18px;height:18px;display:block}" +
      ".translation-paragraph-demo-modal{position:fixed;z-index:100050;display:none;box-sizing:border-box;width:min(420px,calc(100vw - 24px));max-width:420px;padding:10px;background:#fff;border-radius:16px;box-shadow:0 10px 26px rgba(0,0,0,.18),0 2px 8px rgba(0,0,0,.08)}" +
      ".translation-paragraph-demo-modal_visible{display:block}" +
      ".translation-paragraph-demo-modal__card{position:relative}" +
      ".translation-paragraph-demo-modal__header{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 8px;padding-bottom:6px;position:sticky;top:0;z-index:2;background:#fff;border-bottom:1px solid rgba(15,23,42,.08)}" +
      ".translation-paragraph-demo-modal__label{font:600 12px/1.2 Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:var(--text-base-secondary,#607d8b)}" +
      ".translation-paragraph-demo-modal__close-link{display:inline-block;margin:0;font:600 12px/1.2 Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:var(--new-blue-700,#2a8bdf);text-decoration:underline;cursor:pointer}" +
      ".translation-paragraph-demo-modal__close-link:hover{opacity:.85}" +
      ".translation-paragraph-demo-modal__image{display:block;width:100%;height:auto;border-radius:12px}" +
      ".translation-paragraph-demo-modal__caption{margin:8px 4px 2px;font-size:12px;line-height:1.3;color:var(--text-base-secondary,#607d8b);text-align:center}" +
      "body.translation-mobile-sheet-open .reverso-context-block," +
      "body.translation-mobile-sheet-open [class*='reverso-context']," +
      "body.translation-mobile-sheet-open [class*='context-block']{" +
      "animation:translation-sheet-up .18s ease-out 1" +
      "}" +
      "@keyframes translation-sheet-up{from{transform:translateY(18px);opacity:.92}to{transform:translateY(0);opacity:1}}" +
      "@media (max-width:1023px){" +
      ".translation-hover-popover{left:12px!important;right:12px!important;top:auto!important;bottom:calc(12px + env(safe-area-inset-bottom, 0px))!important;width:auto;max-width:none;padding:10px;border-radius:16px}" +
      ".translation-hover-popover_collapsed{width:auto!important;left:auto!important;right:12px!important;padding:8px 10px}" +
      ".translation-hover-popover_collapsed .translation-hover-popover__demo-wrap{display:none}" +
      ".translation-hover-popover__demo-toggle{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:34px;padding:8px 12px;border:none;border-radius:999px;background:var(--line-gray-secondary,#eaeef1);color:var(--text-base-primary,#1f2937);font:600 13px/1 Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;cursor:pointer}" +
      ".translation-hover-popover__demo-toggle:focus-visible{outline:2px solid var(--new-blue-700,#2a8bdf);outline-offset:2px}" +
      ".translation-hover-popover__demo-caption{text-align:left}" +
      ".translation-paragraph-demo-modal{left:12px!important;right:12px!important;top:auto!important;bottom:calc(12px + env(safe-area-inset-bottom, 0px))!important;width:auto;max-width:none;max-height:min(78vh,calc(100vh - 160px - env(safe-area-inset-bottom, 0px)));overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch}" +
      "}" +
      ".translation-words-tab_has-new{position:relative}" +
      ".translation-words-tab_has-new::before{" +
      "content:'';" +
      "position:absolute;" +
      "top:8px;right:12px;" +
      "width:8px;height:8px;border-radius:999px;" +
      "background:#ef4444;" +
      "box-shadow:0 0 0 2px var(--background-base-header, #fff);" +
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

  function isMobileReaderViewport() {
    // Align with the Reverso snapshot tabs breakpoint (they appear at <= 1023px).
    if (hasMobileTabs() && state.mobileTabs.isTabsViewport) return state.mobileTabs.isTabsViewport();
    return window.innerWidth <= 1023;
  }

  function setSelectedParagraph(p) {
    if (state.mobileSelection.selectedParagraph === p) return;
    if (state.mobileSelection.selectedParagraph) {
      state.mobileSelection.selectedParagraph.classList.remove("translation-paragraph_selected");
    }
    state.mobileSelection.selectedParagraph = p || null;
    if (state.mobileSelection.selectedParagraph) {
      state.mobileSelection.selectedParagraph.classList.add("translation-paragraph_selected");
    }
    state.mobileSelection.lastSelectedAtMs = Date.now();
  }

  function pickParagraphClosestToReadingLine(paragraphs) {
    var list = paragraphs || sourceNodes();
    if (!list || !list.length) return null;
    var vh = window.innerHeight || 0;
    if (!vh) return list[0] || null;
    var readingLineY = vh * 0.35;
    var best = null;
    var bestDist = Infinity;
    for (var i = 0; i < list.length; i += 1) {
      var p = list[i];
      if (!p || !p.getBoundingClientRect) continue;
      var rect = p.getBoundingClientRect();
      // Ignore paragraphs fully outside viewport.
      if (rect.bottom <= 0 || rect.top >= vh) continue;
      var dist = Math.abs(rect.top - readingLineY);
      if (dist < bestDist) {
        best = p;
        bestDist = dist;
      }
    }
    return best || list[0] || null;
  }

  function updateMobileParagraphSelection() {
    if (!isMobileReaderViewport()) return;
    if (state.mobileSelection.locked) return;
    var paragraphs = sourceNodes();
    if (!paragraphs.length) return;
    var next = pickParagraphClosestToReadingLine(paragraphs);
    if (!next) return;

    var current = state.mobileSelection.selectedParagraph;
    if (!current) {
      setSelectedParagraph(next);
      return;
    }
    if (current === next) return;

    // Hysteresis: only switch if the new candidate is meaningfully better.
    var vh = window.innerHeight || 0;
    var readingLineY = vh * 0.35;
    var currentRect = current.getBoundingClientRect();
    var nextRect = next.getBoundingClientRect();
    var currentDist = Math.abs(currentRect.top - readingLineY);
    var nextDist = Math.abs(nextRect.top - readingLineY);
    var SWITCH_THRESHOLD_PX = 28;
    if (nextDist + SWITCH_THRESHOLD_PX < currentDist) {
      setSelectedParagraph(next);
    }
  }

  function lockMobileSelection() {
    state.mobileSelection.locked = true;
  }

  function unlockMobileSelection() {
    state.mobileSelection.locked = false;
    // Re-evaluate selection after an interaction completes.
    updateMobileParagraphSelection();
  }

  function installMobileParagraphSelection() {
    if (state.mobileSelection.installed) return;
    state.mobileSelection.installed = true;

    var rafId = 0;
    function scheduleUpdate() {
      if (!isMobileReaderViewport()) return;
      if (rafId) return;
      rafId = requestAnimationFrame(function () {
        rafId = 0;
        updateMobileParagraphSelection();
      });
    }

    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);

    // Initialize.
    scheduleUpdate();
  }

  function installMobileHeaderAutoHide() {
    if (state.mobileHeaderAutoHide.installed) return;
    state.mobileHeaderAutoHide.installed = true;

    var rafId = 0;

    function updateHeaderVisibility() {
      var shouldHide = isMobileReaderViewport() && window.scrollY > 0;
      if (shouldHide === state.mobileHeaderAutoHide.hidden) return;
      state.mobileHeaderAutoHide.hidden = shouldHide;
      document.body.classList.toggle("translation-mobile-header-hidden", shouldHide);
    }

    function scheduleUpdate() {
      if (rafId) return;
      rafId = requestAnimationFrame(function () {
        rafId = 0;
        updateHeaderVisibility();
      });
    }

    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    scheduleUpdate();
  }

  function getSelectedParagraphForMobileActions() {
    // Trust the visible highlight first so UI state and action target stay aligned.
    var highlighted = document.querySelector("p.translation-paragraph_selected");
    if (highlighted && document.contains(highlighted)) {
      setSelectedParagraph(highlighted);
      return highlighted;
    }
    var p = state.mobileSelection.selectedParagraph;
    if (p && document.contains(p)) return p;
    var next = pickParagraphClosestToReadingLine(sourceNodes());
    if (next) setSelectedParagraph(next);
    return state.mobileSelection.selectedParagraph;
  }

  function mobileBarPlayIcon() {
    return paragraphPlayIconSvg();
  }

  function mobileBarPauseIcon() {
    return (
      '<svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor">' +
      '<path d="M7 6.5C7 5.67 7.67 5 8.5 5h1C10.33 5 11 5.67 11 6.5v11c0 .83-.67 1.5-1.5 1.5h-1C7.67 19 7 18.33 7 17.5v-11zM13 6.5C13 5.67 13.67 5 14.5 5h1c.83 0 1.5.67 1.5 1.5v11c0 .83-.67 1.5-1.5 1.5h-1c-.83 0-1.5-.67-1.5-1.5v-11z"/>' +
      "</svg>"
    );
  }

  function mobileBarChevronDownIcon() {
    return (
      '<svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<path d="M5.527 7.364a.8.8 0 0 1 1.131 0L10 10.706l3.343-3.342a.8.8 0 0 1 1.131 1.131l-3.909 3.91a.8.8 0 0 1-1.131 0l-3.91-3.91a.8.8 0 0 1 0-1.131Z" fill="currentColor"></path>' +
      "</svg>"
    );
  }

  function mobileBarChevronUpIcon() {
    return (
      '<svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<path d="M14.473 12.636a.8.8 0 0 1-1.131 0L10 9.294l-3.343 3.342a.8.8 0 0 1-1.131-1.131l3.909-3.91a.8.8 0 0 1 1.131 0l3.91 3.91a.8.8 0 0 1 0 1.131Z" fill="currentColor"></path>' +
      "</svg>"
    );
  }

  function getAccentLanguage(accent) {
    return String(accent || "").toUpperCase() === "UK" ? "en-GB" : "en-US";
  }

  function getAccentFlag(accent) {
    return String(accent || "").toUpperCase() === "UK" ? "🇬🇧" : "🇺🇸";
  }

  function getAccentLabel(accent) {
    return String(accent || "").toUpperCase() === "UK" ? "UK" : "US";
  }

  function cycleAccent(accent) {
    return String(accent || "").toUpperCase() === "UK" ? "US" : "UK";
  }

  function cyclePlaybackRate(current) {
    var values = [1, 1.5, 2];
    var now = Number(current);
    var idx = values.indexOf(now);
    if (idx < 0) return values[0];
    return values[(idx + 1) % values.length];
  }

  function formatPlaybackRateLabel(rate) {
    var safe = Number(rate) || 1;
    return String(safe).replace(/\.0$/, "") + "x";
  }

  function getSelectedReadAloudLanguage() {
    return getAccentLanguage(state.audio.accent);
  }

  function toggleReadAloudAccent() {
    state.audio.accent = cycleAccent(state.audio.accent);
    state.audio.lang = getSelectedReadAloudLanguage();
    state.audio.selectedVoice = "";
    state.audio.selectedLanguage = "";

    var rel = state.audio.remoteEl;
    var switchingPreGen =
      READ_ALOUD_MODE !== "streaming" &&
      state.audio.backend === "remote" &&
      rel &&
      rel.src &&
      state.audio.player &&
      typeof state.audio.player.getMode === "function" &&
      state.audio.player.getMode() === "preGenerated";

    if (!switchingPreGen) {
      updateAudioUi();
      updateMobileCommandBarUi();
      return;
    }

    var savedTime = Number(rel.currentTime || 0);
    if (!isFinite(savedTime) || savedTime < 0) savedTime = 0;
    var wasPlaying = Boolean(state.audio.isPlaying && !state.audio.isPaused);
    var paragraphEl =
      state.audio.karaoke && state.audio.karaoke.paragraphEl && document.contains(state.audio.karaoke.paragraphEl)
        ? state.audio.karaoke.paragraphEl
        : null;
    var paragraphText = paragraphEl ? getParagraphPlainText(paragraphEl) : "";
    var paragraphIndex = -1;
    if (paragraphEl) {
      try {
        paragraphIndex = sourceNodes().indexOf(paragraphEl);
      } catch (_eIdx) {
        paragraphIndex = -1;
      }
    }
    var listenText = !paragraphEl ? String(state.audio.text || "").trim() : "";

    stopAudioPlayback();

    if (paragraphEl && paragraphText) {
      var karaokeDom = buildKaraokeDomMap(paragraphEl);
      state.audio.karaoke.paragraphEl = paragraphEl;
      state.audio.karaoke.tokenEls = karaokeDom.tokenEls;
      state.audio.karaoke.mapByTimedWordIndex = createTimedWordToDomIndexMap(
        karaokeDom.normalizedDomTokens,
        paragraphText
      );
    } else if (listenText) {
      prepareGlobalKaraokeMap(listenText);
    }

    var language = getSelectedReadAloudLanguage();
    var voice = resolveVoiceForLanguage(language);
    var player = ensureReadAloudPlayer(voice, language);
    applyPlaybackRateToAudio();

    state.audio.backend = "remote";
    state.audio.text = paragraphText || listenText;
    state.audio.totalChars = state.audio.text.length;
    state.audio.remoteDuration = 0;
    state.audio.activeChunkStart = 0;
    state.audio.activeChunkLength = state.audio.totalChars;

    var resumeOpts = {
      onWordChange: onKaraokeWordChange,
      resumeMediaSeconds: savedTime,
      resumePaused: !wasPlaying,
      onChunkStart: function (ctx) {
        applyReadAloudChunkProgress(ctx);
        updateAudioUi();
      },
      onChunkEnd: function (ctx) {
        state.audio.currentChar = Math.min(state.audio.totalChars, Math.max(0, ctx.playedChars || 0));
        updateAudioUi();
      }
    };

    function onPlaybackFinished() {
      state.audio.currentChar = state.audio.totalChars;
      state.audio.isPlaying = false;
      state.audio.isPaused = false;
      state.audio.backend = null;
      state.audio.progressMediaStart = 0;
      state.audio.progressMediaEnd = 0;
      resetKaraokeState();
      updateAudioUi();
      updateMobileCommandBarUi();
    }

    function onPlaybackPausedResume() {
      state.audio.isPlaying = false;
      state.audio.isPaused = true;
      state.audio.backend = "remote";
      updateAudioUi();
      updateMobileCommandBarUi();
    }

    function handlePlayResult(res) {
      if (res && res.paused === true) {
        onPlaybackPausedResume();
        return;
      }
      onPlaybackFinished();
    }

    function handlePlayErr(err) {
      if (err && err.name === "AbortError") return;
      var msg = err && err.message ? String(err.message) : String(err);
      console.error(LOG_PREFIX, "Accent switch replay failed:", msg);
      logWarn("accent_switch_replay_error", { message: msg });
      state.audio.isPlaying = false;
      state.audio.isPaused = false;
      state.audio.backend = null;
      resetKaraokeState();
      updateAudioUi();
      updateMobileCommandBarUi();
    }

    if (paragraphText && player && typeof player.playParagraph === "function") {
      state.audio.isPlaying = wasPlaying;
      state.audio.isPaused = !wasPlaying;
      updateAudioUi();
      player
        .playParagraph(paragraphText, Object.assign({ paragraphIndex: paragraphIndex }, resumeOpts))
        .then(handlePlayResult)
        .catch(handlePlayErr);
    } else if (listenText && player && typeof player.playText === "function") {
      state.audio.isPlaying = wasPlaying;
      state.audio.isPaused = !wasPlaying;
      updateAudioUi();
      player
        .playText(listenText, resumeOpts)
        .then(handlePlayResult)
        .catch(handlePlayErr);
    } else {
      updateAudioUi();
      updateMobileCommandBarUi();
    }
  }

  function updateMobileCommandBarUi() {
    if (!state.mobileCommandBar.root) return;
    var isPlaying = Boolean(state.audio.remoteEl && state.audio.remoteEl.src && state.audio.isPlaying && !state.audio.isPaused);
    if (!state.mobileCommandBar.playBtn) return;
    state.mobileCommandBar.playBtn.innerHTML = isPlaying ? mobileBarPauseIcon() : mobileBarPlayIcon();
    state.mobileCommandBar.playBtn.setAttribute("aria-label", isPlaying ? "Pause" : "Play");
    if (state.mobileCommandBar.accentBtn) {
      state.mobileCommandBar.accentBtn.textContent = getAccentFlag(state.audio.accent);
      state.mobileCommandBar.accentBtn.setAttribute("aria-label", "Accent " + getAccentLabel(state.audio.accent));
      state.mobileCommandBar.accentBtn.setAttribute("title", "Accent " + getAccentLabel(state.audio.accent));
    }
    if (state.mobileCommandBar.speedBtn) {
      state.mobileCommandBar.speedBtn.textContent = formatPlaybackRateLabel(state.audio.rate);
      state.mobileCommandBar.speedBtn.setAttribute("aria-label", "Speed " + formatPlaybackRateLabel(state.audio.rate));
      state.mobileCommandBar.speedBtn.setAttribute("title", "Speed " + formatPlaybackRateLabel(state.audio.rate));
    }
  }

  function playSelectedParagraphFromCommandBar() {
    // Recompute once at action time to avoid stale cache/rAF lag.
    updateMobileParagraphSelection();
    var p = getSelectedParagraphForMobileActions();
    if (!p) return;
    var text = getParagraphPlainText(p);
    if (!text) return;

    lockMobileSelection();
    setSelectedParagraph(p);

    // Toggle pause/resume if we're already playing this paragraph.
    if (state.audio.karaoke && state.audio.karaoke.paragraphEl === p && state.audio.remoteEl && state.audio.remoteEl.src) {
      pauseOrResumeAudio();
      updateMobileCommandBarUi();
      return;
    }

    state.mobileCommandBar.lastPlayedParagraph = p;
    setActiveParagraphTriggerButton(state.mobileCommandBar.playBtn);
    ensureAudioPlayer();
    showAudioPlayer();
    stopAudioPlayback();
    setActiveParagraphTriggerButton(state.mobileCommandBar.playBtn);

    ensureSingleModeTokenization();
    var karaokeDom = buildKaraokeDomMap(p);
    state.audio.karaoke.paragraphEl = p;
    state.audio.karaoke.tokenEls = karaokeDom.tokenEls;
    state.audio.karaoke.mapByTimedWordIndex = createTimedWordToDomIndexMap(karaokeDom.normalizedDomTokens, text);

    var paragraphIndex = -1;
    try {
      paragraphIndex = sourceNodes().indexOf(p);
    } catch (_e) { }

    var paragraphLanguage = getSelectedReadAloudLanguage();
    var paragraphVoice = resolveVoiceForLanguage(paragraphLanguage);
    var player = ensureReadAloudPlayer(paragraphVoice, paragraphLanguage);
    applyPlaybackRateToAudio();

    if (player && typeof player.playParagraph === "function") {
      state.audio.backend = "remote";
      state.audio.isPlaying = true;
      state.audio.isPaused = false;
      state.audio.currentChar = 0;
      state.audio.text = text;
      state.audio.totalChars = text.length;
      updateAudioUi();
      updateMobileCommandBarUi();
      player
        .playParagraph(text, {
          onWordChange: onKaraokeWordChange,
          paragraphIndex: paragraphIndex,
          onChunkStart: function (ctx) {
            applyReadAloudChunkProgress(ctx);
            updateAudioUi();
            updateMobileCommandBarUi();
          },
          onChunkEnd: function (ctx) {
            state.audio.currentChar = Math.min(state.audio.totalChars, Math.max(0, ctx.playedChars || 0));
            updateAudioUi();
            updateMobileCommandBarUi();
          }
        })
        .then(function () {
          state.audio.currentChar = state.audio.totalChars;
          state.audio.isPlaying = false;
          state.audio.isPaused = false;
          state.audio.activeChunkLength = 0;
          state.audio.progressMediaStart = 0;
          state.audio.progressMediaEnd = 0;
          updateAudioUi();
          updateMobileCommandBarUi();
          unlockMobileSelection();
        })
        .catch(function (err) {
          if (err && err.name === "AbortError") return;
          state.audio.isPlaying = false;
          state.audio.isPaused = false;
          state.audio.backend = null;
          state.audio.activeChunkLength = 0;
          state.audio.progressMediaStart = 0;
          state.audio.progressMediaEnd = 0;
          resetKaraokeState();
          updateAudioUi();
          updateMobileCommandBarUi();
          unlockMobileSelection();
        });
      return;
    }

    playMistralText(text)
      .then(function () {
        unlockMobileSelection();
      })
      .catch(function () {
        unlockMobileSelection();
      });
  }

  function translateSelectedParagraphFromCommandBar() {
    var p = getSelectedParagraphForMobileActions();
    if (!p) return;
    lockMobileSelection();
    setSelectedParagraph(p);
    openParagraphTranslationModal(p);
  }

  function installMobileCommandBar() {
    if (state.mobileCommandBar.installed) return;
    state.mobileCommandBar.installed = true;

    var root = document.createElement("div");
    root.className = "translation-mobile-commandbar";
    root.innerHTML =
      '<div class="translation-mobile-commandbar__inner">' +
      '<span class="translation-mobile-commandbar__hint">Tap any word to get a definition</span>' +
      '<div class="translation-mobile-commandbar__group">' +
      '<button type="button" class="translation-mobile-commandbar__btn" data-mobile-bar="play" aria-label="Play">' +
      mobileBarPlayIcon() +
      "</button>" +
      '<button type="button" class="translation-mobile-commandbar__btn" data-mobile-bar="accent" aria-label="Accent US" title="Accent US">🇺🇸</button>' +
      '<button type="button" class="translation-mobile-commandbar__btn" data-mobile-bar="speed" aria-label="Speed 1x" title="Speed 1x">1x</button>' +
      '<button type="button" class="translation-mobile-commandbar__btn" data-mobile-bar="translate" aria-label="Translate">' +
      paragraphTranslateIconSvg() +
      "</button>" +
      "</div>" +
      '<button type="button" class="translation-mobile-commandbar__collapse" data-mobile-bar="collapse" aria-label="Collapse controls">' +
      mobileBarChevronDownIcon() +
      "</button>" +
      "</div>" +
      '<button type="button" class="translation-mobile-commandbar__expand" data-mobile-bar="expand" aria-label="Expand controls">' +
      mobileBarChevronUpIcon() +
      "</button>";
    document.body.appendChild(root);

    state.mobileCommandBar.root = root;
    state.mobileCommandBar.playBtn = root.querySelector('[data-mobile-bar="play"]');
    state.mobileCommandBar.accentBtn = root.querySelector('[data-mobile-bar="accent"]');
    state.mobileCommandBar.speedBtn = root.querySelector('[data-mobile-bar="speed"]');
    state.mobileCommandBar.translateBtn = root.querySelector('[data-mobile-bar="translate"]');
    state.mobileCommandBar.collapseBtn = root.querySelector('[data-mobile-bar="collapse"]');
    state.mobileCommandBar.expandBtn = root.querySelector('[data-mobile-bar="expand"]');

    function stopEvent(e) {
      if (!e) return;
      e.preventDefault();
      e.stopPropagation();
    }

    state.mobileCommandBar.playBtn.addEventListener("click", function (e) {
      stopEvent(e);
      playSelectedParagraphFromCommandBar();
    });
    state.mobileCommandBar.accentBtn.addEventListener("click", function (e) {
      stopEvent(e);
      toggleReadAloudAccent();
    });
    state.mobileCommandBar.speedBtn.addEventListener("click", function (e) {
      stopEvent(e);
      state.audio.rate = cyclePlaybackRate(state.audio.rate);
      applyPlaybackRateToAudio();
      updateAudioUi();
      updateMobileCommandBarUi();
    });
    state.mobileCommandBar.translateBtn.addEventListener("click", function (e) {
      stopEvent(e);
      translateSelectedParagraphFromCommandBar();
    });
    state.mobileCommandBar.collapseBtn.addEventListener("click", function (e) {
      stopEvent(e);
      state.mobileCommandBar.collapsed = true;
      root.classList.add("translation-mobile-commandbar_collapsed");
      document.body.classList.add("translation-mobile-commandbar-collapsed");
    });
    state.mobileCommandBar.expandBtn.addEventListener("click", function (e) {
      stopEvent(e);
      state.mobileCommandBar.collapsed = false;
      root.classList.remove("translation-mobile-commandbar_collapsed");
      document.body.classList.remove("translation-mobile-commandbar-collapsed");
    });

    function syncVisibility() {
      // Be defensive: viewport sizing can lag behind initial navigation/resize.
      var visible = isMobileReaderViewport() || window.innerWidth <= 1023;
      root.classList.toggle("translation-mobile-commandbar_visible", visible);
      document.body.classList.toggle("translation-mobile-commandbar-open", visible);
      if (visible) {
        root.classList.toggle("translation-mobile-commandbar_collapsed", Boolean(state.mobileCommandBar.collapsed));
        document.body.classList.toggle("translation-mobile-commandbar-collapsed", Boolean(state.mobileCommandBar.collapsed));
        updateMobileParagraphSelection();
        updateMobileCommandBarUi();
      } else {
        root.classList.remove("translation-mobile-commandbar_collapsed");
        document.body.classList.remove("translation-mobile-commandbar-collapsed");
        unlockMobileSelection();
      }
    }

    window.addEventListener("resize", syncVisibility);
    // Run multiple passes to survive late layout/viewport updates.
    syncVisibility();
    requestAnimationFrame(syncVisibility);
    setTimeout(syncVisibility, 250);
  }

  function findTranslationModalCandidate() {
    return (
      document.querySelector(".reverso-context-block") ||
      document.querySelector("[role='dialog'][aria-modal='true']") ||
      document.querySelector("[class*='reverso-context']") ||
      document.querySelector("[class*='context-block']")
    );
  }

  function mobileSheetCloseIconSvg() {
    return (
      '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<path fill-rule="evenodd" clip-rule="evenodd" d="M12.7141 4.22865C12.9744 3.9683 12.9744 3.54619 12.7141 3.28584C12.4537 3.02549 12.0316 3.02549 11.7712 3.28584L8.00001 7.05708L4.22877 3.28584C3.96842 3.02549 3.54631 3.02549 3.28596 3.28584C3.02561 3.54619 3.02561 3.9683 3.28596 4.22865L7.0572 7.99988L3.28596 11.7711C3.02561 12.0315 3.02561 12.4536 3.28596 12.7139C3.54631 12.9743 3.96842 12.9743 4.22877 12.7139L8.00001 8.94269L11.7712 12.7139C12.0316 12.9743 12.4537 12.9743 12.7141 12.7139C12.9744 12.4536 12.9744 12.0315 12.7141 11.7711L8.94281 7.99988L12.7141 4.22865Z" fill="currentColor"></path>' +
      "</svg>"
    );
  }

  function tryCloseTranslationModal(modal) {
    // Prefer native close buttons if present.
    var scope = modal || document;
    var closeBtn =
      scope.querySelector("[aria-label='Close']") ||
      scope.querySelector("[aria-label='close']") ||
      scope.querySelector("[data-testid*='close']") ||
      scope.querySelector("button[aria-label*='Close']") ||
      scope.querySelector("button[aria-label*='close']");
    if (closeBtn && typeof closeBtn.click === "function") {
      closeBtn.click();
      return true;
    }
    var backdrop = document.querySelector(".popup-menu-backdrop");
    if (backdrop && typeof backdrop.click === "function") {
      backdrop.click();
      return true;
    }
    try {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      return true;
    } catch (_e) { }
    return false;
  }

  function ensureMobileSheetCloseButton(modal) {
    if (!modal) return;
    if (modal.querySelector(".translation-mobile-sheet-close")) return;
    var host = document.createElement("div");
    host.className = "translation-mobile-sheet-close";
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "translation-mobile-sheet-close__btn";
    btn.setAttribute("aria-label", "Close");
    btn.innerHTML = mobileSheetCloseIconSvg();
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      tryCloseTranslationModal(modal);
    });
    host.appendChild(btn);
    // Put it first so it stays at the top of the sheet content.
    modal.insertAdjacentElement("afterbegin", host);
  }

  function setMobileTranslateSheetOpen(isOpen) {
    state.mobileTranslateSheet.open = Boolean(isOpen);
    document.body.classList.toggle("translation-mobile-sheet-open", Boolean(isOpen));
    try {
      // Some modals compute width off the root scroller; clamp at the document level too.
      if (document && document.documentElement) {
        document.documentElement.style.overflowX = isOpen ? "hidden" : "";
      }
    } catch (_e) { }
    if (!isOpen) {
      unlockMobileSelection();
    }
  }

  function applyMobileSheetInlineStyles(modal) {
    if (!modal || !modal.style) return;
    // Inline styles win over most site CSS and avoid layout overflows on mobile.
    modal.style.position = "fixed";
    modal.style.left = "0";
    modal.style.right = "0";
    modal.style.bottom = "0";
    modal.style.top = "auto";
    modal.style.width = "100vw";
    modal.style.maxWidth = "100vw";
    modal.style.minWidth = "0";
    modal.style.margin = "0";
    modal.style.boxSizing = "border-box";
    modal.style.overflowX = "hidden";
    // Keep existing height logic from CSS; just ensure it doesn't exceed viewport.
    if (!modal.style.maxHeight) modal.style.maxHeight = "82vh";
  }

  function installMobileTranslateBottomSheetObserver() {
    if (state.mobileTranslateSheet.installed) return;
    state.mobileTranslateSheet.installed = true;

    function sync() {
      if (!isMobileReaderViewport()) {
        if (state.mobileTranslateSheet.open) setMobileTranslateSheetOpen(false);
        return;
      }
      var modal = findTranslationModalCandidate();
      // Heuristic: consider it open if present and visible.
      var open =
        Boolean(modal) &&
        modal.offsetParent !== null &&
        window.getComputedStyle(modal).display !== "none" &&
        window.getComputedStyle(modal).visibility !== "hidden";

      if (open && !state.mobileTranslateSheet.open) {
        setMobileTranslateSheetOpen(true);
        applyMobileSheetInlineStyles(modal);
        ensureMobileSheetCloseButton(modal);
      } else if (!open && state.mobileTranslateSheet.open) {
        setMobileTranslateSheetOpen(false);
      } else if (open) {
        applyMobileSheetInlineStyles(modal);
        ensureMobileSheetCloseButton(modal);
      }
    }

    var observer = new MutationObserver(function () {
      sync();
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    window.addEventListener("resize", sync);

    // Initial check.
    sync();
  }

  function hasMobileTabs() {
    return Boolean(state.mobileTabs && state.mobileTabs.wordsButton && state.mobileTabs.isTabsViewport);
  }

  function isWordsTabVisibleOnMobile() {
    if (!hasMobileTabs()) return false;
    if (!state.mobileTabs.isTabsViewport()) return false;
    var sidebar = getHistorySidebarElement();
    if (!sidebar) return false;
    return !isSidebarHidden(sidebar);
  }

  function setWordsTabHasNew(hasNew) {
    if (!hasMobileTabs()) return;
    state.mobileTabs.hasNewWords = Boolean(hasNew);
    state.mobileTabs.wordsButton.classList.toggle("translation-words-tab_has-new", Boolean(hasNew));
  }

  function flushPendingHistoryAnimations() {
    if (!hasMobileTabs()) return;
    if (!state.mobileTabs.isTabsViewport()) return;
    if (!isWordsTabVisibleOnMobile()) return;
    var list = document.querySelector(".history-sidebar__list");
    if (!list) return;
    var pending = Array.from(list.querySelectorAll("app-history-item.translation-history-item_pending"));
    if (!pending.length) return;

    // Make sure we end up at the latest added items.
    if (typeof list.scrollTop === "number" && typeof list.scrollHeight === "number") {
      list.scrollTop = list.scrollHeight;
    }

    pending.forEach(function (added, idx) {
      setTimeout(function () {
        added.classList.remove("translation-history-item_pending");
        added.classList.add("translation-history-item_just-added");
        setTimeout(function () {
          added.classList.remove("translation-history-item_just-added");
        }, 1200);
      }, idx * 140);
    });
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

  function readArticleVocabGlobal() {
    var raw = window[ARTICLE_VOCAB_GLOBAL];
    if (!raw || typeof raw !== "object") return null;
    return {
      articleId: raw.articleId ? String(raw.articleId) : "",
      words: Array.isArray(raw.words) ? raw.words : []
    };
  }

  // Keep this indirection so we can later swap to API fetch.
  function loadArticleVocab() {
    if (state.articleVocab) return state.articleVocab;
    state.articleVocab = readArticleVocabGlobal() || { articleId: "", words: [] };
    return state.articleVocab;
  }

  function getVocabEntryByIndex(vocabIndex) {
    if (vocabIndex == null || vocabIndex === "") return null;
    var idx = Number(vocabIndex);
    if (!Number.isInteger(idx) || idx < 0) return null;
    var vocab = loadArticleVocab();
    if (!vocab.words[idx]) return null;
    return { index: idx, entry: vocab.words[idx] };
  }

  function getElementVocabIndex(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return null;
    if (!el.classList || !el.classList.contains(VOCAB_MARKUP_CLASS)) return null;
    var raw = el.getAttribute(VOCAB_MARKUP_INDEX_ATTR);
    if (raw == null || raw === "") return null;
    var idx = Number(raw);
    if (!Number.isInteger(idx) || idx < 0) return null;
    return idx;
  }

  function collectVocabRanges(root) {
    var ranges = [];
    var plainText = "";

    function visit(node, activeVocabIndex) {
      if (!node) return;
      if (node.nodeType === Node.TEXT_NODE) {
        var text = node.nodeValue || "";
        if (!text) return;
        var start = plainText.length;
        plainText += text;
        if (Number.isInteger(activeVocabIndex)) {
          ranges.push({ start: start, end: plainText.length, vocabIndex: activeVocabIndex });
        }
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      var ownIndex = getElementVocabIndex(node);
      var nextIndex = Number.isInteger(ownIndex) ? ownIndex : activeVocabIndex;
      var children = node.childNodes || [];
      for (var i = 0; i < children.length; i += 1) {
        visit(children[i], nextIndex);
      }
    }

    visit(root, null);
    return { text: plainText, ranges: ranges };
  }

  function findVocabIndexForWordRange(start, end, vocabRanges) {
    for (var i = 0; i < vocabRanges.length; i += 1) {
      var range = vocabRanges[i];
      if (end <= range.start || start >= range.end) continue;
      return range.vocabIndex;
    }
    return null;
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

  function demoAssetUrl(path) {
    try {
      return new URL(String(path || ""), window.location.href).toString();
    } catch (_e) {
      return String(path || "");
    }
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
    el.addEventListener("mouseleave", function () {
      hideHoverPopover();
    });
    document.body.appendChild(el);
    state.hoverPopoverEl = el;
    return el;
  }

  function hideHoverPopover() {
    if (!state.hoverPopoverEl) return;
    state.hoverPopoverEl.classList.remove("translation-hover-popover_visible");
    state.hoverPopoverEl.classList.remove("translation-hover-popover_collapsed");
  }

  function positionHoverPopover(anchorEl) {
    if (!anchorEl || !anchorEl.getBoundingClientRect) return;
    var pop = ensureHoverPopover();
    if (isMobileReaderViewport()) {
      pop.style.left = "";
      pop.style.top = "";
      return;
    }
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
      // Keep the hover demo away from the right-side paragraph actions (play/translate).
      var paragraphHost = anchorEl.closest(".translation-paragraph-play-host");
      if (paragraphHost && paragraphHost.getBoundingClientRect) {
        var hostRect = paragraphHost.getBoundingClientRect();
        var actionsReserve = 92;
        minL = Math.max(minL, Math.round(hostRect.left + pad));
        maxL = Math.min(maxL, Math.round(hostRect.right - actionsReserve - pw));
      }
      if (maxL < minL) {
        maxL = minL;
      }
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
    var mobileToggleLabel = "Quick search demo";
    var imgSrc = demoAssetUrl(QUICK_SEARCH_IMAGE_PATH);
    pop.innerHTML =
      '<button type="button" class="translation-hover-popover__demo-toggle" aria-label="Collapse quick search preview">' +
      escapeHtml(mobileToggleLabel) +
      "</button>" +
      '<div class="translation-hover-popover__demo-header">' +
      '<span class="translation-hover-popover__demo-label">Demo image</span>' +
      '<button type="button" class="translation-hover-popover__demo-close" aria-label="Close demo image">Close</button>' +
      "</div>" +
      '<div class="translation-hover-popover__demo-wrap">' +
      '<img class="translation-hover-popover__demo-image" src="' +
      escapeHtml(imgSrc) +
      '" alt="Quick search demo preview">' +
      '<p class="translation-hover-popover__demo-caption">Quick search demo preview</p>' +
      "</div>";
    var toggleBtn = pop.querySelector(".translation-hover-popover__demo-toggle");
    if (toggleBtn) {
      toggleBtn.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        var collapsed = !pop.classList.contains("translation-hover-popover_collapsed");
        pop.classList.toggle("translation-hover-popover_collapsed", collapsed);
        toggleBtn.setAttribute("aria-label", collapsed ? "Expand quick search preview" : "Collapse quick search preview");
      });
    }
    var closeBtn = pop.querySelector(".translation-hover-popover__demo-close");
    if (closeBtn) {
      closeBtn.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        hideHoverPopover();
      });
    }
    if (isMobileReaderViewport()) {
      pop.classList.add("translation-hover-popover_collapsed");
    } else {
      pop.classList.remove("translation-hover-popover_collapsed");
    }
    positionHoverPopover(anchorEl);
  }

  function tokenizeText(text) {
    var re = /([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’-]*)/g;
    var out = [];
    var last = 0;
    var match;
    while ((match = re.exec(text)) !== null) {
      if (match.index > last) out.push({ type: "sep", value: text.slice(last, match.index) });
      out.push({ type: "word", value: match[0], start: match.index, end: re.lastIndex });
      last = re.lastIndex;
    }
    if (last < text.length) out.push({ type: "sep", value: text.slice(last) });
    return out;
  }

  function renderTokenizedParagraph(pEl, text, side, rowIdx) {
    var sourceMeta = side === "source" ? collectVocabRanges(pEl) : null;
    var resolvedText = sourceMeta ? sourceMeta.text : text;
    pEl.innerHTML = "";
    pEl.classList.remove("translation-sentence_tgt");
    var tokens = [];
    var parts = tokenizeText(resolvedText);
    var tokenIdx = 0;
    for (var i = 0; i < parts.length; i += 1) {
      if (parts[i].type === "word") {
        var vocabIndex = sourceMeta
          ? findVocabIndexForWordRange(parts[i].start, parts[i].end, sourceMeta.ranges)
          : null;
        var vocabEntry = getVocabEntryByIndex(vocabIndex);
        var span = document.createElement("span");
        span.className = "translation-token";
        if (vocabEntry) {
          span.classList.add("translation-token_vocab");
          span.setAttribute("data-vocab-index", String(vocabEntry.index));
        }
        span.setAttribute("data-row-index", String(rowIdx));
        span.setAttribute("data-side", side);
        span.setAttribute("data-token-index", String(tokenIdx));
        span.textContent = parts[i].value;
        pEl.appendChild(span);
        tokens.push({
          el: span,
          raw: parts[i].value,
          norm: normalizeWord(parts[i].value),
          isVocab: Boolean(vocabEntry),
          vocabIndex: vocabEntry ? vocabEntry.index : null
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
    syncSavedWordHighlights();
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

  function onSingleReadingHoverMouseleave(event) {
    if (!isHoverWordMappingEnabled()) return;
    if (state.isOpen) return;
    var related = event && event.relatedTarget ? event.relatedTarget : null;
    if (related && state.hoverPopoverEl && state.hoverPopoverEl.contains(related)) {
      return;
    }
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
      listenBtn.innerHTML =
        '<app-icon-stop fillcolor="none">' +
        '<svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">' +
        '<rect x="6" y="6" width="16" height="16" rx="2" stroke="#7C7C7C" stroke-width="2"></rect>' +
        "</svg>" +
        "</app-icon-stop>" +
        '<span class="button__text">Stop</span>';
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
    if (!word || typeof word.index !== "number") {
      clearKaraokeDomHighlight();
      return;
    }
    var domIdx = karaoke.mapByTimedWordIndex[word.index];
    if (typeof domIdx !== "number" || domIdx < 0 || !karaoke.tokenEls[domIdx]) return;
    clearKaraokeDomHighlight();
    karaoke.tokenEls[domIdx].classList.add("translation-token_karaoke");
    karaoke.activeDomTokenIndex = domIdx;
  }

  function prepareGlobalKaraokeMap(fullText) {
    ensureSingleModeTokenization();
    var nodes = sourceNodes();
    var tokenEls = [];
    for (var i = 0; i < nodes.length; i += 1) {
      var rowTokens = nodes[i].querySelectorAll(".translation-token");
      for (var j = 0; j < rowTokens.length; j += 1) {
        tokenEls.push(rowTokens[j]);
      }
    }
    var normalizedDomTokens = tokenEls.map(function (el) {
      return normalizeKaraokeToken(el.textContent || "");
    });
    state.audio.karaoke.paragraphEl = null;
    state.audio.karaoke.tokenEls = tokenEls;
    state.audio.karaoke.mapByTimedWordIndex = createTimedWordToDomIndexMap(
      normalizedDomTokens,
      fullText
    );
    clearKaraokeDomHighlight();
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

  function playerPauseIconSvg() {
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">' +
      '<path fill-rule="evenodd" clip-rule="evenodd" d="M6.37946 5.72222C6.01411 5.77142 5.92726 5.84719 5.8888 5.88583L5.88639 5.88825C5.84699 5.92756 5.77117 6.01531 5.72197 6.38058C5.66889 6.77475 5.66675 7.31384 5.66675 8.167V19.8337C5.66675 20.6874 5.66889 21.2268 5.72197 21.621C5.77118 21.9863 5.84695 22.0732 5.88558 22.1116L5.888 22.114C5.92745 22.1536 6.01508 22.2293 6.37994 22.2785C6.77394 22.3315 7.31298 22.3337 8.16675 22.3337C9.02052 22.3337 9.55988 22.3315 9.95405 22.2784C10.3194 22.2292 10.4062 22.1535 10.4447 22.1148L10.4471 22.1124C10.4865 22.0731 10.5623 21.9853 10.6115 21.6201C10.6646 21.2259 10.6668 20.6868 10.6668 19.8337V8.167C10.6668 7.31324 10.6646 6.77387 10.6115 6.3797C10.5623 6.01436 10.4866 5.92751 10.4479 5.88905L10.4455 5.88664C10.4061 5.8471 10.3184 5.77137 9.95357 5.72221C9.55957 5.66913 9.02053 5.667 8.16675 5.667C7.31299 5.667 6.77363 5.66913 6.37946 5.72222ZM8.10264 3.667C8.12394 3.667 8.14531 3.667 8.16675 3.667C8.18821 3.667 8.20959 3.667 8.2309 3.667C9.0013 3.66694 9.67705 3.66689 10.2206 3.74012C10.8078 3.81923 11.3876 3.99994 11.8601 4.47284C12.3339 4.94516 12.5146 5.52573 12.5936 6.11275C12.6669 6.65643 12.6668 7.33245 12.6668 8.10289C12.6668 8.12419 12.6668 8.14556 12.6668 8.167L12.6668 19.8977C12.6668 20.6676 12.6669 21.3434 12.5936 21.887C12.5146 22.4742 12.334 23.0544 11.8609 23.5271C11.3886 24.0008 10.808 24.1815 10.221 24.2605C9.67733 24.3338 9.00131 24.3337 8.23089 24.3337H8.10263C7.33222 24.3337 6.65646 24.3338 6.11291 24.2605C5.52518 24.1814 4.94489 24.0004 4.47218 23.5266C3.99928 23.0545 3.81886 22.4744 3.73987 21.8879C3.66665 21.3442 3.6667 20.6682 3.66675 19.8978L3.66675 8.167C3.66675 8.14558 3.66675 8.12423 3.66675 8.10295C3.6667 7.33303 3.66665 6.6573 3.73987 6.11363C3.81894 5.52652 3.99955 4.94626 4.47258 4.47363C4.9449 3.99983 5.52548 3.81917 6.11251 3.74011C6.65618 3.66689 7.3322 3.66694 8.10264 3.667ZM18.0461 5.72222C17.6808 5.77142 17.5939 5.84719 17.5555 5.88583L17.5531 5.88824C17.5137 5.92755 17.4378 6.01531 17.3886 6.38058C17.3356 6.77475 17.3334 7.31384 17.3334 8.167V19.8337C17.3334 20.6874 17.3356 21.2268 17.3886 21.621C17.4378 21.9863 17.5136 22.0732 17.5522 22.1116L17.5547 22.114C17.594 22.1534 17.6817 22.2292 18.047 22.2784C18.4412 22.3315 18.9803 22.3337 19.8334 22.3337C20.6866 22.3337 21.2257 22.3315 21.6198 22.2784C21.9851 22.2292 22.0729 22.1534 22.1122 22.114L22.1138 22.1124C22.1532 22.0731 22.229 21.9853 22.2782 21.6201C22.3313 21.2259 22.3334 20.6868 22.3334 19.8337V8.167C22.3334 7.31324 22.3313 6.77387 22.2782 6.3797C22.229 6.01436 22.1532 5.92751 22.1146 5.88905L22.1122 5.88663C22.0727 5.84709 21.9851 5.77137 21.6202 5.72221C21.2262 5.66913 20.6872 5.667 19.8334 5.667C18.9797 5.667 18.4403 5.66913 18.0461 5.72222ZM19.7693 3.667H19.8976C20.668 3.66694 21.3437 3.66689 21.8873 3.74012C22.4745 3.81923 23.0543 3.99994 23.5268 4.47284C24.0006 4.94516 24.1812 5.52573 24.2603 6.11275C24.3335 6.65642 24.3335 7.33244 24.3334 8.10287V19.8977C24.3335 20.6676 24.3335 21.3434 24.2603 21.887C24.1812 22.4743 24.0005 23.0547 23.5272 23.5274C23.0545 24.0008 22.4741 24.1815 21.8868 24.2605C21.3431 24.3338 20.6674 24.3337 19.8975 24.3337H19.7694C18.9995 24.3337 18.3237 24.3338 17.78 24.2605C17.1929 24.1815 16.6127 24.0009 16.14 23.5278C15.6662 23.0555 15.4856 22.4749 15.4065 21.8879C15.3333 21.3442 15.3334 20.6682 15.3334 19.8978L15.3334 8.167C15.3334 8.14558 15.3334 8.12424 15.3334 8.10296C15.3334 7.33304 15.3333 6.6573 15.4065 6.11363C15.4857 5.52602 15.6665 4.94528 16.1405 4.47242C16.6126 3.99953 17.1926 3.81911 17.7792 3.74011C18.3228 3.66689 18.9989 3.66694 19.7693 3.667Z" fill="var(--text-banner-placeholder)"></path>' +
      "</svg>"
    );
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
    if (state.audio.isPlaying && !state.audio.isPaused) {
      playPause.innerHTML = playerPauseIconSvg();
      playPause.setAttribute("aria-label", "Pause");
    } else {
      playPause.textContent = "Play";
      playPause.setAttribute("aria-label", "Play");
    }
    if (state.audio.ui.accent) {
      state.audio.ui.accent.innerHTML =
        '<span aria-hidden="true">' +
        getAccentFlag(state.audio.accent) +
        "</span><span>" +
        getAccentLabel(state.audio.accent) +
        "</span>";
      state.audio.ui.accent.setAttribute("aria-label", "Accent " + getAccentLabel(state.audio.accent));
    }
    if (state.audio.ui.speed) {
      state.audio.ui.speed.textContent = formatPlaybackRateLabel(state.audio.rate);
      state.audio.ui.speed.setAttribute("aria-label", "Speed " + formatPlaybackRateLabel(state.audio.rate));
    }
    syncTriggerButtonsUi();
  }

  function applyPlaybackRateToAudio() {
    var nextRate = Number(state.audio.rate) || 1;
    if (state.audio.remoteEl) {
      try {
        state.audio.remoteEl.playbackRate = nextRate;
      } catch (_e) { }
    }
    if (state.audio.player && state.audio.player.audio) {
      try {
        state.audio.player.audio.playbackRate = nextRate;
      } catch (_e2) { }
    }
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
      var tWindowStart = Number(state.audio.progressMediaStart) || 0;
      var tWindowEnd = Number(state.audio.progressMediaEnd) || 0;
      var rel;
      if (tWindowEnd > tWindowStart) {
        var clamped = Math.min(Math.max(el.currentTime || 0, tWindowStart), tWindowEnd);
        rel = (clamped - tWindowStart) / (tWindowEnd - tWindowStart);
      } else {
        rel = Math.max(0, Math.min(1, (el.currentTime || 0) / d));
      }
      state.audio.currentChar = Math.min(
        state.audio.totalChars,
        activeStart + Math.round(rel * activeLen)
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
    try {
      el.playbackRate = Number(state.audio.rate) || 1;
    } catch (_eRate) { }
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
    state.audio.progressMediaStart = 0;
    state.audio.progressMediaEnd = 0;
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
      state.audio.lang = nextLanguage;
      applyPlaybackRateToAudio();
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
      preGeneratedAudioByLanguage: READ_ALOUD_PREGENERATED_AUDIO_BY_LANGUAGE,
      audio: ensureRemoteAudioEl()
    });
    state.audio.player = player;
    state.audio.selectedVoice = nextVoice;
    state.audio.selectedLanguage = nextLanguage;
    state.audio.lang = nextLanguage;
    applyPlaybackRateToAudio();
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
    prepareGlobalKaraokeMap(text);
    await playMistralText(text);
  }

  function applyReadAloudChunkProgress(ctx) {
    if (!ctx) return;
    state.audio.backend = "remote";
    state.audio.activeChunkStart = Math.max(0, ctx.startChar || 0);
    state.audio.activeChunkLength = String(ctx.chunkText || "").length;
    state.audio.currentChar = state.audio.activeChunkStart;
    state.audio.isPlaying = true;
    state.audio.isPaused = false;
    var ms = ctx.mediaTimeStart;
    var me = ctx.mediaTimeEnd;
    if (typeof ms === "number" && typeof me === "number" && me > ms) {
      state.audio.progressMediaStart = ms;
      state.audio.progressMediaEnd = me;
    } else {
      state.audio.progressMediaStart = 0;
      state.audio.progressMediaEnd = 0;
    }
  }

  async function playMistralText(text) {
    text = String(text || "").trim();
    if (!text.length) throw new Error("No text to read");
    state.audio.text = text;
    state.audio.totalChars = text.length;
    state.audio.currentChar = 0;
    var language = getSelectedReadAloudLanguage();
    var voice = resolveVoiceForLanguage(language);
    var player = ensureReadAloudPlayer(voice, language);
    applyPlaybackRateToAudio();
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
      onWordChange: onKaraokeWordChange,
      onChunkStart: function (ctx) {
        applyReadAloudChunkProgress(ctx);
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
    state.audio.progressMediaStart = 0;
    state.audio.progressMediaEnd = 0;
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
    showParagraphDemoModal(p);
  }

  function ensureQuickSearchDemoModal() {
    if (state.quickSearchDemoModalEl) return state.quickSearchDemoModalEl;
    var root = document.createElement("div");
    root.id = QUICK_SEARCH_DEMO_MODAL_ID;
    root.className = "translation-paragraph-demo-modal";
    root.innerHTML =
      '<div class="translation-paragraph-demo-modal__card" role="dialog" aria-modal="true" aria-label="Quick search demo">' +
      '<div class="translation-paragraph-demo-modal__header">' +
      '<span class="translation-paragraph-demo-modal__label">Demo image</span>' +
      '<a href="#" class="translation-paragraph-demo-modal__close-link" aria-label="Close quick search demo">Close</a>' +
      "</div>" +
      '<img class="translation-paragraph-demo-modal__image" src="' +
      escapeHtml(demoAssetUrl(QUICK_SEARCH_IMAGE_PATH)) +
      '" alt="Quick search demo preview">' +
      '<p class="translation-paragraph-demo-modal__caption">Quick search demo preview</p>' +
      "</div>";
    var closeLink = root.querySelector(".translation-paragraph-demo-modal__close-link");
    if (closeLink) {
      closeLink.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        hideQuickSearchDemoModal();
      });
    }
    document.addEventListener("keydown", function (event) {
      if (!state.quickSearchDemoModalEl) return;
      if (!state.quickSearchDemoModalEl.classList.contains("translation-paragraph-demo-modal_visible")) return;
      if (event.key === "Escape") hideQuickSearchDemoModal();
    });
    document.addEventListener("mousedown", function (event) {
      if (!state.quickSearchDemoModalEl) return;
      if (!state.quickSearchDemoModalEl.classList.contains("translation-paragraph-demo-modal_visible")) return;
      if (state.quickSearchDemoModalEl.contains(event.target)) return;
      hideQuickSearchDemoModal();
    });
    document.body.appendChild(root);
    state.quickSearchDemoModalEl = root;
    return root;
  }

  function showQuickSearchDemoModal(anchorEl) {
    var modal = ensureQuickSearchDemoModal();
    if (!isMobileReaderViewport() && anchorEl && anchorEl.getBoundingClientRect) {
      var rect = anchorEl.getBoundingClientRect();
      var modalWidth = modal.offsetWidth || 420;
      var modalHeight = modal.offsetHeight || 250;
      var pad = 12;
      var left = Math.round(rect.right - modalWidth);
      if (left < pad) left = pad;
      if (left + modalWidth > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - pad - modalWidth);
      var top = Math.round(rect.top + 8);
      var maxTop = window.innerHeight - pad - modalHeight;
      if (top > maxTop) top = Math.max(pad, maxTop);
      modal.style.left = left + "px";
      modal.style.top = top + "px";
      modal.style.right = "auto";
      modal.style.bottom = "auto";
    } else {
      modal.style.left = "";
      modal.style.top = "";
      modal.style.right = "";
      modal.style.bottom = "";
    }
    modal.classList.add("translation-paragraph-demo-modal_visible");
  }

  function hideQuickSearchDemoModal() {
    if (!state.quickSearchDemoModalEl) return;
    state.quickSearchDemoModalEl.classList.remove("translation-paragraph-demo-modal_visible");
  }

  function ensureParagraphDemoModal() {
    if (state.paragraphDemoModalEl) return state.paragraphDemoModalEl;
    var root = document.createElement("div");
    root.id = PARAGRAPH_DEMO_MODAL_ID;
    root.className = "translation-paragraph-demo-modal";
    root.innerHTML =
      '<div class="translation-paragraph-demo-modal__card" role="dialog" aria-modal="true" aria-label="Paragraph translation demo">' +
      '<div class="translation-paragraph-demo-modal__header">' +
      '<span class="translation-paragraph-demo-modal__label">Demo image</span>' +
      '<a href="#" class="translation-paragraph-demo-modal__close-link" aria-label="Close paragraph translation demo">Close</a>' +
      "</div>" +
      '<img class="translation-paragraph-demo-modal__image" src="' +
      escapeHtml(demoAssetUrl(PARAGRAPH_SEARCH_IMAGE_PATH)) +
      '" alt="Paragraph translation demo preview">' +
      '<p class="translation-paragraph-demo-modal__caption">Paragraph translation demo preview</p>' +
      "</div>";
    var closeLink = root.querySelector(".translation-paragraph-demo-modal__close-link");
    if (closeLink) {
      closeLink.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        hideParagraphDemoModal();
      });
    }
    document.addEventListener("keydown", function (event) {
      if (!state.paragraphDemoModalEl) return;
      if (!state.paragraphDemoModalEl.classList.contains("translation-paragraph-demo-modal_visible")) return;
      if (event.key === "Escape") hideParagraphDemoModal();
    });
    document.addEventListener("mousedown", function (event) {
      if (!state.paragraphDemoModalEl) return;
      if (!state.paragraphDemoModalEl.classList.contains("translation-paragraph-demo-modal_visible")) return;
      if (state.paragraphDemoModalEl.contains(event.target)) return;
      if (event.target && event.target.closest && event.target.closest(".translation-paragraph-translate")) return;
      hideParagraphDemoModal();
    });
    document.body.appendChild(root);
    state.paragraphDemoModalEl = root;
    return root;
  }

  function showParagraphDemoModal(anchorEl) {
    var modal = ensureParagraphDemoModal();
    if (!isMobileReaderViewport() && anchorEl && anchorEl.getBoundingClientRect) {
      var rect = anchorEl.getBoundingClientRect();
      var modalWidth = modal.offsetWidth || 420;
      var modalHeight = modal.offsetHeight || 250;
      var pad = 12;
      var left = Math.round(rect.right - modalWidth);
      if (left < pad) left = pad;
      if (left + modalWidth > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - pad - modalWidth);
      var top = Math.round(rect.top + 8);
      var maxTop = window.innerHeight - pad - modalHeight;
      if (top > maxTop) top = Math.max(pad, maxTop);
      modal.style.left = left + "px";
      modal.style.top = top + "px";
      modal.style.right = "auto";
      modal.style.bottom = "auto";
    } else {
      modal.style.left = "";
      modal.style.top = "";
      modal.style.right = "";
      modal.style.bottom = "";
    }
    modal.classList.add("translation-paragraph-demo-modal_visible");
  }

  function hideParagraphDemoModal() {
    if (!state.paragraphDemoModalEl) return;
    state.paragraphDemoModalEl.classList.remove("translation-paragraph-demo-modal_visible");
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
        ensureSingleModeTokenization();
        var karaokeDom = buildKaraokeDomMap(p);
        state.audio.karaoke.paragraphEl = p;
        state.audio.karaoke.tokenEls = karaokeDom.tokenEls;
        state.audio.karaoke.mapByTimedWordIndex = createTimedWordToDomIndexMap(
          karaokeDom.normalizedDomTokens,
          text
        );
        var paragraphLanguage = getSelectedReadAloudLanguage();
        var paragraphVoice = resolveVoiceForLanguage(paragraphLanguage);
        var player = ensureReadAloudPlayer(paragraphVoice, paragraphLanguage);
        applyPlaybackRateToAudio();
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
            paragraphIndex: paragraphIndex,
            onChunkStart: function (ctx) {
              applyReadAloudChunkProgress(ctx);
              updateAudioUi();
            },
            onChunkEnd: function (ctx) {
              state.audio.currentChar = Math.min(state.audio.totalChars, Math.max(0, ctx.playedChars || 0));
              updateAudioUi();
            }
          }).then(function () {
            logDebug("paragraph_play_done", { paragraphIndex: paragraphIndex });
            state.audio.currentChar = state.audio.totalChars;
            state.audio.isPlaying = false;
            state.audio.isPaused = false;
            state.audio.activeChunkLength = 0;
            state.audio.progressMediaStart = 0;
            state.audio.progressMediaEnd = 0;
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
        applyPlaybackRateToAudio();
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
      '<button type="button" class="translation-audio-player__btn translation-audio-player__btn_dialect" data-audio-action="dialect" aria-label="Accent US">' +
      '<span aria-hidden="true">🇺🇸</span><span>US</span>' +
      "</button>" +
      '<button type="button" class="translation-audio-player__btn" data-audio-action="speed" aria-label="Speed 1x">1x</button>' +
      '<span class="translation-audio-player__dialect-chevron" aria-hidden="true">&#8250;</span>' +
      "</div>" +
      '<div class="translation-audio-player__control">' +
      '<button type="button" class="translation-audio-player__btn translation-audio-player__btn_square" data-audio-action="back" aria-label="Back 15 seconds">' +
      '<svg viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M14.9604 22.2852C14.4131 22.2852 14.0234 21.9048 14.0234 21.3574C14.0234 20.8193 14.4131 20.4668 14.9604 20.4668C18.5601 20.4668 21.4453 17.5908 21.4453 14.0005C21.4453 10.4102 18.5601 7.53418 14.9604 7.53418C11.3423 7.53418 8.47559 10.3823 8.47559 13.9727C8.47559 14.585 8.52197 15.1509 8.62402 15.624L11.1289 13.1006C11.3052 12.9336 11.5 12.8408 11.7412 12.8408C12.2515 12.8408 12.6411 13.2305 12.6411 13.7222C12.6411 13.9912 12.5576 14.2046 12.3906 14.3623L8.5498 18.166C8.35498 18.3608 8.13232 18.4536 7.88184 18.4536C7.64062 18.4536 7.39941 18.3516 7.21387 18.166L3.34521 14.3623C3.16895 14.2046 3.07617 13.9819 3.07617 13.7222C3.07617 13.2305 3.48438 12.8408 3.98535 12.8408C4.22656 12.8408 4.43994 12.9336 4.60693 13.0913L6.82422 15.3364C6.74072 14.9282 6.69434 14.4551 6.69434 13.9727C6.69434 9.38037 10.3682 5.71582 14.9604 5.71582C19.562 5.71582 23.2637 9.4082 23.2637 14.0005C23.2637 18.5928 19.562 22.2852 14.9604 22.2852Z" fill="currentColor"></path></svg>' +
      "</button>" +
      '<button type="button" class="translation-audio-player__btn translation-audio-player__btn_play" data-audio-action="play-pause" aria-label="Play or pause">Play</button>' +
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
      accent: root.querySelector('[data-audio-action="dialect"]'),
      speed: root.querySelector('[data-audio-action="speed"]'),
      back: root.querySelector('[data-audio-action="back"]'),
      forward: root.querySelector('[data-audio-action="forward"]'),
      stop: root.querySelector('[data-audio-action="stop"]'),
      close: root.querySelector('[data-audio-action="close"]'),
      seek: root.querySelector('[data-audio-seek="1"]'),
      current: root.querySelector('[data-audio-time="current"]'),
      total: root.querySelector('[data-audio-time="total"]')
    };
    state.audio.ui.playPause.addEventListener("click", pauseOrResumeAudio);
    state.audio.ui.accent.addEventListener("click", function () {
      toggleReadAloudAccent();
    });
    state.audio.ui.speed.addEventListener("click", function () {
      state.audio.rate = cyclePlaybackRate(state.audio.rate);
      applyPlaybackRateToAudio();
      updateAudioUi();
      updateMobileCommandBarUi();
    });
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

  function syncHoverToggleUi() {
    document.body.classList.toggle("translation-hover-disabled", !isHoverWordMappingEnabled());
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
    syncSavedWordHighlights();
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

  function normalizeTokenWordForSavedState(word) {
    var clean = String(word || "").replace(/^[^A-Za-zÀ-ÿ']+|[^A-Za-zÀ-ÿ']+$/g, "");
    return normalizeHistoryWord(clean);
  }

  function syncSavedWordHighlights() {
    var savedWords = getSavedHistoryWordsSet();
    var tokens = document.querySelectorAll('.translation-token[data-side="source"]');
    Array.prototype.forEach.call(tokens, function (tokenEl) {
      var key = normalizeTokenWordForSavedState(tokenEl ? tokenEl.textContent : "");
      var isSaved = Boolean(key) && savedWords.has(key);
      tokenEl.classList.toggle("translation-token_saved", isSaved);
    });
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
    setHoverPopoverContent(tokenEl, {});
    state.activeHighlight = null;
  }

  function attachHoverHandlers(wrap) {
    wrap.addEventListener("mouseover", function (event) {
      if (!isHoverWordMappingEnabled()) return;
      var tokenEl = event.target.closest(".translation-token");
      if (!tokenEl || !wrap.contains(tokenEl)) return;
      clearActiveHighlight();
      applyHighlight(tokenEl);
    });
    wrap.addEventListener("mouseleave", function (event) {
      var related = event && event.relatedTarget ? event.relatedTarget : null;
      if (related && state.hoverPopoverEl && state.hoverPopoverEl.contains(related)) {
        return;
      }
      clearActiveHighlight();
    });
  }

  function normalizeHistoryWord(word) {
    return String(word || "")
      .trim()
      .toLowerCase();
  }

  function historyVocabIconSvg() {
    return (
      '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none">' +
      '<g clip-path="url(#translation-vocab-badge-clip)">' +
      '<path fill-rule="evenodd" clip-rule="evenodd" d="M1.53658 7.60148C1.32294 6.47688 2.06142 5.39202 3.18602 5.17838L9.4281 3.99259C9.25833 4.31723 9.12133 4.66537 9.0226 5.03383L6.42586 14.725C6.23224 15.4476 6.20477 16.1754 6.32004 16.868C6.31369 17.4412 6.4465 17.9977 6.69415 18.4954L5.7499 18.6748C4.6253 18.8884 3.54044 18.1499 3.3268 17.0253L1.53658 7.60148ZM7.81186 19.8099L6.02984 20.1484C4.09137 20.5167 2.2214 19.2437 1.85316 17.3053L0.0629339 7.88142C-0.305312 5.94295 0.967607 4.07298 2.90608 3.70474L9.42811 2.46577C9.85205 2.38523 10.2727 2.38319 10.6751 2.44944C11.1003 2.51944 11.5051 2.66569 11.8718 2.87614C12.4373 2.73698 13.0449 2.73441 13.6472 2.89579L21.1243 4.89928C23.0302 5.40996 24.1612 7.369 23.6505 9.2749L20.8214 19.8332C20.3107 21.7391 18.3517 22.8702 16.4458 22.3595L8.96871 20.356C8.54076 20.2413 8.15187 20.0536 7.81186 19.8099ZM9.57041 19.1506L16.7874 21.0844C17.9892 21.4064 19.2244 20.6933 19.5464 19.4916L22.3755 8.93326C22.6975 7.73153 21.9843 6.4963 20.7826 6.1743L13.3055 4.17082C12.1038 3.84881 10.8686 4.56198 10.5466 5.76371L7.75497 16.1821C7.78392 16.9046 8.03299 17.5931 8.4524 18.1614C8.74685 18.5603 9.12526 18.9 9.57041 19.1506Z" fill="currentColor"></path>' +
      '<path d="M12.6445 14.4432L14.8186 13.6068L16.2755 15.4161C16.3834 15.5501 16.4995 15.6227 16.6237 15.6338C16.7493 15.6399 16.8544 15.5988 16.9388 15.5108C17.0232 15.4228 17.0604 15.2945 17.0503 15.1258L16.9049 12.7884L19.0903 11.9717C19.2311 11.9209 19.3252 11.8382 19.3725 11.7237C19.4263 11.6053 19.427 11.4893 19.3744 11.3757C19.3271 11.2634 19.2182 11.1845 19.0479 11.1388L16.7888 10.5584L16.6765 8.22153C16.6753 8.06079 16.6267 7.94267 16.5308 7.86718C16.4362 7.78652 16.3278 7.75748 16.2056 7.78005C16.0899 7.79884 15.9863 7.87616 15.8945 8.01201L14.6366 9.9817L12.3899 9.35482C12.2247 9.31056 12.091 9.32451 11.9887 9.39667C11.8915 9.47021 11.8341 9.57099 11.8164 9.69901C11.8052 9.82325 11.8447 9.94446 11.9347 10.0626L13.421 11.8549L12.1264 13.8065C12.0399 13.9437 12.0105 14.0741 12.0382 14.1977C12.0673 14.3162 12.1378 14.4042 12.2495 14.4618C12.3627 14.5142 12.4944 14.508 12.6445 14.4432Z" fill="currentColor"></path>' +
      "</g>" +
      '<defs><clipPath id="translation-vocab-badge-clip"><rect width="24" height="24" fill="white"></rect></clipPath></defs>' +
      "</svg>"
    );
  }

  function applyHistoryVocabBadge(host, vocabIndex) {
    if (!host) return;
    var idx = Number(vocabIndex);
    if (!Number.isInteger(idx) || idx < 0) return;
    if (!getVocabEntryByIndex(idx)) return;
    var wordEl = host.querySelector(".history-item__word");
    if (!wordEl || !wordEl.parentElement) return;
    var existing = host.querySelector(".translation-history-vocab-badge");
    if (existing) return;
    var badge = document.createElement("button");
    badge.type = "button";
    badge.className = "translation-history-vocab-badge";
    badge.setAttribute("aria-label", VOCAB_TOOLTIP_TEXT);
    badge.setAttribute("title", VOCAB_TOOLTIP_TEXT);
    badge.setAttribute("data-tooltip", VOCAB_TOOLTIP_TEXT);
    badge.setAttribute("data-vocab-index", String(idx));
    badge.innerHTML = historyVocabIconSvg();
    wordEl.parentElement.appendChild(badge);
  }

  function getVocabularyTermsFromArticle() {
    var words = loadArticleVocab().words || [];
    var seen = new Set();
    var out = [];
    for (var i = 0; i < words.length; i += 1) {
      var row = words[i];
      var term = "";
      if (typeof row === "string") {
        term = row;
      } else if (row && typeof row === "object") {
        term = String(row.term || row.word || row.label || "").trim();
      }
      var key = normalizeHistoryWord(term);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ term: term, vocabIndex: i });
    }
    return out;
  }

  function getSavedHistoryWordsSet() {
    var saved = new Set();
    var list = document.querySelector(".history-sidebar__list");
    if (!list) return saved;
    var items = list.querySelectorAll("app-history-item .history-item__word");
    Array.prototype.forEach.call(items, function (el) {
      var key = normalizeHistoryWord(el ? el.textContent : "");
      if (key) saved.add(key);
    });
    return saved;
  }

  function getSavedHistoryWordsInOrder() {
    var out = [];
    var seen = new Set();
    var list = document.querySelector(".history-sidebar__list");
    if (!list) return out;
    var items = list.querySelectorAll("app-history-item .history-item__word");
    Array.prototype.forEach.call(items, function (el) {
      var term = String(el ? el.textContent : "").trim();
      var key = normalizeHistoryWord(term);
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push(term);
    });
    return out;
  }

  function ensureReadingStatsSectionRoot() {
    var content = document.querySelector(".reading-list__content");
    if (!content || !content.parentElement) return null;
    var container = content.parentElement;
    var finishBlock = container.querySelector("app-reading-finish-block");
    if (finishBlock) finishBlock.remove();
    var existing = container.querySelector(".translation-reading-stats");
    if (existing) {
      if (existing.parentElement !== container) {
        container.appendChild(existing);
      }
      return existing;
    }
    var section = document.createElement("section");
    section.className = "translation-reading-stats skip-highlight";
    section.innerHTML =
      '<div class="translation-reading-stats__top">' +
      '<div class="translation-reading-stats__ring" style="--reading-stats-progress:0%"><span class="translation-reading-stats__ring-value">0/3</span></div>' +
      '<div class="translation-reading-stats__copy">' +
      '<div class="translation-reading-stats__title-row">' +
      '<span class="translation-reading-stats__badge" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M12 3L14.6 8.27L20.4 9.11L16.2 13.2L17.2 19L12 16.27L6.8 19L7.8 13.2L3.6 9.11L9.4 8.27L12 3Z" fill="currentColor"></path></svg></span>' +
      '<h3 class="translation-reading-stats__title">You have discovered 0 words</h3>' +
      "</div>" +
      '<p class="translation-reading-stats__subtitle">Save at least 3 words to unlock practice.</p>' +
      "</div>" +
      "</div>" +
      '<button type="button" class="translation-reading-stats__cta translation-reading-stats__cta_disabled" disabled>Still 3 words to discover</button>' +
      '<p class="translation-reading-stats__hint">Saved words are prioritized first in practice.</p>';
    container.appendChild(section);
    section.addEventListener("click", function (event) {
      var cta = event.target && event.target.closest
        ? event.target.closest(".translation-reading-stats__cta")
        : null;
      if (!cta || cta.disabled) return;
      launchPracticeSavedWordsFlow();
    });
    return section;
  }

  function getVocabularyFillTerms(excluded, maxCount) {
    var out = [];
    var terms = getVocabularyTermsFromArticle();
    for (var i = 0; i < terms.length && out.length < maxCount; i += 1) {
      var key = normalizeHistoryWord(terms[i].term);
      if (!key || excluded.has(key)) continue;
      excluded.add(key);
      out.push(terms[i]);
    }
    return out;
  }

  function getFlashcardsHref() {
    var link = document.querySelector(".history-sidebar__flashcards a");
    if (!link) return "";
    return String(link.getAttribute("href") || "").trim();
  }

  function launchPracticeSavedWordsFlow() {
    var savedWords = getSavedHistoryWordsInOrder();
    var usedKeys = new Set();
    for (var i = 0; i < savedWords.length; i += 1) {
      var savedKey = normalizeHistoryWord(savedWords[i]);
      if (savedKey) usedKeys.add(savedKey);
    }
    if (savedWords.length < PRACTICE_SAVED_WORDS_MIN) {
      var fillers = getVocabularyFillTerms(usedKeys, PRACTICE_SAVED_WORDS_MIN - savedWords.length);
      for (var j = 0; j < fillers.length; j += 1) {
        addWordToHistorySidebar(fillers[j].term, {
          word: fillers[j].term,
          isVocab: true,
          vocabIndex: fillers[j].vocabIndex
        });
        savedWords.push(fillers[j].term);
      }
    }
    try {
      sessionStorage.setItem(
        "READER_PRACTICE_WORD_QUEUE",
        JSON.stringify({
          createdAt: Date.now(),
          minWords: PRACTICE_SAVED_WORDS_MIN,
          words: savedWords
        })
      );
    } catch (_e) { }
    var flashcardsHref = getFlashcardsHref();
    if (flashcardsHref) {
      window.location.assign(flashcardsHref);
    }
  }

  function syncReadingStatsSection() {
    var section = ensureReadingStatsSectionRoot();
    if (!section) return;
    var discoveredCount = getSavedHistoryWordsInOrder().length;
    var capped = Math.min(discoveredCount, PRACTICE_SAVED_WORDS_MIN);
    var remaining = Math.max(0, PRACTICE_SAVED_WORDS_MIN - discoveredCount);
    var progressBase = Math.round((capped / PRACTICE_SAVED_WORDS_MIN) * 100);
    var progressPercent = discoveredCount > PRACTICE_SAVED_WORDS_MIN ? 100 : progressBase;
    var title = section.querySelector(".translation-reading-stats__title");
    var subtitle = section.querySelector(".translation-reading-stats__subtitle");
    var ring = section.querySelector(".translation-reading-stats__ring");
    var ringValue = section.querySelector(".translation-reading-stats__ring-value");
    var badge = section.querySelector(".translation-reading-stats__badge");
    var cta = section.querySelector(".translation-reading-stats__cta");
    var hint = section.querySelector(".translation-reading-stats__hint");
    var hasMastered = discoveredCount > PRACTICE_SAVED_WORDS_MIN;
    section.classList.toggle("translation-reading-stats_mastered", hasMastered);
    if (title) title.textContent = "You have discovered " + String(discoveredCount) + " words";
    if (subtitle) {
      subtitle.textContent = remaining > 0
        ? "Save at least 3 words to unlock practice."
        : hasMastered
          ? "Excellent! The more words you save, the more you progress."
          : "Great momentum. Your practice set is ready.";
    }
    if (ring) ring.style.setProperty("--reading-stats-progress", String(progressPercent) + "%");
    if (ringValue) {
      ringValue.textContent = hasMastered
        ? String(discoveredCount)
        : String(capped) + "/" + String(PRACTICE_SAVED_WORDS_MIN);
    }
    if (badge) {
      badge.innerHTML = hasMastered
        ? '<svg viewBox="0 0 24 24" fill="none"><path d="M7 3H14C15.1 3 16 3.9 16 5V15C16 16.1 15.1 17 14 17H7C5.9 17 5 16.1 5 15V5C5 3.9 5.9 3 7 3Z" stroke="currentColor" stroke-width="2"></path><path d="M16 5H17C18.1 5 19 5.9 19 7V19L16 17L13 19V17" stroke="currentColor" stroke-width="2"></path></svg>'
        : '<svg viewBox="0 0 24 24" fill="none"><path d="M12 3L14.6 8.27L20.4 9.11L16.2 13.2L17.2 19L12 16.27L6.8 19L7.8 13.2L3.6 9.11L9.4 8.27L12 3Z" fill="currentColor"></path></svg>';
    }
    if (cta) {
      if (remaining > 0) {
        cta.disabled = true;
        cta.classList.add("translation-reading-stats__cta_disabled");
        cta.textContent = "Still " + String(remaining) + " words to discover";
      } else {
        cta.disabled = false;
        cta.classList.remove("translation-reading-stats__cta_disabled");
        cta.textContent = hasMastered ? "Practice your top saved words" : "Practice saved words";
      }
    }
    if (hint) {
      hint.textContent = "Saved words are prioritized first in practice.";
    }
  }

  function clearVocabularyPreviewFocus() {
    if (!state.vocabPreview || !state.vocabPreview.tokenEl) return;
    state.vocabPreview.tokenEl.classList.remove("translation-token_vocab-focus");
    state.vocabPreview.tokenEl = null;
    state.vocabPreview.vocabIndex = null;
  }

  function focusVocabularyTokenInText(vocabIndex) {
    var idx = Number(vocabIndex);
    if (!Number.isInteger(idx) || idx < 0) {
      clearVocabularyPreviewFocus();
      return;
    }
    if (state.vocabPreview && state.vocabPreview.vocabIndex === idx && state.vocabPreview.tokenEl) {
      return;
    }
    clearVocabularyPreviewFocus();
    var selector = '.translation-token_vocab[data-vocab-index="' + String(idx) + '"]';
    var tokenEl = document.querySelector(selector);
    if (!tokenEl) return;
    tokenEl.classList.add("translation-token_vocab-focus");
    state.vocabPreview.tokenEl = tokenEl;
    state.vocabPreview.vocabIndex = idx;
    if (typeof tokenEl.scrollIntoView === "function") {
      tokenEl.scrollIntoView({ block: "center", behavior: "smooth", inline: "nearest" });
    }
  }

  function ensureVocabularySectionRoot() {
    var sidebar = document.querySelector(".history-sidebar");
    if (!sidebar) return null;
    var existing = sidebar.querySelector(".translation-vocab-section");
    var historyList = sidebar.querySelector(".history-sidebar__list");
    if (existing) {
      // Keep the section near the words list (after it) so it stays visible and in expected order.
      if (historyList && historyList.parentElement) {
        var desiredParent = historyList.parentElement;
        var isRightParent = existing.parentElement === desiredParent;
        var isRightPosition = historyList.nextSibling === existing;
        if (!isRightParent || !isRightPosition) {
          desiredParent.insertBefore(existing, historyList.nextSibling);
        }
      }
      return existing;
    }
    var section = document.createElement("div");
    section.className = "translation-vocab-section";
    section.innerHTML =
      '<h4 class="translation-vocab-section__title">Key vocabulary</h4>' +
      '<div class="translation-vocab-section__list"></div>';
    if (historyList && historyList.parentElement) {
      historyList.parentElement.insertBefore(section, historyList.nextSibling);
    } else {
      var flashcards = sidebar.querySelector(".history-sidebar__flashcards");
      if (flashcards && flashcards.parentElement) {
        flashcards.parentElement.insertBefore(section, flashcards);
      } else {
        sidebar.appendChild(section);
      }
    }
    section.addEventListener("click", function (event) {
      var bubble = event.target && event.target.closest
        ? event.target.closest(".translation-vocab-item")
        : null;
      if (!bubble || !section.contains(bubble)) return;
      var term = String(bubble.getAttribute("data-term") || "").trim();
      if (!term) return;
      var vocabIndex = Number(bubble.getAttribute("data-vocab-index"));
      addWordToHistorySidebar(term, {
        word: term,
        isVocab: Number.isInteger(vocabIndex) && vocabIndex >= 0,
        vocabIndex: Number.isInteger(vocabIndex) && vocabIndex >= 0 ? vocabIndex : null
      });
    });
    section.addEventListener("mouseover", function (event) {
      var bubble = event.target && event.target.closest
        ? event.target.closest(".translation-vocab-item")
        : null;
      if (!bubble || !section.contains(bubble)) return;
      var vocabIndex = Number(bubble.getAttribute("data-vocab-index"));
      focusVocabularyTokenInText(vocabIndex);
    });
    section.addEventListener("mouseout", function (event) {
      var related = event.relatedTarget || null;
      if (related && section.contains(related)) return;
      clearVocabularyPreviewFocus();
    });
    return section;
  }

  function syncHistoryListHeightForVocabulary(sidebar, historyList, hasTerms) {
    if (!sidebar || !historyList) return;
    if (!hasTerms) {
      historyList.style.maxHeight = "";
      historyList.style.overflowY = "";
      return;
    }
    var parent = historyList.parentElement;
    if (!parent) return;
    var parentHeight = parent.getBoundingClientRect().height;
    if (!parentHeight || parentHeight <= 0) return;
    var taken = 0;
    var children = parent.children || [];
    for (var i = 0; i < children.length; i += 1) {
      var child = children[i];
      if (!child || child === historyList) continue;
      if (child.offsetParent === null) continue;
      var rect = child.getBoundingClientRect();
      var style = window.getComputedStyle ? window.getComputedStyle(child) : null;
      var mt = style ? parseFloat(style.marginTop || "0") || 0 : 0;
      var mb = style ? parseFloat(style.marginBottom || "0") || 0 : 0;
      taken += rect.height + mt + mb;
    }
    var available = Math.floor(parentHeight - taken - 8);
    if (available <= 0) {
      historyList.style.maxHeight = "";
      return;
    }
    historyList.style.maxHeight = String(Math.max(available, 120)) + "px";
    historyList.style.overflowY = "auto";
  }

  function syncVocabularySection() {
    var section = ensureVocabularySectionRoot();
    if (!section) return;
    var sidebar = section.closest ? section.closest(".history-sidebar") : null;
    var historyList = sidebar ? sidebar.querySelector(".history-sidebar__list") : null;
    var list = section.querySelector(".translation-vocab-section__list");
    if (!list) return;
    var terms = getVocabularyTermsFromArticle();
    var savedWords = getSavedHistoryWordsSet();
    list.innerHTML = "";
    for (var i = 0; i < terms.length; i += 1) {
      var termKey = normalizeHistoryWord(terms[i].term);
      if (termKey && savedWords.has(termKey)) continue;
      var item = document.createElement("button");
      item.type = "button";
      item.className = "translation-vocab-item";
      item.textContent = terms[i].term;
      item.setAttribute("data-term", terms[i].term);
      item.setAttribute("data-vocab-index", String(terms[i].vocabIndex));
      list.appendChild(item);
    }
    section.style.display = terms.length ? "" : "none";
    syncHistoryListHeightForVocabulary(sidebar, historyList, terms.length > 0);
    if (!syncVocabularySection._resizeBound) {
      window.addEventListener("resize", syncVocabularySection);
      syncVocabularySection._resizeBound = true;
    }
  }

  function createHistoryItemElement(word, opts) {
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
    var vocabIndex = opts && opts.vocabIndex;
    if (vocabIndex != null) {
      host.setAttribute("data-vocab-index", String(vocabIndex));
      applyHistoryVocabBadge(host, vocabIndex);
    }
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
    syncWordsTabCount(itemCount);
    syncReadingStatsSection();
  }

  function syncWordsTabCount(count) {
    if (!hasMobileTabs()) return;
    var wordsButton = state.mobileTabs.wordsButton;
    if (!wordsButton) return;
    var raw = String(wordsButton.textContent || "");
    var next = raw;
    if (/\(\s*\d+\s*\)/.test(raw)) {
      next = raw.replace(/\(\s*\d+\s*\)/, "(" + String(count) + ")");
    } else if (/\bwords\b/i.test(raw)) {
      // If the snapshot ever changes to "Words" without count, append it.
      next = raw.replace(/\bwords\b/i, function (m) {
        return m + " (" + String(count) + ")";
      });
    } else {
      // Fallback: don't risk corrupting unknown labels/locales.
      return;
    }
    if (next !== raw) wordsButton.textContent = next;
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

  function addWordToHistorySidebar(word, selectionMeta) {
    var clean = String(word || "").trim();
    if (!clean) return;
    var key = normalizeHistoryWord(clean);
    if (!key) return;
    removeDuplicateHistoryEntries();
    ensureHistoryWordCacheFromDom();
    var list = document.querySelector(".history-sidebar__list");
    if (!list) return;
    var existingItem = Array.prototype.find.call(list.querySelectorAll("app-history-item"), function (item) {
      var wordEl = item.querySelector(".history-item__word");
      return normalizeHistoryWord(wordEl ? wordEl.textContent : "") === key;
    });
    if (existingItem) {
      if (selectionMeta && selectionMeta.isVocab && Number.isInteger(selectionMeta.vocabIndex)) {
        existingItem.setAttribute("data-vocab-index", String(selectionMeta.vocabIndex));
        applyHistoryVocabBadge(existingItem, selectionMeta.vocabIndex);
      }
      syncVocabularySection();
      syncSavedWordHighlights();
      return;
    }
    var added = createHistoryItemElement(clean, selectionMeta || null);
    list.appendChild(added);
    syncSavedWordHighlights();
    var canUseMobileTabs = hasMobileTabs() && state.mobileTabs.isTabsViewport();
    var shouldQueueForWordsTab = canUseMobileTabs && !isWordsTabVisibleOnMobile();
    if (shouldQueueForWordsTab) {
      added.classList.add("translation-history-item_pending");
      setWordsTabHasNew(true);
    } else {
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
      // If we're already on Words tab, the dot should not linger.
      if (canUseMobileTabs) setWordsTabHasNew(false);
    }
    state.historyWords.add(key);
    syncHistoryCountFromDom();
    syncVocabularySection();
    syncSavedWordHighlights();
  }

  function installHistoryDedupObserver() {
    var list = document.querySelector(".history-sidebar__list");
    if (!list || list.dataset.dualTranslationDedupInstalled === "1") return;
    list.dataset.dualTranslationDedupInstalled = "1";
    removeDuplicateHistoryEntries();
    syncVocabularySection();
    syncSavedWordHighlights();
    var observer = new MutationObserver(function () {
      removeDuplicateHistoryEntries();
      syncVocabularySection();
      syncSavedWordHighlights();
    });
    observer.observe(list, { childList: true, subtree: true });
  }

  function readWordFromClickEvent(event) {
    var selected = String(window.getSelection ? window.getSelection().toString() : "").trim();
    if (selected) {
      var first = selected.split(/\s+/)[0] || "";
      var cleaned = first.replace(/^[^A-Za-zÀ-ÿ']+|[^A-Za-zÀ-ÿ']+$/g, "");
      return { word: cleaned, isVocab: false, vocabIndex: null };
    }
    var tokenEl = event && event.target && event.target.closest
      ? event.target.closest(".translation-token")
      : null;
    if (tokenEl) {
      var rawIndex = Number(tokenEl.getAttribute("data-vocab-index"));
      var isVocab = Number.isInteger(rawIndex) && rawIndex >= 0;
      return {
        word: String(tokenEl.textContent || "").trim(),
        isVocab: isVocab,
        vocabIndex: isVocab ? rawIndex : null,
        tokenEl: tokenEl
      };
    }
    return { word: "", isVocab: false, vocabIndex: null, tokenEl: null };
  }

  function onReaderWordActivate(event) {
    if (event && event.target && event.target.closest && event.target.closest(".translation-mobile-commandbar")) {
      return;
    }
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
      var selection = readWordFromClickEvent(event);
      if (!selection.word) return;
      addWordToHistorySidebar(selection.word, selection);
      if (isMobileReaderViewport()) {
        showQuickSearchDemoModal(selection.tokenEl || event.target || null);
      }
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

  function installMobileReaderTabsFix() {
    var tabsRoot = document.querySelector(".reader-view-tabs");
    if (!tabsRoot) return;
    if (tabsRoot.dataset.dualTranslationMobileTabsFixInstalled === "1") return;

    var buttons = Array.from(tabsRoot.querySelectorAll(".reader-view-tabs__button"));
    if (buttons.length < 2) return;

    var view =
      document.querySelector(".reader-view-page__view_with-sidebar") ||
      document.querySelector(".reader-view-page__view");
    var sidebar =
      document.querySelector(".reader-view-page__history-sidebar") ||
      document.querySelector("app-reader-view-word-sidebar");
    if (!view || !sidebar) return;

    tabsRoot.dataset.dualTranslationMobileTabsFixInstalled = "1";

    var textButton =
      buttons.find(function (b) {
        return /\btext\b/i.test(String(b.textContent || ""));
      }) || buttons[0];
    var wordsButton =
      buttons.find(function (b) {
        return /\bwords\b/i.test(String(b.textContent || ""));
      }) || buttons[1];

    var mql =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(max-width: 1023px)")
        : null;

    function isTabsViewport() {
      if (mql) return mql.matches;
      return window.innerWidth <= 1023;
    }

    function setActiveTab(tabName) {
      var isMobile = isTabsViewport();
      if (!isMobile) {
        // Desktop/tablet layout: show both panes and keep "Text" visually active.
        view.classList.remove("reader-view-page__view_hidden");
        sidebar.classList.remove("reader-view-page__history-sidebar_hidden");
        buttons.forEach(function (b) {
          b.classList.toggle("reader-view-tabs__button_active", b === textButton);
        });
        setWordsTabHasNew(false);
        return;
      }

      var showWords = tabName === "words";
      view.classList.toggle("reader-view-page__view_hidden", showWords);
      sidebar.classList.toggle("reader-view-page__history-sidebar_hidden", !showWords);
      buttons.forEach(function (b) {
        b.classList.toggle(
          "reader-view-tabs__button_active",
          showWords ? b === wordsButton : b === textButton
        );
      });
      if (showWords) {
        setWordsTabHasNew(false);
        flushPendingHistoryAnimations();
      }
    }

    textButton.addEventListener("click", function () {
      setActiveTab("text");
    });
    wordsButton.addEventListener("click", function () {
      setActiveTab("words");
    });

    function onViewportChange() {
      var activeIsWords = wordsButton.classList.contains("reader-view-tabs__button_active");
      setActiveTab(activeIsWords ? "words" : "text");
    }

    if (mql && typeof mql.addEventListener === "function") {
      mql.addEventListener("change", onViewportChange);
    } else {
      window.addEventListener("resize", onViewportChange);
    }

    // Initialize to the currently marked active tab (fallback: Text).
    state.mobileTabs = {
      wordsButton: wordsButton,
      textButton: textButton,
      isTabsViewport: isTabsViewport,
      hasNewWords: false
    };
    onViewportChange();
  }

  function install() {
    ensureStyles();
    loadArticleVocab();
    if (typeof window[HOVER_FEATURE_FLAG] === "undefined") {
      window[HOVER_FEATURE_FLAG] = true;
    }
    printConsoleHelp();
    logDebug("feature_flags", { hoverWordMap: isHoverWordMappingEnabled(), flagName: HOVER_FEATURE_FLAG });

    var openBtn = isDualTranslationEnabled() ? createToggleButton() : null;
    var darkBtn = findDarkModeBtn();
    var darkHost = darkBtn && typeof darkBtn.closest === "function" ? darkBtn.closest("app-button") : null;
    if (darkHost && darkHost.parentElement) {
      if (openBtn) darkHost.insertAdjacentElement("afterend", openBtn);
    } else if (darkBtn && darkBtn.parentElement) {
      if (openBtn) darkBtn.insertAdjacentElement("afterend", openBtn);
    } else {
      var header = document.querySelector("header.reading-view-header") || document.querySelector("header");
      if (header) {
        if (openBtn) header.appendChild(openBtn);
      } else {
        if (openBtn) document.body.appendChild(openBtn);
      }
    }

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
    installMobileReaderTabsFix();
    installHistoryDedupObserver();
    syncVocabularySection();
    syncReadingStatsSection();
    installListenButtonAudioWatcher();
    attachSingleModeHoverHandlers();
    installParagraphPlayButtons();
    installMobileParagraphSelection();
    installMobileHeaderAutoHide();
    installMobileCommandBar();
    installMobileTranslateBottomSheetObserver();

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
