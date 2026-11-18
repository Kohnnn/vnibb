// The insider API's legacy naive datetimes are UTC; never interpret them in the browser's time zone.
const ALERT_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;

export function parseAlertTime(timestamp: string): number | null {
  const match = ALERT_TIME_PATTERN.exec(timestamp);
  if (!match) return null;
  const time = Date.parse(match[1] ? timestamp : timestamp + 'Z');
  return Number.isFinite(time) ? time : null;
}
