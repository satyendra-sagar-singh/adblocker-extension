/**
 * Pins a nested property path on an object to a constant value, even when the
 * intermediate objects are created later by page scripts (the uBlock Origin
 * "set-constant" pattern). Each segment is trapped with an accessor so that the
 * moment a page script assigns the next object, the trap moves down one level.
 */

type AnyObject = Record<PropertyKey, unknown>

const isObject = (value: unknown): value is AnyObject => typeof value === 'object' && value !== null

export function defineConstantPath(root: object, path: string, constant: unknown): void {
  trapSegment(root as AnyObject, path.split('.'), 0, constant)
}

function trapSegment(target: AnyObject, segments: readonly string[], index: number, constant: unknown): void {
  const key = segments[index]
  if (key === undefined) return
  const isLeaf = index === segments.length - 1

  const descriptor = Object.getOwnPropertyDescriptor(target, key)
  if (descriptor && !descriptor.configurable) return

  if (isLeaf) {
    Object.defineProperty(target, key, {
      configurable: true,
      enumerable: descriptor?.enumerable ?? true,
      get: () => constant,
      set: () => undefined,
    })
    return
  }

  let current: unknown = descriptor && 'value' in descriptor ? descriptor.value : undefined
  if (isObject(current)) trapSegment(current, segments, index + 1, constant)

  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: descriptor?.enumerable ?? true,
    get: () => current,
    set: (value: unknown) => {
      current = value
      if (isObject(value)) trapSegment(value, segments, index + 1, constant)
    },
  })
}

/**
 * Intercepts assignment of a global (e.g. ytInitialPlayerResponse) and lets a transform
 * rewrite the value before the page can read it back.
 */
export function interceptGlobal<T>(root: object, name: string, transform: (value: T) => T): void {
  const target = root as AnyObject
  const descriptor = Object.getOwnPropertyDescriptor(target, name)
  if (descriptor && !descriptor.configurable) return

  let current: unknown = descriptor && 'value' in descriptor ? transform(descriptor.value as T) : undefined
  Object.defineProperty(target, name, {
    configurable: true,
    enumerable: true,
    get: () => current,
    set: (value: unknown) => {
      current = isObject(value) ? transform(value as T) : value
    },
  })
}
