import { PublicKey } from '@solana/web3.js';
import {
  getMint,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';

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

async function getMintAnyProgram(connection, mintPubkey) {
  try {
    const mintInfo = await getMint(connection, mintPubkey, 'confirmed', TOKEN_PROGRAM_ID);
    return { mintInfo, programId: TOKEN_PROGRAM_ID };
  } catch (err) {
    if (err?.name === 'TokenInvalidAccountOwnerError') {
      const mintInfo = await getMint(connection, mintPubkey, 'confirmed', TOKEN_2022_PROGRAM_ID);
      return { mintInfo, programId: TOKEN_2022_PROGRAM_ID };
    }
    throw err;
  }
}

export async function getMintRisk(connection, mintAddress, bondingCurveAddress) {
  const mintPubkey = new PublicKey(mintAddress);

  const { mintInfo, programId } = await withRetry(() => getMintAnyProgram(connection, mintPubkey));
  const supply = mintInfo.supply;
  const decimals = mintInfo.decimals;

  const largest = await withRetry(() => connection.getTokenLargestAccounts(mintPubkey));

  let curveAtaAddress = null;
  if (bondingCurveAddress) {
    try {
      const curveAta = getAssociatedTokenAddressSync(
        mintPubkey,
        new PublicKey(bondingCurveAddress),
        true,
        programId
      );
      curveAtaAddress = curveAta.toBase58();
    } catch {
      curveAtaAddress = null;
    }
  }

  const nonCurveAccounts = largest.value.filter(
    (acc) => acc.address.toBase58() !== curveAtaAddress
  );
  const curveAccount = largest.value.find(
    (acc) => acc.address.toBase58() === curveAtaAddress
  );

  const curveBalance = curveAccount ? BigInt(curveAccount.amount) : 0n;
  const purchasedSupply = supply - curveBalance;

  const top10NonCurveRaw = nonCurveAccounts
    .slice(0, 10)
    .reduce((sum, acc) => sum + BigInt(acc.amount), 0n);

  const top10HoldPercent =
    purchasedSupply > 0n
      ? Number((top10NonCurveRaw * 10000n) / purchasedSupply) / 100
      : 0;

  const percentBought =
    supply > 0n ? Number((purchasedSupply * 10000n) / supply) / 100 : 0;

  return {
    mintAuthorityRenounced: mintInfo.mintAuthority === null,
    freezeAuthorityRenounced: mintInfo.freezeAuthority === null,
    top10HoldPercent,
    percentBought,
    supply,
    decimals,
  };
}
