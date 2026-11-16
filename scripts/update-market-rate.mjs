#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const dbPath = path.join(REPO_ROOT, 'runtime/data/data.db');
const outXmlPath = path.join(REPO_ROOT, 'runtime/data/market-rate.xml');

const args = process.argv.slice(2);
const rateFlagIndex = args.indexOf('--rate');
const dateFlagIndex = args.indexOf('--date');
const manualRate = rateFlagIndex !== -1 ? Number(args[rateFlagIndex + 1]) : null;
const manualDate = dateFlagIndex !== -1 ? args[dateFlagIndex + 1] : new Date().toISOString().slice(0, 10);

const db = new DatabaseSync(dbPath);

function generateId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 15; i++) id += chars.charAt(Math.floor(Math.random() * chars.length));
  return id;
}

function upsertRate(rate) {
  const dateStr = rate.date.slice(0, 10);
  const existing = db.prepare("SELECT id FROM brass_rates WHERE date LIKE ?").get(dateStr + '%');
  if (existing) {
    db.prepare(`UPDATE brass_rates SET vilaity = ?, honey_gulf = ?, honey_europe = ?, raw_text = ? WHERE id = ?`).run(
      rate.vilaity, rate.honey_gulf || 0, rate.honey_europe || 0, rate.raw_text || '', existing.id
    );
    console.log(`[Rate Sync] Updated ${dateStr}: Vilaity = ${rate.vilaity}`);
  } else {
    const id = generateId();
    db.prepare(`INSERT INTO brass_rates (
      id, date, vilaity, honey_gulf, honey_europe, plant_pass, zinc_9995, delhi_honey, delhi_local, armature,
      mcx_copper, mcx_zinc, lme_3m, usd_inr, weekday, bulletin_time, note, source, rss_link, rss_guid, raw_text,
      jamnagar_trend, honey_gulf_trend, honey_europe_trend, vilaity_trend, zinc_trend, plant_pass_trend, zinc_9995_trend,
      delhi_honey_trend, delhi_local_trend, armature_trend, mcx_status, mcx_copper_trend, mcx_zinc_trend, lme_3m_trend, usd_inr_trend,
      telegram_sent_at, weekly_report_included
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      'neutral', 'neutral', 'neutral', 'neutral', 'neutral', 'neutral', 'neutral',
      'neutral', 'neutral', 'neutral', '', 'neutral', 'neutral', 'neutral', 'neutral',
      '', ''
    )`).run(
      id, `${dateStr} 00:00:00.000Z`, rate.vilaity, rate.honey_gulf || 0, rate.honey_europe || 0,
      rate.plant_pass || 0, rate.zinc_9995 || 0, rate.delhi_honey || 0, rate.delhi_local || 0, rate.armature || 0,
      rate.mcx_copper || 0, rate.mcx_zinc || 0, rate.lme_3m || 0, rate.usd_inr || 0,
      rate.weekday || '', rate.bulletin_time || '10:30 AM', rate.note || 'Manual update',
      rate.source || 'manual', rate.rss_link || '', rate.rss_guid || '', rate.raw_text || ''
    );
    console.log(`[Rate Sync] Inserted new rate ${dateStr}: Vilaity = ${rate.vilaity}`);
  }
}

