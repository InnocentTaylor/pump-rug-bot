// Hard caps how many alerts go out per rolling hour, regardless of how
// many coins qualify — protects against flooding even during a busy
// stretch of many good launches close together.
const sentTimestamps = [];

export function canSendAlert(maxPerHour) {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  while (sentTimestamps.length && sentTimestamps[0] < oneHourAgo) {
    sentTimestamps.shift();
  }
  return sentTimestamps.length < maxPerHour;
}

export function recordAlertSent() {
  sentTimestamps.push(Date.now());
}
