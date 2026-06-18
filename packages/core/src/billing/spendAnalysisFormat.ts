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

export function windowDays(fromIso: string, toIso: string): number {
  const fromMs = new Date(fromIso).getTime();
  const toMs = new Date(toIso).getTime();
  return Math.max(1, Math.round((toMs - fromMs) / (1000 * 60 * 60 * 24)));
}

export function formatWindow(fromIso: string, toIso: string): string {
  return `${windowDays(fromIso, toIso)} days`;
}
