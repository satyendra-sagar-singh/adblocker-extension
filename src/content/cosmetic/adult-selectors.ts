/**
 * Element-hiding selectors for adult video sites, taken from EasyList Adult
 * (easylist_adult/adult_specific_hide.txt) and AdGuard Base. Only plain CSS selectors are
 * included; procedural filters and the broad anti-circumvention catch-alls
 * (e.g. [style*="base64"], img[srcset]) are left out so page content is never hidden.
 */

const TRAFFICJUNKY_NETWORK = [
  '#pb_template',
  '.upgradeButtonContainer',
  'a[class*="gtm-event-header-paidtabs"]',
  'a[href^="https://ads.trafficjunky.net/"]',
  'div:has(> ins.adsbytrafficjunky)',
]

const TUBE8 = [
  ...TRAFFICJUNKY_NETWORK,
  '.paidTab',
  'ins[data-spot]',
  'a[href*="/info.html#advertising"]',
]

const XVIDEOS_NETWORK = ['#ad-footer', '.thumb-ad', '.e-banner-game']

const TNAFLIX_NETWORK = ['.bannerBlock', '.mewBlock', '.nav-livesex', '.pause-overlay']

const DRTUBER_NETWORK = ['.drt-sponsor-block', '.drt-spot-box']

export const ADULT_HOST_SELECTORS: Readonly<Record<string, readonly string[]>> = {
  'pornhub.com': [
    ...TRAFFICJUNKY_NETWORK,
    '.js_promoItem',
    '.realsex',
    '.sideAds',
    '#customSkin',
    '#customSkinCTA',
    'a[data-event="header_paid_tabs"]',
    'a[href*=".com/smartpop/"]',
  ],
  'youporn.com': [...TRAFFICJUNKY_NETWORK, 'aside:has(a.ad-remove)', '.js_paidTab:has(> .js_tracking-link)'],
  'redtube.com': [
    ...TRAFFICJUNKY_NETWORK,
    '#pb_block',
    '#popsByTrafficJunky',
    '#live_models_row_wrap',
    '#show_page_streamate',
    '#top_main_menu > li > a[id^="paid_tab_"]',
    '.paid-tabs-information',
    '.search_upper_right_ad',
  ],
  'tube8.com': TUBE8,
  'tube8.es': TUBE8,
  'tube8.fr': TUBE8,
  'xvideos.com': [...XVIDEOS_NETWORK, '#video-right', '#video-sponsor-links', '.player-video.xv-cams-block', '.video-ad'],
  'xnxx.com': [...XVIDEOS_NETWORK, '.ad-footer', '#content-ad-side'],
  'xhamster.com': [
    '.auto-generated-banner-container',
    '.player-add-overlay',
    '.promo-message',
    '.video-view-ads',
    '.clipstore-bottom',
    '.wio-p',
    '.wio-pcam-thumb',
    '.wio-psp-b',
    '.wio-xbanner',
    '.wixx-ebanner',
    '.wixx-ecam-thumb',
    '.wixx-ecams-widget',
    '.yfd-fdcam-thumb',
    '.yfd-fdcams-widget',
    '.yfd-fdclipstore-bottom',
    '.yfd-fdsp-b',
    '.yld-mdcam-thumb',
    '.yld-mdsp-b',
  ],
  'spankbang.com': [
    '.js-inline-ad',
    '.live-rotate',
    '.livecam-rotate',
    '.ad_button',
    '.vjs-paused-banner-ad-container',
    '.ptgncdn_holder',
    '.ptgncdn_holder_haeder',
    'a[href^="https://deliver.ptgncdn.com/"]',
    'iframe[src^="https://deliver.ptgncdn.com/"]',
    'a[data-testid="header-live-cam-link"]',
  ],
  'eporner.com': [
    '#addesktop',
    '#admobileoutstream',
    '#adstripe',
    '#deskadmiddle',
    '#movieplayer-box-adv',
    '.ad300px',
    '.mb:has(> .adnative-1x1)',
  ],
  'youjizz.com': ['#englishPr', '#onPausePrOverlay', '#rightVideoPrs', 'a[href^="//s.zlink7.com/d.php"]'],
  'tnaflix.com': [...TNAFLIX_NETWORK, '#ads-under-video_', '.pspBanner', '.rbsd'],
  'empflix.com': TNAFLIX_NETWORK,
  'drtuber.com': [...DRTUBER_NETWORK, '#video_list_banner', '.item_spots', '.spot_button_m', '.spots', '.title-sponsored', 'a[href^="/partner/"]'],
  'nuvid.com': DRTUBER_NETWORK,
}
