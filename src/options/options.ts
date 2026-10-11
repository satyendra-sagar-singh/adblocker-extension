import { convertAbpFilters } from '../filters/abp-to-dnr.ts'
import { normalizeHostname } from '../shared/hostname.ts'
import { loadSettings, loadStats, resetStats, saveSettings, type Settings } from '../shared/settings.ts'

const CUSTOM_FILTERS_MAX_RULES = 9000
const SAVE_DEBOUNCE_MS = 400

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id)
  if (!element) throw new Error(`options element #${id} missing`)
  return element as T
}

const elements = {
  whitelistForm: requireElement<HTMLFormElement>('whitelist-form'),
  whitelistInput: requireElement<HTMLInputElement>('whitelist-input'),
  whitelistError: requireElement<HTMLElement>('whitelist-error'),
  whitelistList: requireElement<HTMLUListElement>('whitelist-list'),
  whitelistEmpty: requireElement<HTMLElement>('whitelist-empty'),
  customFilters: requireElement<HTMLTextAreaElement>('custom-filters'),
  customFiltersSummary: requireElement<HTMLElement>('custom-filters-summary'),
  customFiltersSkipped: requireElement<HTMLUListElement>('custom-filters-skipped'),
  statYouTube: requireElement<HTMLElement>('stat-youtube'),
  statHidden: requireElement<HTMLElement>('stat-hidden'),
  statPruned: requireElement<HTMLElement>('stat-pruned'),
  resetStats: requireElement<HTMLButtonElement>('reset-stats'),
  savedIndicator: requireElement<HTMLElement>('saved-indicator'),
}

type BooleanSettingPath = 'enabled' | 'blockTrackers' | 'cosmeticFiltering' | `youtube.${keyof Settings['youtube']}`

function readBooleanSetting(settings: Settings, path: BooleanSettingPath): boolean {
  if (path.startsWith('youtube.')) return settings.youtube[path.slice('youtube.'.length) as keyof Settings['youtube']]
  return settings[path as 'enabled' | 'blockTrackers' | 'cosmeticFiltering']
}

function booleanSettingPatch(path: BooleanSettingPath, value: boolean): Partial<Settings> {
  if (path.startsWith('youtube.')) {
    return { youtube: { [path.slice('youtube.'.length)]: value } as unknown as Settings['youtube'] }
  }
  return { [path]: value } as Partial<Settings>
}

let savedTimer: ReturnType<typeof setTimeout> | undefined
function flashSaved(): void {
  elements.savedIndicator.hidden = false
  clearTimeout(savedTimer)
  savedTimer = setTimeout(() => {
    elements.savedIndicator.hidden = true
  }, 1200)
}

function renderToggles(settings: Settings): void {
  for (const input of document.querySelectorAll<HTMLInputElement>('input[data-setting]')) {
    const path = input.dataset.setting as BooleanSettingPath
    input.checked = readBooleanSetting(settings, path)
  }
}

function renderWhitelist(settings: Settings): void {
  elements.whitelistList.replaceChildren(
    ...settings.whitelist.map(hostname => {
      const item = document.createElement('li')
      const label = document.createElement('span')
      label.textContent = hostname
      const remove = document.createElement('button')
      remove.type = 'button'
      remove.className = 'secondary'
      remove.textContent = 'Remove'
      remove.addEventListener('click', async () => {
        const next = await saveSettings({ whitelist: settings.whitelist.filter(entry => entry !== hostname) })
        renderWhitelist(next)
        flashSaved()
      })
      item.append(label, remove)
      return item
    }),
  )
  elements.whitelistEmpty.hidden = settings.whitelist.length > 0
}

function renderCustomFilterPreview(text: string): void {
  const { rules, skipped } = convertAbpFilters(text, { maxRules: CUSTOM_FILTERS_MAX_RULES })
  elements.customFiltersSummary.textContent = text.trim()
    ? `${rules.length} rule${rules.length === 1 ? '' : 's'} active, ${skipped.length} line${skipped.length === 1 ? '' : 's'} skipped.`
    : ''
  elements.customFiltersSkipped.replaceChildren(
    ...skipped.slice(0, 20).map(entry => {
      const item = document.createElement('li')
      item.textContent = `${entry.line} — ${entry.reason}`
      return item
    }),
  )
}

async function renderStats(): Promise<void> {
  const stats = await loadStats()
  elements.statYouTube.textContent = stats.youtubeAdsSkipped.toLocaleString()
  elements.statHidden.textContent = stats.elementsHidden.toLocaleString()
  elements.statPruned.textContent = stats.responsesPruned.toLocaleString()
}

async function main(): Promise<void> {
  let settings = await loadSettings()
  renderToggles(settings)
  renderWhitelist(settings)
  elements.customFilters.value = settings.customFilters
  renderCustomFilterPreview(settings.customFilters)
  await renderStats()

  for (const input of document.querySelectorAll<HTMLInputElement>('input[data-setting]')) {
    input.addEventListener('change', async () => {
      const path = input.dataset.setting as BooleanSettingPath
      settings = await saveSettings(booleanSettingPatch(path, input.checked))
      renderToggles(settings)
      flashSaved()
    })
  }

  elements.whitelistForm.addEventListener('submit', async event => {
    event.preventDefault()
    const hostname = normalizeHostname(elements.whitelistInput.value)
    if (!hostname) {
      elements.whitelistError.textContent = 'Enter a valid hostname such as example.com.'
      elements.whitelistError.hidden = false
      return
    }
    elements.whitelistError.hidden = true
    if (!settings.whitelist.includes(hostname)) {
      settings = await saveSettings({ whitelist: [...settings.whitelist, hostname] })
    }
    elements.whitelistInput.value = ''
    renderWhitelist(settings)
    flashSaved()
  })

  let saveTimer: ReturnType<typeof setTimeout> | undefined
  elements.customFilters.addEventListener('input', () => {
    renderCustomFilterPreview(elements.customFilters.value)
    clearTimeout(saveTimer)
    saveTimer = setTimeout(async () => {
      settings = await saveSettings({ customFilters: elements.customFilters.value })
      flashSaved()
    }, SAVE_DEBOUNCE_MS)
  })

  elements.resetStats.addEventListener('click', async () => {
    await resetStats()
    await renderStats()
    flashSaved()
  })
}

main().catch(error => console.error('options page failed', error))
