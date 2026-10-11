/**
 * Post-conversion optimisation: rules whose only URL condition is a domain anchor
 * ("||host^") with identical action, priority and options are merged into one rule with a
 * requestDomains list. Chrome counts rules, not domains, so this turns tens of thousands of
 * hosts-style entries into a handful of rules without changing what gets matched.
 */

import type { DnrRule, DnrRuleCondition } from './dnr-types.ts'

const DOMAIN_ANCHOR_ONLY = /^\|\|([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)\^$/

/** Maximum domains per merged rule; keeps individual rules small for Chrome's indexer. */
export const DEFAULT_MAX_DOMAINS_PER_RULE = 1000

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value)
}

function isMergeable(rule: DnrRule): string | null {
  const condition = rule.condition
  if (!condition.urlFilter || condition.regexFilter) return null
  if (condition.requestDomains || condition.excludedRequestDomains) return null
  const match = DOMAIN_ANCHOR_ONLY.exec(condition.urlFilter)
  return match?.[1] ?? null
}

export function renumberRules(rules: readonly DnrRule[], firstRuleId: number): DnrRule[] {
  return rules.map((rule, index) => ({ ...rule, id: firstRuleId + index }))
}

export function mergeDomainRules(rules: readonly DnrRule[], maxDomainsPerRule = DEFAULT_MAX_DOMAINS_PER_RULE): DnrRule[] {
  interface Group {
    template: DnrRule
    condition: DnrRuleCondition
    domains: string[]
  }
  const groups = new Map<string, Group>()
  const passthrough: DnrRule[] = []

  for (const rule of rules) {
    const domain = isMergeable(rule)
    if (!domain) {
      passthrough.push(rule)
      continue
    }
    // Hostnames are case-insensitive, so the case-sensitivity flag carries no information here.
    const { urlFilter: _urlFilter, isUrlFilterCaseSensitive: _caseFlag, ...rest } = rule.condition
    const key = stableStringify({ priority: rule.priority ?? 1, action: rule.action, condition: rest })
    const group = groups.get(key)
    if (group) {
      group.domains.push(domain)
    } else {
      groups.set(key, { template: rule, condition: rest, domains: [domain] })
    }
  }

  const merged: DnrRule[] = []
  for (const group of groups.values()) {
    const uniqueDomains = [...new Set(group.domains)]
    for (let start = 0; start < uniqueDomains.length; start += maxDomainsPerRule) {
      const chunk = uniqueDomains.slice(start, start + maxDomainsPerRule)
      merged.push({
        id: group.template.id,
        ...(group.template.priority !== undefined ? { priority: group.template.priority } : {}),
        action: group.template.action,
        condition: { ...group.condition, requestDomains: chunk },
      })
    }
  }

  const firstId = rules[0]?.id ?? 1
  return renumberRules([...merged, ...passthrough], firstId)
}
