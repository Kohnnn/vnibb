'use client';

type TimestampCandidate = string | number | Date | null | undefined;

function parseTimestamp(value: TimestampCandidate): Date | null {
  if (value === null || value === undefined) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function getLatestTimestampValue(values: TimestampCandidate[]): string | undefined {
  const timestamps = values
    .map(parseTimestamp)
    .filter((value): value is Date => value !== null)
    .sort((a, b) => b.getTime() - a.getTime());

  return timestamps[0]?.toISOString();
}
