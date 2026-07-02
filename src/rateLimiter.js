const queue = [];
let processing = false;

const MIN_INTERVAL_MS = 200; // widened further for real safety margin

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
