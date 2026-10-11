import type { Stats } from './settings.ts'

/** Messages sent from content scripts to the service worker. */
export type ContentMessage = {
  type: 'REPORT_STAT'
  stat: keyof Stats
  delta: number
}

export type RuntimeMessage = ContentMessage

export function isRuntimeMessage(value: unknown): value is RuntimeMessage {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    candidate.type === 'REPORT_STAT' &&
    typeof candidate.stat === 'string' &&
    typeof candidate.delta === 'number' &&
    Number.isFinite(candidate.delta)
  )
}

/**
 * Fire-and-forget report from a content script. Errors (e.g. the extension was
 * reloaded and the content script context is orphaned) are deliberately swallowed.
 */
export function reportStat(stat: keyof Stats, delta = 1): void {
  if (delta <= 0) return
  try {
    const message: ContentMessage = { type: 'REPORT_STAT', stat, delta }
    void chrome.runtime.sendMessage(message).catch(() => undefined)
  } catch {
    // Orphaned content script after extension reload; nothing to do.
  }
}
