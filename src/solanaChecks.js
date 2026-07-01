import { PublicKey } from '@solana/web3.js';
import { getMint, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';

async function withRetry(fn, retries = 3, delayMs = 800) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, delayMs * attempt));
    }
  }
}

// Some pump.fun coins use the older Token Program, others use the newer
// Token-2022 Program. Try the common one first; if it's the wrong program,
// automatically retry with the other one instead of failing outright.
async function getMintAnyProgram(connection, mintPubkey) {
  try {
    return await getMint(connection, mintPubkey, 'confirmed', TOKEN_PROGRAM_ID);
  } catch (err) {
    if (err?.name === 'TokenInvalidAccountOwnerError') {
      return await getMint(connection, mintPubkey, 'confirmed', TOKEN_2022_PROGRAM_ID);
    }
    throw err;
  }
}

export async function getMintRisk(connection, mintAddress) {
  const mintPubkey = new PublicKey(mintAddress);

  const mintInfo = await withRetry(() => getMintAnyProgram(connection, mintPubkey));
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
