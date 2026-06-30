// Keeps a running notebook of every token the bot evaluates, in memory.
// Resets if the bot restarts — that's fine for casual review, not meant
// to be a permanent database.
const decisions = [];
const MAX_ENTRIES = 1000;

export function logDecision(entry) {
  decisions.push({ ...entry, timestamp: new Date().toISOString() });
  if (decisions.length > MAX_ENTRIES) decisions.shift();
}

export function getDecisions() {
  return decisions;
}
