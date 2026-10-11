/**
 * End-to-end checks against a real Chrome with the built extension loaded.
 *
 * Ad-network and YouTube hostnames are mapped to a local HTTPS server through
 * --host-resolver-rules (YouTube is HSTS-preloaded, so plain HTTP is impossible), with a
 * throwaway self-signed certificate. Every request stays on this machine and the server
 * log shows what Chrome let through. Rule semantics on production URLs are checked with
 * chrome.declarativeNetRequest.testMatchOutcome, which is available to unpacked extensions.
 *
 * Prerequisite: `npm run build`. Chrome is provided by puppeteer; openssl must be on PATH.
 */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:https'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, describe, it } from 'node:test'
import puppeteer, { type Browser, type Page, type WebWorker } from 'puppeteer'

const here = dirname(fileURLToPath(import.meta.url))
const distDir = join(here, '..', '..', 'dist')
const PORT = 48123

const MAPPED_HOSTS = [
  'ads.doubleclick.net',
  'pagead2.googlesyndication.com',
  'www.google-analytics.com',
  'www.youtube.com',
  'fixture.test',
  'paused.test',
]

interface RuleAction {
  rulesetId: string
  ruleId: number
  action: string
}

const requestLog: string[] = []
let server: Server
let browser: Browser
let certDir: string

function fixture(name: string): string {
  return readFileSync(join(here, 'fixtures', name), 'utf8').replaceAll('__PORT__', String(PORT))
}

function createSelfSignedCertificate(): { key: Buffer; cert: Buffer } {
  certDir = mkdtempSync(join(tmpdir(), 'adblocker-e2e-'))
  const keyPath = join(certDir, 'key.pem')
  const certPath = join(certDir, 'cert.pem')
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath, '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' })
  return { key: readFileSync(keyPath), cert: readFileSync(certPath) }
}

function startServer(): Promise<void> {
  server = createServer(createSelfSignedCertificate(), (request, response) => {
    const host = (request.headers.host ?? '').replace(/:\d+$/, '')
    const path = request.url ?? '/'
    requestLog.push(`${host}${path}`)

    if (host === 'www.youtube.com') {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end(fixture('youtube.html'))
      return
    }
    if (path === '/' || path.startsWith('/?')) {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end(fixture('site.html'))
      return
    }
    const type = path.endsWith('.js') ? 'application/javascript' : path.endsWith('.gif') ? 'image/gif' : 'text/plain'
    response.writeHead(200, { 'content-type': type })
    response.end(path.endsWith('.js') ? `window.__loaded = (window.__loaded || []).concat(${JSON.stringify(host + path)});` : 'ok')
  })
  return new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve))
}

async function launchBrowser(): Promise<Browser> {
  const hostRules = MAPPED_HOSTS.map(host => `MAP ${host} 127.0.0.1`).join(', ')
  return puppeteer.launch({
    headless: true,
    enableExtensions: [distDir],
    acceptInsecureCerts: true,
    args: [`--host-resolver-rules=${hostRules}`, '--no-first-run'],
  })
}

async function getServiceWorker(): Promise<WebWorker> {
  const target = await browser.waitForTarget(candidate => candidate.type() === 'service_worker', { timeout: 15000 })
  const worker = await target.worker()
  assert.ok(worker, 'service worker target should be available')
  return worker
}

/** Writes a settings patch through storage, exactly as the popup / options page do, and waits for it to apply. */
async function patchSettings(worker: WebWorker, patch: Record<string, unknown>): Promise<void> {
  await worker.evaluate(async (settingsPatch: Record<string, unknown>) => {
    const stored = await chrome.storage.local.get('settings')
    await chrome.storage.local.set({ settings: { ...(stored.settings ?? {}), ...settingsPatch } })
    await new Promise(resolve => setTimeout(resolve, 1000))
  }, patch)
}

interface BuiltManifest {
  declarative_net_request: { rule_resources: Array<{ id: string; path: string }> }
}

