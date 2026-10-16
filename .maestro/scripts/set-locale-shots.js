var index = Number(output.langIndex) || 0;
var language = output.localeLanguages[index];
var screens = output.localeScreens;
if (!language || !language.code || !language.picker) {
  throw new Error("Missing language at index " + index);
}

function fileFor(id) {
  for (var i = 0; i < screens.length; i++) {
    if (screens[i].id === id) return screens[i].file;
  }
  throw new Error("catalog.json has no screen id " + id);
}

output.lang = language.picker;
output.code = language.code;
output.shotHome = language.code + "/" + fileFor("home");
output.shotVocabulary = language.code + "/" + fileFor("vocabulary");
output.shotFavorites = language.code + "/" + fileFor("favorites");
output.shotSettings = language.code + "/" + fileFor("settings");
console.log(
  "LOCALE_SHOTS " +
    output.code +
    " " +
    output.lang +
    " " +
    output.shotHome
);
