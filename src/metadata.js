// Fetches a pump.fun token's off-chain metadata and checks whether the
// creator filled in any social links. This is a weak signal only — anyone
// can paste any URL, real or fake — it just tells us someone bothered to
// fill the field in, which many low-effort launches skip entirely.
export async function fetchTokenMetadata(uri, timeoutMs = 5000) {
  if (!uri) return { reachable: false, hasTwitter: false, hasWebsite: false, hasTelegram: false };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(uri, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) {
      return { reachable: false, hasTwitter: false, hasWebsite: false, hasTelegram: false };
    }
    const data = await res.json();
    return {
      reachable: true,
      hasTwitter: Boolean(data.twitter && String(data.twitter).trim()),
      hasWebsite: Boolean(data.website && String(data.website).trim()),
      hasTelegram: Boolean(data.telegram && String(data.telegram).trim()),
      twitter: data.twitter || null,
      website: data.website || null,
      telegram: data.telegram || null,
    };
  } catch {
    clearTimeout(timeout);
    return { reachable: false, hasTwitter: false, hasWebsite: false, hasTelegram: false };
  }
}
