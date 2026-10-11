/**
 * Converts the network-filter subset of EasyList / uBlock Origin / AdGuard syntax
 * into declarativeNetRequest rules.
 *
 * Supported:  ||host^  |anchor  ^ separator  * wildcard  @@ exceptions  hosts-file lines
 *             $third-party/$3p/$1p, resource type options (+ negation), $domain=/$from=,
 *             $to=, $denyallow=, $method=, $important, $match-case, $document (exceptions
 *             become allowAllRequests), $all
 * Skipped:    cosmetic filters, regex patterns, $csp, $redirect, $removeparam, $replace,
 *             $header, $popup, $elemhide/$generichide/$specifichide, $genericblock,
 *             $badfilter, $inline-*, $webrtc, non-ASCII patterns, entity domains (example.*)
 */

import type { DnrResourceType, DnrRequestMethod, DnrRule, DnrRuleCondition, DnrRuleWithoutId } from './dnr-types.ts'

export interface SkippedLine {
  line: string
  reason: string
}

export interface ConversionResult {
  rules: DnrRule[]
  skipped: SkippedLine[]
}

export interface ConvertOptions {
  /** Id assigned to the first emitted rule. Defaults to 1. */
  firstRuleId?: number
  /** Hard cap on emitted rules; further convertible lines are reported as skipped. */
  maxRules?: number
}

export type LineConversion =
  | { kind: 'rule'; rule: DnrRuleWithoutId }
  | { kind: 'skip'; reason: string }
  | { kind: 'ignore' }

export const PRIORITY_DEFAULT = 1
export const PRIORITY_IMPORTANT = 2

const TYPE_OPTIONS: Record<string, DnrResourceType> = {
  script: 'script',
  image: 'image',
  stylesheet: 'stylesheet',
  css: 'stylesheet',
  object: 'object',
  xmlhttprequest: 'xmlhttprequest',
  xhr: 'xmlhttprequest',
  subdocument: 'sub_frame',
  frame: 'sub_frame',
  ping: 'ping',
  beacon: 'ping',
  websocket: 'websocket',
  media: 'media',
  font: 'font',
  other: 'other',
  document: 'main_frame',
  doc: 'main_frame',
}

const UNSUPPORTED_OPTIONS = new Set([
  'csp',
  'redirect',
  'redirect-rule',
  'rewrite',
  'removeparam',
  'queryprune',
  'replace',
  'header',
  'permissions',
  'urltransform',
  'popup',
  'popunder',
  'inline-script',
  'inline-font',
  'elemhide',
  'ehide',
  'generichide',
  'ghide',
  'specifichide',
  'shide',
  'genericblock',
  'badfilter',
  'webrtc',
  'object-subrequest',
  'empty',
  'mp4',
  'cname',
  'strict3p',
  'strict1p',
  'cookie',
  'jsinject',
  'content',
  'extension',
  'app',
  'network',
  'ipaddress',
  'stealth',
  'reason',
])

const COSMETIC_MARKERS = ['##', '#@#', '#?#', '#$#', '#%#', '#$?#', '#@?#', '$$', '$@$']

