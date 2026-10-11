/**
 * Pure helpers for removing ad payloads from YouTube JSON responses.
 * Paths use dot notation; the special "[]" segment means "every element of this array".
 */

export type JsonObject = Record<string, unknown>

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Quick structural check so unrelated JSON.parse calls are left untouched. */
export function looksLikeYouTubeResponse(value: unknown, markerKeys: readonly string[]): value is JsonObject {
  if (!isObject(value)) return false
  return markerKeys.some(key => key in value)
}

function deleteAtPath(target: unknown, segments: readonly string[], index: number): number {
  const segment = segments[index]
  if (segment === undefined) return 0

  if (segment === '[]') {
    if (!Array.isArray(target)) return 0
    let removed = 0
    for (const item of target) removed += deleteAtPath(item, segments, index + 1)
    return removed
  }

  if (!isObject(target)) return 0
  if (index === segments.length - 1) {
    if (!(segment in target)) return 0
    delete target[segment]
    return 1
  }
  return deleteAtPath(target[segment], segments, index + 1)
}

/** Deletes every listed path; returns how many keys were removed. Mutates the object. */
export function pruneObject(value: unknown, paths: readonly string[]): number {
  if (!isObject(value) && !Array.isArray(value)) return 0
  let removed = 0
  for (const path of paths) removed += deleteAtPath(value, path.split('.'), 0)
  return removed
}

/** Looks a few levels deep for an ad marker key; deep enough for richItemRenderer wrappers. */
function containsMarker(value: unknown, markers: readonly string[], depth: number, maxDepth: number): boolean {
  if (!isObject(value) || depth > maxDepth) return false
  for (const key of Object.keys(value)) {
    // Renderer keys mark an ad by their presence; boolean flags such as isAd must be true.
    if (markers.includes(key) && (typeof value[key] !== 'boolean' || value[key] === true)) return true
    if (containsMarker(value[key], markers, depth + 1, maxDepth)) return true
  }
  return false
}

/**
 * Walks the response and removes, from every array stored under one of `arrayKeys`,
 * the entries that wrap an ad renderer. Returns the number of entries removed.
 */
export function pruneFeedEntries(
  value: unknown,
  arrayKeys: readonly string[],
  adMarkers: readonly string[],
  markerMaxDepth: number,
  maxWalkDepth = 24,
): number {
  let removed = 0

  const walk = (node: unknown, depth: number): void => {
    if (depth > maxWalkDepth) return
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1)
      return
    }
    if (!isObject(node)) return
    for (const key of Object.keys(node)) {
      const child = node[key]
      if (Array.isArray(child) && arrayKeys.includes(key)) {
        for (let i = child.length - 1; i >= 0; i -= 1) {
          if (containsMarker(child[i], adMarkers, 0, markerMaxDepth)) {
            child.splice(i, 1)
            removed += 1
          }
        }
      }
      walk(child, depth + 1)
    }
  }

  walk(value, 0)
  return removed
}
