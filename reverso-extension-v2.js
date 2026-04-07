(() => {
  // Re-run safe cleanup
  const EXISTING_ID = "reverso_mock_root";
  document.getElementById(EXISTING_ID)?.remove();
  document.getElementById("reverso-context-block")?.remove();
  document.getElementById("reverso-saved-hint")?.remove();
  document.getElementById("reverso-mock-saved-hint-styles")?.remove();
  if (window.__reversoMockCleanup) {
    try {
      window.__reversoMockCleanup();
    } catch {}
    delete window.__reversoMockCleanup;
  }

  const root = document.createElement("div");
  root.id = EXISTING_ID;
  root.style.position = "fixed";
  root.style.left = "auto";
  root.style.top = "50%";
  root.style.right = "12px";
  root.style.transform = "translateY(-50%)";
  root.style.zIndex = "2147483647";
  root.style.userSelect = "none";
  root.style.webkitUserSelect = "none";
  root.style.touchAction = "none";
  document.documentElement.appendChild(root);

  const shadow = root.attachShadow({ mode: "open" });

  // Close mimic of Reverso "Quick control panel" (UX only; no APIs).
  shadow.innerHTML = `
    <style>
      :host{
        --text-blue-blue-secondary: #0a6cc2;
        --text-base-base-tertiary: #607d8b;
        --bg-base-quaternary: #eaeef1;
        --color-black-0: #fff;
        --bg-base-tertiary: #f7f9f9;
        --text-base-base-primary: #222c31;
        --line-gray-gray-secondary: #dee4e7;
        --light-a-8: rgba(34, 44, 49, .1);
      }
      .quick-control-panel{
        cursor:pointer;
        display:flex;
        padding:3px;
        box-sizing:border-box;
        border:1px solid var(--line-gray-gray-secondary);
        border-right:none;
        background:var(--color-black-0);
        box-shadow:0 4px 20px 0 var(--light-a-8);
        border-radius:8px 0 0 8px;
        width:40px;
      }
      .quick-control-panel__container{
        position:relative;
        display:flex;
        flex-direction:column-reverse;
        align-items:center;
        width:32px;
        height:32px;
      }
      .quick-control-panel__main-button{
        border:none;
        background-color:transparent;
        padding:0;
        cursor:grab;
        display:flex;
        width:32px;
        height:32px;
        touch-action:none;
        user-select:none;
      }
      .quick-control-panel__main-button:active{ cursor:grabbing; }
      .quick-control-panel__main-button svg{width:32px;height:32px}
      .quick-control-panel__menu-items{
        display:flex;
        flex-direction:column;
        position:absolute;
        opacity:0;
        transition:all .3s ease;
        pointer-events:none;
        background:var(--color-black-0);
        gap:8px;
        width:40px;
        padding:8px 3px 0;
        bottom:36px;
        box-sizing:border-box;
        border-radius:8px 0 0;
        border-top:1px solid var(--line-gray-gray-secondary);
        border-left:1px solid var(--line-gray-gray-secondary);
      }
      .quick-control-panel__item{
        border-radius:8px;
        background-color:transparent;
        border:none;
        display:flex;
        align-items:center;
        justify-content:center;
        cursor:pointer;
        transform:translateY(10px);
        opacity:0;
        padding:0;
        transition:opacity .3s ease,transform .3s ease;
        width:32px;
        height:32px;
      }
      .quick-control-panel__item svg{width:32px;height:32px}
      .quick-control-panel__item_active{background-color:var(--text-blue-blue-secondary)}
      .quick-control-panel__item_active svg.filled path{fill:var(--color-black-0)}
      .quick-control-panel__item_active svg.stroked path{stroke:var(--color-black-0)}
      .quick-control-panel__item:not(.quick-control-panel__item_active):hover{background-color:var(--bg-base-tertiary)}
      .quick-control-panel__item:not(.quick-control-panel__item_active):hover svg.filled path{fill:var(--text-blue-blue-secondary)}
      .quick-control-panel__item:not(.quick-control-panel__item_active):hover svg.stroked path{stroke:var(--text-blue-blue-secondary)}
      .quick-control-panel_expanded{
        border-radius:0 0 0 8px;
        border-top:1px solid transparent;
      }
      .quick-control-panel_expand-down .quick-control-panel__menu-items{
        top:36px;
        bottom:auto;
        border-radius:0 0 0 8px;
        border-top:none;
        border-bottom:1px solid var(--line-gray-gray-secondary);
      }
      .quick-control-panel_expanded.quick-control-panel_expand-down{
        border-radius:8px 0 0 0;
        border-top:1px solid var(--line-gray-gray-secondary);
        border-bottom:1px solid transparent;
      }
      .quick-control-panel_expanded .quick-control-panel__menu-items{opacity:1;pointer-events:all}
      .quick-control-panel_expanded .quick-control-panel__item{transform:translateY(0);opacity:1}
      .quick-control-panel_expanded .quick-control-panel__item:nth-child(1){transition-delay:.1s}
      .quick-control-panel_expanded .quick-control-panel__item:nth-child(2){transition-delay:.15s}
      .quick-control-panel_expanded .quick-control-panel__item:nth-child(3){transition-delay:.18s}
      .quick-control-panel_expanded .quick-control-panel__item:nth-child(4){transition-delay:.2s}
      .quick-control-panel__item_reading-list.quick-control-panel__item_saved svg path.reverso-save-icon__bg{
        fill:var(--text-blue-blue-secondary);
      }
      .quick-control-panel__item_reading-list.quick-control-panel__item_saved svg path.reverso-save-icon__fg{
        fill:var(--color-black-0);
      }
      .quick-control-panel__item_reading-list.quick-control-panel__item_saved svg path.reverso-save-icon__edge{
        fill:none;
        stroke:var(--text-blue-blue-secondary);
        stroke-width:1.2;
        stroke-linejoin:round;
        stroke-linecap:round;
      }
      .quick-control-panel__item.quick-control-panel__item_reading-list.quick-control-panel__item_saved:hover svg.filled path.reverso-save-icon__fg{
        fill:var(--color-black-0);
      }
      .quick-control-panel__item.quick-control-panel__item_reading-list.quick-control-panel__item_saved:hover svg.filled path.reverso-save-icon__edge{
        fill:none;
        stroke:var(--text-blue-blue-secondary);
      }
    </style>

    <div class="quick-control-panel">
      <div class="quick-control-panel__container">
        <button class="quick-control-panel__main-button" aria-label="Reverso">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
            <g>
              <rect width="32" height="32" rx="6" fill="white"></rect>
              <g>
                <g>
                  <g>
                    <path fill-rule="evenodd" clip-rule="evenodd" d="M14.2255 16.2328C13.8509 16.2328 13.5374 16.6657 13.2739 16.9319C13.0337 17.1746 12.7002 17.325 12.3316 17.325C11.5996 17.325 11.0061 16.7318 11.0061 16.0001C11.0061 15.2684 11.5996 14.6753 12.3316 14.6753C12.7422 14.6753 13.1091 14.8619 13.3523 15.1548C13.5787 15.4276 13.8709 15.8562 14.2255 15.8562C14.5801 15.8562 14.8723 15.4276 15.0987 15.1548C15.3418 14.8619 15.7088 14.6753 16.1194 14.6753C16.5301 14.6753 16.8973 14.862 17.1404 15.1552C17.3665 15.4279 17.6584 15.8562 18.0127 15.8562C18.367 15.8562 18.6589 15.4279 18.885 15.1552C19.1281 14.862 19.4952 14.6753 19.906 14.6753C20.6381 14.6753 21.2315 15.2684 21.2315 16.0001C21.2315 16.7318 20.6381 17.325 19.906 17.325C19.5372 17.325 19.2036 17.1744 18.9633 16.9315C18.7002 16.6655 18.3869 16.2328 18.0127 16.2328C17.6385 16.2328 17.3252 16.6655 17.0621 16.9315C16.8218 17.1744 16.4882 17.325 16.1194 17.325C15.7508 17.325 15.4173 17.1746 15.177 16.9319C14.9136 16.6657 14.6001 16.2328 14.2255 16.2328Z" fill="#157CD5"></path>
                    <path fill-rule="evenodd" clip-rule="evenodd" d="M8.30314 7.89468L14.7724 3.07702C15.0267 2.88767 15.3882 3.06905 15.3882 3.38598V6.17745H18.4119C23.8386 6.17745 28.2378 10.5745 28.2378 15.9986C28.2378 17.2689 27.9965 18.4828 27.5572 19.5972C27.4734 19.8099 27.2192 19.892 27.021 19.7777L24.7295 18.4554C24.5657 18.3608 24.4959 18.1618 24.5541 17.9819C24.7559 17.357 24.8649 16.6905 24.8649 15.9986C24.8649 12.4364 21.9758 9.54871 18.4119 9.54871H18.4115H16.4485V9.54856H9.29492C7.79946 9.54856 7.66198 8.299 8.30314 7.89468Z" fill="#157CD5"></path>
                    <path fill-rule="evenodd" clip-rule="evenodd" d="M23.9346 24.1053L17.4654 28.923C17.2111 29.1123 16.8496 28.931 16.8496 28.614V25.8225H13.8259C8.39921 25.8225 4.00001 21.4255 4.00001 16.0014C4.00001 14.7311 4.24129 13.5172 4.68056 12.4028C4.76443 12.1901 5.01864 12.1079 5.21678 12.2223L7.50827 13.5446C7.6721 13.6392 7.74185 13.8382 7.68374 14.0181C7.48193 14.643 7.37292 15.3095 7.37292 16.0014C7.37292 19.5636 10.262 22.4513 13.8259 22.4513H13.8263H15.7893V22.4514H22.9429C24.4383 22.4514 24.5758 23.701 23.9346 24.1053Z" fill="#DF3D22"></path>
                  </g>
                </g>
              </g>
            </g>
            <defs>
              <rect width="32" height="32" rx="6" fill="white"></rect>
            </defs>
          </svg>
        </button>

        <div class="quick-control-panel__menu-items" aria-hidden="true">
          <button class="quick-control-panel__item quick-control-panel__item_settings" data-action="settings" title="Settings">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" class="filled">
              <path fill-rule="evenodd" clip-rule="evenodd" d="M15.9998 12C13.774 12 11.9302 13.7694 11.9302 16C11.9302 18.2306 13.774 20 15.9998 20C18.2256 20 20.0693 18.2306 20.0693 16C20.0693 13.7694 18.2256 12 15.9998 12ZM13.9302 16C13.9302 14.9169 14.8351 14 15.9998 14C17.1645 14 18.0693 14.9169 18.0693 16C18.0693 17.0831 17.1645 18 15.9998 18C14.8351 18 13.9302 17.0831 13.9302 16Z" fill="#607D8B"></path>
              <path fill-rule="evenodd" clip-rule="evenodd" d="M13.9535 6C13.4865 6 13.0816 6.32326 12.9783 6.77871L12.5291 8.75825C12.1159 8.94853 11.7195 9.17256 11.3443 9.42807L9.34239 8.81221C8.9003 8.6762 8.42263 8.86113 8.18737 9.25937L6.14101 12.7234C5.89863 13.1336 5.97943 13.658 6.33407 13.9762L7.86394 15.3492C7.82801 15.783 7.82801 16.2188 7.86392 16.6526L6.33428 18.0246C5.97947 18.3428 5.89858 18.8673 6.14101 19.2776L8.18737 22.7416C8.42263 23.1399 8.9003 23.3248 9.34239 23.1888L11.3444 22.5729C11.7194 22.8281 12.1154 23.0518 12.5283 23.2419L12.9784 25.2217C13.0819 25.6769 13.4866 26 13.9535 26H18.0462C18.5131 26 18.9178 25.6769 19.0213 25.2217L19.4715 23.2415C19.8845 23.051 20.2807 22.8267 20.6558 22.571L22.6573 23.1868C23.0994 23.3228 23.5771 23.1379 23.8123 22.7396L25.8587 19.2756C26.1011 18.8653 26.0202 18.3408 25.6654 18.0226L24.1358 16.6506C24.1717 16.2169 24.1717 15.7811 24.1358 15.3474L25.6654 13.9754C26.0202 13.6572 26.1011 13.1327 25.8587 12.7224L23.8123 9.25837C23.5771 8.86013 23.0994 8.6752 22.6573 8.81121L20.6552 9.42712C20.2803 9.17193 19.8842 8.94817 19.4714 8.7581L19.0213 6.77833C18.9178 6.32306 18.5131 6 18.0462 6H13.9535ZM14.3659 9.70129L14.752 8H17.248L17.6349 9.70167C17.7089 10.0275 17.9409 10.2948 18.253 10.4141C18.8315 10.6352 19.3717 10.9401 19.8556 11.3181C20.1131 11.5193 20.4528 11.5819 20.7652 11.4858L22.4915 10.9547L23.7198 13.0339L22.4146 14.2046C22.1631 14.4301 22.0425 14.7674 22.094 15.1013C22.1857 15.6964 22.1857 16.3016 22.094 16.8967C22.0425 17.2306 22.1631 17.5679 22.4146 17.7934L23.7198 18.9641L22.4915 21.0433L20.7652 20.5122C20.4525 20.416 20.1125 20.4789 19.8548 20.6805C19.3711 21.0591 18.8309 21.3646 18.2523 21.5861C17.9405 21.7056 17.7089 21.9727 17.6349 22.2983L17.248 24H14.7517L14.3648 22.2983C14.2908 21.9725 14.0588 21.7052 13.7467 21.5859C13.1682 21.3648 12.628 21.0599 12.1441 20.6819C11.8866 20.4807 11.5469 20.4181 11.2345 20.5142L9.50817 21.0453L8.27989 18.9661L9.58509 17.7954C9.83655 17.5699 9.95715 17.2326 9.90574 16.8988C9.81408 16.3036 9.81408 15.6984 9.90574 15.1032C9.95713 14.7695 9.83662 14.4323 9.58531 14.2068L8.27977 13.0351L9.50817 10.9557L11.2345 11.4868C11.547 11.5829 11.8867 11.5202 12.1443 11.3189C12.6284 10.9406 13.1689 10.6354 13.7478 10.4141C14.06 10.2947 14.292 10.0273 14.3659 9.70129Z" fill="#607D8B"></path>
            </svg>
          </button>
          <button class="quick-control-panel__item quick-control-panel__item_user" data-action="user" title="User">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" class="filled">
              <g clip-path="url(#clip0_7383_11644)">
                <path d="M20.3 15.9999C20.3 15.3687 20.8117 14.8571 21.4429 14.8571H26.8572C27.4883 14.8571 28 15.3687 28 15.9999C28 16.6311 27.4883 17.1428 26.8572 17.1428H21.4429C20.8117 17.1428 20.3 16.6311 20.3 15.9999ZM21.4 20.5714C21.4 19.9402 21.9117 19.4285 22.5429 19.4285H26.8572C27.4883 19.4285 28 19.9402 28 20.5714C28 21.2025 27.4883 21.7142 26.8572 21.7142H22.5429C21.9117 21.7142 21.4 21.2025 21.4 20.5714ZM19.2 11.4285C19.2 10.7973 19.7117 10.2856 20.3429 10.2856H26.8572C27.4883 10.2856 28 10.7973 28 11.4285C28 12.0597 27.4883 12.5714 26.8572 12.5714H20.3429C19.7117 12.5714 19.2 12.0597 19.2 11.4285Z" fill="#607D8B"></path>
                <path fill-rule="evenodd" clip-rule="evenodd" d="M14 12C14 13.1046 13.1046 14 12 14C10.8954 14 10 13.1046 10 12C10 10.8954 10.8954 10 12 10C13.1046 10 14 10.8954 14 12ZM16 12C16 14.2091 14.2091 16 12 16C9.79086 16 8 14.2091 8 12C8 9.79086 9.79086 8 12 8C14.2091 8 16 9.79086 16 12ZM6.00131 22C6.0494 20.335 7.41425 19 9.09091 19H14.9091C16.5857 19 17.9506 20.335 17.9987 22H6.00131ZM4 22.0909C4 19.2793 6.27928 17 9.09091 17H14.9091C17.7207 17 20 19.2793 20 22.0909C20 23.1453 19.1453 24 18.0909 24H5.90909C4.85473 24 4 23.1453 4 22.0909Z" fill="#607D8B"></path>
              </g>
              <defs>
                <clippath id="clip0_7383_11644"><rect width="24" height="24" fill="white" transform="translate(4 4)"></rect></clippath>
              </defs>
            </svg>
          </button>
          <button class="quick-control-panel__item quick-control-panel__item_reading-list" data-action="reading" title="Reading list">
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none" class="filled">
              <path fill-rule="evenodd" clip-rule="evenodd" d="M11 8C10.7348 8 10.4804 8.10536 10.2929 8.29289C10.1054 8.48043 10 8.73478 10 9V23.2768L15.5039 20.1318C15.8113 19.9561 16.1887 19.9561 16.4961 20.1318L22 23.2768V9C22 8.73478 21.8946 8.48043 21.7071 8.29289C21.5196 8.10536 21.2652 8 21 8H11ZM8.87868 6.87868C9.44129 6.31607 10.2044 6 11 6H21C21.7956 6 22.5587 6.31607 23.1213 6.87868C23.6839 7.44129 24 8.20435 24 9V25C24 25.3565 23.8102 25.686 23.5019 25.8649C23.1936 26.0438 22.8134 26.0451 22.5039 25.8682L16 22.1518L9.49614 25.8682C9.18664 26.0451 8.80639 26.0438 8.49807 25.8649C8.18976 25.686 8 25.3565 8 25V9C8 8.20435 8.31607 7.44129 8.87868 6.87868ZM16 10C16.5523 10 17 10.4477 17 11V13H19C19.5523 13 20 13.4477 20 14C20 14.5523 19.5523 15 19 15H17V17C17 17.5523 16.5523 18 16 18C15.4477 18 15 17.5523 15 17V15H13C12.4477 15 12 14.5523 12 14C12 13.4477 12.4477 13 13 13H15V11C15 10.4477 15.4477 10 16 10Z" fill="#607D8B"></path>
            </svg>
          </button>
          <button class="quick-control-panel__item quick-control-panel__item_one-click" data-action="oneclick" title="One click">
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none" class="stroked">
              <g clip-path="url(#clip0_5575_37)">
                <path d="M6 16H9.33333M16 6V9.33333M11.3333 11.3333L8.88889 8.88889M20.6667 11.3333L23.1111 8.88889M11.3333 20.6667L8.88889 23.1111M16 16L26 19.3333L21.5556 21.5556L19.3333 26L16 16Z" stroke="#607D8B" stroke-width="2.22222" stroke-linecap="round" stroke-linejoin="round"></path>
              </g>
              <defs>
                <clippath id="clip0_5575_37"><rect width="24" height="24" fill="white" transform="translate(4 4)"></rect></clippath>
              </defs>
            </svg>
          </button>
        </div>
      </div>
    </div>
  `;

  /* Saved hint must live in light DOM: #reverso_mock_root uses transform, which breaks position:fixed inside shadow. */
  const hintStyleEl = document.createElement("style");
  hintStyleEl.id = "reverso-mock-saved-hint-styles";
  hintStyleEl.textContent = `
    #reverso-saved-hint.reverso-saved-hint{
      position:fixed;
      z-index:2147483648;
      max-width:260px;
      padding:12px 14px 12px 16px;
      background:#1c2023;
      border-radius:8px;
      box-shadow:0 8px 24px rgba(0,0,0,.28);
      pointer-events:none;
      opacity:0;
      visibility:hidden;
      transition:opacity .22s ease,visibility .22s ease;
    }
    #reverso-saved-hint.reverso-saved-hint.reverso-saved-hint--visible{
      opacity:1;
      visibility:visible;
    }
    #reverso-saved-hint.reverso-saved-hint::after{
      content:"";
      position:absolute;
      left:100%;
      top:50%;
      transform:translateY(-50%);
      border:7px solid transparent;
      border-left-color:#1c2023;
    }
    #reverso-saved-hint .reverso-saved-hint__title{
      color:#fff;
      font-family:system-ui,-apple-system,sans-serif;
      font-size:14px;
      font-weight:700;
      line-height:1.3;
      margin:0 0 6px;
    }
    #reverso-saved-hint .reverso-saved-hint__desc{
      color:rgba(255,255,255,.72);
      font-family:system-ui,-apple-system,sans-serif;
      font-size:12px;
      font-weight:400;
      line-height:1.45;
      margin:0;
    }
  `;
  document.head.appendChild(hintStyleEl);

  const savedHintEl = document.createElement("div");
  savedHintEl.id = "reverso-saved-hint";
  savedHintEl.className = "reverso-saved-hint";
  savedHintEl.setAttribute("role", "status");
  savedHintEl.setAttribute("aria-live", "polite");
  savedHintEl.innerHTML =
    '<p class="reverso-saved-hint__title">You\'ve already saved this article.</p>' +
    '<p class="reverso-saved-hint__desc">Open it in the reader for more features.</p>';
  document.documentElement.appendChild(savedHintEl);

  const SAVED_URLS_KEY = "reverso_mock_saved_urls";
  const READING_LIST_ICON_UNSAVED = `
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none" class="filled">
              <path fill-rule="evenodd" clip-rule="evenodd" d="M11 8C10.7348 8 10.4804 8.10536 10.2929 8.29289C10.1054 8.48043 10 8.73478 10 9V23.2768L15.5039 20.1318C15.8113 19.9561 16.1887 19.9561 16.4961 20.1318L22 23.2768V9C22 8.73478 21.8946 8.48043 21.7071 8.29289C21.5196 8.10536 21.2652 8 21 8H11ZM8.87868 6.87868C9.44129 6.31607 10.2044 6 11 6H21C21.7956 6 22.5587 6.31607 23.1213 6.87868C23.6839 7.44129 24 8.20435 24 9V25C24 25.3565 23.8102 25.686 23.5019 25.8649C23.1936 26.0438 22.8134 26.0451 22.5039 25.8682L16 22.1518L9.49614 25.8682C9.18664 26.0451 8.80639 26.0438 8.49807 25.8649C8.18976 25.686 8 25.3565 8 25V9C8 8.20435 8.31607 7.44129 8.87868 6.87868ZM16 10C16.5523 10 17 10.4477 17 11V13H19C19.5523 13 20 13.4477 20 14C20 14.5523 19.5523 15 19 15H17V17C17 17.5523 16.5523 18 16 18C15.4477 18 15 17.5523 15 17V15H13C12.4477 15 12 14.5523 12 14C12 13.4477 12.4477 13 13 13H15V11C15 10.4477 15.4477 10 16 10Z" fill="#607D8B"></path>
            </svg>`;
  const READING_LIST_ICON_SAVED = `
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none" class="filled">
              <path class="reverso-save-icon__bg" fill-rule="evenodd" clip-rule="evenodd" d="M8.87868 6.87868C9.44129 6.31607 10.2044 6 11 6H21C21.7956 6 22.5587 6.31607 23.1213 6.87868C23.6839 7.44129 24 8.20435 24 9V25C24 25.3565 23.8102 25.686 23.5019 25.8649C23.1936 26.0438 22.8134 26.0451 22.5039 25.8682L16 22.1518L9.49614 25.8682C9.18664 26.0451 8.80639 26.0438 8.49807 25.8649C8.18976 25.686 8 25.3565 8 25V9C8 8.20435 8.31607 7.44129 8.87868 6.87868Z"></path>
              <path class="reverso-save-icon__fg" fill-rule="evenodd" clip-rule="evenodd" d="M11 8C10.7348 8 10.4804 8.10536 10.2929 8.29289C10.1054 8.48043 10 8.73478 10 9V23.2768L15.5039 20.1318C15.8113 19.9561 16.1887 19.9561 16.4961 20.1318L22 23.2768V9C22 8.73478 21.8946 8.48043 21.7071 8.29289C21.5196 8.10536 21.2652 8 21 8H11ZM8.87868 6.87868C9.44129 6.31607 10.2044 6 11 6H21C21.7956 6 22.5587 6.31607 23.1213 6.87868C23.6839 7.44129 24 8.20435 24 9V25C24 25.3565 23.8102 25.686 23.5019 25.8649C23.1936 26.0438 22.8134 26.0451 22.5039 25.8682L16 22.1518L9.49614 25.8682C9.18664 26.0451 8.80639 26.0438 8.49807 25.8649C8.18976 25.686 8 25.3565 8 25V9C8 8.20435 8.31607 7.44129 8.87868 6.87868ZM16 10C16.5523 10 17 10.4477 17 11V13H19C19.5523 13 20 13.4477 20 14C20 14.5523 19.5523 15 19 15H17V17C17 17.5523 16.5523 18 16 18C15.4477 18 15 17.5523 15 17V15H13C12.4477 15 12 14.5523 12 14C12 13.4477 12.4477 13 13 13H15V11C15 10.4477 15.4477 10 16 10Z"></path>
              <path class="reverso-save-icon__edge" fill="none" stroke="var(--text-blue-blue-secondary)" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round" d="M8.87868 6.87868C9.44129 6.31607 10.2044 6 11 6H21C21.7956 6 22.5587 6.31607 23.1213 6.87868C23.6839 7.44129 24 8.20435 24 9V25C24 25.3565 23.8102 25.686 23.5019 25.8649C23.1936 26.0438 22.8134 26.0451 22.5039 25.8682L16 22.1518L9.49614 25.8682C9.18664 26.0451 8.80639 26.0438 8.49807 25.8649C8.18976 25.686 8 25.3565 8 25V9C8 8.20435 8.31607 7.44129 8.87868 6.87868Z"></path>
            </svg>`;

  const $ = (sel) => shadow.querySelector(sel);
  const panelEl = $(".quick-control-panel");
  const mainBtn = $(".quick-control-panel__main-button");
  const menu = $(".quick-control-panel__menu-items");
  const oneClickBtn = $(".quick-control-panel__item_one-click");
  const readingListBtn = $(".quick-control-panel__item_reading-list");

  const normalizeArticleUrl = (href) => {
    try {
      const u = new URL(href, location.href);
      u.hash = "";
      let s = u.toString();
      if (s.endsWith("/")) s = s.slice(0, -1);
      return s;
    } catch {
      return href.replace(/#.*$/, "").replace(/\/$/, "");
    }
  };

  const loadSavedUrlSet = () => {
    try {
      const raw = localStorage.getItem(SAVED_URLS_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(arr) ? arr.map(String) : []);
    } catch {
      return new Set();
    }
  };

  const persistSavedUrlSet = (set) => {
    try {
      localStorage.setItem(SAVED_URLS_KEY, JSON.stringify([...set]));
    } catch {}
  };

  const isCurrentArticleSaved = () => {
    const key = normalizeArticleUrl(location.href);
    const set = loadSavedUrlSet();
    const inLibrary = set.has(key);
    console.log("[reverso-mock] saved-article check", {
      normalizedKey: key,
      locationHref: location.href,
      inLibrary,
      libraryCount: set.size,
      libraryUrls: [...set],
    });
    if (inLibrary) {
      console.log("[reverso-mock] saved-article check → true (URL in reverso_mock_saved_urls)");
      return true;
    }
    try {
      const sp = new URLSearchParams(location.search);
      const revParam = sp.get("reverso_saved");
      if (revParam === "1") {
        set.add(key);
        persistSavedUrlSet(set);
        sp.delete("reverso_saved");
        const next =
          location.pathname + (sp.toString() ? `?${sp.toString()}` : "") + location.hash;
        history.replaceState(null, "", next);
        console.log("[reverso-mock] saved-article check → true (reverso_saved=1, persisted to library)");
        return true;
      }
      console.log("[reverso-mock] saved-article check: no ?reverso_saved=1", { reverso_saved: revParam });
    } catch (err) {
      console.log("[reverso-mock] saved-article check: query parse failed", err);
    }
    console.log("[reverso-mock] saved-article check → false");
    return false;
  };

  const setReadingListSavedUi = (saved) => {
    readingListBtn.classList.toggle("quick-control-panel__item_saved", saved);
    readingListBtn.innerHTML = saved ? READING_LIST_ICON_SAVED : READING_LIST_ICON_UNSAVED;
    readingListBtn.title = saved ? "Saved to reading list" : "Reading list";
  };

  let savedHintVisible = false;
  const positionSavedHint = () => {
    if (!savedHintVisible) return;
    const pr = panelEl.getBoundingClientRect();
    const br = readingListBtn.getBoundingClientRect();
    savedHintEl.style.left = "0";
    savedHintEl.style.top = "0";
    const h = savedHintEl.offsetHeight;
    const left = Math.max(8, pr.left - savedHintEl.offsetWidth - 12);
    const top = Math.min(
      Math.max(8, br.top + br.height / 2 - h / 2),
      innerHeight - h - 8
    );
    savedHintEl.style.left = `${left}px`;
    savedHintEl.style.top = `${top}px`;
    console.log("[reverso-mock] saved-hint position", {
      left,
      top,
      hintW: savedHintEl.offsetWidth,
      hintH: savedHintEl.offsetHeight,
      panelLeft: pr.left,
      bookmarkTop: br.top,
      hasVisibleClass: savedHintEl.classList.contains("reverso-saved-hint--visible"),
    });
  };

  const showSavedArticleHint = () => {
    console.log("[reverso-mock] saved-hint: show()", {
      hintElement: Boolean(savedHintEl),
      inLightDom: savedHintEl?.parentNode === document.documentElement,
    });
    savedHintVisible = true;
    savedHintEl.classList.add("reverso-saved-hint--visible");
    requestAnimationFrame(() => {
      positionSavedHint();
      requestAnimationFrame(positionSavedHint);
    });
  };

  const hideSavedArticleHint = () => {
    if (savedHintVisible) console.log("[reverso-mock] saved-hint: hide()");
    savedHintVisible = false;
    savedHintEl.classList.remove("reverso-saved-hint--visible");
  };

  // Context iframe block (matches extension's UX container shape/positioning; uses saved popup html)
  const contextBlock = document.createElement("div");
  contextBlock.id = "reverso-context-block";
  contextBlock.style.width = "450px";
  contextBlock.style.maxHeight = "229px";
  contextBlock.style.minHeight = "229px";
  contextBlock.style.height = "100%";
  contextBlock.style.left = "30px";
  contextBlock.style.top = "140px";
  contextBlock.style.position = "fixed";
  contextBlock.style.visibility = "hidden";
  contextBlock.style.zIndex = "2147483647";
  contextBlock.style.boxShadow = "0 18px 50px rgba(0,0,0,.18)";
  contextBlock.style.borderRadius = "14px";
  contextBlock.style.overflow = "hidden";
  contextBlock.style.background = "#fff";
  contextBlock.style.border = "1px solid #dee4e7";
  const iframe = document.createElement("iframe");
  iframe.id = "reverso-context-iframe";
  iframe.width = "450";
  iframe.height = "229";
  iframe.src = "./France 24 - Noticias y actualidad internacional en vivo_files/index.html";
  iframe.style.border = "0";
  contextBlock.appendChild(iframe);
  document.documentElement.appendChild(contextBlock);

  // Inline selection button (mimics extension's "turn on interactive reading" control bubble)
  const selectionButton = document.createElement("div");
  selectionButton.id = "reverso-selection-button";
  selectionButton.style.position = "fixed";
  selectionButton.style.zIndex = "2147483647";
  selectionButton.style.display = "none";
  selectionButton.style.height = "28px";
  selectionButton.style.width = "28px";
  selectionButton.style.boxShadow = "0 2px 2px 0 rgba(0,0,0,.14), 0 3px 1px -2px rgba(0,0,0,.2), 0 1px 5px 0 rgba(0,0,0,.12)";
  selectionButton.style.backgroundColor = "#fff";
  selectionButton.style.border = "1px solid #eaeef1";
  selectionButton.style.borderRadius = "108px";
  selectionButton.style.overflow = "hidden";
  selectionButton.style.cursor = "pointer";
  selectionButton.style.userSelect = "none";
  selectionButton.style.alignItems = "center";
  selectionButton.style.justifyContent = "space-between";
  selectionButton.style.boxSizing = "border-box";

  const selectionTranslate = document.createElement("button");
  selectionTranslate.type = "button";
  selectionTranslate.style.width = "100%";
  selectionTranslate.style.padding = "2px";
  selectionTranslate.style.border = "none";
  selectionTranslate.style.background = "transparent";
  selectionTranslate.style.display = "flex";
  selectionTranslate.style.justifyContent = "center";
  selectionTranslate.style.cursor = "pointer";
  selectionTranslate.style.boxSizing = "border-box";
  selectionTranslate.title = "Translate selection";
  selectionTranslate.innerHTML = `
    <svg width="24" height="24" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="32" height="32" rx="16" fill="white"></rect>
      <path fill-rule="evenodd" clip-rule="evenodd" d="M14.2255 16.2328C13.8509 16.2328 13.5374 16.6657 13.2739 16.9319C13.0337 17.1746 12.7002 17.325 12.3316 17.325C11.5996 17.325 11.0061 16.7318 11.0061 16.0001C11.0061 15.2684 11.5996 14.6753 12.3316 14.6753C12.7422 14.6753 13.1091 14.8619 13.3523 15.1548C13.5787 15.4276 13.8709 15.8562 14.2255 15.8562C14.5801 15.8562 14.8723 15.4276 15.0987 15.1548C15.3418 14.8619 15.7088 14.6753 16.1194 14.6753C16.5301 14.6753 16.8973 14.862 17.1404 15.1552C17.3665 15.4279 17.6584 15.8562 18.0127 15.8562C18.367 15.8562 18.6589 15.4279 18.885 15.1552C19.1281 14.862 19.4952 14.6753 19.906 14.6753C20.6381 14.6753 21.2315 15.2684 21.2315 16.0001C21.2315 16.7318 20.6381 17.325 19.906 17.325C19.5372 17.325 19.2036 17.1744 18.9633 16.9315C18.7002 16.6655 18.3869 16.2328 18.0127 16.2328C17.6385 16.2328 17.3252 16.6655 17.0621 16.9315C16.8218 17.1744 16.4882 17.325 16.1194 17.325C15.7508 17.325 15.4173 17.1746 15.177 16.9319C14.9136 16.6657 14.6001 16.2328 14.2255 16.2328Z" fill="#157CD5"></path>
      <path fill-rule="evenodd" clip-rule="evenodd" d="M8.30314 7.89468L14.7724 3.07702C15.0267 2.88767 15.3882 3.06905 15.3882 3.38598V6.17745H18.4119C23.8386 6.17745 28.2378 10.5745 28.2378 15.9986C28.2378 17.2689 27.9965 18.4828 27.5572 19.5972C27.4734 19.8099 27.2192 19.892 27.021 19.7777L24.7295 18.4554C24.5657 18.3608 24.4959 18.1618 24.5541 17.9819C24.7559 17.357 24.8649 16.6905 24.8649 15.9986C24.8649 12.4364 21.9758 9.54871 18.4119 9.54871H18.4115H16.4485V9.54856H9.29492C7.79946 9.54856 7.66198 8.299 8.30314 7.89468Z" fill="#157CD5"></path>
      <path fill-rule="evenodd" clip-rule="evenodd" d="M23.9346 24.1053L17.4654 28.923C17.2111 29.1123 16.8496 28.931 16.8496 28.614V25.8225H13.8259C8.39921 25.8225 4.00001 21.4255 4.00001 16.0014C4.00001 14.7311 4.24129 13.5172 4.68056 12.4028C4.76443 12.1901 5.01864 12.1079 5.21678 12.2223L7.50827 13.5446C7.6721 13.6392 7.74185 13.8382 7.68374 14.0181C7.48193 14.643 7.37292 15.3095 7.37292 16.0014C7.37292 19.5636 10.262 22.4513 13.8259 22.4513H13.8263H15.7893V22.4514H22.9429C24.4383 22.4514 24.5758 23.701 23.9346 24.1053Z" fill="#DF3D22"></path>
    </svg>
  `;

  const selectionTurnOff = document.createElement("button");
  selectionTurnOff.type = "button";
  selectionTurnOff.style.display = "none";
  selectionTurnOff.style.width = "100%";
  selectionTurnOff.style.padding = "2px";
  selectionTurnOff.style.border = "none";
  selectionTurnOff.style.background = "transparent";
  selectionTurnOff.style.justifyContent = "center";
  selectionTurnOff.style.cursor = "pointer";
  selectionTurnOff.style.boxSizing = "border-box";
  selectionTurnOff.title = "Turn off interactive reading";
  selectionTurnOff.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2v10" stroke="#607D8B" stroke-width="2" stroke-linecap="round"></path><path d="M7.05 4.93a8 8 0 1 0 9.9 0" stroke="#607D8B" stroke-width="2" stroke-linecap="round"></path></svg>`;

  selectionButton.appendChild(selectionTurnOff);
  selectionButton.appendChild(selectionTranslate);
  document.documentElement.appendChild(selectionButton);

  // Corner snapping overlays
  const CORNER_ZONE_SIZE = 92;
  const cornerZones = {
    tl: document.createElement("div"),
    tr: document.createElement("div"),
    bl: document.createElement("div"),
    br: document.createElement("div"),
  };
  Object.entries(cornerZones).forEach(([key, el]) => {
    el.className = `reverso-corner-zone reverso-corner-zone-${key}`;
    el.style.position = "fixed";
    el.style.width = `${CORNER_ZONE_SIZE}px`;
    el.style.height = `${CORNER_ZONE_SIZE}px`;
    el.style.background = "rgba(10,108,194,0.22)";
    el.style.border = "1px solid rgba(10,108,194,0.45)";
    el.style.boxSizing = "border-box";
    el.style.pointerEvents = "none";
    el.style.opacity = "0";
    el.style.transition = "opacity .14s ease, transform .14s ease";
    el.style.zIndex = "2147483646";
    if (key === "tl") {
      el.style.top = "0";
      el.style.left = "0";
      el.style.borderRadius = "0 0 14px 0";
    } else if (key === "tr") {
      el.style.top = "0";
      el.style.right = "0";
      el.style.borderRadius = "0 0 0 14px";
    } else if (key === "bl") {
      el.style.bottom = "0";
      el.style.left = "0";
      el.style.borderRadius = "0 14px 0 0";
    } else {
      el.style.bottom = "0";
      el.style.right = "0";
      el.style.borderRadius = "14px 0 0 0";
    }
    document.documentElement.appendChild(el);
  });

  let expanded = false;
  let oneClickEnabled = false;
  const MENU_VIEWPORT_MARGIN = 8;
  const updateMenuExpandDirection = () => {
    const panelRect = panelEl.getBoundingClientRect();
    const menuHeight = menu.scrollHeight || menu.getBoundingClientRect().height || 0;
    const canExpandUpToTop = panelRect.top >= menuHeight + MENU_VIEWPORT_MARGIN;
    panelEl.classList.toggle("quick-control-panel_expand-down", !canExpandUpToTop);
  };
  const setExpanded = (v) => {
    updateMenuExpandDirection();
    expanded = v;
    panelEl.classList.toggle("quick-control-panel_expanded", expanded);
    menu.setAttribute("aria-hidden", String(!expanded));
    if (!expanded) hideSavedArticleHint();
    else if (savedHintVisible) {
      requestAnimationFrame(() => {
        positionSavedHint();
        requestAnimationFrame(positionSavedHint);
      });
    }
  };
  const setOneClick = (v) => {
    oneClickEnabled = v;
    oneClickBtn.classList.toggle("quick-control-panel__item_active", oneClickEnabled);
    if (!oneClickEnabled) {
      contextBlock.style.visibility = "hidden";
      selectionButton.style.display = "none";
    }
  };

  const onDocMouseDown = (e) => {
    const path = e.composedPath?.() || [];
    if (!path.includes(root)) setExpanded(false);
  };

  mainBtn.addEventListener("click", (e) => {
    if (mainBtn.dataset.dragged === "1") {
      mainBtn.dataset.dragged = "0";
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    setExpanded(!expanded);
  });

  document.addEventListener("mousedown", onDocMouseDown, true);

  menu.addEventListener("click", (e) => {
    const btn = e.target.closest?.("button.quick-control-panel__item");
    if (!btn) return;
    const action = btn.dataset.action || "";
    if (action === "oneclick") setOneClick(!oneClickEnabled);
    if (action === "reading") {
      const key = normalizeArticleUrl(location.href);
      const set = loadSavedUrlSet();
      if (set.has(key)) {
        set.delete(key);
        hideSavedArticleHint();
      } else {
        set.add(key);
      }
      persistSavedUrlSet(set);
      setReadingListSavedUi(set.has(key));
    }
    btn.animate(
      [{ transform: "scale(1)" }, { transform: "scale(0.92)" }, { transform: "scale(1)" }],
      { duration: 140 }
    );
  });

  // Drag
  let dragging = false;
  let pid = null;
  let sx = 0,
    sy = 0,
    sl = 0,
    st = 0;
  let activeSnapCorner = null;

  const detectActiveCorner = (x, y) => {
    const w = innerWidth;
    const h = innerHeight;
    if (x <= CORNER_ZONE_SIZE && y <= CORNER_ZONE_SIZE) return "tl";
    if (x >= w - CORNER_ZONE_SIZE && y <= CORNER_ZONE_SIZE) return "tr";
    if (x <= CORNER_ZONE_SIZE && y >= h - CORNER_ZONE_SIZE) return "bl";
    if (x >= w - CORNER_ZONE_SIZE && y >= h - CORNER_ZONE_SIZE) return "br";
    return null;
  };

  const updateCornerZones = (hoverCorner) => {
    Object.entries(cornerZones).forEach(([key, el]) => {
      const show = !hoverCorner || hoverCorner === key;
      el.style.opacity = show ? (hoverCorner === key ? "1" : "0.45") : "0";
      el.style.transform = hoverCorner === key ? "scale(1.03)" : "scale(1)";
    });
  };

  const hideCornerZones = () => {
    Object.values(cornerZones).forEach((el) => {
      el.style.opacity = "0";
      el.style.transform = "scale(1)";
    });
  };

  const snapToCorner = (corner) => {
    root.style.right = "auto";
    root.style.bottom = "auto";
    root.style.transform = "none";
    const r = root.getBoundingClientRect();
    const margin = 6;
    if (corner === "tl") {
      root.style.left = `${margin}px`;
      root.style.top = `${margin}px`;
    } else if (corner === "tr") {
      root.style.left = `${Math.max(margin, innerWidth - r.width - margin)}px`;
      root.style.top = `${margin}px`;
    } else if (corner === "bl") {
      root.style.left = `${margin}px`;
      root.style.top = `${Math.max(margin, innerHeight - r.height - margin)}px`;
    } else if (corner === "br") {
      root.style.left = `${Math.max(margin, innerWidth - r.width - margin)}px`;
      root.style.top = `${Math.max(margin, innerHeight - r.height - margin)}px`;
    }
  };

  const ensureFixedXY = () => {
    const r = root.getBoundingClientRect();
    root.style.right = "auto";
    root.style.transform = "none";
    root.style.left = `${Math.max(0, r.left)}px`;
    root.style.top = `${Math.max(0, r.top)}px`;
  };

  const clamp = () => {
    const r = root.getBoundingClientRect();
    const left = Math.min(Math.max(0, r.left), Math.max(0, innerWidth - r.width));
    const top = Math.min(Math.max(0, r.top), Math.max(0, innerHeight - r.height));
    root.style.left = `${left}px`;
    root.style.top = `${top}px`;
  };

  const onMove = (e) => {
    if (!dragging || e.pointerId !== pid) return;
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) mainBtn.dataset.dragged = "1";
    root.style.left = `${sl + dx}px`;
    root.style.top = `${st + dy}px`;
    clamp();
    updateMenuExpandDirection();
    activeSnapCorner = detectActiveCorner(e.clientX, e.clientY);
    updateCornerZones(activeSnapCorner);
  };

  const stop = (e) => {
    if (!dragging || e.pointerId !== pid) return;
    dragging = false;
    pid = null;
    if (activeSnapCorner) {
      snapToCorner(activeSnapCorner);
    }
    updateMenuExpandDirection();
    activeSnapCorner = null;
    hideCornerZones();
    window.removeEventListener("pointermove", onMove, true);
    window.removeEventListener("pointerup", stop, true);
    window.removeEventListener("pointercancel", stop, true);
  };

  mainBtn.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      ensureFixedXY();
      const r = root.getBoundingClientRect();
      dragging = true;
      pid = e.pointerId;
      sx = e.clientX;
      sy = e.clientY;
      sl = r.left;
      st = r.top;
      try {
        mainBtn.setPointerCapture(e.pointerId);
      } catch {}
      updateCornerZones(null);
      window.addEventListener("pointermove", onMove, true);
      window.addEventListener("pointerup", stop, true);
      window.addEventListener("pointercancel", stop, true);
    },
    true
  );

  addEventListener(
    "resize",
    () => {
      clamp();
      updateMenuExpandDirection();
    },
    { passive: true }
  );
  addEventListener(
    "resize",
    () => {
      if (savedHintVisible) positionSavedHint();
    },
    { passive: true }
  );

  // Selection popup (UX only)
  const onKeyDown = (e) => {
    if (e.key !== "Escape") return;
    contextBlock.style.visibility = "hidden";
    selectionButton.style.display = "none";
  };

  document.addEventListener("keydown", onKeyDown);

  const getSelectionText = () => (window.getSelection?.().toString() || "").trim();

  const showSelectionButton = (x, y) => {
    const width = selectionButton.offsetWidth || 28;
    const height = selectionButton.offsetHeight || 28;
    const margin = 8;
    const left = Math.min(Math.max(margin, x), innerWidth - width - margin);
    const top = Math.min(Math.max(margin, y), innerHeight - height - margin);
    selectionButton.style.left = `${left}px`;
    selectionButton.style.top = `${top}px`;
    selectionButton.style.display = "flex";
  };

  const openContextNearSelection = () => {
    const sel = window.getSelection();
    const range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
    const rect = range?.getBoundingClientRect?.();

    const w = 450;
    const h = 229;
    const margin = 10;
    const x = rect && rect.width + rect.height > 0 ? rect.left : innerWidth / 2;
    const y = rect && rect.width + rect.height > 0 ? rect.bottom + 8 : innerHeight / 2;
    const left = Math.min(Math.max(margin, x), innerWidth - w - margin);
    const top = Math.min(Math.max(margin, y), innerHeight - h - margin);
    contextBlock.style.left = `${left}px`;
    contextBlock.style.top = `${top}px`;
    contextBlock.style.visibility = "visible";

    // When panel is opened, extend selection button with "turn off"
    selectionButton.style.width = "58px";
    selectionButton.style.flexDirection = "row-reverse";
    selectionTurnOff.style.display = "flex";
    selectionTranslate.style.paddingRight = "0";
  };

  const resetSelectionButtonCompact = () => {
    selectionButton.style.width = "28px";
    selectionButton.style.flexDirection = "row";
    selectionTurnOff.style.display = "none";
    selectionTranslate.style.paddingRight = "2px";
  };

  const updateFromSelection = () => {
    if (!oneClickEnabled) return;
    const text = getSelectionText();
    if (!text) {
      contextBlock.style.visibility = "hidden";
      selectionButton.style.display = "none";
      return;
    }
    const sel = window.getSelection();
    const range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
    const rect = range?.getBoundingClientRect?.();
    const x = rect && rect.width + rect.height > 0 ? rect.left + rect.width / 2 - 14 : innerWidth / 2;
    const y = rect && rect.width + rect.height > 0 ? rect.bottom + 8 : innerHeight / 2;
    resetSelectionButtonCompact();
    showSelectionButton(x, y);
  };

  let selTimer = null;
  const onSelectionChange = () => {
    clearTimeout(selTimer);
    selTimer = setTimeout(updateFromSelection, 80);
  };

  document.addEventListener("selectionchange", onSelectionChange);

  selectionTranslate.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openContextNearSelection();
  });

  selectionTurnOff.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    setOneClick(false);
    resetSelectionButtonCompact();
  });

  // Default mimic: start with menu collapsed and one-click OFF
  updateMenuExpandDirection();
  setExpanded(false);
  setOneClick(false);
  const bootArticleSaved = isCurrentArticleSaved();
  if (bootArticleSaved) {
    console.log("[reverso-mock] boot: opening drawer + filled save icon + saved-hint");
    setReadingListSavedUi(true);
    setExpanded(true);
    showSavedArticleHint();
  } else {
    console.log("[reverso-mock] boot: drawer stays closed (article not considered saved)");
  }

  // Expose cleanup for easier iteration
  window.__reversoMockCleanup = () => {
    document.removeEventListener("mousedown", onDocMouseDown, true);
    document.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("selectionchange", onSelectionChange);
    Object.values(cornerZones).forEach((el) => el.remove());
    selectionButton.remove();
    contextBlock.remove();
    savedHintEl.remove();
    hintStyleEl.remove();
    root.remove();
  };

  console.log("[reverso-mock] loaded (file).");
})();

