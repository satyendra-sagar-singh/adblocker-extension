/**
 * Structural types for declarativeNetRequest rules so the converter and validator
 * stay independent of @types/chrome. They are assignable to chrome.declarativeNetRequest.Rule.
 */

export const DNR_RESOURCE_TYPES = [
  'main_frame',
  'sub_frame',
  'stylesheet',
  'script',
  'image',
  'font',
  'object',
  'xmlhttprequest',
  'ping',
  'csp_report',
  'media',
  'websocket',
  'webtransport',
  'webbundle',
  'other',
] as const

export type DnrResourceType = (typeof DNR_RESOURCE_TYPES)[number]

export const DNR_ACTION_TYPES = [
  'block',
  'allow',
  'allowAllRequests',
  'upgradeScheme',
  'redirect',
  'modifyHeaders',
] as const

export type DnrActionType = (typeof DNR_ACTION_TYPES)[number]

export const DNR_REQUEST_METHODS = [
  'connect',
  'delete',
  'get',
  'head',
  'options',
  'patch',
  'post',
  'put',
  'other',
] as const

export type DnrRequestMethod = (typeof DNR_REQUEST_METHODS)[number]

export interface DnrRuleCondition {
  urlFilter?: string
  regexFilter?: string
  isUrlFilterCaseSensitive?: boolean
  domainType?: 'firstParty' | 'thirdParty'
  resourceTypes?: DnrResourceType[]
  excludedResourceTypes?: DnrResourceType[]
  initiatorDomains?: string[]
  excludedInitiatorDomains?: string[]
  requestDomains?: string[]
  excludedRequestDomains?: string[]
  requestMethods?: DnrRequestMethod[]
  excludedRequestMethods?: DnrRequestMethod[]
}

export interface DnrRedirect {
  extensionPath?: string
  url?: string
  regexSubstitution?: string
}

export interface DnrRuleAction {
  type: DnrActionType
  redirect?: DnrRedirect
}

export interface DnrRule {
  id: number
  priority?: number
  action: DnrRuleAction
  condition: DnrRuleCondition
}

export type DnrRuleWithoutId = Omit<DnrRule, 'id'>
