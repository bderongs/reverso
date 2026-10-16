# Maestro scenarios

Repo root: `/Users/baptiste/reverso`

Android package: `com.softissimo.reverso.context`

APK used for Cloud: `Android_testing/reverso-translation-dictionary-16-5-0.apk` (version 16.5.0, includes `arm64-v8a`).

Cloud project: `proj_01m2j3xeggey1a5jqywq5z9v6e`

Cloud app binary already uploaded from that APK: `f5c54021022db5bd711f300fc50a0ed854e758a1`

Reuse that binary with `--app-binary-id`. Pass `--app-file Android_testing/reverso-translation-dictionary-16-5-0.apk` when the binary must be uploaded again.

Credentials file (gitignored): `.maestro/auth.local.json`

```json
{
  "email": "<reverso email>",
  "password": "<reverso password>"
}
```

Cloud login reads `email` and `password` from that file. Do not write those values into a flow YAML.

## Entry flows

Launch only these files. The other YAML files are subflows.

| Flow | File | Where it runs | What it does |
| --- | --- | --- | --- |
| Quiz | `.maestro/favorites-play-quiz.yaml` | Local device, or Cloud | Opens Favorites and plays a quiz. |
| One locale shot | `.maestro/favorites-locale-shot.yaml` | Local device | From an already open Favorites screen, switches one interface language and screenshots Favorites. |
| Locale screens | `.maestro/locale-screens.yaml` | Cloud | Signs in, then snapshots Translate home, Vocabulary, Favorites, and Settings in every language listed in the catalog. |
| Persona — Father bedtime | `.maestro/persona/father-arabic-bedtime.yaml` | Cloud | Logged-out EN→AR translate → star → Vocabulary / Define walk. |
| Persona — TOEIC student | `.maestro/persona/student-toeic-for-instance.yaml` | Cloud | Logged-out “for instance” → Vocabulary exam lists → Learn signup. |
| Persona — Translator favorites | `.maestro/persona/translator-favorites-words.yaml` | Cloud | Logged-out FR→EN lookups → star → Vocabulary / Favorites. |

Subflows, not entry points: `login.yaml`, `dismiss-ad.yaml`, `play-quiz-set.yaml`, `locale-capture.yaml`, `persona/welcome-logged-out.yaml`, `persona/set-lang-pair.yaml`, `persona/dismiss-ad.yaml`.

Passing `--flows .maestro` runs every top-level YAML, including those subflows. Pass one entry file.

## Local device

1. Boot an emulator or plug in a phone with USB debugging accepted.
2. `adb devices` must list the device.
3. The Reverso account is already logged in on that device, with words in Favorites. Local flows do not sign in unless `EMAIL` is set.
4. Run commands from the repo root.

List devices and print the quiz command:

```bash
node .maestro/scripts/list-android-devices.js --turns 5
```

The printed command looks like:

```bash
maestro test --device emulator-5554 -e TURNS=5 .maestro/favorites-play-quiz.yaml
```

`--device` is the adb id (`emulator-5554`), not the AVD name.

### Quiz vs SRS score (local only)

Full procedure: `Android_testing/android-quiz-compare-runbook.md`

Order:

1. `node .maestro/scripts/archive-last-run.js --label <label>`
2. Export the Favourites corpus from the web SRS tester into `Android_testing/` before the phone quiz. Same account on phone and web.
3. Leave this running: `node .maestro/scripts/term-logger.js` (listens on `127.0.0.1:18765`).
4. Run `favorites-play-quiz.yaml` on the device. `TURNS` is the number of quiz sets (default 1).
5. `node .maestro/scripts/score-android-quiz.js`

Outputs:

- `.maestro/quiz-runs/latest.json` — terms the quiz showed
- `.maestro/quiz-runs/latest-score.txt` — score

The term logger is on the machine running Maestro. A Cloud device cannot reach `127.0.0.1:18765`, so a Cloud quiz does not produce `latest.json`.

### One Favorites screenshot in one language (local only)

Start on the Favorites screen. `LANG` is the native name shown in the interface-language picker.

```bash
maestro test --device emulator-5554 \
  -e LANG=Español \
  -e SHOT=favorites-es \
  .maestro/favorites-locale-shot.yaml
```

Default `LANG` is `Français`. Default `SHOT` is `favorites-locale`.

## Cloud

Requires a signed-in CLI (`maestro login`) and an active Maestro Cloud plan.

Load the test account into the shell without printing it:

```bash
cd /Users/baptiste/reverso

eval "$(python3 - <<'PY'
import json, shlex
data = json.load(open(".maestro/auth.local.json"))
print("export REVERSO_EMAIL=" + shlex.quote(data["email"]))
print("export REVERSO_PASSWORD=" + shlex.quote(data["password"]))
PY
)"
```

`maestro cloud` waits until the run finishes and prints a dashboard URL.

Device pair used so far: `--device-model pixel_6` and `--device-os android-34`. Names must match `maestro list-cloud-devices` exactly. `--device-locale en_US` sets the device locale before the flow switches the app language.