const loadManifest = (): BuiltManifest => JSON.parse(readFileSync(join(distDir, 'manifest.json'), 'utf8')) as BuiltManifest
const shippedRulesetIds = (): string[] => loadManifest().declarative_net_request.rule_resources.map(resource => resource.id).sort()

function loadRuleActions(): Map<string, string> {
  const actions = new Map<string, string>()
  for (const resource of loadManifest().declarative_net_request.rule_resources) {
    const rules = JSON.parse(readFileSync(join(distDir, resource.path), 'utf8')) as Array<{ id: number; action: { type: string } }>
    for (const rule of rules) actions.set(`${resource.id}:${rule.id}`, rule.action.type)
  }
  return actions
}

async function matchOutcome(worker: WebWorker, url: string, type: string, initiator: string | undefined): Promise<RuleAction[]> {
  const actions = loadRuleActions()
  const matched = await worker.evaluate(
    async (request: { url: string; type: string; initiator?: string }) => {
      const result = await chrome.declarativeNetRequest.testMatchOutcome(request as never)
      return result.matchedRules.map(rule => ({ rulesetId: rule.rulesetId, ruleId: rule.ruleId }))
    },
    initiator ? { url, type, initiator } : { url, type },
  )
  return matched.map(rule => ({ ...rule, action: actions.get(`${rule.rulesetId}:${rule.ruleId}`) ?? 'unknown' }))
}

async function openPage(url: string): Promise<Page> {
  const page = await browser.newPage()
  await page.goto(url, { waitUntil: 'load' })
  await new Promise(resolve => setTimeout(resolve, 800))
  return page
}

