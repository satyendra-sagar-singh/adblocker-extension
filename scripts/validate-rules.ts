/**
 * Validates every static ruleset under src/rules against declarativeNetRequest constraints.
 * Exits non-zero on the first invalid ruleset so CI fails loudly.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateRuleset } from '../src/filters/dnr-validate.ts'

const rulesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'rules')
const MAX_REGEX_RULES = 1000

let failed = false
for (const file of readdirSync(rulesDir).filter(name => name.endsWith('.json')).sort()) {
  const rules = JSON.parse(readFileSync(join(rulesDir, file), 'utf8')) as unknown
  const result = validateRuleset(rules)
  const status = result.errors.length === 0 && result.regexRuleCount <= MAX_REGEX_RULES ? 'ok' : 'FAIL'
  console.log(`${status.padEnd(4)} ${file}: ${result.ruleCount} rules, ${result.regexRuleCount} regex`)

  for (const error of result.errors) {
    failed = true
    console.log(`     rule ${error.id ?? '?'}: ${error.problems.join('; ')}`)
  }
  if (result.regexRuleCount > MAX_REGEX_RULES) {
    failed = true
    console.log(`     too many regex rules (${result.regexRuleCount} > ${MAX_REGEX_RULES})`)
  }
}

process.exit(failed ? 1 : 0)