const HOSTNAME_PATTERN = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/
const HOSTS_FILE_LINE = /^(?:0\.0\.0\.0|127\.0\.0\.1|::1?)\s+([^\s#]+)/
const ASCII_ONLY = /^[\x21-\x7e]+$/

const isHostname = (value: string): boolean => HOSTNAME_PATTERN.test(value)

interface ParsedOptions {
  condition: DnrRuleCondition
  important: boolean
  documentException: boolean
}

function parseDomainList(
  raw: string,
  field: 'initiator' | 'request',
  condition: DnrRuleCondition,
): string | null {
  const included: string[] = []
  const excluded: string[] = []

  for (const entry of raw.split('|')) {
    const negated = entry.startsWith('~')
    const domain = (negated ? entry.slice(1) : entry).toLowerCase()
    if (!domain) return 'empty domain in list'
    if (domain.includes('*') || domain.startsWith('/')) return `unsupported domain pattern "${entry}"`
    if (!isHostname(domain)) return `invalid domain "${entry}"`
    ;(negated ? excluded : included).push(domain)
  }

  if (field === 'initiator') {
    if (included.length) condition.initiatorDomains = included
    if (excluded.length) condition.excludedInitiatorDomains = excluded
  } else {
    if (included.length) condition.requestDomains = included
    if (excluded.length) condition.excludedRequestDomains = excluded
  }
  return null
}

function parseMethodList(raw: string, condition: DnrRuleCondition): string | null {
  const included: DnrRequestMethod[] = []
  const excluded: DnrRequestMethod[] = []
  const known = new Set<string>(['connect', 'delete', 'get', 'head', 'options', 'patch', 'post', 'put', 'other'])

  for (const entry of raw.split('|')) {
    const negated = entry.startsWith('~')
    const method = (negated ? entry.slice(1) : entry).toLowerCase()
    if (!known.has(method)) return `unsupported method "${entry}"`
    ;(negated ? excluded : included).push(method as DnrRequestMethod)
  }
  if (included.length && excluded.length) return 'mixed negated and non-negated methods'
  if (included.length) condition.requestMethods = included
  if (excluded.length) condition.excludedRequestMethods = excluded
  return null
}

function parseOptions(rawOptions: string, isException: boolean): ParsedOptions | string {
  const condition: DnrRuleCondition = {}
  const includedTypes = new Set<DnrResourceType>()
  const excludedTypes = new Set<DnrResourceType>()
  let important = false
  let documentException = false

  for (const rawOption of rawOptions.split(',')) {
    const option = rawOption.trim()
    if (!option || option === '_') continue

    const equalsIndex = option.indexOf('=')
    const name = (equalsIndex === -1 ? option : option.slice(0, equalsIndex)).toLowerCase()
    const value = equalsIndex === -1 ? '' : option.slice(equalsIndex + 1)
    const negated = name.startsWith('~')
    const bareName = negated ? name.slice(1) : name

    if (UNSUPPORTED_OPTIONS.has(bareName)) return `unsupported option "$${bareName}"`

    if (bareName === 'third-party' || bareName === '3p') {
      condition.domainType = negated ? 'firstParty' : 'thirdParty'
      continue
    }
    if (bareName === 'first-party' || bareName === '1p') {
      condition.domainType = negated ? 'thirdParty' : 'firstParty'
      continue
    }
    if (bareName === 'important') {
      important = true
      continue
    }
    if (bareName === 'match-case') {
      condition.isUrlFilterCaseSensitive = true
      continue
    }
    if (bareName === 'all') {
      for (const type of Object.values(TYPE_OPTIONS)) includedTypes.add(type)
      includedTypes.add('sub_frame')
      continue
    }
    if (bareName === 'domain' || bareName === 'from') {
      if (!value) return 'empty $domain option'
      const error = parseDomainList(value, 'initiator', condition)
      if (error) return error
      continue
    }
    if (bareName === 'to') {
      if (!value) return 'empty $to option'
      const error = parseDomainList(value, 'request', condition)
      if (error) return error
      continue
    }
    if (bareName === 'denyallow') {
      if (!value) return 'empty $denyallow option'
      const error = parseDomainList(value.replace(/~/g, ''), 'request', { ...condition })
      if (error) return error
      condition.excludedRequestDomains = value.split('|').map(domain => domain.toLowerCase())
      continue
    }
    if (bareName === 'method') {
      if (!value) return 'empty $method option'
      const error = parseMethodList(value, condition)
      if (error) return error
      continue
    }

    const resourceType = TYPE_OPTIONS[bareName]
    if (!resourceType) return `unknown option "$${bareName}"`

    if (resourceType === 'main_frame') {
      if (isException && !negated) {
        documentException = true
        continue
      }
      if (negated) {
        excludedTypes.add('main_frame')
        continue
      }
    }
    ;(negated ? excludedTypes : includedTypes).add(resourceType)
  }

  if (includedTypes.size && excludedTypes.size) {
    for (const type of excludedTypes) includedTypes.delete(type)
    if (!includedTypes.size) return 'all resource types excluded'
    condition.resourceTypes = [...includedTypes]
  } else if (includedTypes.size) {
    condition.resourceTypes = [...includedTypes]
  } else if (excludedTypes.size) {
    condition.excludedResourceTypes = [...excludedTypes]
  }

  if (documentException) {
    condition.resourceTypes = ['main_frame', 'sub_frame']
    delete condition.excludedResourceTypes
  }

  return { condition, important, documentException }
}

/** Splits "pattern$options" at the last "$" whose tail looks like an option list. */
function splitPatternAndOptions(text: string): { pattern: string; options: string | null } {
  const index = text.lastIndexOf('$')
  if (index <= 0) return { pattern: text, options: null }
  const tail = text.slice(index + 1)
  // Option lists are comma separated names; $csp / $replace values may also carry spaces and quotes.
  if (!/^[a-z0-9~=|,._:/*\s;'"()+-]*$/i.test(tail)) return { pattern: text, options: null }
  return { pattern: text.slice(0, index), options: tail }
}

function normalizePattern(pattern: string): { urlFilter: string | undefined } | string {
  if (pattern === '' || pattern === '*') return { urlFilter: undefined }
  if (pattern.startsWith('/') && pattern.endsWith('/') && pattern.length > 2) return 'regex patterns are not supported'
  if (!ASCII_ONLY.test(pattern)) return 'non-ASCII pattern'

  if (isHostname(pattern)) return { urlFilter: `||${pattern}^` }

  const anchoredStart = pattern.startsWith('||') ? 2 : pattern.startsWith('|') ? 1 : 0
  const anchoredEnd = pattern.endsWith('|') ? 1 : 0
  const body = pattern.slice(anchoredStart, pattern.length - anchoredEnd)
  if (body.includes('|')) return 'unsupported "|" inside pattern'
  if (body.replace(/\*/g, '') === '' && anchoredStart === 0 && anchoredEnd === 0) return { urlFilter: undefined }
  if (anchoredStart === 2 && body.length === 0) return 'empty domain anchor'
  if (body.replace(/[*^]/g, '').length < 3 && anchoredStart === 0) return 'pattern too short, would over-block'

  return { urlFilter: pattern }
}

export function convertAbpLine(rawLine: string): LineConversion {
  const line = rawLine.trim()
  if (!line || line.startsWith('!') || line.startsWith('[') || line.startsWith('#')) return { kind: 'ignore' }
  if (COSMETIC_MARKERS.some(marker => line.includes(marker))) return { kind: 'skip', reason: 'cosmetic filter' }

  const hostsMatch = HOSTS_FILE_LINE.exec(line)
  if (hostsMatch) {
    const host = hostsMatch[1]?.toLowerCase() ?? ''
    if (host === 'localhost' || host === 'localhost.localdomain' || host === 'broadcasthost' || host.startsWith('local')) {
      return { kind: 'ignore' }
    }
    if (!isHostname(host)) return { kind: 'skip', reason: `invalid hostname "${host}"` }
    return {
      kind: 'rule',
      rule: { priority: PRIORITY_DEFAULT, action: { type: 'block' }, condition: { urlFilter: `||${host}^` } },
    }
  }

  const isException = line.startsWith('@@')
  const { pattern, options } = splitPatternAndOptions(isException ? line.slice(2) : line)

  const parsed = options === null
    ? { condition: {} as DnrRuleCondition, important: false, documentException: false }
    : parseOptions(options, isException)
  if (typeof parsed === 'string') return { kind: 'skip', reason: parsed }

  const normalized = normalizePattern(pattern)
  if (typeof normalized === 'string') return { kind: 'skip', reason: normalized }

  const condition: DnrRuleCondition = { ...parsed.condition }
  if (normalized.urlFilter !== undefined) condition.urlFilter = normalized.urlFilter

  const hasScope =
    condition.urlFilter !== undefined ||
    condition.initiatorDomains?.length ||
    condition.requestDomains?.length
  if (!hasScope) return { kind: 'skip', reason: 'filter would match every request' }

  const actionType = isException ? (parsed.documentException ? 'allowAllRequests' : 'allow') : 'block'
  if (actionType === 'allowAllRequests') condition.resourceTypes = ['main_frame', 'sub_frame']

  return {
    kind: 'rule',
    rule: {
      priority: parsed.important ? PRIORITY_IMPORTANT : PRIORITY_DEFAULT,
      action: { type: actionType },
      condition,
    },
  }
}

export function convertAbpFilters(text: string, options: ConvertOptions = {}): ConversionResult {
  const firstRuleId = options.firstRuleId ?? 1
  const maxRules = options.maxRules ?? Number.POSITIVE_INFINITY
  const rules: DnrRule[] = []
  const skipped: SkippedLine[] = []
  const seen = new Set<string>()
  let overflow = 0

  for (const rawLine of text.split(/\r?\n/)) {
    const conversion = convertAbpLine(rawLine)
    if (conversion.kind === 'ignore') continue
    if (conversion.kind === 'skip') {
      skipped.push({ line: rawLine.trim(), reason: conversion.reason })
      continue
    }

    const fingerprint = JSON.stringify(conversion.rule)
    if (seen.has(fingerprint)) continue
    seen.add(fingerprint)

    if (rules.length >= maxRules) {
      overflow += 1
      continue
    }
    rules.push({ id: firstRuleId + rules.length, ...conversion.rule })
  }

  if (overflow > 0) skipped.push({ line: `(${overflow} more rules)`, reason: `exceeded the cap of ${maxRules} rules` })
  return { rules, skipped }
}
