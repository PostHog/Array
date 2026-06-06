import { randomBytes } from "node:crypto";

/**
 * Generate a UUIDv7 (time-ordered, RFC 9562). posthog-js requires this exact
 * format for `bootstrap.sessionID`: a valid v7 whose 48-bit timestamp precedes
 * the session's first event. Main mints it before any window starts posthog-js,
 * so the ordering holds.
 *
 * Layout: 48-bit big-endian unix-ms timestamp, 4-bit version (7), 2-bit variant
 * (10), 74 random bits. Hand-rolled to avoid a phantom dependency on `uuid`
 * (transitive only, and several major versions resolve in the tree).
 */
export function uuidv7(): string {
  const bytes = randomBytes(16);
  const timestamp = Date.now();

  bytes[0] = Math.floor(timestamp / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(timestamp / 2 ** 32) & 0xff;
  bytes[2] = Math.floor(timestamp / 2 ** 24) & 0xff;
  bytes[3] = Math.floor(timestamp / 2 ** 16) & 0xff;
  bytes[4] = Math.floor(timestamp / 2 ** 8) & 0xff;
  bytes[5] = timestamp & 0xff;

  bytes[6] = (bytes[6] & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10

  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
