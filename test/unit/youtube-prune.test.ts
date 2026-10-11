import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { FEED_AD_MARKER_MAX_DEPTH, FEED_AD_RENDERER_KEYS, FEED_ARRAY_KEYS, PRUNE_PATHS, RESPONSE_MARKER_KEYS } from '../../src/content/youtube/config.ts'
import { defineConstantPath, interceptGlobal } from '../../src/content/youtube/define-constant.ts'
import { looksLikeYouTubeResponse, pruneFeedEntries, pruneObject } from '../../src/content/youtube/prune.ts'

describe('pruneObject', () => {
  it('removes top-level and nested paths and reports the count', () => {
    const response = {
      playabilityStatus: { status: 'OK' },
      adPlacements: [{}],
      playerAds: [{}],
      playerResponse: { adSlots: [{}], streamingData: {} },
      auxiliaryUi: { messageRenderers: { enforcementMessageViewModel: {} } },
    }
    const removed = pruneObject(response, [
      'adPlacements',
      'playerAds',
      'playerResponse.adSlots',
      'auxiliaryUi.messageRenderers.enforcementMessageViewModel',
      'missing.path',
    ])
    assert.equal(removed, 4)
    assert.deepEqual(response, {
      playabilityStatus: { status: 'OK' },
      playerResponse: { streamingData: {} },
      auxiliaryUi: { messageRenderers: {} },
    })
  })

  it('supports array wildcards, including batched [].playerResponse payloads', () => {
    const payload = [{ playerResponse: { adPlacements: [1], videoDetails: {} } }, { playerResponse: { adSlots: [1] } }]
    assert.equal(pruneObject(payload, ['[].playerResponse.adPlacements', '[].playerResponse.adSlots']), 2)
    assert.deepEqual(payload, [{ playerResponse: { videoDetails: {} } }, { playerResponse: {} }])

    const messages = { playerResponse: { messages: [{ youThereRenderer: {} }, { other: {} }] } }
    assert.equal(pruneObject(messages, ['playerResponse.messages.[].youThereRenderer']), 1)
    assert.deepEqual(messages.playerResponse.messages, [{}, { other: {} }])
  })

  it('ignores non-objects', () => {
    assert.equal(pruneObject(null, ['a']), 0)
    assert.equal(pruneObject('x', ['a']), 0)
  })

  it('strips every shipped path from a realistic player response without touching playback data', () => {
    const response = {
      responseContext: {},
      playabilityStatus: { status: 'OK' },
      streamingData: { serverAbrStreamingUrl: 'https://x', adaptiveFormats: [{ itag: 1 }] },
      adPlacements: [{}],
      adSlots: [{}],
      playerAds: [{}],
      playerConfig: { audioConfig: {} },
      videoDetails: { videoId: 'abc' },
    }
    pruneObject(response, PRUNE_PATHS)
    assert.deepEqual(Object.keys(response).sort(), ['playabilityStatus', 'playerConfig', 'responseContext', 'streamingData', 'videoDetails'])
    assert.deepEqual(response.streamingData.adaptiveFormats, [{ itag: 1 }])
  })
})

