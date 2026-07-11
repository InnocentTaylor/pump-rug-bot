// madeonsolTracker.js
//
// Uses MadeOnSol's KOL API, which already curates and ranks 1,000+ wallets
// — no manual wallet list, no separate leaderboard step. Two alert tiers:
//
//   1. Regular alerts — a single tracked KOL buys or sells (only if that
//      KOL currently clears our quality bar).
//   2. Coordination alerts — 3+ tracked KOLs buy the same token in a short
//      window. Higher confidence, but NOT proof — a single actor can run
//      multiple wallets to fake this. Treat it as a stronger filter, not
//      a guarantee.
//
// Free tier: 200 API calls/day. This bot makes 2 calls per cycle (feed +
// coordination), so at the default 15-minute interval that's 96 cycles/day
// x 2 = 192 calls/day — safely under 200.
//
// Docs: https://madeonsol.com/solana-api

import { MadeOnSol } from 'madeonsol';
import { createBot, sendAlert } from './telegram.js';

const API_KEY = process.env.MADEONSOL_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 15 * 60 * 1000);
const MIN_KOLS_FOR_COORDINATION = Number(process.env.MIN_KOLS_FOR_COORDINATION || 3);
const MIN_WIN_RATE = Number(process.env.MIN_WIN_RATE || 75);
const MIN_TRADE_COUNT = Number(process.env.MIN_TRADE_COUNT || 15);
const RANK_REFRESH_MS = Number(process.env.RANK_REFRESH_MS || 6 * 60 * 60 * 1000);

if (!API_KEY) {
  console.error('Missing MADEONSOL_API_KEY env var.');
  process.exit(1);
}
if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  console.error('Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID env var.');
  process.exit(1);
}

const client = new MadeOnSol({ apiKey: API_KEY });
const bot = createBot(TELEGRAM_BOT_TOKEN);

function notify(message) {
  console.log(message);
  sendAlert(bot, TELEGRAM_CHAT_ID, message);
}

// De-dupe so the same trade/coordination event doesn't alert twice.
const seenTradeKeys = new Set();
const seenCoordinationKeys = new Set();

// wallet address -> { winRate, totalTrades, pnl, lastSeen }
// Built passively — every feed poll teaches us a bit more about each KOL,
// no extra API calls needed.
//
// NOTE: assumes trade.kol carries winRate/totalTrades/pnl fields. Confirm
// against a real response once you have a live key — if the names differ,
// update updateKolStats() below to match.
const kolStatsCache = new Map();

// The current "qualified" set — only wallets in here can trigger a trade
// alert. Recomputed every RANK_REFRESH_MS.
let qualifiedKols = new Set();

function updateKolStats(trade) {
  const wallet = trade.wallet || trade.kol?.address;
  if (!wallet || !trade.kol) return;

  kolStatsCache.set(wallet, {
    name: trade.kol.name,
    winRate: trade.kol.winRate,
    totalTrades: trade.kol.totalTrades ?? trade.kol.tradeCount,
    pnl: trade.kol.pnl,
    lastSeen: Date.now(),
  });
}

function refreshQualifiedKols() {
  const next = new Set();
  for (const [wallet, stats] of kolStatsCache.entries()) {
    if (
      typeof stats.winRate === 'number' &&
      stats.winRate >= MIN_WIN_RATE &&
      typeof stats.totalTrades === 'number' &&
      stats.totalTrades >= MIN_TRADE_COUNT
    ) {
      next.add(wallet);
    }
  }
  qualifiedKols = next;
  console.log(`Re-ranked: ${qualifiedKols.size} wallet(s) currently clear the bar (${MIN_WIN_RATE}%+ win rate, ${MIN_TRADE_COUNT}+ trades).`);
}

// --- Alert cooldown: safety-only, not a noise filter ---
// You told me not missing a profitable signal matters more than noise
// reduction — and that's the right call for a manual-decision bot. Every
// repeat buy from a trusted KOL is real information (adding to a position
// = growing conviction), not spam. So this is set low on purpose: just
// enough to absorb a genuine duplicate-reporting glitch from the API, not
// to silence real repeat activity. Raise ALERT_COOLDOWN_MS yourself later
// if you ever find it too noisy in practice.
const ALERT_COOLDOWN_MS = Number(process.env.ALERT_COOLDOWN_MS || 2 * 60 * 1000); // 2 min default — safety net, not a filter
const recentAlerts = new Map(); // `${wallet}-${mint}` -> last alert timestamp

