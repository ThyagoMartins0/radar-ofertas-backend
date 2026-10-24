const RETRYABLE_STATUS = new Set([403, 429, 500, 502, 503, 504]);

export function isRetryableHttpStatus(status: number): boolean {
  return RETRYABLE_STATUS.has(status);
}

export function retryDelayMs(attempt: number, baseMs = 1000): number {
  const jitter = Math.random() * 200;
  return baseMs * 2 ** attempt + jitter;
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
