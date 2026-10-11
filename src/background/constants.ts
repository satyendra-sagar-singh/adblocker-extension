/** Static ruleset ids, matching rule_resources in manifest.json (written by scripts/build.ts). */
export const RULESET_YOUTUBE = 'youtube'
export const RULESET_ADS_CORE = 'ads_core'
export const RULESET_TRACKERS = 'trackers'
export const RULESET_EASYLIST = 'easylist'

/** Dynamic rule id ranges. Whitelist rules and custom filters never overlap. */
export const WHITELIST_RULE_ID_START = 1
export const WHITELIST_RULE_ID_END = 999
export const CUSTOM_RULE_ID_START = 1000
export const CUSTOM_RULE_ID_END = 9999

/** Priority of the per-site allowAllRequests rule; must beat every static block rule. */
export const WHITELIST_RULE_PRIORITY = 1000

/** Registered content script ids. */
export const SCRIPT_COSMETIC = 'cosmetic'
export const SCRIPT_YOUTUBE_MAIN = 'youtube-main'
export const SCRIPT_YOUTUBE_ISOLATED = 'youtube-isolated'

export const BADGE_COLOR_ACTIVE = '#2563eb'
export const BADGE_COLOR_PAUSED = '#6b7280'
