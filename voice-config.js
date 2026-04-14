(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.READ_ALOUD_VOICE_CONFIG = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  return {
    defaultLanguage: "en-US",
    defaultVoice: "en_paul_neutral",
    byLanguage: {
      fr: "fr_marie_neutral",
      "en-gb": "gb_oliver_neutral",
      "en-us": "en_paul_neutral",
      en: "en_paul_neutral"
    }
  };
});
