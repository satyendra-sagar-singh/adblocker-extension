import type { Settings } from '../shared/settings.ts'
import { BADGE_COLOR_ACTIVE, BADGE_COLOR_PAUSED } from './constants.ts'

/**
 * Chrome renders the per-tab count of matched (blocked) requests as the badge text when
 * displayActionCountAsBadgeText is on. Explicit badge text overrides it, which is how
 * the "OFF" state is shown.
 */
export async function syncBadge(settings: Settings): Promise<void> {
  await chrome.declarativeNetRequest.setExtensionActionOptions({
    displayActionCountAsBadgeText: settings.enabled,
  })
  await chrome.action.setBadgeBackgroundColor({ color: settings.enabled ? BADGE_COLOR_ACTIVE : BADGE_COLOR_PAUSED })
  await chrome.action.setBadgeTextColor({ color: '#ffffff' })
  await chrome.action.setBadgeText({ text: settings.enabled ? '' : 'OFF' })
}
