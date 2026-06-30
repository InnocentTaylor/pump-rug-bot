import 'dotenv/config';
import { Connection } from '@solana/web3.js';
import { startPumpListener } from './src/pumpListener.js';
import { getMintRisk } from './src/solanaChecks.js';
import { computeRugScore } from './src/rugScore.js';
import { createBot, sendAlert } from './src/telegram.js';
import { logDecision } from './src/logger.js';

const {
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  SOLANA_RPC_URL = 'https://api.mainnet-beta.solana.com',
  ALERT_MAX_SCORE = '40',
  MAX_DEV_HOLD_PERCENT = '15',
  MAX_TOP10_HOLD_PERCENT = '40',
  MIN_MARKET_CAP_SOL = '3',
} = process.env;

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  console.error('Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID — check your .env');
  process.exit(1);
}

const thresholds = {
  maxDevHoldPercent: Number(MAX_DEV_HOLD_PERCENT),
  maxTop10HoldPercent: Number(MAX_TOP10_HOLD_PERCENT),
  minMarketCapSol: Number(MIN_MARKET_CAP_SOL),
};
const alertMaxScore = Number(ALERT_MAX_SCORE);

const connection = new Connection(SOLANA_RPC_URL, 'confirmed');
const bot = createBot(TELEGRAM_BOT_TOKEN);
const pumpEvents = startPumpListener();

console.log('Watching pump.fun for new launches...');

pumpEvents.on('newToken', async (token) => {
  const { mint, name, symbol, marketCapSol, initialBuy } = token;

  try {
    // Give the chain a few seconds to finalize the create + initial buy
    // before reading mint/holder state.
    await new Promise((r) => setTimeout(r, 4000));

    const risk = await getMintRisk(connection, mint);

    // Estimate the creator's share of supply from their initial buy.
    const supplyUi = Number(risk.supply) / 10 ** risk.decimals;
    const devHoldPercent =
      supplyUi > 0 ? (Number(initialBuy || 0) / supplyUi) * 100 : 0;

    const { score, flags } = computeRugScore({
      mintAuthorityRenounced: risk.mintAuthorityRenounced,
      freezeAuthorityRenounced: risk.freezeAuthorityRenounced,
      devHoldPercent,
      top10HoldPercent: risk.top10HoldPercent,
      marketCapSol: marketCapSol || 0,
      thresholds,
    });

    const alerted = score <= alertMaxScore;

    // Log every coin checked — both alerted and skipped — for later review.
    logDecision({
      mint,
      name,
      symbol,
      score,
      flags,
      devHoldPercent,
      top10HoldPercent: risk.top10HoldPercent,
      marketCapSol: marketCapSol || 0,
      alerted,
    });

    console.log(`${symbol || mint} — score ${score}`, flags);

    if (alerted) {
      const message = formatAlert({ mint, name, symbol, score, flags, marketCapSol });
      await sendAlert(bot, TELEGRAM_CHAT_ID, message);
    }
  } catch (err) {
    console.error(`Failed to evaluate ${mint}:`, err.message);
  }
});

function formatAlert({ mint, name, symbol, score, flags, marketCapSol }) {
  const safety = score <= 20 ? '🟢 Low risk signals' : '🟡 Moderate risk signals';
  const flagList = flags.length
    ? flags.map((f) => `• ${f}`).join('\n')
    : '• No major red flags detected';

  return [
    `*New launch:* ${name || 'Unknown'} (${symbol || '?'})`,
    `*Rug score:* ${score}/100 — ${safety}`,
    flagList,
    `*Market cap:* ${(marketCapSol || 0).toFixed(2)} SOL`,
    `[GMGN](https://gmgn.ai/sol/token/${mint}) | [pump.fun](https://pump.fun/${mint})`,
  ].join('\n');
}
