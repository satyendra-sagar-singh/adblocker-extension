import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { convertAbpFilters, convertAbpLine } from '../../src/filters/abp-to-dnr.ts'
import { validateRuleset } from '../../src/filters/dnr-validate.ts'

const ruleFor = (line: string) => {
  const conversion = convertAbpLine(line)
  assert.equal(conversion.kind, 'rule', `expected a rule for ${line}: ${JSON.stringify(conversion)}`)
  return conversion.kind === 'rule' ? conversion.rule : (undefined as never)
}

const skipReason = (line: string) => {
  const conversion = convertAbpLine(line)
  assert.equal(conversion.kind, 'skip', `expected skip for ${line}: ${JSON.stringify(conversion)}`)
  return conversion.kind === 'skip' ? conversion.reason : ''
}

describe('convertAbpLine', () => {
  it('ignores comments, headers and blank lines', () => {
    assert.deepEqual(convertAbpLine(''), { kind: 'ignore' })
    assert.deepEqual(convertAbpLine('! comment'), { kind: 'ignore' })
    assert.deepEqual(convertAbpLine('[Adblock Plus 2.0]'), { kind: 'ignore' })
  })

  it('maps domain-anchored block filters', () => {
    assert.deepEqual(ruleFor('||ads.example.com^'), {
      priority: 1,
      action: { type: 'block' },
      condition: { urlFilter: '||ads.example.com^' },
    })
  })

  it('treats bare hostnames and hosts-file lines as domain blocks', () => {
    assert.equal(ruleFor('ads.example.com').condition.urlFilter, '||ads.example.com^')
    assert.equal(ruleFor('0.0.0.0 tracker.example.net').condition.urlFilter, '||tracker.example.net^')
    assert.equal(ruleFor('127.0.0.1 pixel.example.org # comment').condition.urlFilter, '||pixel.example.org^')
    assert.deepEqual(convertAbpLine('127.0.0.1 localhost'), { kind: 'ignore' })
  })

  it('maps resource type, party and domain options', () => {
    const rule = ruleFor('||example.com/banner*$image,script,third-party,domain=site.com|~sub.site.com')
    assert.deepEqual(rule.condition, {
      urlFilter: '||example.com/banner*',
      domainType: 'thirdParty',
      resourceTypes: ['image', 'script'],
      initiatorDomains: ['site.com'],
      excludedInitiatorDomains: ['sub.site.com'],
    })
  })

  it('maps uBlock short option aliases', () => {
    const rule = ruleFor('||example.com^$xhr,frame,3p')
    assert.deepEqual(rule.condition.resourceTypes, ['xmlhttprequest', 'sub_frame'])
    assert.equal(rule.condition.domainType, 'thirdParty')
    assert.equal(ruleFor('||example.com^$1p').condition.domainType, 'firstParty')
    assert.equal(ruleFor('||example.com^$~third-party').condition.domainType, 'firstParty')
  })

  it('maps negated types to excludedResourceTypes', () => {
    assert.deepEqual(ruleFor('||example.com^$~script,~image').condition.excludedResourceTypes, ['script', 'image'])
  })

  it('maps $document exceptions to allowAllRequests', () => {
    const rule = ruleFor('@@||example.com^$document')
    assert.equal(rule.action.type, 'allowAllRequests')
    assert.deepEqual(rule.condition.resourceTypes, ['main_frame', 'sub_frame'])
  })

  it('maps plain exceptions to allow and $important to a higher priority', () => {
    assert.equal(ruleFor('@@||cdn.example.com^$script').action.type, 'allow')
    assert.equal(ruleFor('||ads.example.com^$important').priority, 2)
  })

  it('maps $to, $denyallow and $method', () => {
    assert.deepEqual(ruleFor('*$script,to=ads.example.com|~safe.example.com').condition, {
      resourceTypes: ['script'],
      requestDomains: ['ads.example.com'],
      excludedRequestDomains: ['safe.example.com'],
    })
    assert.deepEqual(ruleFor('*$script,domain=site.com,denyallow=cdn.site.com').condition, {
      resourceTypes: ['script'],
      initiatorDomains: ['site.com'],
      excludedRequestDomains: ['cdn.site.com'],
    })
    assert.deepEqual(ruleFor('||example.com^$method=post|put').condition.requestMethods, ['post', 'put'])
    assert.deepEqual(ruleFor('||example.com^$method=~get').condition.excludedRequestMethods, ['get'])
  })

  it('maps $match-case and start/end anchors', () => {
    const rule = ruleFor('|https://example.com/ad.js|$match-case')
    assert.equal(rule.condition.urlFilter, '|https://example.com/ad.js|')
    assert.equal(rule.condition.isUrlFilterCaseSensitive, true)
  })

  it('skips everything declarativeNetRequest cannot express', () => {
    assert.equal(skipReason('example.com##.ad'), 'cosmetic filter')
    assert.equal(skipReason('example.com#@#.ad'), 'cosmetic filter')
    assert.equal(skipReason('example.com#?#.ad:has(> .x)'), 'cosmetic filter')
    assert.equal(skipReason('/banner[0-9]+/'), 'regex patterns are not supported')
    assert.match(skipReason('||example.com^$csp=script-src none'), /csp/)
    assert.match(skipReason('||example.com^$redirect=noopjs'), /redirect/)
    assert.match(skipReason('@@||example.com^$generichide'), /generichide/)
    assert.match(skipReason('||example.com^$badfilter'), /badfilter/)
    assert.match(skipReason('||example.com^$popup'), /popup/)
    assert.match(skipReason('||exämple.com^'), /ASCII/)
    assert.match(skipReason('||example.com^$domain=example.*'), /unsupported domain pattern/)
    assert.match(skipReason('*'), /every request/)
    assert.match(skipReason('ad'), /too short/)
    assert.match(skipReason('||a|b^'), /"\|"/)
  })

  it('allows a bare wildcard when scoped by options', () => {
    assert.deepEqual(ruleFor('*$third-party,domain=example.com').condition, {
      domainType: 'thirdParty',
      initiatorDomains: ['example.com'],
    })
  })
})

describe('convertAbpFilters', () => {
  const list = `
[Adblock Plus 2.0]
! Title: test
||ads.example.com^
||ads.example.com^
example.com##.banner
||tracker.example.net^$third-party
@@||example.com^$document
||example.com/*.gif$image,domain=foo.com
`

  it('assigns sequential ids, dedupes, and reports skipped lines', () => {
    const result = convertAbpFilters(list, { firstRuleId: 500 })
    assert.deepEqual(result.rules.map(rule => rule.id), [500, 501, 502, 503])
    assert.deepEqual(result.skipped, [{ line: 'example.com##.banner', reason: 'cosmetic filter' }])
    assert.equal(validateRuleset(result.rules).errors.length, 0)
  })

  it('enforces maxRules and reports the overflow', () => {
    const result = convertAbpFilters(list, { maxRules: 2 })
    assert.equal(result.rules.length, 2)
    assert.ok(result.skipped.some(entry => /exceeded the cap/.test(entry.reason)))
  })
})
