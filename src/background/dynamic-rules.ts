import { convertAbpFilters } from '../filters/abp-to-dnr.ts'
import { validateRule } from '../filters/dnr-validate.ts'
import type { DnrRule } from '../filters/dnr-types.ts'
import type { Settings } from '../shared/settings.ts'
import {
  CUSTOM_RULE_ID_END,
  CUSTOM_RULE_ID_START,
  WHITELIST_RULE_ID_END,
  WHITELIST_RULE_ID_START,
  WHITELIST_RULE_PRIORITY,
} from './constants.ts'

type ChromeRule = chrome.declarativeNetRequest.Rule

/**
 * Pure: one allowAllRequests rule per whitelisted host. A main_frame / sub_frame match on
 * the host allows every request made inside that frame hierarchy, which is exactly
 * "pause blocking on this site". requestDomains also covers subdomains.
 */
export function buildWhitelistRules(whitelist: readonly string[]): DnrRule[] {
  const capacity = WHITELIST_RULE_ID_END - WHITELIST_RULE_ID_START + 1
  return whitelist.slice(0, capacity).map((hostname, index) => ({
    id: WHITELIST_RULE_ID_START + index,
    priority: WHITELIST_RULE_PRIORITY,
    action: { type: 'allowAllRequests' },
    condition: {
      requestDomains: [hostname],
      resourceTypes: ['main_frame', 'sub_frame'],
    },
  }))
}

/** Pure: custom EasyList-syntax filters converted into dynamic rules, invalid ones dropped. */
export function buildCustomRules(customFilters: string): DnrRule[] {
  const capacity = CUSTOM_RULE_ID_END - CUSTOM_RULE_ID_START + 1
  const { rules } = convertAbpFilters(customFilters, { firstRuleId: CUSTOM_RULE_ID_START, maxRules: capacity })
  return rules.filter(rule => validateRule(rule).length === 0)
}

export function buildDynamicRules(settings: Settings): DnrRule[] {
  if (!settings.enabled) return []
  return [...buildWhitelistRules(settings.whitelist), ...buildCustomRules(settings.customFilters)]
}

const ruleFingerprint = (rule: ChromeRule | DnrRule): string =>
  JSON.stringify({ id: rule.id, priority: rule.priority ?? 1, action: rule.action, condition: rule.condition })

/**
 * Replaces the extension's dynamic rules with the desired set, touching only rules that
 * actually changed so Chrome does not re-index unchanged ones.
 */
export async function syncDynamicRules(settings: Settings): Promise<void> {
  const desired = buildDynamicRules(settings)
  const existing = await chrome.declarativeNetRequest.getDynamicRules()

  const desiredById = new Map(desired.map(rule => [rule.id, rule]))
  const existingById = new Map(existing.map(rule => [rule.id, rule]))

  const removeRuleIds = existing
    .filter(rule => {
      const wanted = desiredById.get(rule.id)
      return !wanted || ruleFingerprint(wanted) !== ruleFingerprint(rule)
    })
    .map(rule => rule.id)

  const addRules = desired.filter(rule => {
    const current = existingById.get(rule.id)
    return !current || ruleFingerprint(current) !== ruleFingerprint(rule)
  }) as ChromeRule[]

  if (removeRuleIds.length === 0 && addRules.length === 0) return
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules })
}
