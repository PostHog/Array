/**
 * Runs `fn` with `process.env[key]` set to `value`, restoring the previous
 * value (or unsetting it) afterwards. Keeps env-dependent tests free of
 * repeated save/restore boilerplate.
 */
export async function withEnvVar(
  key: string,
  value: string,
  fn: () => Promise<void>,
): Promise<void> {
  const prev = process.env[key];
  process.env[key] = value;
  try {
    await fn();
  } finally {
    if (prev === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = prev;
    }
  }
}
