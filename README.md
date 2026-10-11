# adblocker-extension

[![CI](https://github.com/satyendra-sagar-singh/adblocker-extension/actions/workflows/ci.yml/badge.svg)](https://github.com/satyendra-sagar-singh/adblocker-extension/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/satyendra-sagar-singh/adblocker-extension/blob/main/LICENSE)
[![manifest](https://img.shields.io/badge/manifest-v3-4285F4.svg)](https://developer.chrome.com/docs/extensions/develop/migrate)

A Chrome extension that blocks ads and trackers on every site, built for Manifest V3 and designed around YouTube. Ad payloads are stripped from the player's data before the player sees them, any ad that still reaches the player is skipped (including server-side stitched ads), promoted content is hidden, the "ad blockers violate YouTube's Terms of Service" dialog is dismissed, and the "ad blockers are not allowed" playback wall is recovered from automatically.

Every YouTube technique mirrors what [uBlock Origin](https://github.com/uBlockOrigin/uAssets) and [AdGuard](https://github.com/AdguardTeam/AdguardFilters) shipped as of October 2026, so the extension does not take any of the shortcuts YouTube is known to detect.

- 🚫 **Network blocking** — `declarativeNetRequest` rulesets for ad networks, trackers, streaming sites, adult sites and YouTube, plus an optional full EasyList + EasyPrivacy conversion
- 📺 **YouTube, properly** — response pruning in the page world, client-side and server-side ad skipping, enforcement-wall recovery through request reshaping, anti-detection hooks
- 🧩 **Element hiding** — structural selectors only, taken from the maintained lists, so pages keep their layout
- ⏸️ **Per-site pause** — one switch in the popup; the host gets an `allowAllRequests` rule and no content scripts at all
- ✍️ **Custom filters** — EasyList syntax in the options page, converted to dynamic rules on save
- 🔁 **Filter-list tooling** — a converter and a domain-merge optimiser that fit ~113,000 EasyList rules into ~13,000 DNR rules
- 🟦 **TypeScript**, no runtime dependencies, tested end to end in a real Chrome

## Install

```bash
npm install
npm run build          # bundles into dist/
```

Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked** and select the `dist/` folder. After code changes run `npm run build` again (or `npm run watch`) and press the reload icon on the extension card. `npm run package` zips `dist/` for a Web Store upload.

Node 22.6+ (TypeScript is executed directly by Node; scripts and tests need no transpile step) and Chrome 120+.

## Quickstart

Once loaded the extension works with no configuration:

- The toolbar badge shows the number of requests blocked on the current tab.
- The popup has the global switch, a per-site pause switch for the current host, and counters.
- The options page toggles the tracker ruleset, element hiding and each YouTube feature, manages paused sites and holds custom filters:

```text
||ads.example.com^
@@||example.com^$document
||example.com/banner*$image,third-party
```

Only one YouTube ad blocker should run at a time; two blockers on the same page trigger YouTube's detection.

## How it works

| Layer                    | Mechanism                                                                                                                                                                                                                                                                                         | Where                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **Network blocking**     | `declarativeNetRequest` static rulesets (`youtube`, `ads_core`, `trackers`, `streaming`, `adult`, optional `easylist`)                                                                                                                                                                            | `src/rules/*.json`                                                      |
| **Per-site pause**       | Dynamic `allowAllRequests` rule per whitelisted host, plus content scripts excluded on that host                                                                                                                                                                                                   | `src/background/dynamic-rules.ts`, `src/background/content-scripts.ts` |
| **Custom filters**       | EasyList-syntax lines converted to dynamic rules at save time                                                                                                                                                                                                                                     | `src/filters/abp-to-dnr.ts`                                             |
| **YouTube pruning**      | MAIN-world script at `document_start`: hooks `JSON.parse`, `Response.prototype.json` and `XMLHttpRequest.response`, intercepts the inline `ytInitialPlayerResponse` / `ytInitialData` globals, removes `adPlacements` / `adSlots` / `playerAds` and feed `adSlotRenderer` entries                | `src/content/youtube/response-pruning.ts`, `prune.ts`                   |
| **YouTube anti-detection** | MAIN world: no-ops the player's `onAbnormalityDetected` callback, shortens the 17 s stall timer, hooks the about:blank iframe YouTube uses to obtain pristine natives, pins `google_ad_status`; ISOLATED world: neutralises the inline script that fetches those natives                        | `src/content/youtube/anti-detection.ts`, `isolated.ts`                  |
| **YouTube ad skipping**  | MAIN-world player controller: watches `ad-showing`, clicks visible skip buttons, mutes, seeks client-side ad media to its end, skips server-side stitched ads via `player.seekTo` when stats-for-nerds reports `SSAP, AD`                                                                         | `src/content/youtube/player-controller.ts`                              |
| **YouTube wall recovery** | When the player response is the `UNPLAYABLE` enforcement wall, the next `/youtubei/v1/player` request is reshaped (`isInlinePlaybackNoAd`, `clientScreen: CHANNEL`, `params: 8AUB` / `YAHI` / `eAFgAQ`, in-stream ad context, ...) and the video is reloaded with `loadVideoById`, walking the ladder until playback resumes | `src/content/youtube/request-shaping.ts`, `player-controller.ts`        |
| **YouTube dialog removal** | ISOLATED world removes the enforcement dialog and backdrop and resumes playback                                                                                                                                                                                                                 | `src/content/youtube/isolated.ts`                                       |
| **Element hiding**       | CSS injected at `document_start` (generic + per-host selectors; YouTube has its own sheet)                                                                                                                                                                                                        | `src/content/cosmetic/`, `src/content/youtube/youtube.css`              |
| **UI**                   | Popup (global switch, per-site pause, counters) and options page (toggles, whitelist, custom filters, stats)                                                                                                                                                                                      | `src/popup/`, `src/options/`                                            |

Settings live in `chrome.storage.local` and are the single source of truth. The popup and options page only write settings; the service worker reacts to `storage.onChanged` and re-applies rulesets, dynamic rules, content-script registrations and the badge. Content scripts are registered dynamically (`chrome.scripting.registerContentScripts`) so that whitelisted hosts never run any extension code and no asynchronous settings lookup is needed in the MAIN world.

The badge count is rendered natively by Chrome (`displayActionCountAsBadgeText`). The popup reads it through `getMatchedRules`, which works because opening the popup grants `activeTab`; the `declarativeNetRequestFeedback` permission is deliberately not requested, since Chrome ignores it for Web Store installs and it would add a "read your browsing history" warning.

**Permissions:** `activeTab`, `declarativeNetRequest`, `scripting`, `storage`, plus host permissions for `http://*/*` and `https://*/*` (needed to inject the content scripts and for the one redirect rule that replaces DoubleClick's `ad_status.js` with a local stub).

## Filter lists

Five hand-maintained rulesets ship with the extension (`src/rules/`). `streaming` holds site-specific ad rules for Twitch, Dailymotion and Spotify, whose element-hiding selectors (plus Vimeo and Crunchyroll) live in `HOST_SELECTORS` in `src/content/cosmetic/selectors.ts`. The `adult` ruleset is generated from EasyList Adult plus the main adult ad networks and is committed, so it ships enabled; regenerate it with `npm run filters:adult`. Its element-hiding selectors live in `src/content/cosmetic/adult-selectors.ts`.

To add the full EasyList + EasyPrivacy + Peter Lowe's list converted to `declarativeNetRequest` rules:

```bash
npm run filters:update   # downloads, converts, writes src/rules/easylist.json
npm run build            # the easylist ruleset is added to the manifest automatically
```

The converter supports the network-filter subset of EasyList syntax (domain anchors, wildcards, separators, exceptions, resource types, `$third-party`, `$domain`, `$to`, `$denyallow`, `$method`, `$important`, `$match-case`, `$document` exceptions). Cosmetic filters, scriptlets, regex filters and options Chrome cannot express (`$csp`, `$redirect`, `$removeparam`, `$replace`, ...) are skipped and reported. Rules whose only condition is a `||host^` anchor are merged into `requestDomains` lists with identical options, which is how three lists fit under Chrome's 30,000 guaranteed static-rule budget without truncation.

## Scripts

| Command                           | Purpose                                                                                                                                                                                 |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build` / `npm run watch` | Production build / rebuild on change                                                                                                                                                    |
| `npm run typecheck`               | `tsc --noEmit`                                                                                                                                                                          |
| `npm test`                        | Unit tests (`node --test`) for the converter, optimiser, validator, settings, hostname helpers, rule builders, YouTube pruning, request shaping and wall detection                      |
| `npm run validate:rules`          | Validates every ruleset in `src/rules` against DNR constraints                                                                                                                          |
| `npm run test:e2e`                | Loads `dist/` into a real Chrome (via puppeteer) and checks blocking, rule matching on production URLs, YouTube pruning/skipping/recovery, whitelist, custom filters, popup and options |
| `npm run check`                   | typecheck + rule validation + unit tests                                                                                                                                                |
| `npm run test:all`                | `check` + build + e2e                                                                                                                                                                   |
| `npm run filters:update`          | Regenerate the optional EasyList ruleset                                                                                                                                                |
| `npm run filters:adult`           | Regenerate the shipped adult-site ruleset from EasyList Adult                                                                                                                           |
| `npm run icons`                   | Regenerate the PNG icons                                                                                                                                                                |
| `npm run package`                 | Zip `dist/` for a Web Store upload                                                                                                                                                      |

The e2e suite needs `openssl` on `PATH` (it mints a throwaway certificate; YouTube is HSTS-preloaded so the fixture must be served over HTTPS).

## Project layout

```
src/
  manifest.json            # rule_resources are filled in by the build
  background/              # service worker: applies settings to Chrome APIs
  content/cosmetic/        # generic and per-host element hiding
  content/youtube/         # MAIN-world pruning, anti-detection and player controller; ISOLATED-world dialog removal
  filters/                 # EasyList -> DNR converter, optimiser and validator (pure, unit-tested)
  popup/ options/          # UI
  rules/                   # static DNR rulesets
  shared/                  # settings schema/storage, hostname helpers, messaging
  web-accessible/          # stub served in place of DoubleClick's ad_status.js
scripts/                   # build, validate-rules, update-filters, update-adult-filters, generate-icons, package
test/unit/ test/e2e/
```

## Limitations

- **Manifest V3 cannot modify response bodies**, so YouTube ad removal relies on the in-page hooks above. Server-side stitched ads cannot be removed, only skipped by seeking past them.
- **YouTube decides per account and cohort** whether to serve the "fake buffering" delay before playback; it is produced server-side and no extension can fully remove it.
- **Fixes for new YouTube countermeasures ship with extension updates**, not with filter-list downloads.
- **`declarativeNetRequest` cannot express** cosmetic filters, `$csp`, `$redirect`, `$replace` or regex-heavy lists; those EasyList lines are dropped by the converter.

## Maintenance notes

YouTube changes its markup, data shapes and detection logic every few weeks. Everything that is likely to need updating lives in `src/content/youtube/config.ts` (JSON paths, pinned constants, player and button selectors, wall signature), `src/content/youtube/request-shaping.ts` (the recovery request shapes) and `src/content/youtube/youtube.css` (promoted-content selectors). The network rules for YouTube are in `src/rules/youtube.json`.

Reference sources, in order of usefulness: uBlock Origin's `uAssets/filters/quick-fixes.txt` and `filters.txt`, the pinned uAssets YouTube issue, AdGuard Base's "Youtube whitescreen fix" block in `BaseFilter/sections/specific.txt`, and EasyList's `! youtube` cosmetic block.

Rules that must not be "improved":

- Do not hide `#player-ads`, `.video-ads` / `.ytp-ad-module` or other in-player containers; YouTube treats cosmetic hiding of those as an ad-blocker signal. The shipped CSS is limited to the structural selectors the maintained lists use.
- Do not block `youtube.com/api/stats/*` beacons beyond `/api/stats/ads`; uBlock Origin reverted such blocks after they contributed to detection.
- Do not prune `streamingData` or `playerConfig` fields; only the ad fields are removed.
- Keep the hooks as `Proxy` objects so `Function.prototype.toString` still reports native code.

Symptoms of a stale configuration: videos stuck buffering with an "Experiencing interruptions?" toast, the player showing "Ad blockers are not allowed" without recovering, or playlist videos skipping after a few seconds (a seek firing on a non-ad).

## Contributing

```bash
npm install
npm run check     # typecheck, rule validation, unit tests — no browser required
npm run build
npm run test:e2e  # real Chrome, local HTTPS fixtures
```

CI runs `check` and `build` on Node 22 and 24, and the e2e suite on the version in `.nvmrc`. Issues and pull requests are welcome on [GitHub](https://github.com/satyendra-sagar-singh/adblocker-extension/issues).

## License

[MIT](LICENSE)
