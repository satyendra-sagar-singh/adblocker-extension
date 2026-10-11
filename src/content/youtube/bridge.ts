/**
 * Message passing between the MAIN-world and ISOLATED-world scripts. Payloads are
 * serialised to strings because object `detail` values do not cross JS worlds in Chrome.
 */

import type { YouTubeSettings } from '../../shared/settings.ts'

export const EVENT_TO_ISOLATED = 'adblocker-youtube:to-isolated'
export const EVENT_TO_MAIN = 'adblocker-youtube:to-main'

export type ToIsolatedMessage =
  | { type: 'ready' }
  | { type: 'stat'; stat: 'youtubeAdsSkipped' | 'responsesPruned'; delta: number }

export type ToMainMessage = { type: 'settings'; settings: YouTubeSettings }

export function emit(eventName: string, payload: unknown): void {
  try {
    document.dispatchEvent(new CustomEvent(eventName, { detail: JSON.stringify(payload) }))
  } catch {
    // No document yet or serialisation failure; nothing useful to do.
  }
}

export function listen<T>(eventName: string, handler: (payload: T) => void): void {
  document.addEventListener(eventName, event => {
    const detail = (event as CustomEvent<unknown>).detail
    if (typeof detail !== 'string') return
    try {
      handler(JSON.parse(detail) as T)
    } catch {
      // Malformed payload; ignore.
    }
  })
}
