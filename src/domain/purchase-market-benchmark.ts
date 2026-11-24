/** Vilaity is a Brass benchmark. Other materials need their own rate feed. */
export function isBrassBenchmarkItem(name: string): boolean {
  const normalized = name.trim().toLowerCase()
  return /^brass\b/.test(normalized) && !/\b(lead|copper|zinc|tin|alumini?um|iron|steel|nickel|mixed)\b/.test(normalized)
}
