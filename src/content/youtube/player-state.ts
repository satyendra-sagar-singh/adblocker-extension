/**
 * Pure predicates over the player's public API objects. Kept free of DOM access so
 * they can be unit tested against captured payloads.
 */

import { SSAP_DEBUG_PREFIX, WALL_PAGE_TYPE_TOKEN, WALL_SUPPORT_URL } from './config.ts'

type AnyRecord = Record<string, unknown>
const isRecord = (value: unknown): value is AnyRecord => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Shape of the subset of #movie_player's API that the controller relies on. */
export interface PlayerApi {
  getPlayerResponse?: () => unknown
  getStatsForNerds?: () => unknown
  getProgressState?: () => unknown
  seekTo?: (seconds: number, allowSeekAhead?: boolean) => void
  loadVideoById?: (videoId: string, startSeconds?: number) => void
}

export interface ProgressState {
  current: number
  duration: number
  loaded: number
}

/**
 * The enforcement wall: playability UNPLAYABLE whose error screen links the generic
 * troubleshooting answer and carries the WEB_PAGE_TYPE_UNKNOWN endpoint, and which is
 * not a captcha challenge.
 */
export function isEnforcementWall(playerResponse: unknown): boolean {
  if (!isRecord(playerResponse)) return false
  const playability = playerResponse.playabilityStatus
  if (!isRecord(playability) || playability.status !== 'UNPLAYABLE') return false

  const errorScreen = isRecord(playability.errorScreen) ? playability.errorScreen : {}
  const messageRenderer = isRecord(errorScreen.playerErrorMessageRenderer) ? errorScreen.playerErrorMessageRenderer : undefined
  if (messageRenderer?.playerCaptchaViewModel) return false

  const subreason = isRecord(messageRenderer?.subreason) ? messageRenderer.subreason.runs : undefined
  const interstitial = isRecord(errorScreen.playerInterstitialRenderer) ? errorScreen.playerInterstitialRenderer : undefined
  const interstitialContent = isRecord(interstitial?.content) ? interstitial.content : undefined
  const viewModel = isRecord(interstitialContent?.interstitialViewModel) ? interstitialContent.interstitialViewModel : undefined
  const description = isRecord(viewModel?.description) ? viewModel.description : undefined
  const text = JSON.stringify(subreason ?? description?.commandRuns ?? null)

  return text.includes(WALL_PAGE_TYPE_TOKEN) && text.includes(WALL_SUPPORT_URL)
}

/** True while a server-side stitched ad segment is playing (stats-for-nerds debug_info). */
export function isSsapAdPlaying(statsForNerds: unknown): boolean {
  if (!isRecord(statsForNerds)) return false
  return typeof statsForNerds.debug_info === 'string' && statsForNerds.debug_info.startsWith(SSAP_DEBUG_PREFIX)
}

export function readProgressState(value: unknown): ProgressState | null {
  if (!isRecord(value)) return null
  const { current, duration, loaded } = value
  if (typeof current !== 'number' || typeof duration !== 'number' || typeof loaded !== 'number') return null
  return { current, duration, loaded }
}

/** uBO only seeks when the ad still has meaningful time left. */
export function shouldSeekPastSsapAd(progress: ProgressState | null): boolean {
  if (!progress || progress.duration <= 0) return false
  return progress.loaded < progress.duration || progress.duration - progress.current > 1
}

export function getVideoId(playerResponse: unknown): string | null {
  if (!isRecord(playerResponse)) return null
  const details = playerResponse.videoDetails
  return isRecord(details) && typeof details.videoId === 'string' ? details.videoId : null
}

export function getStartSeconds(playerResponse: unknown, locationSearch: string): number {
  if (isRecord(playerResponse)) {
    const config = isRecord(playerResponse.playerConfig) ? playerResponse.playerConfig : undefined
    const start = isRecord(config?.playbackStartConfig) ? config.playbackStartConfig.startSeconds : undefined
    if (typeof start === 'number' && Number.isFinite(start)) return start
  }
  const fromUrl = Number.parseInt(new URLSearchParams(locationSearch).get('t') ?? '', 10)
  return Number.isFinite(fromUrl) ? fromUrl : 0
}

/** Premium subscribers never see ads; the recovery logic must stay out of their way. */
export function isPremiumUser(ytInitialData: unknown, mastheadLogoType: string | null): boolean {
  if (mastheadLogoType === 'YOUTUBE_PREMIUM_LOGO') return true
  if (!isRecord(ytInitialData)) return false
  const topbar = isRecord(ytInitialData.topbar) ? ytInitialData.topbar : undefined
  const desktop = isRecord(topbar?.desktopTopbarRenderer) ? topbar.desktopTopbarRenderer : undefined
  const logo = isRecord(desktop?.logo) ? desktop.logo : undefined
  const renderer = isRecord(logo?.topbarLogoRenderer) ? logo.topbarLogoRenderer : undefined
  const icon = isRecord(renderer?.iconImage) ? renderer.iconImage : undefined
  return icon?.iconType === 'YOUTUBE_PREMIUM_LOGO'
}
