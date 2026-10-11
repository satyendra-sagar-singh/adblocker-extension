/**
 * Runs in the extension's ISOLATED world on YouTube pages. Owns everything that needs
 * extension APIs or must act on DOM before page scripts: settings sync to the MAIN
 * world, counter reporting, neutralising the native-bypass inline script, and removing
 * the "ad blockers violate YouTube's Terms of Service" dialog.
 */

import { reportStat } from '../../shared/messaging.ts'
import { DEFAULT_SETTINGS, loadSettings, onSettingsChanged, type YouTubeSettings } from '../../shared/settings.ts'
import { emit, EVENT_TO_ISOLATED, EVENT_TO_MAIN, listen, type ToIsolatedMessage, type ToMainMessage } from './bridge.ts'
import {
  DIALOG_BACKDROP_SELECTORS,
  DIALOG_SHELL_SELECTORS,
  ENFORCEMENT_SELECTORS,
  NATIVE_BYPASS_SCRIPT_TOKEN,
  PLAYER_SELECTORS,
  VIDEO_SELECTORS,
} from './config.ts'

let settings: YouTubeSettings = DEFAULT_SETTINGS.youtube

function querySafe<T extends Element>(root: ParentNode, selector: string): T | null {
  try {
    return root.querySelector<T>(selector)
  } catch {
    return null
  }
}

function sendSettings(): void {
  const message: ToMainMessage = { type: 'settings', settings }
  emit(EVENT_TO_MAIN, message)
}

/** Empties a parser-inserted script before it runs; falls back to removing it. */
function neutralizeScript(script: HTMLScriptElement): void {
  try {
    script.textContent = ''
    return
  } catch {
    // Trusted Types enforcement; try a policy, then removal.
  }
  try {
    const trustedTypes = (window as Window & { trustedTypes?: { createPolicy: (name: string, rules: { createScript: (input: string) => string }) => { createScript: (input: string) => unknown } } }).trustedTypes
    const policy = trustedTypes?.createPolicy('adblocker-youtube', { createScript: input => input })
    if (policy) {
      script.textContent = policy.createScript('') as string
      return
    }
  } catch {
    // Policy creation blocked by CSP.
  }
  script.remove()
}

function inspectScript(script: HTMLScriptElement): void {
  if (script.src || !script.textContent?.includes(NATIVE_BYPASS_SCRIPT_TOKEN)) return
  neutralizeScript(script)
}

/**
 * The parser may yield while an inline script is only partially received; the rest then
 * arrives as text appended to the script, so text mutations inside scripts are inspected too.
 */
function handleMutation(mutation: MutationRecord): void {
  if (mutation.type === 'characterData') {
    const parent = mutation.target.parentNode
    if (parent?.nodeName === 'SCRIPT') inspectScript(parent as HTMLScriptElement)
    return
  }
  for (const node of mutation.addedNodes) {
    if (node.nodeName === 'SCRIPT') inspectScript(node as HTMLScriptElement)
    else if (node.nodeType === Node.TEXT_NODE && node.parentNode?.nodeName === 'SCRIPT') inspectScript(node.parentNode as HTMLScriptElement)
  }
}

function resumePlayback(): void {
  for (const playerSelector of PLAYER_SELECTORS) {
    const player = querySafe<HTMLElement>(document, playerSelector)
    if (!player) continue
    for (const videoSelector of VIDEO_SELECTORS) {
      const video = querySafe<HTMLVideoElement>(player, videoSelector)
      if (!video) continue
      if (video.paused && !video.ended && video.currentTime > 0) void video.play().catch(() => undefined)
      return
    }
  }
}

function removeEnforcementDialog(): boolean {
  let removed = false
  for (const selector of ENFORCEMENT_SELECTORS) {
    const message = querySafe<HTMLElement>(document, selector)
    if (!message) continue
    const shell = DIALOG_SHELL_SELECTORS.map(shellSelector => message.closest<HTMLElement>(shellSelector)).find(Boolean)
    ;(shell ?? message).remove()
    removed = true
  }
  if (!removed) return false
  for (const selector of DIALOG_BACKDROP_SELECTORS) {
    for (const backdrop of document.querySelectorAll(selector)) backdrop.remove()
  }
  resumePlayback()
  return true
}

let dialogCheckScheduled = false
function scheduleDialogCheck(): void {
  if (dialogCheckScheduled || !settings.removeEnforcementDialog) return
  dialogCheckScheduled = true
  setTimeout(() => {
    dialogCheckScheduled = false
    removeEnforcementDialog()
  }, 50)
}

function observeDocument(): void {
  const observer = new MutationObserver(mutations => {
    let elementsAdded = false
    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0) elementsAdded = true
      handleMutation(mutation)
    }
    if (elementsAdded) scheduleDialogCheck()
  })
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true })
}

function listenToMainWorld(): void {
  listen<ToIsolatedMessage>(EVENT_TO_ISOLATED, message => {
    if (message.type === 'ready') sendSettings()
    else if (message.type === 'stat') reportStat(message.stat, message.delta)
  })
}

async function main(): Promise<void> {
  listenToMainWorld()
  observeDocument()
  document.addEventListener('yt-navigate-finish', scheduleDialogCheck)

  try {
    settings = (await loadSettings()).youtube
    sendSettings()
    onSettingsChanged(next => {
      settings = next.youtube
      sendSettings()
    })
  } catch {
    // Storage unavailable (orphaned script after an extension reload); keep defaults.
  }
}

void main()
