import { PublicKey } from '@solana/web3.js';
import { getMint } from '@solana/spl-token';

async function withRetry(fn, retries = 3, delayMs = 800) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isLastAttempt = attempt === retries;
      if (isLastAttempt) throw err;
      await new Promise((r) => setTimeout(r, delayMs * attempt));
    }
  }
}

/**
 * Pulls the on-chain signals that matter most for pump.fun rug risk:
 *  - mint authority renounced (can supply still be inflated?)
 *  - freeze authority renounced (can wallets be frozen?)
 *  - concentration of supply in the top 10 holder wallets
 * Wrapped in retries since RPC providers occasionally return transient
 * errors (like 503) that succeed on a second attempt.
 */
export async function getMintRisk(connection, mintAddress) {
  const mintPubkey = new PublicKey(mintAddress);

  const mintInfo = await withRetry(() => getMint(connection, mintPubkey));
  const supply = mintInfo.supply;
  const decimals = mintInfo.decimals;

  const largest = await withRetry(() => connection.getTokenLargestAccounts(mintPubkey));
  const top10Raw = largest.value
    .slice(0, 10)
    .reduce((sum, acc) => sum + BigInt(acc.amount), 0n);

  const top10HoldPercent =
    supply > 0n ? Number((top10Raw * 10000n) / supply) / 100 : 0;

  return {
    mintAuthorityRenounced: mintInfo.mintAuthority === null,
    freezeAuthorityRenounced: mintInfo.freezeAuthority === null,
    top10HoldPercent,
    supply,
    decimals,
  };
}
