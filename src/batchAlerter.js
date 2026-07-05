// Instead of sending the instant a coin qualifies (first-come, first-served),
// this holds qualifying candidates for a short window, then sends only the
// best-scoring one from that batch — quality wins over timing.
let buffer = [];

export function addCandidate(candidate) {
  buffer.push(candidate);
}

export function startBatchWindow(windowMs, onBestPicked) {
  setInterval(() => {
    if (buffer.length === 0) return;
    const best = [...buffer].sort((a, b) => a.score - b.score)[0];
    buffer = [];
    onBestPicked(best);
  }, windowMs);
}