### Cloud quiz

Signs in, then plays one quiz set (`TURNS=1`).

```bash
maestro cloud \
  --project-id proj_01m2j3xeggey1a5jqywq5z9v6e \
  --app-binary-id f5c54021022db5bd711f300fc50a0ed854e758a1 \
  --flows .maestro/favorites-play-quiz.yaml \
  --name "favorites-quiz" \
  --device-model pixel_6 \
  --device-os android-34 \
  --device-locale en_US \
  -e TURNS=1 \
  -e EMAIL="$REVERSO_EMAIL" \
  -e PASSWORD="$REVERSO_PASSWORD"
```

`login.yaml` runs only when `EMAIL` is non-empty. A fresh Cloud install opens Welcome to Reverso, then email sign-in.

### Cloud locale screens

Signs in, then snapshots four screens for every language in `locale-screens/catalog.json`.

Cloud scripts cannot read workspace files, so pass the catalog JSON in `CATALOG_JSON`. Local runs still read the file directly.

```bash
CATALOG_JSON=$(python3 -c 'import json; print(json.dumps(json.load(open("locale-screens/catalog.json")), separators=(",", ":")))')

maestro cloud \
  --project-id proj_01m2j3xeggey1a5jqywq5z9v6e \
  --app-binary-id f5c54021022db5bd711f300fc50a0ed854e758a1 \
  --flows .maestro/locale-screens.yaml \
  --name "locale-screens" \
  --device-model pixel_6 \
  --device-os android-34 \
  --device-locale en_US \
  -e CATALOG_JSON="$CATALOG_JSON" \
  -e EMAIL="$REVERSO_EMAIL" \
  -e PASSWORD="$REVERSO_PASSWORD"
```

Current languages: `fr` Français, `en` English, `es` Español, `de` Deutsch.

Screens, in order, for each language:

| File | Screen |
| --- | --- |
| `01-home.png` | Translate home |
| `02-vocabulary.png` | Vocabulary hub |
| `03-favorites.png` | Favorites list |
| `04-settings.png` | Settings, top of the page |

Inside the Cloud artifacts zip, each file is under `takeScreenshot/<code>/<file>`, for example `takeScreenshot/fr/01-home.png`.

Copy them into the review tree:

```bash
node .maestro/scripts/pull-locale-screens.js --zip /path/to/artifacts.zip
```

That writes `locale-screens/<code>/<file>` for every language and screen in the catalog.

Review the shots with a vision model (needs `OPENAI_API_KEY` in the environment or `.env`; optional `OPENAI_VISION_MODEL`, default `gpt-4o`). If PNGs are already under `locale-screens/<code>/`:

```bash
node .maestro/scripts/review-locale-screens.js
```

Or pull from a real Cloud artifacts zip, then review (replace with your downloaded zip path):

```bash
node .maestro/scripts/review-locale-screens.js --zip ~/Downloads/artifacts.zip
```

That archives a dated run under `locale-screens/runs/<id>/` (screenshots + `review.json`), refreshes `runs-data.js`, and also updates the latest `review.json` / `review.md` in `locale-screens/`. Open the browse page:

```bash
open locale-screens/index.html
```

Deployed (after push): https://reverso-brown.vercel.app/locale-screens/

The page lists every run by date. Rebuild the index without re-calling the vision model:

```bash
node .maestro/scripts/review-locale-screens.js --rebuild-index
```

Settings findings cover only the top of that page.

### Cloud persona walks

Logged out (omit `EMAIL` / `PASSWORD`). One flow per Cloud run. Screenshots land under `takeScreenshot/persona/<id>/` in the artifacts zip.

```bash
maestro cloud \
  --project-id proj_01m2j3xeggey1a5jqywq5z9v6e \
  --app-binary-id f5c54021022db5bd711f300fc50a0ed854e758a1 \
  --flows .maestro/persona/father-arabic-bedtime.yaml \
  --name "persona-father-arabic-bedtime" \
  --device-model pixel_6 \
  --device-os android-34 \
  --device-locale en_US
```

Repeat with `student-toeic-for-instance.yaml` and `translator-favorites-words.yaml` (names `persona-student-toeic-for-instance`, `persona-translator-favorites-words`).

Pull shots into the review page tree:

```bash
node .maestro/scripts/pull-persona-screens.js --zip /path/to/artifacts.zip --id father-arabic-bedtime
```

Then fill `environments.android` in `persona-walkthroughs/scenarios/<id>.yaml` and sync `SCENARIOS` in `persona-walkthroughs/index.html`.

Add a language by appending one object to `languages` in `locale-screens/catalog.json`:

```json
{ "code": "it", "picker": "Italiano" }
```

`code` is the folder name. `picker` is the exact label in the app's interface-language list (native spelling). The flow loads this file. Do not add the language inside the YAML loop.

Adding a screen requires a new capture step in `.maestro/locale-capture.yaml` and a new object in `screens`.
