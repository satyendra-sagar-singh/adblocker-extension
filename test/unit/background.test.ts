import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildContentScriptRegistrations } from '../../src/background/content-scripts.ts'
import { buildCustomRules, buildDynamicRules, buildWhitelistRules } from '../../src/background/dynamic-rules.ts'
import { selectEnabledRulesets } from '../../src/background/rulesets.ts'
import { validateRuleset } from '../../src/filters/dnr-validate.ts'
import { DEFAULT_SETTINGS, type Settings } from '../../src/shared/settings.ts'

const settingsWith = (patch: Partial<Settings>): Settings => ({ ...DEFAULT_SETTINGS, ...patch, youtube: { ...DEFAULT_SETTINGS.youtube, ...(patch.youtube ?? {}) } })

describe('selectEnabledRulesets', () => {
  const available = ['youtube', 'ads_core', 'trackers', 'streaming', 'easylist']

  it('enables everything by default', () => {
    assert.deepEqual(selectEnabledRulesets(DEFAULT_SETTINGS, available), available)
  })

  it('drops trackers when disabled and everything when paused', () => {
    assert.deepEqual(selectEnabledRulesets(settingsWith({ blockTrackers: false }), available), ['youtube', 'ads_core', 'streaming', 'easylist'])
    assert.deepEqual(selectEnabledRulesets(settingsWith({ enabled: false }), available), [])
  })
})

describe('buildWhitelistRules', () => {
  it('creates one high-priority allowAllRequests rule per host', () => {
    const rules = buildWhitelistRules(['example.com', 'news.site.org'])
    assert.equal(rules.length, 2)
    assert.deepEqual(rules[0], {
      id: 1,
      priority: 1000,
      action: { type: 'allowAllRequests' },
      condition: { requestDomains: ['example.com'], resourceTypes: ['main_frame', 'sub_frame'] },
    })
    assert.equal(rules[1]?.id, 2)
    assert.equal(validateRuleset(rules).errors.length, 0)
  })
})

describe('buildCustomRules', () => {
  it('converts custom filters into the custom id range and drops invalid output', () => {
    const rules = buildCustomRules('||ads.example.com^\nexample.com##.ad\n@@||example.com^$document')
    assert.deepEqual(rules.map(rule => rule.id), [1000, 1001])
    assert.equal(validateRuleset(rules).errors.length, 0)
  })
})

describe('buildDynamicRules', () => {
  it('returns nothing when the extension is disabled', () => {
    assert.deepEqual(buildDynamicRules(settingsWith({ enabled: false, whitelist: ['a.com'], customFilters: '||b.com^' })), [])
  })

  it('never produces overlapping ids between whitelist and custom rules', () => {
    const rules = buildDynamicRules(settingsWith({ whitelist: ['a.com'], customFilters: '||b.com^' }))
    assert.deepEqual(rules.map(rule => rule.id), [1, 1000])
  })
})

describe('buildContentScriptRegistrations', () => {
  it('registers cosmetic and both YouTube scripts by default', () => {
    const scripts = buildContentScriptRegistrations(DEFAULT_SETTINGS)
    assert.deepEqual(scripts.map(script => script.id), ['cosmetic', 'youtube-main', 'youtube-isolated'])
    const main = scripts.find(script => script.id === 'youtube-main')
    assert.equal(main?.world, 'MAIN')
    assert.equal(main?.runAt, 'document_start')
    assert.equal(main?.allFrames, true)
  })

  it('excludes whitelisted hosts from every script and YouTube from the cosmetic script', () => {
    const scripts = buildContentScriptRegistrations(settingsWith({ whitelist: ['example.com'] }))
    for (const script of scripts) {
      assert.ok(script.excludeMatches?.includes('*://example.com/*'), `${script.id} excludes example.com`)
      assert.ok(script.excludeMatches?.includes('*://*.example.com/*'), `${script.id} excludes subdomains`)
    }
    const cosmetic = scripts.find(script => script.id === 'cosmetic')
    assert.ok(cosmetic?.excludeMatches?.includes('*://www.youtube.com/*'))
  })

  it('registers nothing when disabled and drops scripts whose features are off', () => {
    assert.deepEqual(buildContentScriptRegistrations(settingsWith({ enabled: false })), [])
    const noCosmetic = buildContentScriptRegistrations(settingsWith({ cosmeticFiltering: false }))
    assert.deepEqual(noCosmetic.map(script => script.id), ['youtube-main', 'youtube-isolated'])
    const noYouTube = buildContentScriptRegistrations(settingsWith({ youtube: { skipAds: false, hideFeedAds: false, muteAds: false, removeEnforcementDialog: false } }))
    assert.deepEqual(noYouTube.map(script => script.id), ['cosmetic'])
  })
})
