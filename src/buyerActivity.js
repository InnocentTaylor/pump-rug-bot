import { PublicKey } from '@solana/web3.js';
import { rateLimited } from './rateLimiter.js';

async function withRetry(fn, retries = 2, delayMs = 600) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, delayMs * attempt));
    }
  }
}

export async function getRecentBuyerActivity(connection, mintAddress, bondingCurveAddress, options = {}) {
  const { lookbackSignatures = 4 } = options; // tightened further — fewer, lighter calls per coin

  if (!bondingCurveAddress) {
    return { uniqueBuyers: 0, buyCount: 0, sellCount: 0 };
  }

  let signatures;
  try {
    signatures = await withRetry(() =>
      rateLimited(() =>
        connection.getSignaturesForAddress(new PublicKey(bondingCurveAddress), {
          limit: lookbackSignatures,
        })
      )
    );
  } catch {
    return { uniqueBuyers: 0, buyCount: 0, sellCount: 0 };
  }

  const buyers = new Set();
  let buyCount = 0;
  let sellCount = 0;

  for (const sigInfo of signatures) {
    try {
      // getTransaction (not getParsedTransaction) skips decoding instruction
      // data we never use — we only need meta.preTokenBalances/postTokenBalances,
      // which are included either way. This is meaningfully lighter per call.
      const tx = await withRetry(() =>
        rateLimited(() =>
          connection.getTransaction(sigInfo.signature, {
            maxSupportedTransactionVersion: 0,
          })
        )
      );
      if (!tx?.meta) continue;

      const pre = tx.meta.preTokenBalances || [];
      const post = tx.meta.postTokenBalances || [];

      const curvePre = pre.find((b) => b.mint === mintAddress && b.owner === bondingCurveAddress);
      const curvePost = post.find((b) => b.mint === mintAddress && b.owner === bondingCurveAddress);
      if (!curvePre || !curvePost) continue;

      const curveDelta =
        Number(curvePost.uiTokenAmount.amount) - Number(curvePre.uiTokenAmount.amount);
      if (curveDelta === 0) continue;

      const isBuy = curveDelta < 0;

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
