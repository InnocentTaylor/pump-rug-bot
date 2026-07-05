import 'dotenv/config';
import { Connection } from '@solana/web3.js';
import { startPumpListener } from './src/pumpListener.js';
import { getMintRisk } from './src/solanaChecks.js';
import { getRecentBuyerActivity } from './src/buyerActivity.js';
import { computeRugScore } from './src/rugScore.js';
import { createBot, sendAlert } from './src/telegram.js';
import { logDecision, markGraduated } from './src/logger.js';
import { fetchTokenMetadata } from './src/metadata.js';
import { initGitHubSync, flushToGitHub } from './src/githubSync.js';
import { addCandidate, startBatchWindow } from './src/batchAlerter.js';

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
  MIN_UNIQUE_BUYERS = '2',
  GITHUB_SYNC_INTERVAL_MS = '300000',
  BATCH_WINDOW_MS = '1200000',
} = process.env;

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  console.error('Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID — check your .env');
  process.exit(1);
}

const thresholds = {
  maxDevHoldPercent: Number(MAX_DEV_HOLD_PERCENT),
  maxTop10HoldPercent: Number(MAX_TOP10_HOLD_PERCENT),
  maxPriceAboveBaselinePercent: Number(MAX_PRICE_ABOVE_BASELINE_PERCENT),
  minUniqueBuyers: Number(MIN_UNIQUE_BUYERS),
};
const alertMaxScore = Number(ALERT_MAX_SCORE);
const minPercentBoughtToAlert = Number(MIN_PERCENT_BOUGHT_TO_ALERT);
const evaluationDelayMs = Number(EVALUATION_DELAY_MS);
const requireSocialLink = REQUIRE_SOCIAL_LINK === 'true';

const connection = new Connection(SOLANA_RPC_URL, 'confirmed');
const bot = createBot(TELEGRAM_BOT_TOKEN);
const pumpEvents = startPumpListener();

const pastEntries = await initGitHubSync();
const seenMints = new Set(pastEntries.map((e) => e.mint));
let pendingLines = [];

console.log(`Loaded ${seenMints.size} previously-seen mints from GitHub.`);
console.log('Watching pump.fun for new launches...');

function escapeMarkdown(text) {
  if (!text) return text;
  return String(text).replace(/([_*`[\]])/g, '\\$1');
}

function formatAlert({ mint, name, symbol, score, flags, marketCapSol, metadata }) {
  const safety = score <= 15 ? '🟢 Low risk signals' : '🟡 Moderate risk signals';
  const flagList = flags.length ? flags.map((f) => `• ${f}`).join('\n') : '• No major red flags detected';
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

startBatchWindow(Number(BATCH_WINDOW_MS), async (best) => {
  const message = formatAlert(best);
  await sendAlert(bot, TELEGRAM_CHAT_ID, message);
  console.log(`Sent batch winner: ${best.symbol || best.mint} — score ${best.score}`);
});

setInterval(async () => {
  if (pendingLines.length === 0) return;
  const toSend = pendingLines;
  pendingLines = [];
  await flushToGitHub(toSend);
}, Number(GITHUB_SYNC_INTERVAL_MS));

process.on('SIGTERM', async () => {
  console.log('Shutting down — flushing remaining log entries to GitHub...');
  if (pendingLines.length > 0) await flushToGitHub(pendingLines);
  process.exit(0);
});

pumpEvents.on('newToken', async (token) => {
  const { mint, name, symbol, marketCapSol, initialBuy, bondingCurveKey, uri } = token;

  if (seenMints.has(mint)) return;
  seenMints.add(mint);

  let uniqueBuyerCount = null;
  let buyCount = null;
  let sellCount = null;

  try {
    await new Promise((r) => setTimeout(r, evaluationDelayMs));

    const [risk, metadata] = await Promise.all([
      getMintRisk(connection, mint, bondingCurveKey),
      fetchTokenMetadata(uri),
    ]);

    const supplyUi = Number(risk.supply) / 10 ** risk.decimals;
    const devHoldPercent =
      supplyUi > 0 ? (Number(initialBuy || 0) / supplyUi) * 100 : 0;

    const hasAnySocial = metadata.hasTwitter || metadata.hasWebsite || metadata.hasTelegram;
    const hasRealBuying = risk.percentBought >= minPercentBoughtToAlert;
    const socialRequirementMet = !requireSocialLink || hasAnySocial;

    const baseResult = computeRugScore({
      mintAuthorityRenounced: risk.mintAuthorityRenounced,
      freezeAuthorityRenounced: risk.freezeAuthorityRenounced,
      devHoldPercent,
      top10HoldPercent: risk.top10HoldPercent,
      percentBought: risk.percentBought,
      marketCapSol: marketCapSol || 0,
      thresholds,
    });

    let score = baseResult.score;
    let flags = baseResult.flags;
    let alerted = false;

    if (!socialRequirementMet) {
      flags.push('Skipped alert — no social links provided (X/website/Telegram all missing)');
    } else if (!hasRealBuying) {
      flags.push(`Skipped alert — only ${ris