function regenerateXml() {
  const allRates = db.prepare("SELECT * FROM brass_rates ORDER BY date DESC LIMIT 40").all();
  let itemsXml = '';
  for (const r of allRates) {
    const d = String(r.date || '').slice(0, 10);
    const parts = d.split('-');
    const formattedDate = parts.length === 3 ? `${parts[2]}.${parts[1]}.${parts[0]}` : d;
    const link = r.rss_link || 'https://t.me/brassb2b';
    const guid = r.rss_guid || link || `rate-${d}`;
    let desc = r.raw_text || '';
    if (!desc || !desc.includes('Brass Vilaity')) {
      desc = `♻️ BrassB2B Rate Bulletin ♻️\n\n📆 Date : ${formattedDate}  🕥 10:30 AM\n\n📌Jamnagar (Retail Reference Rates).\nBrass Vilaity. (Local)  :    ${r.vilaity}  +/-\nHoney Gulf.                 :      ${r.honey_gulf} +/-\nHoney Europe/U.K.    :    ${r.honey_europe} +/-`;
    }
    itemsXml += `\n    <item>\n      <title>BrassB2B Rate Bulletin - ${formattedDate}</title>\n      <link>${link}</link>\n      <guid>${guid}</guid>\n      <description><![CDATA[${desc.replace(/\]\]>/g, ']]&gt;')}]]></description>\n    </item>`;
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n  <channel>\n    <title>BrassB2B Rate Bulletin (Local Mirror)</title>\n    <link>https://t.me/brassb2b</link>\n    <description>Daily Jamnagar Brass Scrap Reference Market Rates</description>${itemsXml}\n  </channel>\n</rss>`;
  fs.writeFileSync(outXmlPath, xml, 'utf8');
  console.log(`[Rate Sync] Generated ${outXmlPath} (latest date: ${String(allRates[0]?.date || '').slice(0, 10)}, Vilaity: ${allRates[0]?.vilaity})`);
}

async function main() {
  if (manualRate != null && Number.isFinite(manualRate) && manualRate > 0) {
    const dParts = manualDate.split('-');
    const formatted = dParts.length === 3 ? `${dParts[2]}.${dParts[1]}.${dParts[0]}` : manualDate;
    console.log(`Setting manual rate for ${manualDate}: ₹${manualRate}/kg`);
    upsertRate({
      date: manualDate,
      vilaity: manualRate,
      note: 'Manually updated by operator',
      source: 'manual',
      raw_text: `♻️ BrassB2B Rate Bulletin (Manual) ♻️\n📆 Date : ${formatted}  🕥 10:30 AM\n📌Jamnagar (Retail Reference Rates).\nBrass Vilaity. (Local)  :    ${manualRate}  +/-`
    });
    regenerateXml();
    return;
  }

  // Attempt sync from Telegram web channel with retries
  console.log('Fetching latest bulletin from Telegram channel @brassb2b...');
  let html = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      html = execFileSync('curl.exe', ['-s', '-m', '10', '--tlsv1.3', '--http1.1', 'https://t.me/s/brassb2b'], {
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024
      });
      if (html && html.includes('BrassB2B Rate Bulletin')) {
        break;
      }
    } catch (e) {
      if (attempt < 3) {
        execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Start-Sleep -Milliseconds 1500']);
      }
    }
  }

  if (html) {
    try {
      const messageRegex = /<div class="tgme_widget_message_wrap[\s\S]*?<div class="tgme_widget_message_text js-message_text[^"]*"[^>]*>([\s\S]*?)<\/div>[\s\S]*?<a class="tgme_widget_message_date" href="([^"]+)"/gi;
      let match;
      let synced = 0;
      while ((match = messageRegex.exec(html)) !== null) {
        const text = match[1];
        const link = match[2];
        if (/BrassB2B\s+Rate\s+Bulletin/i.test(text)) {
          const dateMatch = text.match(/Date\s*:\s*(\d{1,2})[./](\d{1,2})[./](\d{4})/i);
          const vilaityMatch = text.match(/(?:Brass\s+)?Vi[la]{2,3}ity(?:\.\s*\(Local\))?[\s\S]{0,40}?:\s*[^0-9]*(\d{3,4})/i);
          const gulfMatch = text.match(/Honey\s+Gulf\.?[\s\S]{0,40}?:\s*[^0-9]*(\d{3,4})/i);
          const europeMatch = text.match(/Honey\s+Europe(?:\/U\.?K\.?)?\.?[\s\S]{0,40}?:\s*[^0-9]*(\d{3,4})/i);

          if (dateMatch && vilaityMatch) {
            const date = `${dateMatch[3]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[1].padStart(2, '0')}`;
            const cleanText = text.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();
            upsertRate({
              date,
              vilaity: Number(vilaityMatch[1]),
              honey_gulf: gulfMatch ? Number(gulfMatch[1]) : 0,
              honey_europe: europeMatch ? Number(europeMatch[1]) : 0,
              raw_text: cleanText,
              source: 'brassb2b_telegram',
              rss_link: link,
              rss_guid: link
            });
            synced++;
          }
        }
      }
      if (synced > 0) {
        console.log(`Synced ${synced} bulletins from Telegram.`);
      }
    } catch (err) {
      console.warn(`Telegram parsing error (${err.message}). Using local cache.`);
    }
  } else {
    console.log('Telegram channel currently unreachable; retained local rate history.');
  }

  regenerateXml();
}

main().catch(err => {
  console.error('Update failed:', err);
  process.exit(1);
});
