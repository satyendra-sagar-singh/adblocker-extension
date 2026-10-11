import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DEFAULT_SETTINGS, mergeSettings, mergeStats } from '../../src/shared/settings.ts'

describe('mergeSettings', () => {
  it('returns defaults for missing or corrupt storage', () => {
    assert.deepEqual(mergeSettings(undefined), DEFAULT_SETTINGS)
    assert.deepEqual(mergeSettings('garbage'), DEFAULT_SETTINGS)
    assert.deepEqual(mergeSettings([]), DEFAULT_SETTINGS)
  })

  it('keeps valid values, drops invalid ones and dedupes the whitelist', () => {
    const merged = mergeSettings({
      enabled: false,
      blockTrackers: 'yes',
      youtube: { skipAds: false, muteAds: 1 },
      whitelist: ['a.com', 'a.com', 42, 'b.com'],
      customFilters: 7,
    })
    assert.equal(merged.enabled, false)
    assert.equal(merged.blockTrackers, DEFAULT_SETTINGS.blockTrackers)
    assert.equal(merged.youtube.skipAds, false)
    assert.equal(merged.youtube.muteAds, DEFAULT_SETTINGS.youtube.muteAds)
    assert.deepEqual(merged.whitelist, ['a.com', 'b.com'])
    assert.equal(merged.customFilters, '')
  })
})

describe('mergeStats', () => {
  it('sanitises counters', () => {
    assert.deepEqual(mergeStats({ youtubeAdsSkipped: 3.7, elementsHidden: -1, responsesPruned: 'x' }), {
      youtubeAdsSkipped: 3,
      elementsHidden: 0,
      responsesPruned: 0,
    })
  })
})
