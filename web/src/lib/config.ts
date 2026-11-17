// Build-time configuration. The window.__FF override exists so end-to-end tests can point one static
// build at a mocked backend and shorten the wake timeout.
export const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "static";

interface Override { apiBase?: string; wakeTimeoutMs?: number }
const override = (): Override => (typeof window === "undefined" ? {} : ((window as unknown as { __FF?: Override }).__FF ?? {}));

/** Backend base URL. Empty string = no backend (static demo with the in-browser simulator only). */
export function apiBase(): string {
  const o = override().apiBase;
  if (o !== undefined) return o;
  const env = process.env.NEXT_PUBLIC_API_BASE ?? process.env.NEXT_PUBLIC_API_URL;
  if (env) return env.replace(/\/$/, "");
  return DEMO_MODE ? "" : "http://localhost:8000";
}

export const WAKE_TIMEOUT_MS = 90_000;
export const wakeTimeoutMs = () => override().wakeTimeoutMs ?? WAKE_TIMEOUT_MS;
