import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { HOST_SELECTORS, selectorsForHost } from '../../src/content/cosmetic/selectors.ts'

describe('selectorsForHost', () => {
  it('applies streaming-site selectors to the site and its subdomains', () => {
    assert.ok(selectorsForHost('www.twitch.tv').includes('.stream-display-ad__wrapper'))
    assert.ok(selectorsForHost('player.twitch.tv').includes('[data-a-target="video-ad-label"]'))
    assert.ok(selectorsForHost('open.spotify.com').includes('#leaderboard-ad-element'))
    assert.ok(selectorsForHost('www.dailymotion.com').includes('.dmp_VideoView-ad-slot'))
    assert.ok(selectorsForHost('vimeo.com').includes('.profile__ad-wrapper'))
    assert.ok(selectorsForHost('www.crunchyroll.com').includes('#template_skin_leaderboard'))
  })

  it('does not leak selectors to lookalike hosts', () => {
    assert.deepEqual(selectorsForHost('nottwitch.tv'), [])
    assert.deepEqual(selectorsForHost('spotify.com.example.org'), [])
  })

  it('has no duplicate selectors per host', () => {
    for (const [host, selectors] of Object.entries(HOST_SELECTORS)) {
      assert.equal(new Set(selectors).size, selectors.length, host)
    }
  })
})
