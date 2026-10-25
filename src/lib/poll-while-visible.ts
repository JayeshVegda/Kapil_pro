/**
 * Polling interval adapter for React Query: polls at `intervalMs` only while the
 * tab is visible; background tabs stop polling entirely instead of burning
 * requests against the local PocketBase.
 */
export function pollWhileTabVisible(intervalMs: number) {
  return () => {
    if (typeof document === 'undefined') return intervalMs
    return document.visibilityState === 'visible' ? intervalMs : false
  }
}
