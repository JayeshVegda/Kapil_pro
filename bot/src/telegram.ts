import { env } from './env.js'
import { splitTelegramHtml } from './format.js'

type TelegramUser = {
  id: number
  first_name?: string
  username?: string
}

type TelegramMessage = {
  message_id: number
  chat: { id: number }
  from?: TelegramUser
  text?: string
}

export type TelegramUpdate = {
  update_id: number
  message?: TelegramMessage
}

type TelegramResponse<T> = {
  ok: boolean
  result?: T
  description?: string
}

export class TelegramClient {
  private readonly baseUrl = `https://api.telegram.org/bot${env.telegramToken}`

  async getUpdates(offset: number) {
    const url = new URL(`${this.baseUrl}/getUpdates`)
    url.searchParams.set('timeout', String(env.pollTimeoutSeconds))
    if (offset > 0) url.searchParams.set('offset', String(offset))
    url.searchParams.set('allowed_updates', JSON.stringify(['message']))
    const response = await fetch(url)
    const body = (await response.json()) as TelegramResponse<TelegramUpdate[]>
    if (!body.ok) throw new Error(body.description || 'Telegram getUpdates failed')
    return body.result ?? []
  }

  async sendMessage(chatId: number, html: string) {
    for (const chunk of splitTelegramHtml(html)) {
      const response = await fetch(`${this.baseUrl}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: chunk,
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
        }),
      })
      const body = (await response.json()) as TelegramResponse<unknown>
      if (!body.ok) throw new Error(body.description || 'Telegram sendMessage failed')
    }
  }

  async sendPhoto(chatId: number, image: Buffer, filename: string, captionHtml: string) {
    const form = new FormData()
    form.set('chat_id', String(chatId))
    form.set('photo', new Blob([new Uint8Array(image)], { type: 'image/jpeg' }), filename)
    form.set('caption', captionHtml)
    form.set('parse_mode', 'HTML')
    const response = await fetch(`${this.baseUrl}/sendPhoto`, {
      method: 'POST',
      body: form,
    })
    const body = (await response.json()) as TelegramResponse<unknown>
    if (!body.ok) throw new Error(body.description || 'Telegram sendPhoto failed')
  }
}

export function getMessageText(update: TelegramUpdate) {
  return update.message?.text?.trim() ?? ''
}

export function getChatId(update: TelegramUpdate) {
  return update.message?.chat.id ?? 0
}

export function isAllowed(update: TelegramUpdate) {
  if (env.allowAllUsers) return true
  const userId = update.message?.from?.id
  return Boolean(userId && env.allowedUserIds.has(userId))
}
