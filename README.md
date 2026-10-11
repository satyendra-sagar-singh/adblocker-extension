# Ad Blocker (Chrome, Manifest V3)

A Chrome extension that blocks ads and trackers on every site, with dedicated handling for
YouTube: ad payloads are stripped from the player's data before the player sees them, any ad
that still reaches the player is skipped, promoted content is hidden, and the
"ad blockers violate YouTube's Terms of Service" dialog is dismissed.

## How it works

| Layer | Mechanism | Where |
|---|---|---|
| Network blocking | `declarativeNetRequest` static rulesets (`youtube`, `ads_core`, `trackers`, optional `easylist`) | `src/rules/*.json` |
| Per-site pause | Dynamic `allowAllRequests` rule per whitelisted host, plus content scripts excluded on that host | `src/background/dynamic-rules.ts`, `src/background/content-scripts.ts` |
| Custom filters | EasyList-syntax lines converted to dynamic rules at save time | `src/filters/abp-to-dnr.ts` |
| YouTube data pruning | MAIN-world script at `document_start`: hooks `JSON.parse` / `Response.prototype.json`, intercepts `ytInitialPlayerResponse` / `ytInitialData`, pins anti-ad-block flags | `src/content/youtube/main-world.ts` |
| YouTube ad skipping | ISOLATED-world script: watches the player's `ad-showing` state, clicks skip buttons, fast-forwards, mutes, removes the enforcement dialog | `src/content/youtube/isolated.ts` |
| Element hiding | CSS injected at `document_start` (generic + per-host selectors; YouTube has its own sheet) | `src/content/cosmetic/`, `src/content/youtube/youtube.css` |
| UI | Popup (global switch, per-site pause, counters) and options page (toggles, whitelist, custom filters, stats) | `src/popup/`, `src/options/` |

Settings live in `chrome.storage.local` and are the single source of truth. The popup and
options page only write settings; the service worker reacts to `storage.onChanged` and
re-applies rulesets, dynamic rules, content-script registrations and the badge. Content
scripts are registered dynamically (`chrome.scripting.registerContentScripts`) so that
whitelisted hosts never run any extension code and no asynchronous settings lookup is
needed in the MAIN world.

The badge shows the number of requests blocked on the current tab (Chrome renders it
natively via `displayActionCountAsBadgeText`; reading it back for the popup requires the
`declarativeNetRequestFeedback` permission).

## Requirements

- Node.js 22.6+ (TypeScript is executed directly by Node; no transpile step for scripts/tests)
- Chrome 120+

## Build and install

```bash
npm install
npm run build          # bundles into dist/
```

Then open `chrome://extensions`, enable **Developer mode**, click **Load unpacked** and
select the `dist/` folder. After code changes run `npm run build` again (or `npm run watch`)
and press the reload icon on the extension card.

`npm run package` zips `dist/` for a Web Store upload.

## Filter lists

Three hand-maintained rulesets ship with the extension (`src/rules/`). To add the full
EasyList + EasyPrivacy + Peter Lowe's list converted to `declarativeNetRequest` rules:

```bash
npm run filters:update   # downloads, converts, writes src/rules/easylist.json
npm run build            # the easylist ruleset is added to the manifest automatically
```

The converter supports the network-filter subset of EasyList syntax (domain anchors,
wildcards, separators, exceptions, resource types, `$third-party`, `$domain`, `$to`,
`$denyallow`, `$method`, `$important`, `$match-case`, `$document` exceptions). Cosmetic
filters, scriptlets, regex filters and options Chrome cannot express (`$csp`, `$redirect`,
`$removeparam`, `$replace`, ...) are skipped and reported. The cap defaults to 25,000 rules so
the total stays under Chrome's 30,000 guaranteed static rule budget.

## Scripts

| Command | Purpose |
|---|---|
| `npm run build` / `npm run watch` | Production build / rebuild on change |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Unit tests (`node --test`) for the converter, validator, settings, hostname helpers, rule builders and YouTube pruning |
| `npm run validate:rules` | Validates every ruleset in `src/rules` against DNR constraints |
| `npm run test:e2e` | Loads `dist/` into a real Chrome (via puppeteer) and checks blocking, YouTube pruning/skipping, whitelist, custom filters and the global switch against a local HTTPS server |
| `npm run check` | typecheck + rule validation + unit tests |
| `npm run test:all` | `check` + build + e2e |
| `npm run filters:update` | Regenerate the optional EasyList ruleset |
| `npm run icons` | Regenerate the PNG icons |

The e2e suite needs `openssl` on `PATH` (it mints a throwaway certificate; YouTube is
HSTS-preloaded so the fixture must be served over HTTPS).

## Project layout

```
src/
  manifest.json            # rule_resources are filled in by the build
  background/              # service worker: applies settings to Chrome APIs
  content/cosmetic/        # generic element hiding
  content/youtube/         # MAIN-world pruning + ISOLATED-world skipper, config.ts holds all paths/selectors
  filters/                 # EasyList -> DNR converter and DNR validator (pure, unit-tested)
  popup/ options/          # UI
  rules/                   # static DNR rulesets
  shared/                  # settings schema/storage, hostname helpers, messaging
scripts/                   # build, validate-rules, update-filters, generate-icons, package
test/unit/ test/e2e/
```

## Maintenance notes

YouTube changes its markup and data shapes regularly. Everything that is likely to need
updating lives in `src/content/youtube/config.ts` (JSON paths, pinned constants, player and
button selectors) and `src/content/youtube/youtube.css` (promoted-content selectors). The
network rules for YouTube are in `src/rules/youtube.json`. uBlock Origin's `uAssets`
repository is the reference for current values.

## Limitations

- Manifest V3 cannot modify response bodies, so YouTube ad removal relies on the in-page
  hooks above. If YouTube serves ads stitched into the video stream (server-side ad
  insertion) for your account, the skipper fast-forwards instead of removing the ad.
- `declarativeNetRequest` cannot express cosmetic filters, `$csp`, `$redirect`, `$replace`
  or regex-heavy lists; those EasyList lines are dropped by the converter.
- Static rule budget: 30,000 rules are guaranteed across all enabled rulesets; the converter
  cap keeps the total under that.
