import { PublicKey } from '@solana/web3.js';
import { getMint } from '@solana/spl-token';

/**
 * Pulls the on-chain signals that matter most for pump.fun rug risk:
 *  - mint authority renounced (can supply still be inflated?)
 *  - freeze authority renounced (can wallets be frozen?)
 *  - concentration of supply in the top 10 holder wallets
 */
export async function getMintRisk(connection, mintAddress) {
  const mintPubkey = new PublicKey(mintAddress);

  const mintInfo = await getMint(connection, mintPubkey);
  const supply = mintInfo.supply; // bigint, raw units
  const decimals = mintInfo.decimals;

  const largest = await connection.getTokenLargestAccounts(mintPubkey);
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
