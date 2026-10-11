/**
 * MAIN-world controller for the YouTube player. It needs the page world because the
 * player's public API (getPlayerResponse, getStatsForNerds, seekTo, loadVideoById)
 * only exists there.
 *
 * Responsibilities: skip ads that still reach the player (client-side and server-side
 * stitched), mute while they are visible, and recover from the "ad blockers are not
 * allowed" wall by reloading the video with a reshaped request.
 */

import type { YouTubeSettings } from '../../shared/settings.ts'
import {
  AD_STATE_CLASSES,
  FALLBACK_PLAYBACK_RATE,
  MAX_CLIENT_AD_SECONDS,
  OVERLAY_CLOSE_SELECTORS,
  OVERLAY_OPEN_CLASS,
  PLAYER_POLL_INTERVAL_MS,
  PLAYER_SELECTORS,
  SKIP_BUTTON_DISABLED_CLASS,
  SKIP_BUTTON_SELECTORS,
  SKIP_CLICK_THROTTLE_MS,
  VIDEO_SELECTORS,
  WALL_RECOVERY_THROTTLE_MS,
} from './config.ts'
import {
  getStartSeconds,
  getVideoId,
  isEnforcementWall,
  isPremiumUser,
  isSsapAdPlaying,
  readProgressState,
  shouldSeekPastSsapAd,
  type PlayerApi,
} from './player-state.ts'
import { nextRecoveryMode, RECOVERY_MODES, type RequestMode } from './request-shaping.ts'

export interface ControllerDependencies {
  getSettings: () => YouTubeSettings
  getMode: () => RequestMode
  setMode: (mode: RequestMode) => void
  onAdSkipped: () => void
  now?: () => number
}

type PlayerElement = HTMLElement & PlayerApi

interface AdSession {
  mutedByUs: boolean
  previousMuted: boolean
  rateChanged: boolean
  counted: boolean
}

function querySafe<T extends Element>(root: ParentNode, selector: string): T | null {
  try {
    return root.querySelector<T>(selector)
  } catch {
    return null
  }
}

function safeCall<T>(fn: (() => T) | undefined, thisArg: unknown): T | undefined {
  if (typeof fn !== 'function') return undefined
  try {
    return fn.call(thisArg)
  } catch {
    return undefined
  }
}

const isClickable = (button: HTMLElement): boolean =>
  button.offsetParent !== null &&
  button.getAttribute('aria-disabled') !== 'true' &&
  !button.closest(`.${SKIP_BUTTON_DISABLED_CLASS}`)

