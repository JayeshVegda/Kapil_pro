import { describe, expect, it } from 'vitest'
import {
  formatRateAlertMessage,
  formatRateAnalyticsMessage,
  parseBrassBulletinsFromRss,
  parseBrassBulletinFromRss,
} from './brass-bulletin.mjs'

const rssSample = `<?xml version="1.0"?>
<rss version="2.0">
<channel>
<item>
<title>🖼 ♻️ BrassB2B Rate Bulletin ♻️</title>
<description><p><span class="emoji">♻️</span> BrassB2B Rate Bulletin <span class="emoji">♻️</span><br><br><span class="emoji">📆</span> Date : 23.05.2026&nbsp; <span class="emoji">🕥</span> 10:30 AM Saturday.<br><br><br><span class="emoji">📌</span>Jamnagar&nbsp;(Retail Reference Rates)<br>Brass&nbsp; Scrap <span class="emoji">⬆️</span><br>Honey Gulf.&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; &nbsp;&nbsp; :&nbsp;&nbsp;&nbsp; &nbsp;826 +/-<br>Honey Europe/U.K.&nbsp;&nbsp;&nbsp; :&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; 831 +/-<br>Brass Vilaity. (Local)&nbsp;&nbsp; :&nbsp;&nbsp;&nbsp;&nbsp; 795 +/-<br><br>Zinc Ingots <span class="emoji">⬆️</span><br>Plant Pass&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; :&nbsp;&nbsp;&nbsp; 334 +/-<br>Zinc 99.95&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; :&nbsp;&nbsp; 380 +/-<br><br><span class="emoji">📌</span> Delhi <br>Brass<br>Honey : 818 <span class="emoji">⬆️</span><br>Local&nbsp;&nbsp; :&nbsp; 769 <span class="emoji">⬆️</span><br><br>Copper&nbsp; <br>Armature :&nbsp;1222 <span class="emoji">⬆️</span><br>Source : Markethub<br><br><span class="emoji">📌</span> MCX Friday Closed <br>Copper&nbsp; :&nbsp; 1344.30 <span class="emoji">⬇️</span><br>Zinc&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; :&nbsp;&nbsp;&nbsp; 370.25 <span class="emoji">⬇️</span><br><br><br><span class="emoji">📊</span> LME&nbsp;3M :&nbsp; 13669 <span class="emoji">↔️</span><br><span class="emoji">💰</span>$/₹&nbsp; :&nbsp; 95.69 <span class="emoji">⬇️</span><br><br><span class="emoji">👉</span> GST&nbsp; Extra</p></description>
<link>https://t.me/brassb2b/2637</link>
<guid isPermaLink="false">https://t.me/brassb2b/2637</guid>
<pubDate>Sat, 23 May 2026 05:00:01 GMT</pubDate>
</item>
</channel>
</rss>`

describe('brass bulletin parser', () => {
  it('parses all structured fields from the latest BrassB2B RSS bulletin', () => {
    const parsed = parseBrassBulletinFromRss(rssSample)

    expect(parsed).toMatchObject({
      date: '2026-05-23',
      bulletin_time: '10:30 AM',
      weekday: 'Saturday',
      rss_guid: 'https://t.me/brassb2b/2637',
      rss_link: 'https://t.me/brassb2b/2637',
      jamnagar_trend: 'up',
      honey_gulf: 826,
      honey_gulf_trend: 'neutral',
      honey_europe: 831,
      honey_europe_trend: 'neutral',
      vilaity: 795,
      vilaity_trend: 'neutral',
      zinc_trend: 'up',
      plant_pass: 334,
      plant_pass_trend: 'neutral',
      zinc_9995: 380,
      zinc_9995_trend: 'neutral',
      delhi_honey: 818,
      delhi_honey_trend: 'up',
      delhi_local: 769,
      delhi_local_trend: 'up',
      armature: 1222,
      armature_trend: 'up',
      mcx_status: 'Friday Closed',
      mcx_copper: 1344.3,
      mcx_copper_trend: 'down',
      mcx_zinc: 370.25,
      mcx_zinc_trend: 'down',
      lme_3m: 13669,
      lme_3m_trend: 'flat',
      usd_inr: 95.69,
      usd_inr_trend: 'down',
    })
    expect(parsed.raw_text).toContain('BrassB2B Rate Bulletin')
  })

  it('formats the daily Telegram alert with previous-day comparison', () => {
    const parsed = parseBrassBulletinFromRss(rssSample)
    const message = formatRateAlertMessage(parsed, {
      date: '2026-05-21',
      vilaity: 794,
      honey_gulf: 825,
      honey_europe: 830,
    })

    expect(message).toContain('Brass Rates Update')
    expect(message).toContain('23 May')
    expect(message).toContain('Vilaity')
    expect(message).toContain('795')
    expect(message).toContain('▲ +1')
    expect(message).toContain('Honey Europe')
  })

  it('formats analytics windows from historical rows', () => {
    const parsed = parseBrassBulletinFromRss(rssSample)
    const message = formatRateAnalyticsMessage(parsed, [
      { date: '2026-04-23', vilaity: 767, honey_gulf: 796, honey_europe: 802 },
      { date: '2026-05-16', vilaity: 792, honey_gulf: 820, honey_europe: 825 },
      { date: '2026-05-20', vilaity: 792, honey_gulf: 820, honey_europe: 825 },
    ])

    expect(message).toContain('Price Change Analysis')
    expect(message).toContain('3 Days')
    expect(message).toContain('7 Days')
    expect(message).toContain('30 Days')
    expect(message).toContain('▲ +3')
  })

  it('parses RSSHub escaped HTML entities around labels and numbers', () => {
    const escapedRss = rssSample
      .replaceAll('<p>', '&lt;p&gt;')
      .replaceAll('</p>', '&lt;/p&gt;')
      .replaceAll('<br>', '&lt;br&gt;')
      .replaceAll('&nbsp;', '&amp;nbsp;')

    const parsed = parseBrassBulletinFromRss(escapedRss)

    expect(parsed?.vilaity).toBe(795)
    expect(parsed?.honey_gulf).toBe(826)
    expect(parsed?.usd_inr).toBe(95.69)
  })

  it('parses all bulletin items from an RSS feed for backfills', () => {
    const twoItemFeed = rssSample.replace('</channel>', rssSample.match(/<item>[\s\S]*<\/item>/)?.[0].replace('23.05.2026', '21.05.2026').replace('795', '794') + '</channel>')

    const rows = parseBrassBulletinsFromRss(twoItemFeed)

    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.date)).toEqual(['2026-05-23', '2026-05-21'])
  })
})
