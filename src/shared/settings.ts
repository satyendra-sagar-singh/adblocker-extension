/**
 * Single source of truth for user settings and counters.
 * Settings live in chrome.storage.local; the service worker reacts to changes
 * and re-applies rulesets, dynamic rules and content-script registrations.
 */

export interface YouTubeSettings {
  /** Fast-forward / auto-click skip on in-player ads. */
  skipAds: boolean
  /** Hide promoted videos, display ads, mastheads and shelves in feeds. */
  hideFeedAds: boolean
  /** Mute the player while an ad is playing. */
  muteAds: boolean
  /** Dismiss the "ad blockers violate YouTube's ToS" dialog and resume playback. */
  removeEnforcementDialog: boolean
}

export interface Settings {
  /** Global kill switch. */
  enabled: boolean
  /** Enable the optional tracker / analytics ruleset. */
  blockTrackers: boolean
  /** Inject generic element-hiding CSS on all sites. */
  cosmeticFiltering: boolean
  youtube: YouTubeSettings
  /** Hostnames where blocking is paused (subdomains included). */
  whitelist: string[]
  /** User supplied EasyList-syntax network filters, one per line. */
  customFilters: string
}

export interface Stats {
  youtubeAdsSkipped: number
  elementsHidden: number
  responsesPruned: number
}

export const SETTINGS_KEY = 'settings'
export const STATS_KEY = 'stats'

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  blockTrackers: true,
  cosmeticFiltering: true,
  youtube: {
    skipAds: true,
    hideFeedAds: true,
    muteAds: true,
    removeEnforcementDialog: true,
  },
  whitelist: [],
  customFilters: '',
}

export const DEFAULT_STATS: Stats = {
  youtubeAdsSkipped: 0,
  elementsHidden: 0,
  responsesPruned: 0,
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const pickBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback

const pickString = (value: unknown, fallback: string): string =>
  typeof value === 'string' ? value : fallback

const pickStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

const pickCounter = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0

/** Pure: merges whatever is in storage with defaults, tolerating partial or corrupt data. */
export function mergeSettings(stored: unknown): Settings {
  const source = isRecord(stored) ? stored : {}
  const youtube = isRecord(source.youtube) ? source.youtube : {}

  return {
    enabled: pickBoolean(source.enabled, DEFAULT_SETTINGS.enabled),
    blockTrackers: pickBoolean(source.blockTrackers, DEFAULT_SETTINGS.blockTrackers),
    cosmeticFiltering: pickBoolean(source.cosmeticFiltering, DEFAULT_SETTINGS.cosmeticFiltering),
    youtube: {
      skipAds: pickBoolean(youtube.skipAds, DEFAULT_SETTINGS.youtube.skipAds),
      hideFeedAds: pickBoolean(youtube.hideFeedAds, DEFAULT_SETTINGS.youtube.hideFeedAds),
      muteAds: pickBoolean(youtube.muteAds, DEFAULT_SETTINGS.youtube.muteAds),
      removeEnforcementDialog: pickBoolean(
        youtube.removeEnforcementDialog,
        DEFAULT_SETTINGS.youtube.removeEnforcementDialog,
      ),
    },
    whitelist: [...new Set(pickStringArray(source.whitelist))],
    customFilters: pickString(source.customFilters, DEFAULT_SETTINGS.customFilters),
  }
}

export function mergeStats(stored: unknown): Stats {
  const source = isRecord(stored) ? stored : {}
  return {
    youtubeAdsSkipped: pickCounter(source.youtubeAdsSkipped),
    elementsHidden: pickCounter(source.elementsHidden),
    responsesPruned: pickCounter(source.responsesPruned),
  }
}

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY)
  return mergeSettings(stored[SETTINGS_KEY])
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await loadSettings()
  const next: Settings = {
    ...current,
    ...patch,
    youtube: { ...current.youtube, ...(patch.youtube ?? {}) },
  }
  await chrome.storage.local.set({ [SETTINGS_KEY]: next })
  return next
}

export async function loadStats(): Promise<Stats> {
  const stored = await chrome.storage.local.get(STATS_KEY)
  return mergeStats(stored[STATS_KEY])
}

export async function resetStats(): Promise<void> {
  await chrome.storage.local.set({ [STATS_KEY]: DEFAULT_STATS })
}

/** Subscribe to settings changes; returns an unsubscribe function. */
export function onSettingsChanged(listener: (settings: Settings) => void): () => void {
  const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'local' || !(SETTINGS_KEY in changes)) return
    listener(mergeSettings(changes[SETTINGS_KEY]?.newValue))
  }
  chrome.storage.onChanged.addListener(handler)
  return () => chrome.storage.onChanged.removeListener(handler)
}
