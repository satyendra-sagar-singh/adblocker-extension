/**
 * Validates declarativeNetRequest rules against the constraints Chrome enforces at
 * load time, so broken rulesets fail in CI instead of silently disabling a ruleset.
 */

import { DNR_ACTION_TYPES, DNR_REQUEST_METHODS, DNR_RESOURCE_TYPES, type DnrRule } from './dnr-types.ts'

export interface RuleProblem {
  id: number | null
  problems: string[]
}

export interface RulesetValidation {
  ruleCount: number
  regexRuleCount: number
  errors: RuleProblem[]
}

const ASCII_ONLY = /^[\x21-\x7e]+$/
const HOSTNAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/
const MAX_REGEX_LENGTH = 2000

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function validateDomainList(value: unknown, field: string, problems: string[]): void {
  if (value === undefined) return
  if (!Array.isArray(value) || value.length === 0) {
    problems.push(`${field} must be a non-empty array`)
    return
  }
  for (const domain of value) {
    if (typeof domain !== 'string' || !HOSTNAME_PATTERN.test(domain)) {
      problems.push(`${field} contains an invalid domain: ${JSON.stringify(domain)}`)
    } else if (!ASCII_ONLY.test(domain)) {
      problems.push(`${field} must be ASCII (punycode): ${domain}`)
    }
  }
}

function validateEnumList(value: unknown, field: string, allowed: readonly string[], problems: string[]): void {
  if (value === undefined) return
  if (!Array.isArray(value) || value.length === 0) {
    problems.push(`${field} must be a non-empty array`)
    return
  }
  for (const entry of value) {
    if (!allowed.includes(entry as string)) problems.push(`${field} has unknown value ${JSON.stringify(entry)}`)
  }
}

function validateUrlFilter(urlFilter: string, problems: string[]): void {
  if (urlFilter.length === 0) {
    problems.push('urlFilter must not be empty')
    return
  }
  if (!ASCII_ONLY.test(urlFilter)) problems.push('urlFilter must be ASCII without whitespace')

  const anchoredStart = urlFilter.startsWith('||') ? 2 : urlFilter.startsWith('|') ? 1 : 0
  const anchoredEnd = urlFilter.endsWith('|') ? 1 : 0
  const body = urlFilter.slice(anchoredStart, urlFilter.length - anchoredEnd)
  if (body.includes('|')) problems.push('urlFilter may only contain "|" as a start or end anchor')
  if (anchoredStart === 2 && body.length === 0) problems.push('urlFilter "||" needs a domain')
  if (body.replace(/[*^]/g, '').length === 0 && anchoredStart === 0 && anchoredEnd === 0) {
    problems.push('urlFilter matches every URL')
  }
}

export function validateRule(input: unknown): string[] {
  const problems: string[] = []
  if (!isRecord(input)) return ['rule must be an object']
  const rule = input as Partial<DnrRule> & Record<string, unknown>

  if (!Number.isInteger(rule.id) || (rule.id as number) < 1) problems.push('id must be a positive integer')
  if (rule.priority !== undefined && (!Number.isInteger(rule.priority) || rule.priority < 1)) {
    problems.push('priority must be a positive integer')
  }

  if (!isRecord(rule.action)) {
    problems.push('action is required')
  } else if (!DNR_ACTION_TYPES.includes(rule.action.type as never)) {
    problems.push(`unknown action type ${JSON.stringify(rule.action.type)}`)
  }

  if (!isRecord(rule.condition)) {
    problems.push('condition is required')
    return problems
  }
  const condition = rule.condition

  if (condition.urlFilter !== undefined && condition.regexFilter !== undefined) {
    problems.push('urlFilter and regexFilter are mutually exclusive')
  }
  if (condition.urlFilter !== undefined) {
    if (typeof condition.urlFilter !== 'string') problems.push('urlFilter must be a string')
    else validateUrlFilter(condition.urlFilter, problems)
  }
  if (condition.regexFilter !== undefined) {
    if (typeof condition.regexFilter !== 'string' || condition.regexFilter.length === 0) {
      problems.push('regexFilter must be a non-empty string')
    } else {
      if (condition.regexFilter.length > MAX_REGEX_LENGTH) problems.push('regexFilter exceeds 2KB')
      if (!ASCII_ONLY.test(condition.regexFilter)) problems.push('regexFilter must be ASCII')
      try {
        new RegExp(condition.regexFilter)
      } catch {
        problems.push('regexFilter is not a valid regular expression')
      }
    }
  }
  if (condition.isUrlFilterCaseSensitive !== undefined && typeof condition.isUrlFilterCaseSensitive !== 'boolean') {
    problems.push('isUrlFilterCaseSensitive must be boolean')
  }
  if (condition.domainType !== undefined && condition.domainType !== 'firstParty' && condition.domainType !== 'thirdParty') {
    problems.push('domainType must be firstParty or thirdParty')
  }

  validateEnumList(condition.resourceTypes, 'resourceTypes', DNR_RESOURCE_TYPES, problems)
  validateEnumList(condition.excludedResourceTypes, 'excludedResourceTypes', DNR_RESOURCE_TYPES, problems)
  validateEnumList(condition.requestMethods, 'requestMethods', DNR_REQUEST_METHODS, problems)
  validateEnumList(condition.excludedRequestMethods, 'excludedRequestMethods', DNR_REQUEST_METHODS, problems)
  if (condition.resourceTypes !== undefined && condition.excludedResourceTypes !== undefined) {
    problems.push('resourceTypes and excludedResourceTypes are mutually exclusive')
  }

  validateDomainList(condition.initiatorDomains, 'initiatorDomains', problems)
  validateDomainList(condition.excludedInitiatorDomains, 'excludedInitiatorDomains', problems)
  validateDomainList(condition.requestDomains, 'requestDomains', problems)
  validateDomainList(condition.excludedRequestDomains, 'excludedRequestDomains', problems)

  const deprecated = ['domains', 'excludedDomains'].filter(key => key in condition)
  if (deprecated.length) problems.push(`deprecated condition keys: ${deprecated.join(', ')}`)

  const actionType = isRecord(rule.action) ? rule.action.type : undefined
  if (actionType === 'allowAllRequests') {
    const types = condition.resourceTypes
    const onlyFrames = Array.isArray(types) && types.length > 0 && types.every(type => type === 'main_frame' || type === 'sub_frame')
    if (!onlyFrames) problems.push('allowAllRequests requires resourceTypes limited to main_frame / sub_frame')
  }

  return problems
}

export function validateRuleset(rules: unknown): RulesetValidation {
  if (!Array.isArray(rules)) {
    return { ruleCount: 0, regexRuleCount: 0, errors: [{ id: null, problems: ['ruleset must be a JSON array'] }] }
  }

  const errors: RuleProblem[] = []
  const seenIds = new Set<number>()
  let regexRuleCount = 0

  for (const rule of rules) {
    const problems = validateRule(rule)
    const id = isRecord(rule) && Number.isInteger(rule.id) ? (rule.id as number) : null
    if (id !== null) {
      if (seenIds.has(id)) problems.push(`duplicate id ${id}`)
      seenIds.add(id)
    }
    if (isRecord(rule) && isRecord(rule.condition) && rule.condition.regexFilter !== undefined) regexRuleCount += 1
    if (problems.length) errors.push({ id, problems })
  }

  return { ruleCount: rules.length, regexRuleCount, errors }
}
