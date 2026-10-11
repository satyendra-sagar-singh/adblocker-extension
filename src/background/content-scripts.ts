import { hostToMatchPatterns } from '../shared/hostname.ts'
import type { Settings } from '../shared/settings.ts'
import { YOUTUBE_MATCH_PATTERNS } from '../shared/youtube-hosts.ts'
import { SCRIPT_COSMETIC, SCRIPT_YOUTUBE_ISOLATED, SCRIPT_YOUTUBE_MAIN } from './constants.ts'

type RegisteredScript = chrome.scripting.RegisteredContentScript

const OWN_SCRIPT_IDS = new Set([SCRIPT_COSMETIC, SCRIPT_YOUTUBE_MAIN, SCRIPT_YOUTUBE_ISOLATED])

/**
 * Pure: the content scripts that should be registered for the given settings.
 * Whitelisted hosts are excluded at registration time, so paused sites never run
 * any of our code, and the MAIN-world script needs no asynchronous settings lookup.
 */
export function buildContentScriptRegistrations(settings: Settings): RegisteredScript[] {
  if (!settings.enabled) return []

  const excludeMatches = settings.whitelist.flatMap(hostToMatchPatterns)
  const scripts: RegisteredScript[] = []

  if (settings.cosmeticFiltering) {
    scripts.push({
      id: SCRIPT_COSMETIC,
      matches: ['http://*/*', 'https://*/*'],
      excludeMatches: [...excludeMatches, ...YOUTUBE_MATCH_PATTERNS],
      js: ['content/cosmetic/cosmetic.js'],
      css: ['content/cosmetic/generic.css'],
      runAt: 'document_start',
      world: 'ISOLATED',
      persistAcrossSessions: true,
    })
  }

  const youtube = settings.youtube
  const youtubeWanted = youtube.skipAds || youtube.hideFeedAds || youtube.muteAds || youtube.removeEnforcementDialog
  if (youtubeWanted) {
    scripts.push({
      id: SCRIPT_YOUTUBE_MAIN,
      matches: YOUTUBE_MATCH_PATTERNS,
      excludeMatches,
      js: ['content/youtube/main-world.js'],
      runAt: 'document_start',
      world: 'MAIN',
      allFrames: true,
      matchOriginAsFallback: true,
      persistAcrossSessions: true,
    })
    scripts.push({
      id: SCRIPT_YOUTUBE_ISOLATED,
      matches: YOUTUBE_MATCH_PATTERNS,
      excludeMatches,
      js: ['content/youtube/isolated.js'],
      css: youtube.hideFeedAds ? ['content/youtube/youtube.css'] : [],
      runAt: 'document_start',
      world: 'ISOLATED',
      allFrames: true,
      matchOriginAsFallback: true,
      persistAcrossSessions: true,
    })
  }

  return scripts
}

const scriptFingerprint = (script: RegisteredScript): string =>
  JSON.stringify({
    matches: script.matches ?? [],
    excludeMatches: script.excludeMatches ?? [],
    js: script.js ?? [],
    css: script.css ?? [],
    runAt: script.runAt ?? 'document_idle',
    world: script.world ?? 'ISOLATED',
    allFrames: script.allFrames ?? false,
    matchOriginAsFallback: script.matchOriginAsFallback ?? false,
  })

export async function syncContentScripts(settings: Settings): Promise<void> {
  const desired = buildContentScriptRegistrations(settings)
  const registered = (await chrome.scripting.getRegisteredContentScripts()).filter(script => OWN_SCRIPT_IDS.has(script.id))

  const desiredById = new Map(desired.map(script => [script.id, script]))
  const registeredById = new Map(registered.map(script => [script.id, script]))

  // Unregister only what is no longer wanted; changed scripts are updated in place so a
  // failure never leaves a wanted script unregistered.
  const unwantedIds = registered.filter(script => !desiredById.has(script.id)).map(script => script.id)
  if (unwantedIds.length) await chrome.scripting.unregisterContentScripts({ ids: unwantedIds })

  const toUpdate = desired.filter(script => {
    const current = registeredById.get(script.id)
    return current !== undefined && scriptFingerprint(current) !== scriptFingerprint(script)
  })
  if (toUpdate.length) await chrome.scripting.updateContentScripts(toUpdate)

  const toRegister = desired.filter(script => !registeredById.has(script.id))
  if (toRegister.length) await chrome.scripting.registerContentScripts(toRegister)
}
