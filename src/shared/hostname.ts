const HOSTNAME_PATTERN = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/

/** Extracts a lowercase hostname from a URL; null for non-http(s) URLs. */
export function getHostnameFromUrl(url: string | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.hostname.toLowerCase()
  } catch {
    return null
  }
}

/**
 * Accepts "Example.com", "https://example.com/path", "example.com:8080" or "www.example.com"
 * and returns a canonical hostname, or null when the input is not a valid host.
 */
export function normalizeHostname(input: string): string | null {
  const trimmed = input.trim().toLowerCase()
  if (!trimmed) return null

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`
  const hostname = getHostnameFromUrl(withScheme)
  if (!hostname) return null

  const stripped = hostname.replace(/^www\./, '').replace(/\.$/, '')
  return HOSTNAME_PATTERN.test(stripped) ? stripped : null
}

export function isValidHostname(hostname: string): boolean {
  return HOSTNAME_PATTERN.test(hostname)
}

/** A hostname is covered by a whitelist entry when it equals the entry or is a subdomain of it. */
export function isHostWhitelisted(hostname: string | null, whitelist: readonly string[]): boolean {
  if (!hostname) return false
  const host = hostname.toLowerCase().replace(/^www\./, '')
  return whitelist.some(entry => host === entry || host.endsWith(`.${entry}`))
}

/** Match patterns covering a host and all of its subdomains. */
export function hostToMatchPatterns(hostname: string): string[] {
  return [`*://${hostname}/*`, `*://*.${hostname}/*`]
}

/** The label shown in the popup: the registrable-looking part of the host without "www.". */
export function displayHostname(hostname: string): string {
  return hostname.replace(/^www\./, '')
}