describe('pruneFeedEntries', () => {
  it('drops home feed items and Shorts entries that wrap an ad renderer', () => {
    const feed = {
      responseContext: {},
      contents: {
        twoColumnBrowseResultsRenderer: {
          tabs: [
            {
              tabRenderer: {
                content: {
                  richGridRenderer: {
                    contents: [
                      { richItemRenderer: { content: { adSlotRenderer: {} } } },
                      { richItemRenderer: { content: { videoRenderer: { videoId: 'keep' } } } },
                      { richSectionRenderer: { content: { richShelfRenderer: { contents: [{ richItemRenderer: { content: { videoRenderer: {} } } }] } } } },
                    ],
                  },
                },
              },
            },
          ],
        },
      },
      onResponseReceivedActions: [{ appendContinuationItemsAction: { continuationItems: [{ richItemRenderer: { content: { adSlotRenderer: {} } } }, { continuationItemRenderer: {} }] } }],
      entries: [
        { command: { reelWatchEndpoint: { adClientParams: { isAd: true }, videoId: 'ad' } } },
        { command: { reelWatchEndpoint: { adClientParams: { isAd: false }, videoId: 'organic' } } },
        { command: { reelWatchEndpoint: { videoId: 'short' } } },
      ],
    }
    const removed = pruneFeedEntries(feed, FEED_ARRAY_KEYS, FEED_AD_RENDERER_KEYS, FEED_AD_MARKER_MAX_DEPTH)
    assert.equal(removed, 3)
    const grid = feed.contents.twoColumnBrowseResultsRenderer.tabs[0]!.tabRenderer.content.richGridRenderer.contents
    assert.equal(grid.length, 2)
    assert.deepEqual(grid[0], { richItemRenderer: { content: { videoRenderer: { videoId: 'keep' } } } })
    assert.deepEqual(feed.onResponseReceivedActions[0]!.appendContinuationItemsAction.continuationItems, [{ continuationItemRenderer: {} }])
    assert.deepEqual(feed.entries, [
      { command: { reelWatchEndpoint: { adClientParams: { isAd: false }, videoId: 'organic' } } },
      { command: { reelWatchEndpoint: { videoId: 'short' } } },
    ])
  })

  it('leaves ordinary videos alone even when they mention ad keys deep inside', () => {
    const feed = { contents: [{ videoRenderer: { a: { b: { c: { d: { e: { adSlotRenderer: {} } } } } } } }] }
    assert.equal(pruneFeedEntries(feed, FEED_ARRAY_KEYS, FEED_AD_RENDERER_KEYS, FEED_AD_MARKER_MAX_DEPTH), 0)
    assert.equal(feed.contents.length, 1)
  })
})

describe('looksLikeYouTubeResponse', () => {
  it('detects marker keys', () => {
    assert.equal(looksLikeYouTubeResponse({ responseContext: {} }, RESPONSE_MARKER_KEYS), true)
    assert.equal(looksLikeYouTubeResponse({ foo: 1 }, RESPONSE_MARKER_KEYS), false)
    assert.equal(looksLikeYouTubeResponse([], RESPONSE_MARKER_KEYS), false)
  })
})

describe('defineConstantPath', () => {
  it('pins a value through objects created later', () => {
    const root: Record<string, unknown> = {}
    defineConstantPath(root, 'yt.config_.flags.example', false)
    ;(root as { yt: unknown }).yt = { config_: { flags: { example: true, other: 1 } } }
    const flags = (root as { yt: { config_: { flags: Record<string, unknown> } } }).yt.config_.flags
    assert.equal(flags.example, false)
    assert.equal(flags.other, 1)
    flags.example = true
    assert.equal(flags.example, false)
  })

  it('pins a top-level global such as google_ad_status', () => {
    const root: Record<string, unknown> = {}
    defineConstantPath(root, 'google_ad_status', 1)
    root.google_ad_status = 0
    assert.equal(root.google_ad_status, 1)
  })
})

describe('interceptGlobal', () => {
  it('transforms values assigned to a global and pre-existing values', () => {
    const root: Record<string, unknown> = { ytInitialData: { adSlots: [1] } }
    const transform = (value: Record<string, unknown>) => {
      delete value.adSlots
      delete value.adPlacements
      return value
    }
    interceptGlobal(root, 'ytInitialData', transform)
    interceptGlobal(root, 'ytInitialPlayerResponse', transform)
    assert.deepEqual(root.ytInitialData, {})
    root.ytInitialPlayerResponse = { adPlacements: [1], videoDetails: {} }
    assert.deepEqual(root.ytInitialPlayerResponse, { videoDetails: {} })
    root.ytInitialPlayerResponse = 'string'
    assert.equal(root.ytInitialPlayerResponse, 'string')
  })
})
