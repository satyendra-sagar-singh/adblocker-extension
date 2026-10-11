/**
 * Downloads the network sections of EasyList Adult (ad servers and site-specific blocks)
 * and converts them into the shipped "adult" static ruleset (src/rules/adult.json).
 * Unlike the optional easylist ruleset this one is committed, so adult sites are covered
 * out of the box. Re-run periodically and rebuild.
 *
 * Usage: node scripts/update-adult-filters.ts
 */

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { convertAbpFilters } from '../src/filters/abp-to-dnr.ts'
import { validateRuleset } from '../src/filters/dnr-validate.ts'
import { mergeDomainRules } from '../src/filters/optimize.ts'

const SOURCE_BASE = 'https://raw.githubusercontent.com/easylist/easylist/master/easylist_adult'

const FILTER_SECTIONS = [
  { name: 'EasyList Adult ad servers', url: `${SOURCE_BASE}/adult_adservers.txt` },
  { name: 'EasyList Adult site-specific blocks', url: `${SOURCE_BASE}/adult_specific_block.txt` },
]

/**
 * The networks that serve most ads on adult sites are listed in EasyList's general ad
 * server section rather than in EasyList Adult; these lines are copied from it verbatim.
 */
const ADULT_AD_NETWORK_FILTERS = [
  '||trafficjunky.net^',
  '||trafficjunky.com^$third-party',
  '||exosrv.com^',
  '||exdynsrv.com^',
  '||magsrv.com^',
  '||realsrv.com^',
  '||juicyads.com^$script,third-party',
  '||tsyndicate.com^',
  '||ero-advertising.com^',
  '||adspyglass.com^',
  '||hilltopads.net^',
  '||clickadu.com^$third-party',
]

/** Keeps the shipped ruleset small next to the 30,000 guaranteed static rules. */
const MAX_RULES = 2000

async function download(url: string): Promise<string> {
  const response = await fetch(url, { headers: { 'user-agent': 'adblocker-extension filter updater' } })
  if (!response.ok) throw new Error(`${url} responded ${response.status}`)
  return response.text()
}

async function main(): Promise<void> {
  const sources: string[] = []
  for (const section of FILTER_SECTIONS) {
    const text = await download(section.url)
    console.log(`${section.name}: ${text.split('\n').length} lines`)
    sources.push(text)
  }

  sources.push(ADULT_AD_NETWORK_FILTERS.join('\n'))

  const converted = convertAbpFilters(sources.join('\n'), { firstRuleId: 1 })
  const merged = mergeDomainRules(converted.rules)
  if (merged.length > MAX_RULES) throw new Error(`${merged.length} rules exceed the cap of ${MAX_RULES}`)
  console.log(`merged ${converted.rules.length} converted rules into ${merged.length}, skipped ${converted.skipped.length} lines`)

  const validation = validateRuleset(merged)
  if (validation.errors.length) {
    for (const error of validation.errors.slice(0, 20)) console.error(`rule ${error.id}: ${error.problems.join('; ')}`)
    throw new Error(`${validation.errors.length} converted rules failed validation`)
  }

  // One rule per line, like the hand-maintained rulesets, so updates diff cleanly.
  const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'rules', 'adult.json')
  writeFileSync(target, `[\n${merged.map(rule => `  ${JSON.stringify(rule)}`).join(',\n')}\n]\n`)
  console.log(`wrote ${target}`)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
