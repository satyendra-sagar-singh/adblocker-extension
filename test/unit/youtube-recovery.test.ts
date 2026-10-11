import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  getStartSeconds,
  getVideoId,
  isEnforcementWall,
  isPremiumUser,
  isSsapAdPlaying,
  readProgressState,
  shouldSeekPastSsapAd,
} from '../../src/content/youtube/player-state.ts'
import {
  installRequestShaping,
  isPlayerRequestBody,
  nextRecoveryMode,
  RECOVERY_MODES,
  shapePlayerRequest,
} from '../../src/content/youtube/request-shaping.ts'

const wallResponse = (overrides: Record<string, unknown> = {}) => ({
  playabilityStatus: {
    status: 'UNPLAYABLE',
    errorScreen: {
      playerErrorMessageRenderer: {
        subreason: {
          runs: [
            {
              text: 'Ad blockers violate the Terms of Service',
              navigationEndpoint: {
                commandMetadata: { webCommandMetadata: { url: 'https://support.google.com/youtube/answer/3037019', webPageType: 'WEB_PAGE_TYPE_UNKNOWN' } },
              },
            },
          ],
        },
      },
    },
    ...overrides,
  },
  videoDetails: { videoId: 'abc123' },
  playerConfig: { playbackStartConfig: { startSeconds: 42 } },
})

describe('isEnforcementWall', () => {
  it('recognises the UNPLAYABLE wall with the troubleshooting link', () => {
    assert.equal(isEnforcementWall(wallResponse()), true)
  })

  it('recognises the interstitial variant', () => {
    const response = {
      playabilityStatus: {
        status: 'UNPLAYABLE',
        errorScreen: {
          playerInterstitialRenderer: {
            content: {
              interstitialViewModel: {
                description: { commandRuns: [{ onTap: { innertubeCommand: { commandMetadata: { webCommandMetadata: { url: 'https://support.google.com/youtube/answer/3037019', webPageType: 'WEB_PAGE_TYPE_UNKNOWN' } } } } }] },
              },
            },
          },
        },
      },
    }
    assert.equal(isEnforcementWall(response), true)
  })

  it('ignores playable videos, captchas, login walls and unrelated errors', () => {
    assert.equal(isEnforcementWall({ playabilityStatus: { status: 'OK' } }), false)
    assert.equal(isEnforcementWall(wallResponse({ status: 'LOGIN_REQUIRED' })), false)
    const captcha = wallResponse()
    ;(captcha.playabilityStatus.errorScreen.playerErrorMessageRenderer as Record<string, unknown>).playerCaptchaViewModel = {}
    assert.equal(isEnforcementWall(captcha), false)
    assert.equal(isEnforcementWall({ playabilityStatus: { status: 'UNPLAYABLE', errorScreen: { playerErrorMessageRenderer: { subreason: { runs: [{ text: 'Private video' }] } } } } }), false)
    assert.equal(isEnforcementWall(null), false)
  })
})

describe('player state helpers', () => {
  it('detects stitched ads from stats-for-nerds and decides when to seek', () => {
    assert.equal(isSsapAdPlaying({ debug_info: 'SSAP, AD, 1 of 2' }), true)
    assert.equal(isSsapAdPlaying({ debug_info: 'SSAP, CONTENT' }), false)
    assert.equal(isSsapAdPlaying(undefined), false)
    assert.equal(shouldSeekPastSsapAd(readProgressState({ current: 1, duration: 15, loaded: 15 })), true)
    assert.equal(shouldSeekPastSsapAd(readProgressState({ current: 14.5, duration: 15, loaded: 15 })), false)
    assert.equal(shouldSeekPastSsapAd(readProgressState({ current: 'x' })), false)
  })

  it('reads the video id and start position', () => {
    assert.equal(getVideoId(wallResponse()), 'abc123')
    assert.equal(getStartSeconds(wallResponse(), '?v=abc123&t=10'), 42)
    assert.equal(getStartSeconds({ videoDetails: {} }, '?v=abc123&t=10'), 10)
    assert.equal(getStartSeconds({}, '?v=abc123'), 0)
  })

  it('identifies Premium users from the masthead or initial data', () => {
    assert.equal(isPremiumUser(undefined, 'YOUTUBE_PREMIUM_LOGO'), true)
    assert.equal(isPremiumUser({ topbar: { desktopTopbarRenderer: { logo: { topbarLogoRenderer: { iconImage: { iconType: 'YOUTUBE_PREMIUM_LOGO' } } } } } }, null), true)
    assert.equal(isPremiumUser({ topbar: {} }, 'YOUTUBE_LOGO'), false)
  })
})

