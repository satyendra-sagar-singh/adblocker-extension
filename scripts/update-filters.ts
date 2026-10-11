/**
 * Downloads maintained filter lists and converts their network rules into the optional
 * "easylist" static ruleset (src/rules/easylist.json). Re-run periodically and rebuild.
 *
 * Usage: node scripts/update-filters.ts [--max 30000]
 */

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { convertAbpFilters } from '../src/filters/abp-to-dnr.ts'
import { validateRuleset } from '../src/filters/dnr-validate.ts'
import { mergeDomainRules } from '../src/filters/optimize.ts'

const FILTER_LISTS = [
  { name: 'EasyList', url: 'https://easylist.to/easylist/easylist.txt' },
  { name: 'EasyPrivacy', url: 'https://easylist.to/easylist/easyprivacy.txt' },
  { name: "Peter Lowe's list", url: 'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=0&mimetype=plaintext' },
]

/**
 * Cap applied AFTER domain rules are merged into requestDomains lists. Chrome guarantees
 * 30,000 static rules across all of an extension's enabled rulesets; the three shipped
 * rulesets use a few hundred, so this leaves comfortable headroom.
 */
const DEFAULT_MAX_RULES = 25000
const EASYLIST_FIRST_ID = 100000

const maxArgIndex = process.argv.indexOf('--max')
const maxRules = maxArgIndex === -1 ? DEFAULT_MAX_RULES : Number(process.argv[maxArgIndex + 1])
if (!Number.isInteger(maxRules) || maxRules < 1) throw new Error('--max must be a positive integer')

async function download(url: string): Promise<string> {
  const response = await fetch(url, { headers: { 'user-agent': 'adblocker-extension filter updater' } })
  if (!response.ok) throw new Error(`${url} responded ${response.status}`)
  return response.text()
}

async function main(): Promise<void> {
  const sources: string[] = []
  for (const list of FILTER_LISTS) {
    const text = await download(list.url)
    console.log(`${list.name}: ${text.split('\n').length} lines`)
    sources.push(text)
  }

  const converted = convertAbpFilters(sources.join('\n'), { firstRuleId: EASYLIST_FIRST_ID })
  const merged = mergeDomainRules(converted.rules)
  const overflow = Math.max(0, merged.length - maxRules)
  const rules = merged.slice(0, maxRules)
  const result = {
    rules,
    skipped: overflow > 0 ? [...converted.skipped, { line: `(${overflow} more rules)`, reason: `exceeded the cap of ${maxRules} rules` }] : converted.skipped,
  }
  console.log(`merged ${converted.rules.length} converted rules into ${merged.length}`)
  const validation = validateRuleset(result.rules)
  if (validation.errors.length) {
    for (const error of validation.errors.slice(0, 20)) console.error(`rule ${error.id}: ${error.problems.join('; ')}`)
    throw new Error(`${validation.errors.length} converted rules failed validation`)
  }

  const reasons = new Map<string, number>()
  for (const skipped of result.skipped) reasons.set(skipped.reason, (reasons.get(skipped.reason) ?? 0) + 1)
  const topReasons = [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
  console.log(`converted ${result.rules.length} rules, skipped ${result.skipped.length} lines`)
  for (const [reason, count] of topReasons) console.log(`  ${count.toString().padStart(6)}  ${reason}`)

  const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'rules', 'easylist.json')
  writeFileSync(target, JSON.stringify(result.rules))
  console.log(`wrote ${target}`)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
