/**
 * Generic cosmetic filtering, injected on every site except YouTube and paused hosts.
 * Hides known ad containers via a stylesheet and reports how many elements were hidden.
 */

import { reportStat } from '../../shared/messaging.ts'
import { GENERIC_SELECTORS, selectorsForHost } from './selectors.ts'

const STYLE_ID = 'adblocker-cosmetic-style'
const COUNT_DELAY_MS = 2500

function injectStyle(selectors: readonly string[]): void {
  if (selectors.length === 0 || document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  // One rule per selector: an unsupported selector then only invalidates itself.
  style.textContent = selectors.map(selector => `${selector}{display:none!important}`).join('\n')
  ;(document.head ?? document.documentElement).appendChild(style)
}

function countHidden(selectors: readonly string[]): number {
  let hidden = 0
  for (const selector of selectors) {
    try {
      hidden += document.querySelectorAll(selector).length
    } catch {
      // Selector not supported by this browser version; ignore.
    }
  }
  return hidden
}

function main(): void {
  const selectors = [...GENERIC_SELECTORS, ...selectorsForHost(location.hostname)]
  injectStyle(selectors)

  const report = () => {
    const hidden = countHidden(selectors)
    if (hidden > 0) reportStat('elementsHidden', hidden)
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(report, COUNT_DELAY_MS), { once: true })
  } else {
    setTimeout(report, COUNT_DELAY_MS)
  }
}

main()
