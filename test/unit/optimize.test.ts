import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { convertAbpFilters } from '../../src/filters/abp-to-dnr.ts'
import { validateRuleset } from '../../src/filters/dnr-validate.ts'
import { mergeDomainRules, renumberRules } from '../../src/filters/optimize.ts'

describe('mergeDomainRules', () => {
  it('merges domain-anchor rules with identical options into requestDomains lists', () => {
    const { rules } = convertAbpFilters(
      ['||a.com^', '||b.com^', '||c.com^$third-party', '||d.com^$third-party', '@@||e.com^', '||f.com/path', '||g.com^$script,domain=x.com'].join('\n'),
      { firstRuleId: 100 },
    )
    const merged = mergeDomainRules(rules)
    assert.equal(validateRuleset(merged).errors.length, 0)
    assert.deepEqual(merged.map(rule => rule.id), [100, 101, 102, 103, 104])

    const plain = merged.find(rule => rule.condition.requestDomains?.includes('a.com'))
    assert.deepEqual(plain?.condition, { requestDomains: ['a.com', 'b.com'] })
    assert.equal(plain?.action.type, 'block')

    const thirdParty = merged.find(rule => rule.condition.requestDomains?.includes('c.com'))
    assert.deepEqual(thirdParty?.condition, { domainType: 'thirdParty', requestDomains: ['c.com', 'd.com'] })

    const allow = merged.find(rule => rule.action.type === 'allow')
    assert.deepEqual(allow?.condition, { requestDomains: ['e.com'] })

    assert.ok(merged.some(rule => rule.condition.urlFilter === '||f.com/path'), 'path rules pass through untouched')
    const scoped = merged.find(rule => rule.condition.requestDomains?.includes('g.com'))
    assert.deepEqual(scoped?.condition, { resourceTypes: ['script'], initiatorDomains: ['x.com'], requestDomains: ['g.com'] })
  })

  it('chunks large groups, dedupes domains and keeps priorities apart', () => {
    const lines = Array.from({ length: 2500 }, (_, index) => `||host${index % 2400}.com^`)
    lines.push('||important.com^$important')
    const { rules } = convertAbpFilters(lines.join('\n'))
    const merged = mergeDomainRules(rules, 1000)
    const chunks = merged.filter(rule => (rule.priority ?? 1) === 1)
    assert.deepEqual(chunks.map(rule => rule.condition.requestDomains?.length), [1000, 1000, 400])
    const important = merged.find(rule => rule.priority === 2)
    assert.deepEqual(important?.condition.requestDomains, ['important.com'])
    assert.equal(validateRuleset(merged).errors.length, 0)
  })
})

describe('renumberRules', () => {
  it('assigns sequential ids from the given start', () => {
    const rules = renumberRules([{ id: 9, action: { type: 'block' }, condition: { urlFilter: 'a' } }, { id: 3, action: { type: 'block' }, condition: { urlFilter: 'b' } }], 50)
    assert.deepEqual(rules.map(rule => rule.id), [50, 51])
  })
})
