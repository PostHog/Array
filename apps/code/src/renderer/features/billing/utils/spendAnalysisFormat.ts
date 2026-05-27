/** Display helpers shared between the React rendering of the spend banner and the
 * markdown prompt that gets fed to a new agent task.
 *
 * Single source of truth so the agent sees the same shape the user sees. */

export function formatUsd(amount: number): string {
  if (amount === 0) return "$0";
  if (amount < 0.01) return "<$0.01";
  if (amount < 100) return `$${amount.toFixed(2)}`;
  return `$${Math.round(amount).toLocaleString()}`;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return n.toString();
}

export function formatWindow(fromIso: string, toIso: string): string {
  const fromMs = new Date(fromIso).getTime();
  const toMs = new Date(toIso).getTime();
  const days = Math.max(1, Math.round((toMs - fromMs) / (1000 * 60 * 60 * 24)));
  return `${days} days`;
}
