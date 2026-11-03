#!/usr/bin/env node
// One-time helper: generate a TELEGRAM_SESSION string for local RSSHub.
// Usage: node scripts/telegram-session.mjs <api_id> <api_hash>
import readline from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { TelegramClient } from 'teleproto'
import { StringSession } from 'teleproto/sessions/index.js'
import authMethods from 'teleproto/client/methods/auth.js'

// teleproto's update manager can emit AUTH_KEY_UNREGISTERED from a background
// loop before the interactive login finishes — swallow it, we don't need updates.
const swallowable = (error) => {
  const code = error?.errorMessage
  return code && ['AUTH_KEY_UNREGISTERED', 'SESSION_EXPIRED', 'SESSION_REVOKED', 'AUTH_KEY_INVALID', 'AUTH_KEY_DUPLICATED'].includes(code)
}
process.on('unhandledRejection', (error) => {
  if (swallowable(error)) { console.error('(suppressed background auth noise, continuing)'); return }
  console.error('Unexpected background error:', error)
  process.exit(2)
})
process.on('uncaughtException', (error) => {
  if (swallowable(error)) { console.error('(suppressed background auth noise, continuing)'); return }
  console.error('Unexpected error:', error)
  process.exit(2)
})

const [apiIdArg, apiHash] = process.argv.slice(2)
if (!apiIdArg || !apiHash) {
  console.error('Usage: node scripts/telegram-session.mjs <api_id> <api_hash>')
  process.exit(1)
}
const rl = readline.createInterface({ input: stdin, output: stdout })

const client = new TelegramClient(new StringSession(''), Number(apiIdArg), apiHash, {
  connectionRetries: 3,
})
await client.connect()
console.log('Connected to Telegram. It will now send a login code to your account...')

try {
  // signInUser drives the whole flow itself: sends the code, asks for it via
  // the phoneCode callback, handles 2FA via the password callback, and retries.
  await authMethods.signInUser(
    client,
    { apiId: Number(apiIdArg), apiHash },
    {
      phoneNumber: async () => await rl.question('Your phone number (e.g. +91XXXXXXXXXX): '),
      phoneCode: async () => await rl.question('Code you received in the Telegram app: '),
      password: async () => {
        const has2fa = await rl.question('Do you have a 2FA password? (y/N): ')
        if (!/^y/i.test(has2fa.trim())) return null
        return await rl.question('2FA password: ')
      },
      onError: async (error) => {
        console.error('Login attempt note: ' + (error?.message || error) + ' — retrying. ')
        return false
      },
    },
  )
  console.log('\n=== SUCCESS ===')
  console.log('TELEGRAM_SESSION (copy the whole line):')
  console.log(client.session.save())
  console.log('\nYou can close this window. Do not share this session string with anyone.')
} catch (error) {
  console.error('\nLogin did not complete:', error?.message || error)
  console.log('Run the script again.')
}
await client.disconnect()
rl.close()
