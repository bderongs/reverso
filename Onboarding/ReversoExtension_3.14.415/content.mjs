import('./dist/preload-content-script.bundle.js')
  .then(async (m) => {
    await window.localStorage.preloadStorage();
    return true;
  })
  .then(async () => {
    let url = chrome.runtime.getURL('dist/content-script.bundle.js');
    await import(url);
  });
