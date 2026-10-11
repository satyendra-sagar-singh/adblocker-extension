/**
 * Runs in the page's MAIN world at document_start, before any YouTube script.
 * Installs the response pruning, anti-detection and request-shaping hooks, then
 * starts the player controller. Settings arrive from the ISOLATED-world script.
 */

import { DEFAULT_SETTINGS, type YouTubeSettings } from '../../shared/settings.ts'
import { installAntiDetection } from './anti-detection.ts'
import { emit, EVENT_TO_ISOLATED, EVENT_TO_MAIN, listen, type ToIsolatedMessage, type ToMainMessage } from './bridge.ts'
import { createPlayerController } from './player-controller.ts'
import { installRequestShaping, type RequestMode } from './request-shaping.ts'
import { installResponsePruning, onPruned } from './response-pruning.ts'

const INSTALL_FLAG = Symbol.for('adblocker-youtube-main-world')

function main(): void {
  const scope = window as Window & { [INSTALL_FLAG]?: boolean }
  if (scope[INSTALL_FLAG]) return
  scope[INSTALL_FLAG] = true

  const state: { settings: YouTubeSettings; mode: RequestMode } = { settings: DEFAULT_SETTINGS.youtube, mode: 'none' }
  const send = (message: ToIsolatedMessage): void => emit(EVENT_TO_ISOLATED, message)

  installResponsePruning()
  onPruned(removed => send({ type: 'stat', stat: 'responsesPruned', delta: removed }))
  installAntiDetection()
  installRequestShaping(() => state.mode)

  listen<ToMainMessage>(EVENT_TO_MAIN, message => {
    if (message.type === 'settings') state.settings = message.settings
  })

  createPlayerController({
    getSettings: () => state.settings,
    getMode: () => state.mode,
    setMode: mode => {
      state.mode = mode
    },
    onAdSkipped: () => send({ type: 'stat', stat: 'youtubeAdsSkipped', delta: 1 }),
  }).start()

  send({ type: 'ready' })
}

main()
