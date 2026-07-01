// A single shared queue that every RPC request in the bot passes through,
// no matter which coin or which check it belongs to. This is what actually
// prevents bursts — earlier fixes paced requests within one coin's checks,
// but multiple coins evaluated at the same time could still overwhelm
// Alchemy together. Funneling everything through one queue fixes that
// at the source.
const queue = [];
let processing = false;

const MIN_INTERVAL_MS = 60; // roughly 16 requests/second, safely under the 25/sec free-tier limit

async function processQueue() {
  if (processing) return;
  processing = true;
  while (queue.length > 0) {
    const { fn, resolve, reject } = queue.shift();
    try {
      resolve(await fn());
    } catch (err) {
      reject(err);
    }
    await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS));
  }
  processing = false;
}

export function rateLimited(fn) {
  return new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    processQueue();
  });
}
