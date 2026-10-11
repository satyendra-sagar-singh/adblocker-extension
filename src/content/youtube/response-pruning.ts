/**
 * MAIN-world hooks that strip ad payloads from every path YouTube uses to deliver
 * InnerTube data: JSON.parse, Response.prototype.json, XMLHttpRequest responses with
 * responseType "json", and the inline ytInitial* globals.
 */

import {
  FEED_AD_MARKER_MAX_DEPTH,
  FEED_AD_RENDERER_KEYS,
  FEED_ARRAY_KEYS,
  INTERCEPTED_GLOBALS,
  PRUNE_PATHS,
  RESPONSE_MARKER_KEYS,
  RESPONSE_URL_SKIP_PATTERNS,
} from './config.ts'
import { interceptGlobal } from './define-constant.ts'
import { looksLikeYouTubeResponse, pruneFeedEntries, pruneObject, type JsonObject } from './prune.ts'

export type PrunedListener = (removed: number) => void

const listeners: PrunedListener[] = []

export function onPruned(listener: PrunedListener): void {
  listeners.push(listener)
}

const shouldSkipUrl = (url: string | undefined): boolean =>
  typeof url === 'string' && RESPONSE_URL_SKIP_PATTERNS.some(pattern => url.includes(pattern))

export function pruneResponse<T>(value: T, url?: string): T {
  if (shouldSkipUrl(url)) return value
  const isArrayPayload = Array.isArray(value) && value.some(item => looksLikeYouTubeResponse(item, RESPONSE_MARKER_KEYS))
  if (!isArrayPayload && !looksLikeYouTubeResponse(value, RESPONSE_MARKER_KEYS)) return value

  const removed =
    pruneObject(value, PRUNE_PATHS) +
    pruneFeedEntries(value, FEED_ARRAY_KEYS, FEED_AD_RENDERER_KEYS, FEED_AD_MARKER_MAX_DEPTH)
  if (removed > 0) for (const listener of listeners) listener(removed)
  return value
}

/** Proxies keep Function.prototype.toString reporting native code. */
function proxyMethod<T extends object, K extends keyof T>(target: T, key: K, handler: ProxyHandler<T[K] & object>): void {
  const descriptor = Object.getOwnPropertyDescriptor(target, key)
  if (!descriptor || (!descriptor.writable && !descriptor.configurable)) return
  const original = target[key]
  if (typeof original !== 'function') return
  const proxied = new Proxy(original as T[K] & object, handler)
  Object.defineProperty(target, key, { ...descriptor, value: proxied })
}

function hookJsonParse(): void {
  proxyMethod(JSON, 'parse', {
    apply: (target, thisArg, args) => pruneResponse(Reflect.apply(target as typeof JSON.parse, thisArg, args)),
  })
}

function hookResponseJson(): void {
  proxyMethod(Response.prototype, 'json', {
    apply: (target, thisArg, args) => {
      const url = thisArg instanceof Response ? thisArg.url : undefined
      const result = Reflect.apply(target as typeof Response.prototype.json, thisArg, args) as Promise<unknown>
      return result.then(value => pruneResponse(value, url))
    },
  })
}

const XHR_URL = Symbol('adblocker-xhr-url')

function hookXmlHttpRequest(): void {
  proxyMethod(XMLHttpRequest.prototype, 'open', {
    apply: (target, thisArg, args) => {
      try {
        ;(thisArg as Record<symbol, unknown>)[XHR_URL] = String(args[1] ?? '')
      } catch {
        // Frozen instance; the JSON.parse hook still covers text responses.
      }
      return Reflect.apply(target as typeof XMLHttpRequest.prototype.open, thisArg, args)
    },
  })

  const descriptor = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'response')
  if (!descriptor?.get || !descriptor.configurable) return
  const nativeGet = descriptor.get
  Object.defineProperty(XMLHttpRequest.prototype, 'response', {
    ...descriptor,
    get(this: XMLHttpRequest) {
      const value = nativeGet.call(this)
      if (this.responseType !== 'json' || value === null || typeof value !== 'object') return value
      return pruneResponse(value, (this as unknown as Record<symbol, unknown>)[XHR_URL] as string | undefined)
    },
  })
}

function interceptInlineData(): void {
  for (const name of INTERCEPTED_GLOBALS) {
    interceptGlobal<JsonObject>(window, name, value => pruneResponse(value))
  }
}

export function installResponsePruning(): void {
  hookJsonParse()
  hookResponseJson()
  hookXmlHttpRequest()
  interceptInlineData()
}
