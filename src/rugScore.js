/**
 * Combines on-chain + launch signals into a single heuristic score.
 * 0 = no red flags detected, 100 = worst. This is a heuristic screen,
 * not a guarantee — it narrows the field, it doesn't replace judgment.
 */
export function computeRugScore({
  mintAuthorityRenounced,
  freezeAuthorityRenounced,
  devHoldPercent,
  top10HoldPercent,
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
  if (top10HoldPercent > thresholds.maxTop10HoldPercent) {
    score += 20;
    flags.push(
      `Top 10 wallets hold ${top10HoldPercent.toFixed(1)}% of supply (>${thresholds.maxTop10HoldPercent}%)`
    );
  }
  if (marketCapSol < thresholds.minMarketCapSol) {
    score += 15;
    flags.push(`Very thin starting liquidity (${marketCapSol.toFixed(2)} SOL)`);
  }

  return { score: Math.min(score, 100), flags };
}
