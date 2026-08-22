#!/usr/bin/env node
import { spawn } from 'node:child_process'

const TZ = process.env.BRASS_DAEMON_TZ || 'Asia/Kolkata'
const WINDOW_START = parseClock(process.env.BRASS_DAEMON_WINDOW_START || '10:20')
const WINDOW_END = parseClock(process.env.BRASS_DAEMON_WINDOW_END || '10:50')
const ACTIVE_INTERVAL_MS = seconds(process.env.BRASS_DAEMON_ACTIVE_INTERVAL_SECONDS || '120')
const IDLE_INTERVAL_MS = seconds(process.env.BRASS_DAEMON_IDLE_INTERVAL_SECONDS || '900')
const WATCHER_PATH = process.env.BRASS_RSS_WATCHER_PATH || 'scripts/brass-rss-watch.mjs'
const REQUIRE_TODAY = process.env.BRASS_DAEMON_REQUIRE_TODAY !== 'false'

let lastCheckedMinute = ''

main().catch((error) => {
  console.error('Brass RSS daemon failed:', error?.message || error)
  process.exit(1)
})

async function main() {
  console.log(`Brass RSS daemon started. Window ${clockText(WINDOW_START)}-${clockText(WINDOW_END)} ${TZ}.`)

  for (;;) {
    const now = zonedNow(TZ)
    if (isWithinWindow(now, WINDOW_START, WINDOW_END)) {
      const minuteKey = `${now.year}-${now.month}-${now.day}T${pad2(now.hour)}:${pad2(now.minute)}`
      if (minuteKey !== lastCheckedMinute) {
        lastCheckedMinute = minuteKey
        await runWatcher()
      }
      await sleep(ACTIVE_INTERVAL_MS)
      continue
    }

    await sleep(msUntilNextWindow(now, WINDOW_START, IDLE_INTERVAL_MS))
  }
}

function runWatcher() {
  return new Promise((resolve) => {
    const args = REQUIRE_TODAY ? [WATCHER_PATH, '--require-today'] : [WATCHER_PATH]
    const child = spawn(process.execPath, args, {
      stdio: 'inherit',
      env: process.env,
    })
    child.on('error', (error) => {
      console.error('Unable to start brass watcher:', error?.message || error)
      resolve()
    })
    child.on('exit', (code, signal) => {
      if (code || signal) {
        console.error(`Brass watcher exited with ${signal || `code ${code}`}. Will retry in the next interval.`)
      }
      resolve()
    })
  })
}

function isWithinWindow(now, start, end) {
  const minutes = now.hour * 60 + now.minute
  return minutes >= start.minutes && minutes <= end.minutes
}

function msUntilNextWindow(now, start, fallbackMs) {
  const currentMinutes = now.hour * 60 + now.minute
  const startMinutes = start.minutes
  const minutesUntilStart = currentMinutes < startMinutes
    ? startMinutes - currentMinutes
    : (24 * 60) - currentMinutes + startMinutes
  const ms = Math.max(30_000, minutesUntilStart * 60_000)
  return Math.min(ms, fallbackMs)
}

function zonedNow(timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date())

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: Number(values.hour),
    minute: Number(values.minute),
  }
}

function parseClock(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/)
  if (!match) throw new Error(`Invalid clock time: ${value}`)
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) throw new Error(`Invalid clock time: ${value}`)
  return { hour, minute, minutes: hour * 60 + minute }
}

function seconds(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return 60_000
  return parsed * 1000
}

function clockText(clock) {
  return `${pad2(clock.hour)}:${pad2(clock.minute)}`
}

function pad2(value) {
  return String(value).padStart(2, '0')
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
