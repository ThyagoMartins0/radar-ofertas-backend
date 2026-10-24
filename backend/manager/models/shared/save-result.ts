export type SaveResult<T = void> = { ok: true; value?: T } | { ok: false; error: string };

export async function runSave<T>(
  fn: () => Promise<T>,
  fallbackError: string,
): Promise<SaveResult<T>> {
  try {
    const value = await fn();
    return { ok: true, value };
  } catch (error) {
    const message = error instanceof Error ? error.message : fallbackError;
    return { ok: false, error: message };
  }
}
