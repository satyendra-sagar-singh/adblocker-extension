/**
 * Configuration for the YouTube scripts: JSON paths, constants and selectors.
 * Every value here traces back to a currently maintained filter list (EasyList,
 * uBlock Origin's uAssets, AdGuard Base) or to YouTube's own player code, so this
 * is the single file to revisit when YouTube changes.
 */

/** Keys that identify an InnerTube payload; other JSON is left untouched. */
export const RESPONSE_MARKER_KEYS = [
  'responseContext',
  'playabilityStatus',
  'playerResponse',
  'adPlacements',
  'adSlots',
  'playerAds',
  'reelWatchSequenceResponse',
  'entries',
] as const

/**
 * Paths deleted from player / watch / playlist responses and from the inline globals.
 * adPlacements, adSlots and playerAds carry pre-roll / mid-roll placements; the
 * auxiliaryUi entries are the enforcement and Premium upsell dialogs.
 */
export const PRUNE_PATHS = [
  'adPlacements',
  'adSlots',
  'playerAds',
  'playerResponse.adPlacements',
  'playerResponse.adSlots',
  'playerResponse.playerAds',
  '[].playerResponse.adPlacements',
  '[].playerResponse.adSlots',
  '[].playerResponse.playerAds',
  'auxiliaryUi.messageRenderers.enforcementMessageViewModel',
  'auxiliaryUi.messageRenderers.upsellDialogRenderer',
  'playerResponse.auxiliaryUi.messageRenderers.enforcementMessageViewModel',
  'playerResponse.auxiliaryUi.messageRenderers.upsellDialogRenderer',
  'playerResponse.messages.[].youThereRenderer',
  'messages.[].youThereRenderer',
] as const

/** Array keys whose entries are inspected for ad renderers (feeds, search, sidebar, Shorts). */
export const FEED_ARRAY_KEYS = ['contents', 'items', 'results', 'entries', 'continuationItems'] as const

/**
 * Keys that mark a feed entry as an ad. adSlotRenderer is the current universal
 * slot; isAd (reelWatchEndpoint.adClientParams.isAd) marks a Shorts ad; the
 * remaining ones are legacy display ads that AdGuard still handles.
 */
export const FEED_AD_RENDERER_KEYS = [
  'adSlotRenderer',
  'isAd',
  'displayAdRenderer',
  'promotedSparklesWebRenderer',
  'promotedVideoRenderer',
  'compactPromotedVideoRenderer',
  'compactPromotedItemRenderer',
  'searchPyvRenderer',
  'inFeedAdLayoutRenderer',
] as const

/** Deepest nesting at which a marker key still identifies the entry as an ad. */
export const FEED_AD_MARKER_MAX_DEPTH = 4

/** Player endpoint responses that must never be touched. */
export const RESPONSE_URL_SKIP_PATTERNS = ['get_drm_license'] as const

/** Globals whose inline JSON is pruned the moment the page assigns them. */
export const INTERCEPTED_GLOBALS = ['ytInitialPlayerResponse', 'ytInitialData', 'playerResponse'] as const

/** Values pinned on page globals (uBlock Origin / AdGuard set-constant equivalents). */
export const PINNED_CONSTANTS: ReadonlyArray<{ path: string; value: unknown }> = [
  // AdGuard: YouTube checks that DoubleClick's ad_status.js ran; satisfy it unconditionally.
  { path: 'google_ad_status', value: 1 },
]

/** The watch page bootstraps ads through a 17 s native timer; both vendors shrink it. */
export const STALL_TIMER_MS = 17000
export const STALL_TIMER_SCALE = 0.001

/** Token in the inline script that fetches pristine natives through an about:blank iframe. */
export const NATIVE_BYPASS_SCRIPT_TOKEN = 'window,"fetch"'

/** Player element and the classes it carries while an ad plays (player JS, 2026). */
export const PLAYER_SELECTORS = ['#movie_player', '.html5-video-player'] as const
export const VIDEO_SELECTORS = ['video.html5-main-video', 'video'] as const
export const AD_STATE_CLASSES = ['ad-showing', 'ad-interrupting'] as const
export const OVERLAY_OPEN_CLASS = 'ytp-ad-overlay-open'

/** Skip / close buttons, newest first. All three skip variants ship concurrently (A/B). */
export const SKIP_BUTTON_SELECTORS = [
  '.ytp-skip-ad-button',
  '.ytp-ad-skip-button',
  '.ytp-ad-skip-button-modern',
  '.ytp-ad-skip-button-container button',
  '.ytp-ad-skip-button-slot button',
] as const
export const OVERLAY_CLOSE_SELECTORS = ['.ytp-ad-overlay-close-button'] as const
export const SKIP_BUTTON_DISABLED_CLASS = 'ytp-ad-skip-button-disabled'

/**
 * A client-side ad is a separate media item, so its duration is short. Anything longer
 * is treated as a stitched stream and handled through the player API instead of a seek.
 */
export const MAX_CLIENT_AD_SECONDS = 600
export const FALLBACK_PLAYBACK_RATE = 16
export const PLAYER_POLL_INTERVAL_MS = 500
export const SKIP_CLICK_THROTTLE_MS = 300

/** Signature of the "ad blockers are not allowed" wall in playabilityStatus (uBO quick-fixes). */
export const WALL_SUPPORT_URL = 'https://support.google.com/youtube/answer/3037019'
export const WALL_PAGE_TYPE_TOKEN = 'WEB_PAGE_TYPE_UNKNOWN'
export const WALL_RECOVERY_THROTTLE_MS = 1500
export const SSAP_DEBUG_PREFIX = 'SSAP, AD'

/** The "ad blockers violate YouTube's Terms of Service" dialog, desktop and mobile. */
export const ENFORCEMENT_SELECTORS = [
  'ytd-enforcement-message-view-model',
  'ytm-enforcement-message-view-model',
] as const
export const DIALOG_SHELL_SELECTORS = ['tp-yt-paper-dialog', 'ytd-popup-container > *'] as const
export const DIALOG_BACKDROP_SELECTORS = ['tp-yt-iron-overlay-backdrop', 'iron-overlay-backdrop'] as const
