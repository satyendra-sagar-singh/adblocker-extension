/**
 * Reshapes outbound /youtubei/v1/player request bodies so YouTube returns a response
 * without ads or an enforcement wall. The shapes are the ones uBlock Origin and AdGuard
 * rotate through (clientScreen CHANNEL / ADUNIT, params 8AUB / YAHI / eAFgAQ, in-stream
 * ad context, inline-playback-no-ad). Nothing is changed until a wall has been seen.
 */

export type RequestMode = 'none' | 'inline' | 'channel' | 'lactmilli' | 'yahi' | 'instream' | 'eafg' | 'adunit'

export const RECOVERY_MODES: readonly RequestMode[] = ['inline', 'channel', 'lactmilli', 'yahi', 'instream', 'eafg', 'adunit']

const RELOAD_MARKER = '#reloadxhr'

type AnyRecord = Record<string, unknown>

const isRecord = (value: unknown): value is AnyRecord => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * A /youtubei/v1/player body carries the InnerTube context, the video id and a
 * playbackContext.contentPlaybackContext (signature timestamp etc.). /next,
 * /updated_metadata and /player/heartbeat bodies also carry context + videoId but no
 * content playback context, and must never be reshaped.
 */
export function isPlayerRequestBody(value: unknown): value is AnyRecord {
  if (!isRecord(value)) return false
  const context = value.context
  if (!isRecord(context) || !isRecord(context.client) || typeof value.videoId !== 'string') return false
  if ('heartbeatRequestParams' in value) return false
  const playbackContext = value.playbackContext
  return isRecord(playbackContext) && isRecord(playbackContext.contentPlaybackContext)
}

/** Mutates and returns the request body for the given mode; a no-op for mode "none". */
export function shapePlayerRequest<T>(body: T, mode: RequestMode, now: number): T {
  if (mode === 'none' || !isPlayerRequestBody(body)) return body

  const request = body as AnyRecord
  const client = (request.context as AnyRecord).client as AnyRecord
  const playbackContext = request.playbackContext as AnyRecord
  const contentPlaybackContext = playbackContext.contentPlaybackContext as AnyRecord

  contentPlaybackContext.lactMilliseconds = String(now)
  const referer = typeof contentPlaybackContext.referer === 'string' ? contentPlaybackContext.referer : ''
  contentPlaybackContext.referer = referer.endsWith(RELOAD_MARKER) ? referer : `${referer}${RELOAD_MARKER}`

  switch (mode) {
    case 'inline':
      contentPlaybackContext.isInlinePlaybackNoAd = true
      break
    case 'channel':
      if (client.clientName === 'WEB') client.clientScreen = 'CHANNEL'
      break
    case 'adunit':
      if (client.clientName === 'WEB') client.clientScreen = 'ADUNIT'
      break
    case 'lactmilli':
      request.params = '8AUB'
      break
    case 'yahi':
      request.params = 'YAHI'
      break
    case 'eafg':
      request.params = 'eAFgAQ'
      break
    case 'instream':
      playbackContext.adPlaybackContext = { adType: 'AD_TYPE_INSTREAM' }
      break
    default:
      break
  }
  return body
}

/** Next mode in the ladder, or null once every shape has been tried. */
export function nextRecoveryMode(current: RequestMode): RequestMode | null {
  const index = RECOVERY_MODES.indexOf(current)
  return RECOVERY_MODES[index + 1] ?? null
}

/**
 * Hooks JSON.stringify (the serialisation step before every InnerTube fetch) so that
 * player request bodies are reshaped according to the current recovery mode.
 */
export function installRequestShaping(getMode: () => RequestMode, now: () => number = () => Date.now()): void {
  const descriptor = Object.getOwnPropertyDescriptor(JSON, 'stringify')
  if (!descriptor || typeof descriptor.value !== 'function') return
  if (!descriptor.writable && !descriptor.configurable) return
  const proxied = new Proxy(descriptor.value as typeof JSON.stringify, {
    apply: (target, thisArg, args: unknown[]) => {
      const mode = getMode()
      if (mode !== 'none' && isPlayerRequestBody(args[0])) shapePlayerRequest(args[0], mode, now())
      return Reflect.apply(target, thisArg, args)
    },
  })
  Object.defineProperty(JSON, 'stringify', { ...descriptor, value: proxied })
}
