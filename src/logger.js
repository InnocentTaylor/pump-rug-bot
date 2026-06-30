// Writes every decision the bot makes to a file, so it survives restarts
// once this file path points at a Railway Volume.
import fs from 'fs';
import path from 'path';

const LOG_FILE_PATH = process.env.LOG_FILE_PATH || './data/decisions.jsonl';

function ensureLogDir() {
  const dir = path.dirname(LOG_FILE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function logDecision(entry) {
  try {
    ensureLogDir();
    const line = JSON.stringify({ ...entry, timestamp: new Date().toISOString() }) + '\n';
    fs.appendFileSync(LOG_FILE_PATH, line);
  } catch (err) {
    console.error('Failed to write log entry:', err.message);
  }
}

export function getDecisions() {
  try {
    if (!fs.existsSync(LOG_FILE_PATH)) return [];
    const content = fs.readFileSync(LOG_FILE_PATH, 'utf-8');
    return content
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (err) {
    console.error('Failed to read log file:', err.message);
    return [];
  }
}

// Finds the notebook entry for a given coin and tags it as graduated.
// Rewrites the whole file — fine at the data sizes this project expects.
export function markGraduated(mint) {
  try {
    const decisions = getDecisions();
    let found = false;
    const updated = decisions.map((entry) => {
      if (entry.mint === mint && !entry.graduated) {
        found = true;
        return { ...entry, graduated: true, graduatedAt: new Date().toISOString() };
      }
      return entry;
    });

    if (found) {
      ensureLogDir();
      const lines = updated.map((e) => JSON.stringify(e)).join('\n') + '\n';
      fs.writeFileSync(LOG_FILE_PATH, lines);
    }
  } catch (err) {
    console.error('Failed to mark graduation:', err.message);
  }
}