interface PlayerRequestBody {
  context: { client: Record<string, unknown> }
  videoId: string
  playbackContext: { contentPlaybackContext: Record<string, unknown>; [key: string]: unknown }
  params?: string
}

describe('request shaping', () => {
  const body = (): PlayerRequestBody => ({
    context: { client: { clientName: 'WEB', clientVersion: '2.2026' } },
    videoId: 'abc123',
    playbackContext: { contentPlaybackContext: { referer: 'https://www.youtube.com/watch?v=abc123' } },
  })

  it('only treats InnerTube player bodies as player requests', () => {
    assert.equal(isPlayerRequestBody(body()), true)
    assert.equal(isPlayerRequestBody({ context: { client: {} } }), false)
    assert.equal(isPlayerRequestBody({ videoId: 'x' }), false)
    assert.equal(isPlayerRequestBody('string'), false)
    // /next and heartbeat bodies carry context + videoId but are not player requests.
    assert.equal(isPlayerRequestBody({ context: { client: { clientName: 'WEB' } }, videoId: 'x', playlistId: 'PL1', params: 'OAI%3D' }), false)
    assert.equal(isPlayerRequestBody({ ...body(), heartbeatRequestParams: {} }), false)
  })

  it('never reshapes a /next body even while a mode is active', () => {
    const next = { context: { client: { clientName: 'WEB' } }, videoId: 'x', playlistId: 'PL1', params: 'OAI%3D' }
    assert.deepEqual(shapePlayerRequest(structuredClone(next), 'lactmilli', 1), next)
  })

  it('applies each recovery shape and marks the reload', () => {
    const inline = shapePlayerRequest(body(), 'inline', 1000)
    assert.equal(inline.playbackContext.contentPlaybackContext.isInlinePlaybackNoAd, true)
    assert.equal(inline.playbackContext.contentPlaybackContext.referer, 'https://www.youtube.com/watch?v=abc123#reloadxhr')
    assert.equal(inline.playbackContext.contentPlaybackContext.lactMilliseconds, '1000')

    assert.equal(shapePlayerRequest(body(), 'channel', 1).context.client.clientScreen, 'CHANNEL')
    assert.equal(shapePlayerRequest(body(), 'adunit', 1).context.client.clientScreen, 'ADUNIT')
    assert.equal(shapePlayerRequest(body(), 'lactmilli', 1).params, '8AUB')
    assert.equal(shapePlayerRequest(body(), 'yahi', 1).params, 'YAHI')
    assert.equal(shapePlayerRequest(body(), 'eafg', 1).params, 'eAFgAQ')
    assert.deepEqual(shapePlayerRequest(body(), 'instream', 1).playbackContext.adPlaybackContext, { adType: 'AD_TYPE_INSTREAM' })
  })

  it('does not duplicate the reload marker and leaves non-WEB clients alone for screen modes', () => {
    const twice = shapePlayerRequest(shapePlayerRequest(body(), 'inline', 1), 'inline', 2)
    assert.equal(twice.playbackContext.contentPlaybackContext.referer, 'https://www.youtube.com/watch?v=abc123#reloadxhr')
    const android = body()
    android.context.client.clientName = 'ANDROID'
    assert.equal('clientScreen' in shapePlayerRequest(android, 'channel', 1).context.client, false)
  })

  it('leaves bodies untouched in mode none', () => {
    const original = body()
    assert.deepEqual(shapePlayerRequest(structuredClone(original), 'none', 1), original)
  })

  it('walks the ladder in order and ends', () => {
    let mode: ReturnType<typeof nextRecoveryMode> = 'none'
    const seen: string[] = []
    while ((mode = nextRecoveryMode(mode)) !== null) seen.push(mode)
    assert.deepEqual(seen, [...RECOVERY_MODES])
  })

  it('hooks JSON.stringify so outbound bodies are reshaped only while a mode is active', () => {
    const nativeStringify = JSON.stringify
    let mode: 'none' | 'inline' = 'none'
    try {
      installRequestShaping(() => mode, () => 5)
      assert.equal(JSON.stringify({ a: 1 }), '{"a":1}')
      const untouched = JSON.parse(JSON.stringify(body())) as PlayerRequestBody
      assert.equal('isInlinePlaybackNoAd' in untouched.playbackContext.contentPlaybackContext, false)
      mode = 'inline'
      const shaped = JSON.parse(JSON.stringify(body())) as PlayerRequestBody
      assert.equal(shaped.playbackContext.contentPlaybackContext.isInlinePlaybackNoAd, true)
      assert.equal(String(JSON.stringify).includes('native code'), true, 'proxy keeps native toString')
    } finally {
      Object.defineProperty(JSON, 'stringify', { value: nativeStringify, writable: true, configurable: true })
    }
  })
})
