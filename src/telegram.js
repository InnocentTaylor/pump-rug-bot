import TelegramBot from 'node-telegram-bot-api';

export function createBot(token) {
  return new TelegramBot(token, { polling: false });
}

// Telegram enforces its own flood limit per chat — sending several alerts
// back-to-back can get silently rejected. This queue paces outgoing
// messages and retries automatically if Telegram asks us to wait, so a
// real alert never just vanishes.
const queue = [];
let processing = false;
const MIN_INTERVAL_MS = 1200;

async function processQueue() {
  if (processing) return;
  processing = true;
  while (queue.length > 0) {
    const job = queue.shift();
    await trySend(job);
    await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS));
  }
  processing = false;
}

async function trySend({ bot, chatId, text, attempt = 1 }) {
  try {
    await bot.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      disable_web_page_preview: false,
    });
  } catch (err) {
    const retryAfterSec = err?.response?.body?.parameters?.retry_after;
    if (retryAfterSec && attempt <= 3) {
      console.warn(`Telegram asked us to wait ${retryAfterSec}s — retrying alert`);
      await new Promise((r) => setTimeout(r, retryAfterSec * 1000));
      await trySend({ bot, chatId, text, attempt: attempt + 1 });
    } else {
      console.error('Failed to send Telegram alert:', err.message);
    }
  }
}

export async function sendAlert(bot, chatId, text) {
  queue.push({ bot, chatId, text });
  processQueue();
}
