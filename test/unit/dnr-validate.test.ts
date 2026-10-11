import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { validateRule, validateRuleset } from '../../src/filters/dnr-validate.ts'

describe('validateRule', () => {
  it('accepts a minimal block rule', () => {
    assert.deepEqual(validateRule({ id: 1, action: { type: 'block' }, condition: { urlFilter: '||example.com^' } }), [])
  })

  it('rejects malformed ids, actions and filters', () => {
    assert.ok(validateRule({ id: 0, action: { type: 'block' }, condition: { urlFilter: 'x' } }).some(p => /id/.test(p)))
    assert.ok(validateRule({ id: 1, action: { type: 'nope' }, condition: { urlFilter: 'x' } }).some(p => /action/.test(p)))
    assert.ok(validateRule({ id: 1, action: { type: 'block' }, condition: { urlFilter: '' } }).some(p => /empty/.test(p)))
    assert.ok(validateRule({ id: 1, action: { type: 'block' }, condition: { urlFilter: 'a|b' } }).some(p => /"\|"/.test(p)))
    assert.ok(validateRule({ id: 1, action: { type: 'block' }, condition: { urlFilter: '*' } }).some(p => /every URL/.test(p)))
    assert.ok(validateRule({ id: 1, action: { type: 'block' }, condition: { urlFilter: '||exämple.com^' } }).some(p => /ASCII/.test(p)))
  })

  it('rejects mutually exclusive and deprecated condition keys', () => {
    const both = validateRule({ id: 1, action: { type: 'block' }, condition: { urlFilter: 'a.b', resourceTypes: ['script'], excludedResourceTypes: ['image'] } })
    assert.ok(both.some(p => /mutually exclusive/.test(p)))
    const deprecated = validateRule({ id: 1, action: { type: 'block' }, condition: { urlFilter: 'a.b', domains: ['x.com'] } })
    assert.ok(deprecated.some(p => /deprecated/.test(p)))
  })

  it('requires frame resource types for allowAllRequests', () => {
    const bad = validateRule({ id: 1, action: { type: 'allowAllRequests' }, condition: { requestDomains: ['example.com'], resourceTypes: ['script'] } })
    assert.ok(bad.some(p => /allowAllRequests/.test(p)))
    const good = validateRule({ id: 1, action: { type: 'allowAllRequests' }, condition: { requestDomains: ['example.com'], resourceTypes: ['main_frame', 'sub_frame'] } })
    assert.deepEqual(good, [])
  })

  it('validates domain lists and resource types', () => {
    const problems = validateRule({ id: 1, action: { type: 'block' }, condition: { urlFilter: 'a.b', initiatorDomains: ['bad domain'], resourceTypes: ['scripts'] } })
    assert.ok(problems.some(p => /initiatorDomains/.test(p)))
    assert.ok(problems.some(p => /resourceTypes/.test(p)))
  })
})

describe('validateRuleset', () => {
  it('flags duplicate ids and counts regex rules', () => {
    const result = validateRuleset([
      { id: 1, action: { type: 'block' }, condition: { urlFilter: '||a.com^' } },
      { id: 1, action: { type: 'block' }, condition: { regexFilter: 'ads[0-9]+' } },
    ])
    assert.equal(result.ruleCount, 2)
    assert.equal(result.regexRuleCount, 1)
    assert.ok(result.errors.some(error => error.problems.some(p => /duplicate id/.test(p))))
  })

  it('rejects non-array input', () => {
    assert.equal(validateRuleset({}).errors.length, 1)
  })
})
