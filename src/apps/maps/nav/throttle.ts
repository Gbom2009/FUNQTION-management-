/**
 * Per-service request queue: at most one request every `minIntervalMs`.
 * Public geocoders/routers ask for ≤1 req/s; this enforces it app-wide.
 *
 * Note: a webview can't set User-Agent (forbidden header) and a custom header
 * would trigger CORS preflights the public services may reject. The proper
 * User-Agent from services.ts gets sent once requests move to the Tauri HTTP
 * plugin (Phase 6).
 */
export function createThrottle(minIntervalMs: number, now: () => number = Date.now) {
  let next = 0;
  let chain: Promise<unknown> = Promise.resolve();
  return function schedule<T>(task: () => Promise<T>): Promise<T> {
    const run = chain.then(async () => {
      const wait = Math.max(0, next - now());
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      next = now() + minIntervalMs;
      return task();
    });
    chain = run.catch(() => undefined);
    return run;
  };
}
