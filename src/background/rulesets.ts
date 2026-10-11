import type { Settings } from '../shared/settings.ts'
import { RULESET_TRACKERS } from './constants.ts'

/** Pure: which static rulesets should be enabled for the given settings. */
export function selectEnabledRulesets(settings: Settings, availableRulesetIds: readonly string[]): string[] {
  if (!settings.enabled) return []
  return availableRulesetIds.filter(id => id !== RULESET_TRACKERS || settings.blockTrackers)
}

export function getAvailableRulesetIds(): string[] {
  const resources = chrome.runtime.getManifest().declarative_net_request?.rule_resources ?? []
  return resources.map(resource => resource.id)
}

export async function syncStaticRulesets(settings: Settings): Promise<void> {
  const available = getAvailableRulesetIds()
  const enableRulesetIds = selectEnabledRulesets(settings, available)
  const disableRulesetIds = available.filter(id => !enableRulesetIds.includes(id))
  await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds, disableRulesetIds })
}
