export const MIN_POLLING_SECONDS = 30;
export const MAX_POLLING_SECONDS = 3600;

export function sanitizePollingInterval(value: unknown, fallback = 300): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(MIN_POLLING_SECONDS, Math.min(MAX_POLLING_SECONDS, Math.round(value)));
}