describe('extension end-to-end', { timeout: 180000 }, () => {
  before(async () => {
    await startServer()
    browser = await launchBrowser()
    const worker = await getServiceWorker()
    // Give the service worker time to apply rulesets and register content scripts.
    await worker.evaluate(() => new Promise(resolve => setTimeout(resolve, 1500)))
  })

  after(async () => {
    await browser?.close()
    await new Promise<void>(resolve => server.close(() => resolve()))
    rmSync(certDir, { recursive: true, force: true })
  })

  it('enables all static rulesets and registers content scripts', async () => {
    const worker = await getServiceWorker()
    const state = await worker.evaluate(async () => ({
      rulesets: await chrome.declarativeNetRequest.getEnabledRulesets(),
      scripts: (await chrome.scripting.getRegisteredContentScripts()).map(script => script.id).sort(),
      dynamic: (await chrome.declarativeNetRequest.getDynamicRules()).length,
    }))
    assert.deepEqual([...state.rulesets].sort(), shippedRulesetIds())
    assert.deepEqual(state.scripts, ['cosmetic', 'youtube-isolated', 'youtube-main'])
    assert.equal(state.dynamic, 0)
  })

  it('matches production URLs the way the rulesets intend', async () => {
    const worker = await getServiceWorker()
    const youtube = 'https://www.youtube.com'
    // ownRulesOnly: the maintained EasyList/EasyPrivacy lists may legitimately decide differently.
    const cases: Array<{ url: string; type: string; initiator?: string; expect: 'block' | 'allow' | 'none'; ownRulesOnly?: boolean }> = [
      { url: 'https://www.youtube.com/pagead/interaction/?ai=abc', type: 'xmlhttprequest', initiator: youtube, expect: 'block' },
      { url: 'https://www.youtube.com/api/stats/ads?ver=2', type: 'xmlhttprequest', initiator: youtube, expect: 'block' },
      { url: 'https://www.youtube.com/ptracking?html5=1', type: 'image', initiator: youtube, expect: 'block' },
      { url: 'https://googleads.g.doubleclick.net/pagead/id', type: 'xmlhttprequest', initiator: youtube, expect: 'block' },
      { url: 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false', type: 'xmlhttprequest', initiator: youtube, expect: 'none' },
      { url: 'https://www.youtube.com/youtubei/v1/next?prettyPrint=false', type: 'xmlhttprequest', initiator: youtube, expect: 'none' },
      { url: 'https://rr3---sn-abc.googlevideo.com/videoplayback?expire=1', type: 'xmlhttprequest', initiator: youtube, expect: 'none' },
      { url: 'https://www.youtube.com/api/stats/playback?docid=x', type: 'xmlhttprequest', initiator: youtube, expect: 'none' },
      { url: 'https://www.youtube.com/api/stats/watchtime?docid=x', type: 'xmlhttprequest', initiator: youtube, expect: 'none' },
      { url: 'https://i.ytimg.com/vi/x/hqdefault.jpg', type: 'image', initiator: youtube, expect: 'none' },
      { url: 'https://www.youtube.com/s/player/abc/player_ias.vflset/en_US/base.js', type: 'script', initiator: youtube, expect: 'none' },
      { url: 'https://static.doubleclick.net/instream/ad_status.js', type: 'script', initiator: youtube, expect: 'allow' },
      { url: 'https://securepubads.g.doubleclick.net/tag/js/gpt.js', type: 'script', initiator: 'https://news.example.com', expect: 'block' },
      { url: 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js', type: 'script', initiator: 'https://blog.example.com', expect: 'block' },
      { url: 'https://www.google-analytics.com/analytics.js', type: 'script', initiator: 'https://blog.example.com', expect: 'block' },
      { url: 'https://ads.reddit.com/x', type: 'xmlhttprequest', initiator: 'https://www.reddit.com', expect: 'block' },
      { url: 'https://www.google.com/recaptcha/api.js', type: 'script', initiator: 'https://shop.example.com', expect: 'allow' },
      { url: 'https://cdn.example.com/app.js', type: 'script', initiator: 'https://www.example.com', expect: 'none' },
      { url: 'https://www.googletagmanager.com/gtm.js?id=GTM-1', type: 'script', initiator: 'https://www.example.com', expect: 'none', ownRulesOnly: true },
      { url: 'https://edge.ads.twitch.tv/ads?x=1', type: 'xmlhttprequest', initiator: 'https://www.twitch.tv', expect: 'block' },
      { url: 'https://static1.dmcdn.net/playerv5/dmp.advertising.abc123.js', type: 'script', initiator: 'https://www.dailymotion.com', expect: 'block' },
      { url: 'https://spclient.wg.spotify.com/ad-logic/state/config', type: 'xmlhttprequest', initiator: 'https://open.spotify.com', expect: 'block' },
      { url: 'https://player-telemetry.vimeo.com/player-events/log', type: 'xmlhttprequest', initiator: 'https://player.vimeo.com', expect: 'block' },
      { url: 'https://usher.ttvnw.net/api/channel/hls/x.m3u8', type: 'xmlhttprequest', initiator: 'https://www.twitch.tv', expect: 'none', ownRulesOnly: true },
      { url: 'https://ads.trafficjunky.net/ads?zone_id=1', type: 'script', initiator: 'https://www.pornhub.com', expect: 'block' },
      { url: 'https://a.magsrv.com/ad-provider.js', type: 'script', initiator: 'https://www.xvideos.com', expect: 'block' },
      { url: 'https://www.pornhub.com/view_video.php?viewkey=x', type: 'main_frame', expect: 'none' },
      { url: 'https://www.example.com/', type: 'main_frame', expect: 'none' },
    ]

    for (const testCase of cases) {
      const allMatched = await matchOutcome(worker, testCase.url, testCase.type, testCase.initiator)
      const matched = testCase.ownRulesOnly ? allMatched.filter(rule => rule.rulesetId !== 'easylist') : allMatched
      const label = `${testCase.type} ${testCase.url}`
      if (testCase.expect === 'none') {
        assert.deepEqual(matched, [], `${label} should match no rule, got ${JSON.stringify(matched)}`)
        continue
      }
      assert.ok(matched.length > 0, `${label} should match a rule`)
      for (const rule of matched) assert.equal(rule.action, testCase.expect, `${label} matched ${JSON.stringify(rule)}`)
    }
  })

  it('indexes the optional EasyList ruleset (sampled through testMatchOutcome)', async t => {
    const resource = loadManifest().declarative_net_request.rule_resources.find(entry => entry.id === 'easylist')
    if (!resource) {
      t.skip('easylist ruleset not generated; run `npm run filters:update`')
      return
    }
    const rules = JSON.parse(readFileSync(join(distDir, resource.path), 'utf8')) as Array<{
      id: number
      action: { type: string }
      condition: { requestDomains?: string[]; initiatorDomains?: string[]; resourceTypes?: string[]; domainType?: string; excludedInitiatorDomains?: string[]; excludedResourceTypes?: string[]; requestMethods?: string[]; excludedRequestMethods?: string[] }
    }>
    const candidates = rules.filter(rule =>
      rule.action.type === 'block' && rule.condition.requestDomains && !rule.condition.excludedInitiatorDomains && !rule.condition.excludedResourceTypes && !rule.condition.requestMethods && !rule.condition.excludedRequestMethods,
    )
    assert.ok(candidates.length > 0, 'expected merged domain rules in the easylist ruleset')

    const worker = await getServiceWorker()
    const SAMPLE = 60
    const step = Math.max(1, Math.floor(candidates.length / SAMPLE))
    let checked = 0
    for (let index = 0; index < candidates.length && checked < SAMPLE; index += step) {
      const rule = candidates[index]!
      const domains = rule.condition.requestDomains!
      const domain = domains[Math.floor(domains.length / 2)]!
      const type = rule.condition.resourceTypes?.[0] ?? 'script'
      if (type === 'main_frame') continue
      const initiator = rule.condition.initiatorDomains?.[0]
        ? `https://${rule.condition.initiatorDomains[0]}`
        : rule.condition.domainType === 'firstParty' ? `https://${domain}` : 'https://initiator.example'
      const matched = await matchOutcome(worker, `https://${domain}/resource`, type, initiator)
      assert.ok(matched.length > 0, `rule ${rule.id} (${domain}, ${type}) should match`)
      checked += 1
    }
    assert.ok(checked >= Math.min(SAMPLE, candidates.length) - 5, `checked ${checked} sampled rules`)
  })

  it('blocks ad and tracker requests on a regular site but lets first-party content through', async () => {
    requestLog.length = 0
    const page = await openPage(`https://fixture.test:${PORT}/`)
    const loaded = await page.evaluate(() => (window as unknown as { __loaded?: string[] }).__loaded ?? [])

    assert.ok(loaded.some(entry => entry.endsWith('/first-party.js')), 'first-party script loads')
    assert.ok(!requestLog.some(entry => entry.startsWith('ads.doubleclick.net')), 'doubleclick script blocked')
    assert.ok(!requestLog.some(entry => entry.startsWith('pagead2.googlesyndication.com')), 'googlesyndication pixel blocked')
    assert.ok(!requestLog.some(entry => entry.startsWith('www.google-analytics.com')), 'analytics blocked by tracker ruleset')

    const bannerHidden = await page.$eval('#banner', element => getComputedStyle(element).display === 'none')
    assert.equal(bannerHidden, true, 'generic cosmetic CSS hides .ad-banner')
    await page.close()
  })

  it('prunes ad payloads and neutralises detection hooks on a YouTube page', async () => {
    const page = await openPage(`https://www.youtube.com:${PORT}/watch?v=fixture`)
    const result = await page.evaluate(async () => {
      const w = window as unknown as Record<string, any>
      const frame = document.createElement('iframe')
      document.body.appendChild(frame)
      const frameWindow = frame.contentWindow as unknown as Record<string, any>

      let abnormalityRan = false
      await Promise.resolve().then(function onAbnormalityDetected() { abnormalityRan = true })

      const timerStart = performance.now()
      await new Promise(resolve => setTimeout((resolve as () => void).bind(null), 17000))
      const timerElapsed = performance.now() - timerStart

      return {
        adPlacements: w.ytInitialPlayerResponse.adPlacements,
        playerAds: w.ytInitialPlayerResponse.playerAds,
        adSlots: w.ytInitialPlayerResponse.adSlots,
        videoId: w.ytInitialPlayerResponse.videoDetails.videoId,
        enforcement: w.ytInitialPlayerResponse.auxiliaryUi.messageRenderers.enforcementMessageViewModel,
        feedItems: w.ytInitialData.contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.richGridRenderer.contents.length,
        parsedAdPlacements: w.__parsedPlayer.adPlacements,
        parsedFormats: w.__parsedPlayer.streamingData.formats,
        googleAdStatus: w.google_ad_status,
        feedAdHidden: getComputedStyle(document.getElementById('feed-ad')!).display === 'none',
        feedItemHidden: getComputedStyle(document.getElementById('feed-item')!).display === 'none',
        playerAdsVisible: getComputedStyle(document.getElementById('player-ads')!).display !== 'none',
        bypassScriptRan: w.__bypassRan === true,
        frameSharesFetch: frameWindow.fetch === w.fetch,
        frameSharesParse: frameWindow.JSON.parse === JSON.parse,
        abnormalityRan,
        timerElapsed,
        nativeLookingParse: String(JSON.parse).includes('native code'),
        nativeLookingStringify: String(JSON.stringify).includes('native code'),
      }
    })
    assert.equal(result.adPlacements, undefined)
    assert.equal(result.playerAds, undefined)
    assert.equal(result.adSlots, undefined)
    assert.equal(result.enforcement, undefined)
    assert.equal(result.videoId, 'fixture')
    assert.equal(result.feedItems, 1, 'home feed ad entry pruned from ytInitialData')
    assert.equal(result.parsedAdPlacements, undefined)
    assert.deepEqual(result.parsedFormats, [])
    assert.equal(result.googleAdStatus, 1, 'google_ad_status pinned')
    assert.equal(result.feedAdHidden, false, 'bare ad slot element is not hidden by itself')
    assert.equal(result.feedItemHidden, true, 'rich item wrapping an ad slot is hidden')
    assert.equal(result.playerAdsVisible, true, '#player-ads is never hidden (detection bait)')
    assert.equal(result.bypassScriptRan, false, 'inline native-bypass script neutralised before running')
    assert.equal(result.frameSharesFetch, true, 'about:blank iframe gets the hooked fetch')
    assert.equal(result.frameSharesParse, true, 'about:blank iframe gets the hooked JSON.parse')
    assert.equal(result.abnormalityRan, false, 'onAbnormalityDetected callbacks are neutralised')
    assert.ok(result.timerElapsed < 2000, `17 s stall timer shortened, took ${result.timerElapsed}ms`)
    assert.equal(result.nativeLookingParse, true)
    assert.equal(result.nativeLookingStringify, true)
    await page.close()
  })

  it('skips client-side and server-side ads and restores the player afterwards', async () => {
    const page = await openPage(`https://www.youtube.com:${PORT}/watch?v=fixture`)

    const clientAd = await page.evaluate(async () => {
      const w = window as unknown as Record<string, any>
      const player = document.getElementById('movie_player')!
      const video = document.getElementById('video') as HTMLVideoElement
      video.muted = false
      let skipClicked = false
      const skip = document.createElement('button')
      skip.className = 'ytp-skip-ad-button'
      skip.textContent = 'Skip'
      skip.addEventListener('click', () => { skipClicked = true })
      player.appendChild(skip)
      w.__stats = { debug_info: 'CSI' }
      player.classList.add('ad-showing')
      await new Promise(resolve => setTimeout(resolve, 900))
      const duringAd = { muted: video.muted, rate: video.playbackRate, skipClicked }
      player.classList.remove('ad-showing')
      skip.remove()
      await new Promise(resolve => setTimeout(resolve, 900))
      return { duringAd, afterAd: { muted: video.muted, rate: video.playbackRate } }
    })
    assert.equal(clientAd.duringAd.skipClicked, true, 'skip button clicked')
    assert.equal(clientAd.duringAd.muted, true, 'muted during ad')
    assert.equal(clientAd.duringAd.rate, 16, 'unknown-duration ad fast-forwarded')
    assert.equal(clientAd.afterAd.muted, false, 'mute restored after ad')
    assert.equal(clientAd.afterAd.rate, 1, 'playback rate restored after ad')

    const stitchedAd = await page.evaluate(async () => {
      const w = window as unknown as Record<string, any>
      const player = document.getElementById('movie_player')!
      w.__stats = { debug_info: 'SSAP, AD, 1 of 1' }
      w.__progress = { current: 2, duration: 20, loaded: 20 }
      w.__seekTo = []
      player.classList.add('ad-showing')
      await new Promise(resolve => setTimeout(resolve, 900))
      player.classList.remove('ad-showing')
      w.__stats = { debug_info: 'CSI' }
      return { seeks: w.__seekTo as number[] }
    })
    assert.ok(stitchedAd.seeks.includes(20), `server-side ad skipped via player.seekTo, got ${JSON.stringify(stitchedAd.seeks)}`)

    const dialog = await page.evaluate(async () => {
      const shell = document.createElement('tp-yt-paper-dialog')
      shell.id = 'enforcement-shell'
      shell.appendChild(document.createElement('ytd-enforcement-message-view-model'))
      document.body.appendChild(shell)
      document.body.appendChild(document.createElement('tp-yt-iron-overlay-backdrop'))
      await new Promise(resolve => setTimeout(resolve, 600))
      return { shellPresent: Boolean(document.getElementById('enforcement-shell')), backdropPresent: Boolean(document.querySelector('tp-yt-iron-overlay-backdrop')) }
    })
    assert.equal(dialog.shellPresent, false, 'enforcement dialog removed')
    assert.equal(dialog.backdropPresent, false, 'dialog backdrop removed')
    await page.close()

    const worker = await getServiceWorker()
    const stats = await worker.evaluate(async () => (await chrome.storage.local.get('stats')).stats as Record<string, number> | undefined)
    assert.ok(stats, 'stats recorded')
    assert.equal(stats.youtubeAdsSkipped, 2)
    assert.ok((stats.responsesPruned ?? 0) >= 5, `responsesPruned should count removed keys, got ${stats.responsesPruned}`)
  })

  it('recovers from the enforcement wall by reloading with a reshaped player request', async () => {
    const page = await openPage(`https://www.youtube.com:${PORT}/watch?v=fixture`)
    const result = await page.evaluate(async () => {
      const w = window as unknown as Record<string, any>
      const requestBody = () => ({
        context: { client: { clientName: 'WEB', clientVersion: '2.2026' } },
        videoId: 'wall1',
        playbackContext: { contentPlaybackContext: { referer: 'https://www.youtube.com/watch?v=wall1' } },
      })
      const before = JSON.parse(JSON.stringify(requestBody()))
      w.__loads = []
      w.__playerResponse = {
        playabilityStatus: {
          status: 'UNPLAYABLE',
          errorScreen: { playerErrorMessageRenderer: { subreason: { runs: [{ text: 'Ad blockers violate the Terms of Service', navigationEndpoint: { commandMetadata: { webCommandMetadata: { url: 'https://support.google.com/youtube/answer/3037019', webPageType: 'WEB_PAGE_TYPE_UNKNOWN' } } } }] } } },
        },
        videoDetails: { videoId: 'wall1' },
        playerConfig: { playbackStartConfig: { startSeconds: 7 } },
      }
      await new Promise(resolve => setTimeout(resolve, 1200))
      const firstLoads = [...w.__loads]
      const afterFirst = JSON.parse(JSON.stringify(requestBody()))
      // Still walled: the controller must advance to the next shape after the throttle window.
      await new Promise(resolve => setTimeout(resolve, 1800))
      const secondLoads = [...w.__loads]
      const afterSecond = JSON.parse(JSON.stringify(requestBody()))
      // Playable again: no further reloads.
      w.__playerResponse = { playabilityStatus: { status: 'OK' }, videoDetails: { videoId: 'wall1' } }
      await new Promise(resolve => setTimeout(resolve, 1800))
      return { before, firstLoads, afterFirst, secondLoads, afterSecond, finalLoads: [...w.__loads] }
    })
    assert.equal('isInlinePlaybackNoAd' in result.before.playbackContext.contentPlaybackContext, false, 'requests untouched before a wall')
    assert.deepEqual(result.firstLoads, [['wall1', 7]], 'video reloaded once at the saved position')
    assert.equal(result.afterFirst.playbackContext.contentPlaybackContext.isInlinePlaybackNoAd, true, 'first recovery shape applied')
    assert.equal(result.afterFirst.playbackContext.contentPlaybackContext.referer.endsWith('#reloadxhr'), true)
    assert.equal(result.secondLoads.length, 2, 'second attempt after the throttle window')
    assert.equal(result.afterSecond.context.client.clientScreen, 'CHANNEL', 'second recovery shape applied')
    assert.equal(result.finalLoads.length, 2, 'no reloads once playable')
    await page.close()
  })

  it('pauses everything on a whitelisted host', async () => {
    const worker = await getServiceWorker()
    await patchSettings(worker, { whitelist: ['paused.test'] })
    const dynamicRules = await worker.evaluate(() => chrome.declarativeNetRequest.getDynamicRules())
    assert.equal(dynamicRules.length, 1)
    assert.equal(dynamicRules[0]?.action.type, 'allowAllRequests')

    requestLog.length = 0
    const page = await openPage(`https://paused.test:${PORT}/`)
    assert.ok(requestLog.some(entry => entry.startsWith('ads.doubleclick.net')), 'ads load on the paused host')
    const bannerVisible = await page.$eval('#banner', element => getComputedStyle(element).display !== 'none')
    assert.equal(bannerVisible, true, 'no cosmetic filtering on the paused host')
    await page.close()

    await patchSettings(worker, { whitelist: [] })
  })

  it('applies custom filters as dynamic rules', async () => {
    const worker = await getServiceWorker()
    await patchSettings(worker, { customFilters: '||custom-blocked.example^\n@@||allowed.example^$document\ninvalid##cosmetic' })
    const dynamicRules = await worker.evaluate(() => chrome.declarativeNetRequest.getDynamicRules())
    assert.deepEqual(dynamicRules.map(rule => [rule.id, rule.action.type]), [[1000, 'block'], [1001, 'allowAllRequests']])
    const matched = await matchOutcome(worker, 'https://custom-blocked.example/x.js', 'script', 'https://www.example.com')
    assert.ok(matched.some(rule => rule.rulesetId === '_dynamic' && rule.ruleId === 1000), `custom rule matched: ${JSON.stringify(matched)}`)
    await patchSettings(worker, { customFilters: '' })
  })

  it('disables rulesets and scripts when the global switch is off, and restores them', async () => {
    const worker = await getServiceWorker()
    const readState = () =>
      worker.evaluate(async () => ({
        rulesets: await chrome.declarativeNetRequest.getEnabledRulesets(),
        scripts: (await chrome.scripting.getRegisteredContentScripts()).length,
        badge: await chrome.action.getBadgeText({}),
      }))

    await patchSettings(worker, { enabled: false })
    const off = await readState()
    assert.deepEqual(off.rulesets, [])
    assert.equal(off.scripts, 0)
    assert.equal(off.badge, 'OFF')

    await patchSettings(worker, { enabled: true })
    const on = await readState()
    assert.deepEqual([...on.rulesets].sort(), shippedRulesetIds())
    assert.equal(on.scripts, 3)
    assert.equal(on.badge, '')
  })
})
