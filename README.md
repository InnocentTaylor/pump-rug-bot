# pump-rug-bot

A Telegram bot that watches pump.fun (Solana) for new token launches in real
time and flags ones with fewer early rug-risk signals — mint/freeze authority
status, creator wallet concentration, top-10 holder concentration, and
starting liquidity.

This is a heuristic screen, not a guarantee. pump.fun tokens are extremely
high risk as a category; this tool narrows the field, it doesn't eliminate
risk. Always do your own check before buying anything.

## How it works

1. Connects to PumpPortal's free real-time WebSocket feed and gets notified
   the instant a new token is created on-chain (this is what makes it fast —
   no waiting on an aggregator site to index and display it).
2. A few seconds after creation, reads the token's on-chain state directly
   via Solana RPC: mint authority, freeze authority, and top-10 holder
   concentration.
3. Combines that with the creator's initial buy size and starting market cap
   into a 0–100 risk score (lower = fewer red flags).
4. If the score is at or below your threshold, sends a formatted alert to
   your Telegram chat/channel with GMGN and pump.fun links.

## Known limitations / next steps

- Uses the creator's initial buy as a proxy for dev holdings. It doesn't yet
  track buys/sells after launch.
- Uses the public Solana RPC by default, which can rate-limit under load. A
  free-tier dedicated RPC (Helius, QuickNode) will be more reliable.
- No backtesting has been done on these specific weights — treat the score
  as a starting filter and adjust thresholds against what you observe.
