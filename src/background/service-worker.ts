import { isRuntimeMessage } from '../shared/messaging.ts'
import { loadSettings, onSettingsChanged, type Settings } from '../shared/settings.ts'
import { syncBadge } from './badge.ts'
import { syncContentScripts } from './content-scripts.ts'
import { syncDynamicRules } from './dynamic-rules.ts'
import { syncStaticRulesets } from './rulesets.ts'
import { incrementStat } from './stats.ts'

/** Settings changes are applied strictly in order; a failing step never blocks later ones. */
let applyQueue: Promise<void> = Promise.resolve()

function applySettings(settings: Settings): Promise<void> {
  applyQueue = applyQueue.then(async () => {
    const steps: Array<[string, () => Promise<void>]> = [
      ['static rulesets', () => syncStaticRulesets(settings)],
      ['dynamic rules', () => syncDynamicRules(settings)],
      ['content scripts', () => syncContentScripts(settings)],
      ['badge', () => syncBadge(settings)],
    ]
    for (const [name, step] of steps) {
      try {
        await step()
      } catch (error) {
        console.error(`failed to apply ${name}`, error)
      }
    }
  })
  return applyQueue
}

async function initialize(): Promise<void> {
  await applySettings(await loadSettings())
}

chrome.runtime.onInstalled.addListener(() => {
  void initialize()
})

chrome.runtime.onStartup.addListener(() => {
  void initialize()
})

onSettingsChanged(settings => {
  void applySettings(settings)
})

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!isRuntimeMessage(message) || !sender.tab) return false
  void incrementStat(message.stat, Math.max(0, Math.floor(message.delta))).then(() => sendResponse({ ok: true }))
  return true
})
