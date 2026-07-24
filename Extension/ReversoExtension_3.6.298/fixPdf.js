/*---------------------------------------------------------------------------
 * @Developer: Aleksey Romanov
 * @Project URI: www.domprog.com, www.sites4web.ru
 * @Copyright: DomProg
 *----------------------------------------------------------------------------
 */
'use strict';

const SELECTORS = [
  '#sidebarContainer',
  '#findbar',
  '#editorFreeTextParamsToolbar',
  '#editorInkParamsToolbar',
  '#editorInkParamsToolbar',
  '#editorStampParamsToolbar',
  '#mainContainer > .toolbar',
  '#dialogContainer',
  '#printContainer',
  '#secondaryToolbar',
];

//sidebarToggle
function setAttributeOneClick() {
  SELECTORS.forEach((el) => {
    document.querySelector(el)?.setAttribute('data-oneclick', 'false');
  });
}

function regOnMouse(event) {
  const className = 'ReversoReader__added_line_break';
  if (event.path?.length && !event.path[0].classList?.contains(className)) {
    let element = event.path[0];
    if (
      element.previousSibling &&
      element.offsetTop &&
      element.previousSibling.offsetTop &&
      element.offsetTop > element.previousSibling.offsetTop
    ) {
      element.textContent = `\uFEFF${element.textContent}`;
    }
    element.classList.add(className);
  }
}

// Document ready
window.onload = function () {
  //addedButtonOneClick();
  setAttributeOneClick();
  document.onmousedown = function (event) {
    regOnMouse(event);
  };
  document.ondblclick = function (event) {
    regOnMouse(event);
  };

  if (document.querySelector('#viewerContainer') && window.parent) {
    document.querySelector('#viewerContainer').addEventListener('scroll', function (e) {
      // Удаляем iframe, если выделенное слово не видно на экране
      var hWin =
          Math.min(document.documentElement.clientHeight, window.innerHeight) ||
          Math.max(document.documentElement.clientHeight, window.innerHeight),
        highlight = document.querySelector('hghlght');
      if (
        highlight &&
        ((highlight.getBoundingClientRect().top || 0) <= 0 ||
          (highlight.getBoundingClientRect().top || 9999) >= hWin)
      ) {
        window.getSelection().removeAllRanges();
        try {
          window.parent['postMessage']('closeIframe:true', '*');
        } catch (error) {}
      }
    });
  }
};
