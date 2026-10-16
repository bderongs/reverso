var candidates = [
  "locale-screens/catalog.json",
  ".maestro/locale-screens/catalog.json",
];

function catalogFromEnv() {
  if (typeof CATALOG_JSON === "string" && CATALOG_JSON.length) return CATALOG_JSON;
  if (typeof env !== "undefined" && env && typeof env.CATALOG_JSON === "string" && env.CATALOG_JSON.length) {
    return env.CATALOG_JSON;
  }
  return null;
}

function readText(path) {
  var File = null;
  var Scanner = null;
  try {
    if (typeof Java !== "undefined" && Java.type) {
      File = Java.type("java.io.File");
      Scanner = Java.type("java.util.Scanner");
    } else if (typeof java !== "undefined" && java.io) {
      File = java.io.File;
      Scanner = java.util.Scanner;
    }
  } catch (e) {
    return null;
  }
  if (!File || !Scanner) return null;
  var file = new File(path);
  if (!file.isFile()) return null;
  var scanner = new Scanner(file, "UTF-8").useDelimiter("\\A");
  var text = scanner.hasNext() ? String(scanner.next()) : "";
  scanner.close();
  return text;
}

var text = catalogFromEnv();
var used = text ? "CATALOG_JSON" : null;
if (!text) {
  for (var i = 0; i < candidates.length; i++) {
    text = readText(candidates[i]);
    if (text) {
      used = candidates[i];
      break;
    }
  }
}
if (!text) {
  throw new Error(
    "locale-screens/catalog.json was not found. On Cloud, pass it with -e CATALOG_JSON."
  );
}

var catalog = JSON.parse(text);
if (!catalog.languages || !catalog.languages.length) {
  throw new Error("locale-screens/catalog.json has no languages");
}
if (!catalog.screens || !catalog.screens.length) {
  throw new Error("locale-screens/catalog.json has no screens");
}

output.localeLanguages = catalog.languages;
output.localeScreens = catalog.screens;
output.langIndex = 0;

var names = [];
for (var j = 0; j < catalog.languages.length; j++) {
  names.push(catalog.languages[j].code + "=" + catalog.languages[j].picker);
}
console.log("LOCALE_CATALOG " + used + " " + names.join(", "));
