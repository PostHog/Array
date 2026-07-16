/**
 * Whether a parsed IPv4 address falls in a non-public range: loopback
 * (127/8), "this network" (0/8), RFC1918 private space (10/8, 172.16/12,
 * 192.168/16), link-local (169.254/16, including the cloud metadata
 * endpoint), carrier-grade NAT (100.64/10, which also covers Tailscale IPs),
 * or the benchmarking range (198.18/15). Shared by every private/public host
 * classifier in this monorepo so the range table can't drift between them —
 * see `@posthog/core`'s `isPrivateHostname` and the web-fetch tool's
 * `isBlockedHost`.
 */
export function isPrivateIpv4Octets(a: number, b: number): boolean {
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return a === 198 && (b === 18 || b === 19);
}
