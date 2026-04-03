(function () {
  "use strict";

  var PANEL_CLASS = "reverso-context-block";
  var PANEL_ID = "mock-reverso-panel";
  var lastSelection = { text: "", context: "" };
  var favoritesByWord = Object.create(null);
  var cachedHistoryItemTemplate = null;

  function injectStyles() {
    if (document.getElementById("mock-reverso-panel-styles")) return;
    var style = document.createElement("style");
    style.id = "mock-reverso-panel-styles";
    style.textContent = [
      "#" + PANEL_ID + "{font-family:Roboto,Helvetica,Arial,sans-serif;box-sizing:border-box;width:100%;height:100%;background:#f5f6f8;border:1px solid #d6dee5;border-radius:4px;box-shadow:0 10px 24px rgba(0,0,0,.18);display:flex;flex-direction:column;overflow:hidden}",
      "#" + PANEL_ID + " *{box-sizing:border-box}",
      ".mock-panel__header{display:flex;align-items:center;justify-content:space-between;min-height:36px;max-height:36px;padding:8px 8px 8px 10px;border-bottom:1px solid #dfe7ef;color:#6f8795;font-size:14px;font-weight:500;line-height:20px;background:#f3f5f8}",
      ".mock-panel__links{display:flex;align-items:center;gap:18px}",
      ".mock-panel__link{position:relative;border:0;background:transparent;color:#6e8594;cursor:pointer;font-size:13px;padding:0;line-height:20px}",
      ".mock-panel__link_active{color:#0a6cc2;font-weight:500}",
      ".mock-panel__link_active::after{content:'';position:absolute;left:0;bottom:-8px;width:100%;height:2px;background:#0a6cc2}",
      ".mock-panel__logo-svg{display:inline-flex;width:16px;height:16px;margin-right:4px;vertical-align:-2px}",
      ".mock-panel__logo-svg svg{width:16px;height:16px;display:block}",
      ".mock-panel__header-right{display:flex;align-items:center;gap:10px}",
      ".mock-panel__lang{display:flex;align-items:center;gap:2px}",
      ".mock-panel__lang-btn{border:0;background:transparent;border-radius:4px;color:#0970ac;font-size:12px;font-weight:500;width:34px;height:24px;cursor:pointer}",
      ".mock-panel__lang-swap{color:#7d96a4;width:24px;height:24px}",
      ".mock-panel__close{width:20px;height:20px;border-radius:6px;border:0;background:transparent;color:#79929d;font-size:20px;cursor:pointer}",
      ".mock-panel__close:hover,.mock-panel__lang-btn:hover{background:#eef3f8}",
      ".mock-panel__body{flex:1;padding:8px 12px 0 12px;overflow:hidden;display:flex;flex-direction:column}",
      ".mock-panel__heading{display:flex;align-items:center;margin-bottom:10px}",
      ".mock-panel__word{font-size:18px;line-height:28px;color:#263948;font-weight:400}",
      ".mock-panel__actions-inline{margin-left:8px;display:flex;align-items:center;gap:4px}",
      ".mock-panel__icon-btn{border:0;background:transparent;width:32px;height:32px;border-radius:4px;color:#79929d;cursor:pointer;display:inline-flex;align-items:center;justify-content:center}",
      ".mock-panel__icon-btn svg{width:18px;height:18px;display:block}",
      ".mock-panel__icon-btn:hover{background:#eef3f8}",
      ".mock-panel__icon-btn_fav.is-fav svg path{fill:#0a6cc2;stroke:#0a6cc2}",
      ".mock-panel__chips{display:flex;flex-wrap:wrap;align-content:flex-start;overflow:hidden;max-height:134px}",
      ".mock-panel__chip{position:relative;height:32px;display:inline-flex;align-items:center;padding:4px 8px;margin:0 6px 8px 0;border:1px solid #d5e2ed;border-radius:4px;background:#e9edf2;color:#263847;font-size:16px;line-height:24px;font-weight:500;cursor:pointer}",
      ".mock-panel__chip::before{content:'';position:absolute;left:0;right:0;top:0;height:2px;background:#2a8bdf;border-radius:4px 4px 0 0}",
      ".mock-panel__chip:hover{background:#e4edf5}",
      ".mock-panel__context{display:none}",
      ".mock-panel__footer{margin-top:auto;min-height:48px;border-top:1px solid #dde6ee;padding:8px 12px;display:flex;align-items:center;justify-content:space-between}",
      ".mock-panel__open-app{border:1px solid #d6dee5;background:#f7f9fc;color:#4c6274;border-radius:4px;height:32px;padding:0 8px;font-size:14px;cursor:pointer;display:inline-flex;align-items:center;gap:6px}",
      ".mock-panel__open-app:hover{color:#0a6cc2}",
      ".mock-panel__flashcards{border:0;background:#e8f3fc;color:#0a6cc2;border-radius:4px;height:32px;padding:0 8px;font-size:14px;font-weight:500;cursor:pointer}",
      ".mock-panel__flashcards:hover{background:#dcedfc}",
      ".mock-panel__saved{display:none}",
      "@media (max-width:700px){.mock-panel__link{font-size:13px}.mock-panel__word{font-size:18px;line-height:28px}.mock-panel__chip{font-size:16px}.mock-panel__open-app,.mock-panel__flashcards{font-size:14px}}"
    ].join("");
    document.head.appendChild(style);
  }

  function cleanWord(raw) {
    return (raw || "")
      .replace(/[^\p{L}\p{M}'’-]/gu, "")
      .trim();
  }

  function buildTranslations(word) {
    if (!word) return ["example", "sample", "instance", "test"];
    var lower = word.toLowerCase();
    var map = {
      magistrate: ["magistrat", "juge", "juge de paix", "magistrature", "intendant", "prefet", "caid", "officier de justice"],
      peaceful: ["pacifique", "paisible", "tranquille", "serein"]
    };
    if (map[lower]) return map[lower];
    return [
      lower + " tr",
      lower + " alt",
      lower + " option",
      lower + " variant"
    ];
  }

  function getContextFromSelection(sel) {
    if (!sel || sel.rangeCount < 1) return "";
    var range = sel.getRangeAt(0).cloneRange();
    var node = range.startContainer;
    var el = node.nodeType === 1 ? node : node.parentElement;
    if (!el) return "";
    var block = el.closest("p,li,span,div");
    if (!block) return "";
    return (block.textContent || "").trim().slice(0, 180);
  }

  function getOrCreatePanelHost() {
    var host = document.querySelector("." + PANEL_CLASS);
    if (!host) {
      host = document.createElement("div");
      host.className = PANEL_CLASS;
      host.style.cssText = "z-index: 1070; width: 450px; height: 229px; left: 245px; top: 10px; display: block; position: fixed;";
      document.body.appendChild(host);
    }
    if (!host.style.position) host.style.position = "fixed";
    if (!host.style.zIndex) host.style.zIndex = "1070";
    return host;
  }

  function closePanel() {
    var host = document.querySelector("." + PANEL_CLASS);
    if (host) host.style.display = "none";
  }

  function addFavorite(word, context, translations) {
    var payload = {
      srcText: word,
      translation1: translations[0],
      translation2: translations[1],
      translation3: translations[2],
      srcLang: "en",
      trgLang: "fr",
      srcContext: context || "",
      documentTitle: document.title.replace(/\s+-\s+Reverso$/, ""),
      position: "{\"start\":0,\"end\":0}"
    };

    if (window.reversoHistoryMock && window.reversoHistoryMock.addWord) {
      return window.reversoHistoryMock.addWord(payload) || true;
    }
    return true;
  }

  function addToRightSidebar(entry) {
    var list = document.querySelector(".history-sidebar__list");
    if (!list) return;

    if (!cachedHistoryItemTemplate) {
      var initialTemplate = list.querySelector("app-history-item");
      if (initialTemplate) cachedHistoryItemTemplate = initialTemplate.cloneNode(true);
    }

    var items = list.querySelectorAll("app-history-item");
    var template = items.length ? items[0] : null;
    var node;

    if (template || cachedHistoryItemTemplate) {
      var baseTemplate = template || cachedHistoryItemTemplate;
      node = baseTemplate.cloneNode(true);
      node.removeAttribute("data-mock-id");

      var wordEl = node.querySelector(".history-item__word");
      if (wordEl) wordEl.textContent = entry.srcText || "";

      var translationsEl = node.querySelector(".history-item__translations");
      if (translationsEl) {
        var txt = [entry.translation1, entry.translation2, entry.translation3]
          .filter(Boolean)
          .join(", ");
        translationsEl.textContent = txt ? txt + "," : "";
      }

      var moreLink = node.querySelector(".history-item__more-link a");
      if (moreLink) {
        moreLink.href = "https://context.reverso.net/translation/english-french/" + encodeURIComponent(entry.srcText || "");
      }
    } else {
      return;
    }

    if (entry && entry.id != null) node.setAttribute("data-mock-id", String(entry.id));
    list.insertBefore(node, list.firstChild);
  }

  function removeFromSidebar(itemNode) {
    if (!itemNode) return;
    itemNode.remove();
  }

  function setupSidebarDeleteBridge() {
    document.addEventListener("click", function (evt) {
      var deleteBtn = evt.target.closest(".history-item__three-dots button, .history-item__three-dots");
      if (!deleteBtn) return;
      var itemNode = deleteBtn.closest("app-history-item");
      if (!itemNode) return;

      var idAttr = itemNode.getAttribute("data-mock-id");
      var wordEl = itemNode.querySelector(".history-item__word");
      var srcText = wordEl ? (wordEl.textContent || "").trim() : "";
      var payload = {};
      if (idAttr) payload.id = Number(idAttr);
      if (srcText) payload.srcText = srcText;

      if (window.reversoHistoryMock && window.reversoHistoryMock.removeWord) {
        window.reversoHistoryMock.removeWord(payload);
      }
      if (srcText) delete favoritesByWord[srcText.toLowerCase()];
      removeFromSidebar(itemNode);
    }, true);
  }

  function primeSidebarTemplateCache() {
    var list = document.querySelector(".history-sidebar__list");
    if (!list) return;
    var item = list.querySelector("app-history-item");
    if (item) cachedHistoryItemTemplate = item.cloneNode(true);
  }

  function starIcon() {
    return '' +
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M12 3.9l2.6 5.27 5.82.85-4.21 4.1.99 5.79L12 17.15 6.8 19.9l.99-5.79-4.21-4.1 5.82-.85L12 3.9z" fill="none" stroke="#79929d" stroke-width="1.6"></path>' +
      "</svg>";
  }

  function speakerIcon() {
    return '' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="16" viewBox="0 0 20 16" fill="none" aria-hidden="true">' +
      '<path d="M2.07275 11.6592C1.43082 11.6592 0.943846 11.4904 0.611814 11.1528C0.285317 10.8097 0.122068 10.3006 0.122068 9.62549V6.42139C0.122068 5.74626 0.285317 5.23714 0.611814 4.89404C0.943846 4.55094 1.43082 4.37939 2.07275 4.37939H4.40527C4.47168 4.37939 4.52978 4.35726 4.57959 4.31299L8.14892 1.14209C8.39795 0.92627 8.61377 0.768555 8.79638 0.668945C8.979 0.563802 9.18375 0.51123 9.41064 0.51123C9.74821 0.51123 10.0277 0.627441 10.249 0.859863C10.4759 1.09229 10.5894 1.37728 10.5894 1.71484V14.3569C10.5894 14.6834 10.4787 14.9574 10.2573 15.1787C10.036 15.4056 9.75928 15.519 9.42724 15.519C9.18929 15.519 8.97347 15.4692 8.77978 15.3696C8.5861 15.2756 8.37581 15.1261 8.14892 14.9214L4.57959 11.7256C4.52978 11.6813 4.47168 11.6592 4.40527 11.6592H2.07275ZM2.27197 10.0073H4.82031C4.93652 10.0073 5.0389 10.0239 5.12744 10.0571C5.22152 10.0848 5.31836 10.1429 5.41797 10.2314L8.58056 13.1035C8.6193 13.1478 8.66081 13.1699 8.70508 13.1699C8.78255 13.1699 8.82129 13.1257 8.82129 13.0371V2.99316C8.82129 2.91016 8.78255 2.86865 8.70508 2.86865C8.68294 2.86865 8.66081 2.87419 8.63867 2.88525C8.61653 2.89632 8.5944 2.91016 8.57226 2.92676L5.41797 5.81543C5.31836 5.90397 5.22152 5.96484 5.12744 5.99805C5.0389 6.02572 4.93652 6.03955 4.82031 6.03955H2.27197C2.14469 6.03955 2.04785 6.07275 1.98144 6.13916C1.92057 6.20003 1.89013 6.29134 1.89013 6.41309V9.63379C1.89013 9.75553 1.92057 9.84961 1.98144 9.91602C2.04785 9.97689 2.14469 10.0073 2.27197 10.0073ZM13.4199 11.8003C13.1986 11.6564 13.0685 11.46 13.0298 11.2109C12.9966 10.9619 13.0685 10.6935 13.2456 10.4058C13.467 10.0793 13.6357 9.71126 13.752 9.30176C13.8737 8.88672 13.9346 8.45508 13.9346 8.00684C13.9346 7.55859 13.8737 7.12695 13.752 6.71191C13.6357 6.29688 13.467 5.92887 13.2456 5.60791C13.063 5.32568 12.991 5.06006 13.0298 4.81104C13.0685 4.55648 13.1986 4.35726 13.4199 4.21338C13.6247 4.08057 13.8405 4.0363 14.0674 4.08057C14.2943 4.12484 14.4769 4.24382 14.6152 4.4375C14.9639 4.90788 15.235 5.45296 15.4287 6.07275C15.6224 6.68701 15.7192 7.33171 15.7192 8.00684C15.7192 8.68197 15.6224 9.32943 15.4287 9.94922C15.235 10.5635 14.9639 11.103 14.6152 11.5679C14.4769 11.7671 14.2943 11.8888 14.0674 11.9331C13.8405 11.9718 13.6247 11.9276 13.4199 11.8003ZM16.9228 14.0581C16.696 13.9198 16.5659 13.7261 16.5327 13.4771C16.505 13.228 16.5687 12.9762 16.7236 12.7217C17.1553 12.0687 17.4901 11.3382 17.728 10.5303C17.9715 9.7168 18.0933 8.87565 18.0933 8.00684C18.0933 7.13249 17.9743 6.29134 17.7363 5.4834C17.4984 4.66992 17.1608 3.93669 16.7236 3.28369C16.5631 3.03467 16.4995 2.78564 16.5327 2.53662C16.5659 2.2876 16.696 2.09391 16.9228 1.95557C17.1331 1.82275 17.3517 1.78125 17.5786 1.83105C17.811 1.87533 17.9992 2.00537 18.1431 2.22119C18.6964 3.00146 19.1226 3.89518 19.4214 4.90234C19.7202 5.90397 19.8696 6.9388 19.8696 8.00684C19.8696 9.07487 19.7174 10.1097 19.4131 11.1113C19.1143 12.113 18.6909 13.0067 18.1431 13.7925C17.9992 14.0028 17.811 14.13 17.5786 14.1743C17.3517 14.2241 17.1331 14.1854 16.9228 14.0581Z" fill="var(--text-color-base-base-tertiary, #79929D)"></path>' +
      '</svg>';
  }

  function reversoLogoIcon() {
    return '' +
      '<span class="mock-panel__logo-svg" aria-hidden="true">' +
      '<svg width="50" height="54" viewBox="0 0 50 54" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      '<rect width="49.1225" height="52.694" transform="translate(0.646729 0.652954)" fill="transparent"></rect>' +
      '<path fill-rule="evenodd" clip-rule="evenodd" d="M21.3707 27.4716C20.6116 27.4716 19.9761 28.349 19.4422 28.8883C18.9552 29.3803 18.2794 29.6851 17.5324 29.6851C16.0487 29.6851 14.8459 28.4829 14.8459 27C14.8459 25.5171 16.0487 24.3149 17.5324 24.3149C18.3645 24.3149 19.1082 24.6931 19.6009 25.2867C20.0598 25.8396 20.652 26.7082 21.3707 26.7082C22.0894 26.7082 22.6815 25.8396 23.1404 25.2867C23.6332 24.6931 24.3769 24.3149 25.209 24.3149C26.0415 24.3149 26.7856 24.6934 27.2783 25.2876C27.7366 25.8402 28.3281 26.7082 29.0462 26.7082C29.7643 26.7082 30.3558 25.8402 30.8141 25.2876C31.3068 24.6934 32.0509 24.3149 32.8834 24.3149C34.367 24.3149 35.5698 25.5171 35.5698 27C35.5698 28.4829 34.367 29.6851 32.8834 29.6851C32.1359 29.6851 31.4598 29.3799 30.9728 28.8875C30.4396 28.3484 29.8046 27.4716 29.0462 27.4716C28.2878 27.4716 27.6528 28.3484 27.1196 28.8875C26.6326 29.3799 25.9565 29.6851 25.209 29.6851C24.462 29.6851 23.7861 29.3803 23.2992 28.8883C22.7653 28.349 22.1298 27.4716 21.3707 27.4716Z" fill="#0A6CC2"></path>' +
      '<path fill-rule="evenodd" clip-rule="evenodd" d="M9.36768 10.573L22.4789 0.80906C22.9943 0.425292 23.7269 0.792897 23.7269 1.43522V7.09269H29.855C40.8533 7.09269 49.7692 16.0042 49.7692 26.9972C49.7692 29.5717 49.2802 32.032 48.3899 34.2904C48.22 34.7216 47.7047 34.8881 47.3032 34.6563L42.659 31.9763C42.327 31.7847 42.1856 31.3814 42.3034 31.0167C42.7124 29.7503 42.9333 28.3995 42.9333 26.9972C42.9333 19.7777 37.078 13.9252 29.855 13.9252H29.8543H25.8759V13.9249H11.3777C8.34687 13.9249 8.06823 11.3924 9.36768 10.573Z" fill="#0A6CC2"></path>' +
      '<path fill-rule="evenodd" clip-rule="evenodd" d="M41.0483 43.4269L27.9371 53.1908C27.4218 53.5746 26.6891 53.207 26.6891 52.5647V46.9072H20.561C9.56268 46.9072 0.646816 37.9956 0.646816 27.0027C0.646816 24.4282 1.13583 21.9679 2.02609 19.7094C2.19606 19.2782 2.71128 19.1118 3.11285 19.3436L7.75702 22.0235C8.08905 22.2152 8.2304 22.6185 8.11263 22.9832C7.70363 24.2495 7.48269 25.6003 7.48269 27.0027C7.48269 34.2222 13.338 40.0747 20.561 40.0747H20.5617H24.5401V40.075H39.0383C42.0691 40.075 42.3478 42.6074 41.0483 43.4269Z" fill="#F5524F"></path>' +
      "</svg></span>";
  }

  function externalIcon() {
    return '' +
      '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">' +
      '<path fill="#607d8b" d="M10 2h4v4h-1.3V4.3L8.5 8.5l-1-1L11.7 3.3H10V2z"></path>' +
      '<path fill="#607d8b" d="M3 3h5v1.3H4.3v7.4h7.4V8H13v4c0 .6-.4 1-1 1H4c-.6 0-1-.4-1-1V3z"></path>' +
      "</svg>";
  }

  function flashcardsIcon() {
    return '' +
      '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">' +
      '<rect x="3" y="5" width="12" height="10" rx="2" fill="#56a8f0"></rect>' +
      '<rect x="6" y="3" width="12" height="10" rx="2" fill="#0a6cc2"></rect>' +
      "</svg>";
  }

  function renderPanel(word, context) {
    injectStyles();
    var host = getOrCreatePanelHost();
    var translations = buildTranslations(word);
    var isFavorite = !!favoritesByWord[word.toLowerCase()];
    host.style.display = "block";
    host.innerHTML =
      '<div id="' + PANEL_ID + '">' +
      '  <div class="mock-panel__header">' +
      '    <div class="mock-panel__links">' +
      '      <button class="mock-panel__link mock-panel__link_active" type="button">' + reversoLogoIcon() + 'Translate</button>' +
      '      <button class="mock-panel__link" type="button">Definitions</button>' +
      "    </div>" +
      '    <div class="mock-panel__header-right">' +
      '      <div class="mock-panel__lang">' +
      '        <button class="mock-panel__lang-btn" type="button">EN ▾</button>' +
      '        <button class="mock-panel__lang-btn mock-panel__lang-swap" type="button">⇄</button>' +
      '        <button class="mock-panel__lang-btn" type="button">FR ▾</button>' +
      "      </div>" +
      '      <button class="mock-panel__close" type="button" aria-label="Close">✕</button>' +
      "    </div>" +
      "  </div>" +
      '  <div class="mock-panel__body">' +
      '    <div class="mock-panel__heading">' +
      '      <span class="mock-panel__word">' + (word || "word") + "</span>" +
      '      <div class="mock-panel__actions-inline">' +
      '        <button class="mock-panel__icon-btn" data-action="pronounce" type="button" aria-label="Pronounce">' + speakerIcon() + "</button>" +
      '        <button class="mock-panel__icon-btn mock-panel__icon-btn_fav ' + (isFavorite ? "is-fav" : "") + '" data-action="favorite" type="button" aria-label="Add to favorite">' + starIcon() + "</button>" +
      "      </div>" +
      "    </div>" +
      '    <div class="mock-panel__chips">' +
      '      <button class="mock-panel__chip" data-action="chip" type="button">' + translations[0] + "</button>" +
      '      <button class="mock-panel__chip" data-action="chip" type="button">' + translations[1] + "</button>" +
      '      <button class="mock-panel__chip" data-action="chip" type="button">' + translations[2] + "</button>" +
      (translations[3] ? ('      <button class="mock-panel__chip" data-action="chip" type="button">' + translations[3] + "</button>") : "") +
      (translations[4] ? ('      <button class="mock-panel__chip" data-action="chip" type="button">' + translations[4] + "</button>") : "") +
      (translations[5] ? ('      <button class="mock-panel__chip" data-action="chip" type="button">' + translations[5] + "</button>") : "") +
      (translations[6] ? ('      <button class="mock-panel__chip" data-action="chip" type="button">' + translations[6] + "</button>") : "") +
      (translations[7] ? ('      <button class="mock-panel__chip" data-action="chip" type="button">' + translations[7] + "</button>") : "") +
      "    </div>" +
      '    <div class="mock-panel__context">' + (context || "No context available.") + "</div>" +
      "  </div>" +
      '  <div class="mock-panel__footer">' +
      '    <button class="mock-panel__open-app" data-action="open-app" type="button">reverso.com ' + externalIcon() + "</button>" +
      '    <div>' +
      '      <button class="mock-panel__flashcards" data-action="flashcards" type="button">' + flashcardsIcon() + " Flashcards</button>" +
      '    <span class="mock-panel__saved" id="mock-panel-saved"></span>' +
      "    </div>" +
      "  </div>" +
      "</div>";

    var root = host.querySelector("#" + PANEL_ID);
    var closeBtn = root.querySelector(".mock-panel__close");
    var savedMessage = root.querySelector("#mock-panel-saved");
    closeBtn.addEventListener("click", closePanel);

    root.addEventListener("click", function (evt) {
      var btn = evt.target.closest("[data-action]");
      if (!btn) return;
      var action = btn.getAttribute("data-action");
      if (action === "pronounce") {
        if (window.speechSynthesis && word) {
          window.speechSynthesis.cancel();
          window.speechSynthesis.speak(new SpeechSynthesisUtterance(word));
        }
      }
      if (action === "chip") {
        var selectedText = btn.textContent || "";
        navigator.clipboard && navigator.clipboard.writeText(selectedText).catch(function () {});
      }
      if (action === "favorite") {
        var key = word.toLowerCase();
        if (!favoritesByWord[key]) {
          var result = addFavorite(word, context, translations);
          favoritesByWord[key] = result || true;
          btn.classList.add("is-fav");
          if (result && typeof result === "object") addToRightSidebar(result);
        }
      }
      if (action === "open-app") {
        window.open("https://www.reverso.net/", "_blank", "noopener,noreferrer");
      }
      if (action === "flashcards") {
        window.open("https://www.reverso.net/history/flashcards/en?dir=en-fr", "_blank", "noopener,noreferrer");
      }
    });
  }

  function handleDoubleClick() {
    var sel = window.getSelection();
    if (!sel) return;
    var text = cleanWord(sel.toString());
    if (!text) return;
    lastSelection = {
      text: text,
      context: getContextFromSelection(sel)
    };
    renderPanel(lastSelection.text, lastSelection.context);
  }

  function setupIframeReplacementObserver() {
    var observer = new MutationObserver(function () {
      var host = document.querySelector("." + PANEL_CLASS);
      if (!host) return;
      var iframe = host.querySelector("iframe#reader");
      if (!iframe) return;
      iframe.remove();
      if (lastSelection.text) {
        renderPanel(lastSelection.text, lastSelection.context);
      } else {
        host.style.display = "none";
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  document.addEventListener("dblclick", function () {
    setTimeout(handleDoubleClick, 0);
  });

  document.addEventListener("keydown", function (evt) {
    if (evt.key === "Escape") closePanel();
  });

  setupIframeReplacementObserver();
  setupSidebarDeleteBridge();
  primeSidebarTemplateCache();
})();