function isOnCooldown(wallet, mint) {
  const key = `${wallet}-${mint}`;
  const last = recentAlerts.get(key);
  const now = Date.now();
  if (last && now - last < ALERT_COOLDOWN_MS) return true;
  recentAlerts.set(key, now);
  return false;
}

function markSeen(set, key) {
  if (set.has(key)) return true;
  set.add(key);
  if (set.size > 5000) set.delete(set.values().next().value);
  return false;
}

function formatTradeAlert(trade) {
  const side = trade.action === 'buy' ? '🟢 BUY' : '🔴 SELL';
  const kol = trade.kol?.name || trade.wallet || 'unknown';
  const token = trade.token?.symbol || trade.mint || 'unknown token';
  const amount = trade.amountSol ? `${trade.amountSol} SOL` : 'n/a';

  let sellContext = null;
  if (trade.action === 'sell' && typeof trade.positionRemainingPercent === 'number') {
    sellContext = trade.positionRemainingPercent === 0
      ? '⚠️ FULL EXIT — closed entire position'
      : `Partial sell — still holding ~${trade.positionRemainingPercent}% of position`;
  }

  return [
    `${side} — ${kol}`,
    `Token: ${token}`,
    `Size: ${amount}`,
    sellContext,
    trade.signature ? `Tx: https://solscan.io/tx/${trade.signature}` : null,
  ].filter(Boolean).join('\n');
}

function looksArtificial(signal) {
  const kols = signal.kols || [];
  if (kols.length < 2) return false;

  const amounts = kols.map((k) => k.amountSol).filter((a) => typeof a === 'number');
  const timestamps = kols.map((k) => k.timestamp).filter((t) => typeof t === 'number');

  const amountsNearlyIdentical =
    amounts.length >= 2 && (Math.max(...amounts) - Math.min(...amounts)) < 0.05 * Math.max(...amounts);

  const timestampsNearlyIdentical =
    timestamps.length >= 2 && (Math.max(...timestamps) - Math.min(...timestamps)) < 5;

  return amountsNearlyIdentical && timestampsNearlyIdentical;
}

function formatCoordinationAlert(signal) {
  const token = signal.token?.symbol || signal.mint || 'unknown token';
  const count = signal.kolCount || signal.kols?.length || MIN_KOLS_FOR_COORDINATION;
  const suspicious = looksArtificial(signal);

  return [
    suspicious ? `⚠️ COORDINATION SIGNAL (looks possibly artificial)` : `🔥 COORDINATION SIGNAL`,
    `${count} tracked KOLs bought ${token} in a short window`,
    suspicious
      ? `Amounts and timing are near-identical across wallets — could be one person, not three independent traders. Treat with extra caution.`
      : `This is a stronger signal than a single buy — but not proof. Verify before acting.`,
  ].join('\n');
}

async function checkTrades() {
  try {
    const { trades } = await client.kol.feed({ limit: 50 });
    for (const trade of trades) {
      updateKolStats(trade);

      const key = trade.signature || `${trade.wallet}-${trade.mint}-${trade.timestamp}`;
      if (markSeen(seenTradeKeys, key)) continue;

      const wallet = trade.wallet || trade.kol?.address;
      if (!qualifiedKols.has(wallet)) continue;

      const mint = trade.mint || trade.token?.address;
      if (isOnCooldown(wallet, mint)) continue;

      const message = formatTradeAlert(trade);
      notify(message);
    }
  } catch (err) {
    console.error('Error fetching KOL feed:', err.message);
  }
}

async function checkCoordination() {
  try {
    const { tokens } = await client.kol.coordination({ min_kols: MIN_KOLS_FOR_COORDINATION });
    for (const signal of tokens) {
      const key = signal.mint || signal.token?.address;
      if (markSeen(seenCoordinationKeys, key)) continue;
      const message = formatCoordinationAlert(signal);
      notify(message);
    }
  } catch (err) {
    console.error('Error fetching coordination signals:', err.message);
  }
}

async function loop() {
  await checkTrades();
  await checkCoordination();
}

console.log(`Polling MadeOnSol KOL feed every ${POLL_INTERVAL_MS / 60000} min. Coordination threshold: ${MIN_KOLS_FOR_COORDINATION} KOLs.`);
console.log(`Re-ranking wallets every ${RANK_REFRESH_MS / 3600000} hr. Bar: ${MIN_WIN_RATE}%+ win rate, ${MIN_TRADE_COUNT}+ trades.`);
console.log('Heads up: the scoreboard starts empty, so the first cycle or two may qualify zero wallets while it learns.');

loop();
setInterval(loop, POLL_INTERVAL_MS);
setInterval(refreshQualifiedKols, RANK_REFRESH_MS);
