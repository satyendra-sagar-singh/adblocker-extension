import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getHostnameFromUrl, hostToMatchPatterns, isHostWhitelisted, normalizeHostname } from '../../src/shared/hostname.ts'

describe('normalizeHostname', () => {
  it('accepts hosts, URLs and ports, stripping www', () => {
    assert.equal(normalizeHostname(' Example.com '), 'example.com')
    assert.equal(normalizeHostname('https://WWW.Example.com/path?q=1'), 'example.com')
    assert.equal(normalizeHostname('example.com:8080'), 'example.com')
    assert.equal(normalizeHostname('sub.example.co.uk'), 'sub.example.co.uk')
  })

  it('rejects invalid input', () => {
    assert.equal(normalizeHostname(''), null)
    assert.equal(normalizeHostname('not a host'), null)
    assert.equal(normalizeHostname('chrome://extensions'), null)
    assert.equal(normalizeHostname('-bad.com'), null)
  })
})

describe('getHostnameFromUrl', () => {
  it('only returns http(s) hostnames', () => {
    assert.equal(getHostnameFromUrl('https://m.youtube.com/watch?v=1'), 'm.youtube.com')
    assert.equal(getHostnameFromUrl('chrome://newtab'), null)
    assert.equal(getHostnameFromUrl(undefined), null)
    assert.equal(getHostnameFromUrl('nonsense'), null)
  })
})

describe('isHostWhitelisted', () => {
  it('matches exact hosts and subdomains only', () => {
    const whitelist = ['example.com']
    assert.equal(isHostWhitelisted('example.com', whitelist), true)
    assert.equal(isHostWhitelisted('www.example.com', whitelist), true)
    assert.equal(isHostWhitelisted('a.b.example.com', whitelist), true)
    assert.equal(isHostWhitelisted('notexample.com', whitelist), false)
    assert.equal(isHostWhitelisted(null, whitelist), false)
  })
})

describe('hostToMatchPatterns', () => {
  it('covers the host and its subdomains', () => {
    assert.deepEqual(hostToMatchPatterns('example.com'), ['*://example.com/*', '*://*.example.com/*'])
  })
})
