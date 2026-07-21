// Radix color scales whose "9" step pairs with white text (the light-9 scales —
// amber/yellow/lime/mint/sky — are excluded so initials stay legible).
const AVATAR_COLORS = [
  "orange",
  "blue",
  "purple",
  "green",
  "pink",
  "teal",
  "red",
  "indigo",
  "cyan",
  "violet",
  "jade",
  "crimson",
] as const;

export function avatarColorSeedHash(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash + seed.charCodeAt(i) * (i + 1)) % 9973;
  }
  return hash;
}

// Returns a CSS custom-property reference (e.g. "var(--orange-9)") for a stable
// seed, applied via inline style. We return a CSS var rather than a Tailwind
// `bg-*` class because this file lives in @posthog/core, which the app's Tailwind
// content globs don't scan — a dynamically-chosen utility class here would never
// be generated, so the bubble would fall back to the neutral default.
export function avatarColorVar(seed: string): string {
  const color = AVATAR_COLORS[avatarColorSeedHash(seed) % AVATAR_COLORS.length];
  return `var(--${color}-9)`;
}
