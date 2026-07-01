const BASELINE_MARKET_CAP_SOL = 30; // pump.fun's default starting virtual market cap
const MIN_PERCENT_BOUGHT_TO_JUDGE = 1; // need at least this much bought before concentration % means anything

export function computeRugScore({
  mintAuthorityRenounced,
  freezeAuthorityRenounced,
  devHoldPercent,
  top10HoldPercent,
  percentBought,
  marketCapSol,
  thresholds,
}) {
  let score = 0;
  const flags = [];

  if (!mintAuthorityRenounced) {
    score += 25;
    flags.push('Mint authority not renounced — supply can still be inflated');
  }
  if (!freezeAuthorityRenounced) {
    score += 20;
    flags.push('Freeze authority not renounced — wallets can be frozen');
  }
  if (devHoldPercent > thresholds.maxDevHoldPercent) {
    score += 20;
    flags.push(
      `Creator holds ~${devHoldPercent.toFixed(1)}% of supply (>${thresholds.maxDevHoldPercent}%)`
    );
  }

  if (percentBought < MIN_PERCENT_BOUGHT_TO_JUDGE) {
    flags.push(`Too early to judge concentration (only ${percentBought.toFixed(2)}% of supply bought)`);
  } else if (top10HoldPercent > thresholds.maxTop10HoldPercent) {
    score += 20;
    flags.push(
      `Top 10 buyer wallets hold ${top10HoldPercent.toFixed(1)}% of purchased supply (>${thresholds.maxTop10HoldPercent}%)`
    );
  }

  const percentAboveBaseline = ((marketCapSol - BASELINE_MARKET_CAP_SOL) / BASELINE_MARKET_CAP_SOL) * 100;
  if (percentAboveBaseline > thresholds.maxPriceAboveBaselinePercent) {
    score += 15;
    flags.push(`Already ${percentAboveBaseline.toFixed(1)}% above launch baseline — may not be a fresh entry`);
  }

  return { score: Math.min(score, 100), flags };
}
