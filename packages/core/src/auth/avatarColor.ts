// Deterministic per-user avatar color. A stable seed (user uuid, email, or name)
// always maps to the same palette entry, so a given person keeps one color across
// every view and session. All entries use a Radix "9" step whose accessible pairing
// is white text (the light-9 scales — amber/yellow/lime/mint/sky — are excluded).
const AVATAR_PALETTE = [
  "bg-(--orange-9) text-white",
  "bg-(--blue-9) text-white",
  "bg-(--purple-9) text-white",
  "bg-(--green-9) text-white",
  "bg-(--pink-9) text-white",
  "bg-(--teal-9) text-white",
  "bg-(--red-9) text-white",
  "bg-(--indigo-9) text-white",
  "bg-(--cyan-9) text-white",
  "bg-(--violet-9) text-white",
  "bg-(--jade-9) text-white",
  "bg-(--crimson-9) text-white",
] as const;

export function avatarColorSeedHash(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash + seed.charCodeAt(i) * (i + 1)) % 9973;
  }
  return hash;
}

export function avatarColorClass(seed: string): string {
  return AVATAR_PALETTE[avatarColorSeedHash(seed) % AVATAR_PALETTE.length];
}