export function createPlayerController(deps: ControllerDependencies): { start: () => void } {
  const now = deps.now ?? (() => Date.now())
  let player: PlayerElement | null = null
  let classObserver: MutationObserver | null = null
  let session: AdSession | null = null
  let lastClickAt = 0
  let lastRecoveryAt = 0
  let recoveryVideoId: string | null = null
  let recoveryAttempts = 0

  const findPlayer = (): PlayerElement | null => {
    for (const selector of PLAYER_SELECTORS) {
      const candidate = querySafe<PlayerElement>(document, selector)
      if (candidate) return candidate
    }
    return null
  }

  const findVideo = (root: HTMLElement): HTMLVideoElement | null => {
    for (const selector of VIDEO_SELECTORS) {
      const candidate = querySafe<HTMLVideoElement>(root, selector)
      if (candidate) return candidate
    }
    return null
  }

  const isAdShowing = (element: HTMLElement): boolean => AD_STATE_CLASSES.some(name => element.classList.contains(name))
  const isShortsPage = (): boolean => location.pathname.startsWith('/shorts/')
  const isWatchPage = (): boolean => location.pathname === '/watch'

  const clickButtons = (root: HTMLElement, selectors: readonly string[]): void => {
    if (now() - lastClickAt < SKIP_CLICK_THROTTLE_MS) return
    for (const selector of selectors) {
      const button = querySafe<HTMLElement>(root, selector)
      if (!button || !isClickable(button)) continue
      button.click()
      lastClickAt = now()
    }
  }

  const skipAdPlayback = (element: PlayerElement, video: HTMLVideoElement | null, active: AdSession): void => {
    const stats = safeCall(element.getStatsForNerds, element)
    const progress = readProgressState(safeCall(element.getProgressState, element))

    if (isSsapAdPlaying(stats)) {
      if (shouldSeekPastSsapAd(progress) && typeof element.seekTo === 'function' && progress) element.seekTo(progress.duration, true)
      return
    }
    if (!video) return

    const duration = video.duration
    const isSeparateAdMedia =
      progress !== null &&
      Number.isFinite(duration) &&
      duration > 0 &&
      duration <= MAX_CLIENT_AD_SECONDS &&
      Math.abs(progress.duration - duration) <= 2

    if (isSeparateAdMedia) {
      if (video.currentTime < duration - 0.2) video.currentTime = duration
      return
    }
    if (video.playbackRate !== FALLBACK_PLAYBACK_RATE) {
      video.playbackRate = FALLBACK_PLAYBACK_RATE
      active.rateChanged = true
    }
  }

  const handleAd = (element: PlayerElement): void => {
    const settings = deps.getSettings()
    const video = findVideo(element)
    if (!session) session = { mutedByUs: false, previousMuted: video?.muted ?? false, rateChanged: false, counted: false }

    if (settings.muteAds && video && !session.mutedByUs) {
      session.previousMuted = video.muted
      video.muted = true
      session.mutedByUs = true
    }
    if (settings.skipAds) {
      clickButtons(element, SKIP_BUTTON_SELECTORS)
      skipAdPlayback(element, video, session)
    }
    if (!session.counted) {
      session.counted = true
      deps.onAdSkipped()
    }
  }

  const endAdSession = (element: PlayerElement): void => {
    if (!session) return
    const video = findVideo(element)
    if (video) {
      if (session.mutedByUs) video.muted = session.previousMuted
      if (session.rateChanged && video.playbackRate === FALLBACK_PLAYBACK_RATE) video.playbackRate = 1
    }
    session = null
  }

  const recoverFromWall = (element: PlayerElement): void => {
    const response = safeCall(element.getPlayerResponse, element)
    if (!isEnforcementWall(response)) return
    const videoId = getVideoId(response)
    if (!videoId || typeof element.loadVideoById !== 'function') return
    if (now() - lastRecoveryAt < WALL_RECOVERY_THROTTLE_MS) return

    if (recoveryVideoId !== videoId) {
      recoveryVideoId = videoId
      recoveryAttempts = 0
    }
    if (recoveryAttempts >= RECOVERY_MODES.length) return

    const mode = nextRecoveryMode(deps.getMode()) ?? RECOVERY_MODES[0]
    if (!mode) return
    recoveryAttempts += 1
    lastRecoveryAt = now()
    deps.setMode(mode)
    element.loadVideoById(videoId, getStartSeconds(response, location.search))
  }

  const isPremium = (): boolean =>
    isPremiumUser((window as Window & { ytInitialData?: unknown }).ytInitialData, document.getElementById('masthead')?.getAttribute('logo-type') ?? null)

  const tick = (): void => {
    if (!player || !player.isConnected) attachPlayer()
    if (!player || isShortsPage()) return

    const settings = deps.getSettings()
    if (settings.removeEnforcementDialog && isWatchPage() && !isPremium()) recoverFromWall(player)

    if (isAdShowing(player)) handleAd(player)
    else if (session) endAdSession(player)

    if (settings.skipAds && player.classList.contains(OVERLAY_OPEN_CLASS)) clickButtons(player, OVERLAY_CLOSE_SELECTORS)
  }

  function attachPlayer(): void {
    const found = findPlayer()
    if (!found || found === player) return
    classObserver?.disconnect()
    player = found
    classObserver = new MutationObserver(tick)
    classObserver.observe(player, { attributes: true, attributeFilter: ['class'] })
  }

  return {
    start: () => {
      setInterval(tick, PLAYER_POLL_INTERVAL_MS)
      document.addEventListener('yt-navigate-finish', () => {
        attachPlayer()
        tick()
      })
      attachPlayer()
    },
  }
}
