import { loadStats, STATS_KEY, type Stats } from '../shared/settings.ts'

/**
 * Counter increments are serialized through a promise chain so concurrent reports from
 * several tabs never produce lost updates on the read-modify-write cycle.
 */
let queue: Promise<void> = Promise.resolve()

export function incrementStat(stat: keyof Stats, delta: number): Promise<void> {
  queue = queue
    .then(async () => {
      const stats = await loadStats()
      stats[stat] += delta
      await chrome.storage.local.set({ [STATS_KEY]: stats })
    })
    .catch(error => console.warn('stat update failed', error))
  return queue
}
