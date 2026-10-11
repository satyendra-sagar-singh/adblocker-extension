/**
 * MAIN-world countermeasures to YouTube's ad-blocker detection, mirroring what uBlock
 * Origin and AdGuard ship:
 *  - no-op the player's onAbnormalityDetected promise callback (the wall trigger)
 *  - shrink the 17 s "fake buffering" timer
 *  - make natives pulled from an about:blank iframe resolve to the hooked versions
 *  - pin google_ad_status so the ad_status.js beacon check passes
 */

import { PINNED_CONSTANTS, STALL_TIMER_MS, STALL_TIMER_SCALE } from './config.ts'
import { defineConstantPath } from './define-constant.ts'
import { hookRealm } from './response-pruning.ts'

const ABNORMALITY_TOKEN = 'onAbnormalityDetected'

function proxyFunction<T extends object>(owner: T, key: keyof T & string, apply: ProxyHandler<never>['apply']): void {
  const descriptor = Object.getOwnPropertyDescriptor(owner, key)
  if (!descriptor || typeof descriptor.value !== 'function') return
  if (!descriptor.writable && !descriptor.configurable) return
  Object.defineProperty(owner, key, { ...descriptor, value: new Proxy(descriptor.value as never, { apply: apply as never }) })
}

function neutralizeAbnormalityDetector(): void {
  proxyFunction(Promise.prototype, 'then', (target: (...args: unknown[]) => unknown, thisArg: unknown, args: unknown[]) => {
    const callback = args[0]
    if (typeof callback === 'function' && Function.prototype.toString.call(callback).includes(ABNORMALITY_TOKEN)) {
      args[0] = () => undefined
    }
    return Reflect.apply(target, thisArg, args)
  })
}

function shrinkStallTimer(): void {
  proxyFunction(window, 'setTimeout', (target: (...args: unknown[]) => unknown, thisArg: unknown, args: unknown[]) => {
    const [callback, delay] = args
    if (delay === STALL_TIMER_MS && typeof callback === 'function' && Function.prototype.toString.call(callback).includes('[native code]')) {
      args[1] = STALL_TIMER_MS * STALL_TIMER_SCALE
    }
    return Reflect.apply(target, thisArg, args)
  })
}

/**
 * Hooks a freshly inserted about:blank iframe's realm and points its fetch/Request at this
 * window's, so natives obtained through the frame still yield pruned responses.
 */
function shareNativesWithFrame(node: unknown): void {
  if (!(node instanceof HTMLIFrameElement)) return
  const src = node.getAttribute('src')
  if (src && src !== 'about:blank') return
  try {
    const frameWindow = node.contentWindow as unknown as (Record<string, unknown> & { JSON: typeof JSON }) | null
    if (!frameWindow) return
    hookRealm(frameWindow)
    frameWindow.fetch = window.fetch
    frameWindow.Request = window.Request
    frameWindow.JSON.parse = JSON.parse
  } catch {
    // Cross-origin (sandboxed) frame: content scripts are injected there via matchOriginAsFallback.
  }
}

function guardIframeNatives(): void {
  const insertion = (target: (...args: unknown[]) => unknown, thisArg: unknown, args: unknown[]) => {
    const result = Reflect.apply(target, thisArg, args)
    for (const arg of args) shareNativesWithFrame(arg)
    return result
  }
  proxyFunction(Node.prototype, 'appendChild', insertion)
  proxyFunction(Node.prototype, 'insertBefore', insertion)
  proxyFunction(Element.prototype, 'append', insertion)
  proxyFunction(Element.prototype, 'prepend', insertion)
}

function pinConstants(): void {
  for (const { path, value } of PINNED_CONSTANTS) defineConstantPath(window, path, value)
}

export function installAntiDetection(): void {
  neutralizeAbnormalityDetector()
  shrinkStallTimer()
  guardIframeNatives()
  pinConstants()
}
