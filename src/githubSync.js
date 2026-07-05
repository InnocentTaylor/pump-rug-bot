import { Buffer } from 'buffer';

const { GITHUB_TOKEN, GITHUB_REPO, GITHUB_LOG_PATH = 'data/decisions.jsonl' } = process.env;

const API_BASE = GITHUB_REPO
  ? `https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_LOG_PATH}`
  : null;

let cachedSha = null;
let cachedContent = '';

function authHeaders() {
  return { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' };
}

export async function initGitHubSync() {
  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    console.warn('GitHub sync not configured — running without persistent history.');
    return [];
  }
  try {
    const res = await fetch(API_BASE, { headers: authHeaders() });
    if (res.status === 404) {
      console.log('No GitHub log file yet — will create on first push.');
      return [];
    }
    if (!res.ok) {
      console.error('Failed to load GitHub log:', res.status, await res.text());
      return [];
    }
    const data = await res.json();
    cachedSha = data.sha;
    cachedContent = Buffer.from(data.content, 'base64').toString('utf-8');
    const entries = cachedContent
      .split('\n')
      .filter(Boolean)
      .map((line) => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean);
    console.log(`Loaded ${entries.length} past decisions from GitHub.`);
    return entries;
  } catch (err) {
    console.error('Error loading GitHub log:', err.message);
    return [];
  }
}

export async function flushToGitHub(newLines) {
  if (!GITHUB_TOKEN || !GITHUB_REPO || newLines.length === 0) return;

  cachedContent += newLines.join('\n') + '\n';
  const encoded = Buffer.from(cachedContent, 'utf-8').toString('base64');
  const body = {
    message: `Update decision log (+${newLines.length} entries)`,
    content: encoded,
    ...(cachedSha ? { sha: cachedSha } : {}),
  };

  try {
    const res = await fetch(API_BASE, {
      method: 'PUT',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error('Failed to push log to GitHub:', res.status, await res.text());
      return;
    }
    const data = await res.json();
    cachedSha = data.content.sha;
    console.log(`Pushed ${newLines.length} new entries to GitHub.`);
  } catch (err) {
    console.error('Error pushing to GitHub:', err.message);
  }
}
