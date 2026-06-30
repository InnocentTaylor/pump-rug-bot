import TelegramBot from 'node-telegram-bot-api';

export function createBot(token) {
  // polling: false — this bot only sends alerts, it doesn't need to receive commands
  return new TelegramBot(token, { polling: false });
}

export async function sendAlert(bot, chatId, text) {
  try {
    await bot.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      disable_web_page_preview: false,
    });
  } catch (err) {
    console.error('Failed to send Telegram alert:', err.message);
  }
}
