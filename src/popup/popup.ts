import { displayHostname, getHostnameFromUrl, isHostWhitelisted, normalizeHostname } from '../shared/hostname.ts'
import { loadSettings, loadStats, saveSettings, type Settings } from '../shared/settings.ts'

interface ActiveTab {
  id: number
  hostname: string | null
}

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id)
  if (!element) throw new Error(`popup element #${id} missing`)
  return element as T
}

const elements = {
  globalToggle: requireElement<HTMLInputElement>('global-toggle'),
  siteSection: requireElement<HTMLElement>('site-section'),
  noSiteSection: requireElement<HTMLElement>('no-site-section'),
  siteStatusLabel: requireElement<HTMLElement>('site-status-label'),
  siteHost: requireElement<HTMLElement>('site-host'),
  siteToggle: requireElement<HTMLInputElement>('site-toggle'),
  reloadButton: requireElement<HTMLButtonElement>('reload-button'),
  statBlocked: requireElement<HTMLElement>('stat-blocked'),
  statYouTube: requireElement<HTMLElement>('stat-youtube'),
  statHidden: requireElement<HTMLElement>('stat-hidden'),
  pausedBanner: requireElement<HTMLElement>('paused-banner'),
  optionsButton: requireElement<HTMLButtonElement>('options-button'),
}

async function getActiveTab(): Promise<ActiveTab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) return null
  return { id: tab.id, hostname: getHostnameFromUrl(tab.url) }
}

/**
 * Opening the popup grants activeTab for the current tab, which is what getMatchedRules
 * needs. The badge text is a placeholder without declarativeNetRequestFeedback, which is
 * ignored for Web Store installs anyway, so the matched-rule list is the reliable source.
 */
async function readBlockedCount(tabId: number): Promise<string> {
  try {
    const { rulesMatchedInfo } = await chrome.declarativeNetRequest.getMatchedRules({ tabId })
    return String(rulesMatchedInfo.length)
  } catch {
    return '–'
  }
}

function render(settings: Settings, tab: ActiveTab | null): void {
  elements.globalToggle.checked = settings.enabled
  elements.pausedBanner.hidden = settings.enabled

  const hostname = tab?.hostname ?? null
  elements.siteSection.hidden = !hostname
  elements.noSiteSection.hidden = Boolean(hostname)
  if (!hostname) return

  const whitelisted = isHostWhitelisted(hostname, settings.whitelist)
  elements.siteHost.textContent = displayHostname(hostname)
  elements.siteToggle.checked = !whitelisted
  elements.siteToggle.disabled = !settings.enabled
  elements.siteStatusLabel.textContent = whitelisted ? 'Paused on' : 'Blocking on'
}

async function refreshStats(tab: ActiveTab | null): Promise<void> {
  const stats = await loadStats()
  elements.statYouTube.textContent = stats.youtubeAdsSkipped.toLocaleString()
  elements.statHidden.textContent = stats.elementsHidden.toLocaleString()
  elements.statBlocked.textContent = tab ? await readBlockedCount(tab.id) : '–'
}

async function toggleWhitelist(settings: Settings, hostname: string): Promise<Settings> {
  const entry = normalizeHostname(hostname)
  if (!entry) return settings
  const whitelisted = isHostWhitelisted(hostname, settings.whitelist)
  const whitelist = whitelisted
    ? settings.whitelist.filter(item => entry !== item && !entry.endsWith(`.${item}`))
    : [...settings.whitelist, entry]
  return saveSettings({ whitelist })
}

async function main(): Promise<void> {
  let settings = await loadSettings()
  const tab = await getActiveTab()
  render(settings, tab)
  await refreshStats(tab)

  elements.globalToggle.addEventListener('change', async () => {
    settings = await saveSettings({ enabled: elements.globalToggle.checked })
    render(settings, tab)
    elements.reloadButton.hidden = false
  })

  elements.siteToggle.addEventListener('change', async () => {
    if (!tab?.hostname) return
    settings = await toggleWhitelist(settings, tab.hostname)
    render(settings, tab)
    elements.reloadButton.hidden = false
  })

  elements.reloadButton.addEventListener('click', async () => {
    if (tab) await chrome.tabs.reload(tab.id)
    window.close()
  })

  elements.optionsButton.addEventListener('click', () => {
    void chrome.runtime.openOptionsPage()
  })
}

main().catch(error => console.error('popup failed', error))
