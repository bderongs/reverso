window.LOCALE_REVIEW_RUNS = [
  {
    "id": "2026-10-16T11-25-16Z",
    "generatedAt": "2026-10-16T11:25:16.482Z",
    "model": "gpt-4o",
    "languages": [
      {
        "code": "fr",
        "picker": "Français"
      },
      {
        "code": "en",
        "picker": "English"
      },
      {
        "code": "es",
        "picker": "Español"
      },
      {
        "code": "de",
        "picker": "Deutsch"
      }
    ],
    "screens": [
      {
        "id": "home",
        "file": "01-home.png",
        "what": "Translate home"
      },
      {
        "id": "vocabulary",
        "file": "02-vocabulary.png",
        "what": "Vocabulary hub"
      },
      {
        "id": "favorites",
        "file": "03-favorites.png",
        "what": "Favorites list"
      },
      {
        "id": "settings",
        "file": "04-settings.png",
        "what": "Settings, top of the page"
      }
    ],
    "note": "Settings shots cover only the top of the page. Findings there do not cover the rest of Settings.",
    "issueCount": 3,
    "uxCount": 0,
    "findingCount": 3,
    "top5": [
      {
        "screen": "favorites",
        "screenFile": "03-favorites.png",
        "what": "Favorites list",
        "kind": "mixed_locale",
        "severity": "medium",
        "languages": [
          "fr",
          "es",
          "de"
        ],
        "evidence": "Showing the last 40 saved terms",
        "where": "Below the 'Terms' section",
        "shots": [
          "fr/03-favorites.png",
          "es/03-favorites.png",
          "de/03-favorites.png"
        ],
        "score": 4
      },
      {
        "screen": "settings",
        "screenFile": "04-settings.png",
        "what": "Settings, top of the page",
        "kind": "mixed_locale",
        "severity": "medium",
        "languages": [
          "fr",
          "es",
          "de"
        ],
        "evidence": "Upgrade to Premium",
        "where": "Subscription section",
        "shots": [
          "fr/04-settings.png",
          "es/04-settings.png",
          "de/04-settings.png"
        ],
        "score": 4
      },
      {
        "screen": "vocabulary",
        "screenFile": "02-vocabulary.png",
        "what": "Vocabulary hub",
        "kind": "mixed_locale",
        "severity": "medium",
        "languages": [
          "es",
          "de"
        ],
        "evidence": "\"In a Meeting\", \"Animals\", \"Project Management\", \"Intermediate Vocabulary (B1/B2)\"",
        "where": "Card titles",
        "shots": [
          "es/02-vocabulary.png",
          "de/02-vocabulary.png"
        ],
        "score": 3
      }
    ],
    "issues": [
      {
        "screen": "favorites",
        "screenFile": "03-favorites.png",
        "what": "Favorites list",
        "kind": "mixed_locale",
        "severity": "medium",
        "languages": [
          "fr",
          "es",
          "de"
        ],
        "evidence": "Showing the last 40 saved terms",
        "where": "Below the 'Terms' section",
        "shots": [
          "fr/03-favorites.png",
          "es/03-favorites.png",
          "de/03-favorites.png"
        ],
        "score": 4
      },
      {
        "screen": "settings",
        "screenFile": "04-settings.png",
        "what": "Settings, top of the page",
        "kind": "mixed_locale",
        "severity": "medium",
        "languages": [
          "fr",
          "es",
          "de"
        ],
        "evidence": "Upgrade to Premium",
        "where": "Subscription section",
        "shots": [
          "fr/04-settings.png",
          "es/04-settings.png",
          "de/04-settings.png"
        ],
        "score": 4
      },
      {
        "screen": "vocabulary",
        "screenFile": "02-vocabulary.png",
        "what": "Vocabulary hub",
        "kind": "mixed_locale",
        "severity": "medium",
        "languages": [
          "es",
          "de"
        ],
        "evidence": "\"In a Meeting\", \"Animals\", \"Project Management\", \"Intermediate Vocabulary (B1/B2)\"",
        "where": "Card titles",
        "shots": [
          "es/02-vocabulary.png",
          "de/02-vocabulary.png"
        ],
        "score": 3
      }
    ],
    "ux": [],
    "findings": [
      {
        "screen": "favorites",
        "screenFile": "03-favorites.png",
        "what": "Favorites list",
        "kind": "mixed_locale",
        "severity": "medium",
        "languages": [
          "fr",
          "es",
          "de"
        ],
        "evidence": "Showing the last 40 saved terms",
        "where": "Below the 'Terms' section",
        "shots": [
          "fr/03-favorites.png",
          "es/03-favorites.png",
          "de/03-favorites.png"
        ],
        "score": 4
      },
      {
        "screen": "settings",
        "screenFile": "04-settings.png",
        "what": "Settings, top of the page",
        "kind": "mixed_locale",
        "severity": "medium",
        "languages": [
          "fr",
          "es",
          "de"
        ],
        "evidence": "Upgrade to Premium",
        "where": "Subscription section",
        "shots": [
          "fr/04-settings.png",
          "es/04-settings.png",
          "de/04-settings.png"
        ],
        "score": 4
      },
      {
        "screen": "vocabulary",
        "screenFile": "02-vocabulary.png",
        "what": "Vocabulary hub",
        "kind": "mixed_locale",
        "severity": "medium",
        "languages": [
          "es",
          "de"
        ],
        "evidence": "\"In a Meeting\", \"Animals\", \"Project Management\", \"Intermediate Vocabulary (B1/B2)\"",
        "where": "Card titles",
        "shots": [
          "es/02-vocabulary.png",
          "de/02-vocabulary.png"
        ],
        "score": 3
      }
    ]
  }
];
