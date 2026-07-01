import 'dotenv/config';
import { Connection } from '@solana/web3.js';
import { startPumpListener } from './src/pumpListener.js';
import { getMintRisk } from './src/solanaChecks.js';
import { computeRugScore } from './src/rugScore.js';
import { createBot, sendAlert } from './src/telegram.js';
import { logDecision, markGraduated } from './src/logger.js';
import { fetchTokenMetadata } from './src/metadata.js';

const {
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  SOLANA_RPC_URL = 'https://api.mainnet-beta.solana.com',
  ALERT_MAX_SCORE = '30',
  MAX_DEV_HOLD_PERCENT = '15',
  MAX_TOP10_HOLD_PERCENT = '40',
  MAX_PRICE_ABOVE_BASELINE_PERCENT = '25',
  MIN_PERCENT_BOUGHT_TO_ALERT = '3',
  EVALUATION_DELAY_MS = '20000',
  REQUIRE_SOCIAL_LINK = 'true',
} = process.env;

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  console.error('Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID — check your .env');
  process.exit(1);
}

const thresholds = {
  maxDevHoldPercent: Number(MAX_DEV_HOLD_PERCENT),
  maxTop10HoldPercent: Number(MAX_TOP10_HOLD_PERCENT),
  maxPriceAboveBaselinePercent: Number(MAX_PRICE_ABOVE_BASELINE_PERCENT),
};
const alertMaxScore = Number(ALERT_MAX_SCORE);
const minPercentBoughtToAlert = Number(MIN_PERCENT_BOUGHT_TO_ALERT);
const evaluationDelayMs = Number(EVALUATION_DELAY_MS);
const requireSocialLink = REQUIRE_SOCIAL_LINK === 'true';

const connection = new Connection(SOLANA_RPC_URL, 'confirmed');
const bot = createBot(TELEGRAM_BOT_TOKEN);
const pumpEvents = startPumpListener();

console.log('Watching pump.fun for new launches...');

function escapeMarkdown(text) {
  if (!text) return text;
  return String(text).replace(/([_*`[\]])/g, '\\$1');
}

const seenMints = new Set();

pumpEvents.on('newToken', async (token) => {
  const { mint, name, symbol, marketCapSol, initialBuy, bondingCurveKey, uri } = token;

  if (seenMints.has(mint)) return;
  seenMints.add(mint);

  try {
    await new Promise((r) => setTimeout(r, evaluationDelayMs));

    const [risk, metadata] = await Promise.all([
      getMintRisk(connection, mint, bondingCurveKey),
      fetchTokenMetadata(uri),
    ]);

    const supplyUi = Number(risk.supply) / 10 ** risk.decimals;
    const devHoldPercent =
      supplyUi > 0 ? (Number(initialBuy || 0) / supplyUi) * 100 : 0;

    const { score, flags } = computeRugScore({
      mintAuthorityRenounced: risk.mintAuthorityRenounced,
      freezeAuthorityRenounced: risk.freezeAuthorityRenounced,
      devHoldPercent,
      top10HoldPercent: risk.top10HoldPercent,
      percentBought: risk.percentBought,
      marketCapSol: marketCapSol || 0,
      thresholds,
    });

    const hasAnySocial = metadata.hasTwitter || metadata.hasWebsite || metadata.hasTelegram;

    const scoreQualifies = score <= alertMaxScore;
    const hasRealBuying = risk.percentBought >= minPercentBoughtToAlert;
    const socialRequirementMet = !requireSocialLink || hasAnySocial;

    const alerted = scoreQualifies && hasRealBuying && socialRequirementMet;

    if (!socialRequirementMet) {
      flags.push('Skipped alert — no social links provided (X/website/Telegram all missing)');
    } else if (scoreQualifies && !hasRealBuying) {
      flags.push(`Skipped alert — only ${risk.percentBought.toFixed(2)}% bought (need ${minPercentBoughtToAlert}%)`);
    }

    logDecision({
      mint,
      name,
      symbol,
      score,
      flags,
      devHoldPercent,
      top10HoldPercent: risk.top10HoldPercent,
      percentBought: risk.percentBought,
      marketCapSol: marketCapSol || 0,
      hasAnySocial,
      alerted,
    });

    console.log(`${symbol || mint} — score ${score}`, flags);

    if (alerted) {
      const message = formatAlert({ mint, name, symbol, score, flags, marketCapSol, metadata });
      await sendAlert(bot, TELEGRAM_CHAT_ID, message);
    }
  } catch (err) {
    console.error(`Failed to evaluate ${mint}:`, err?.message, JSON.stringify(err, Object.getOwnPropertyNames(err || {})));
  }
});

pumpEvents.on('tokenGraduated', (data) => {
  console.log('GRADUATION EVENT RECEIVED:', JSON.stringify(data));
  if (data.mint) {
    markGraduated(data.mint);
  }
});

function formatAlert({ mint, name, symbol, score, flags, marketCapSol, metadata }) {
  const safety = score <= 15 ? '🟢 Low risk signals' : '🟡 Moderate risk signals';
  const flagList = flags.length
    ? flags.map((f) => `• ${f}`).join('\n')
    : '• No major red flags detected';

  const safeName = escapeMarkdown(name) || 'Unknown';
  const safeSymbol = escapeMarkdown(symbol) || '?';

  const socialLines = [];
  if (metadata?.twitter) socialLines.push(`[X/Twitter](${metadata.twitter})`);
  if (metadata?.website) socialLines.push(`[Website](${metadata.website})`);
  if (metadata?.telegram) socialLines.push(`[Telegram](${metadata.telegram})`);
  const socialsText = socialLines.length ? socialLines.join(' | ') : 'None provided';

  return [
    `*New launch:* ${safeName} (${safeSymbol})`,
    `*Rug score:* ${score}/100 — ${safety}`,
    flagList,
    `*Market cap:* ${(marketCapSol || 0).toFixed(2)} SOL`,
    `*Socials:* ${socialsText}`,
    `[GMGN](https://gmgn.ai/sol/token/${mint}) | [pump.fun](https://pump.fun/${mint})`,
  ].join('\n');
}
