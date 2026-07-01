import { PublicKey } from '@solana/web3.js';

// Reads recent transactions that touched the bonding curve's own token
// account directly from Solana itself, not from PumpPortal. A real buy or
// sell always moves tokens through the curve; private wallet-to-wallet
// transfers never do, so this naturally excludes gifts, self-transfers,
// or fake volume that bypasses the actual trading mechanism.
export async function getRecentBuyerActivity(connection, mintAddress, bondingCurveAddress, options = {}) {
  const { lookbackSignatures = 40 } = options;

  if (!bondingCurveAddress) {
    return { uniqueBuyers: 0, buyCount: 0, sellCount: 0 };
  }

  let signatures;
  try {
    signatures = await connection.getSignaturesForAddress(
      new PublicKey(bondingCurveAddress),
      { limit: lookbackSignatures }
    );
  } catch {
    return { uniqueBuyers: 0, buyCount: 0, sellCount: 0 };
  }

  const buyers = new Set();
  let buyCount = 0;
  let sellCount = 0;

  for (const sigInfo of signatures) {
    try {
      const tx = await connection.getParsedTransaction(sigInfo.signature, {
        maxSupportedTransactionVersion: 0,
      });
      if (!tx?.meta) continue;

      const pre = tx.meta.preTokenBalances || [];
      const post = tx.meta.postTokenBalances || [];

      const curvePre = pre.find((b) => b.mint === mintAddress && b.owner === bondingCurveAddress);
      const curvePost = post.find((b) => b.mint === mintAddress && b.owner === bondingCurveAddress);
      if (!curvePre || !curvePost) continue;

      const curveDelta =
        Number(curvePost.uiTokenAmount.amount) - Number(curvePre.uiTokenAmount.amount);
      if (curveDelta === 0) continue;

      const isBuy = curveDelta < 0; // tokens left the curve = someone bought

      for (const postEntry of post) {
        if (postEntry.mint !== mintAddress || postEntry.owner === bondingCurveAddress) continue;
        const preEntry = pre.find((p) => p.accountIndex === postEntry.accountIndex);
        const preAmt = preEntry ? Number(preEntry.uiTokenAmount.amount) : 0;
        const delta = Number(postEntry.uiTokenAmount.amount) - preAmt;

        if (isBuy && delta > 0) {
          buyers.add(postEntry.owner);
          buyCount++;
        } else if (!isBuy && delta < 0) {
          sellCount++;
        }
      }
    } catch {
      continue;
    }
  }

  return { uniqueBuyers: buyers.size, buyCount, sellCount };
}
