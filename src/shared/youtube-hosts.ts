/** Hosts on which the YouTube-specific scripts and styles are injected. */
export const YOUTUBE_HOSTS = [
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'www.youtube-nocookie.com',
  'www.youtubekids.com',
] as const

export const YOUTUBE_MATCH_PATTERNS = YOUTUBE_HOSTS.map(host => `*://${host}/*`)

export function isYouTubeHost(hostname: string | null): boolean {
  if (!hostname) return false
  return hostname === 'youtube.com' || hostname.endsWith('.youtube.com') || hostname.endsWith('.youtube-nocookie.com') || hostname.endsWith('.youtubekids.com')
}
