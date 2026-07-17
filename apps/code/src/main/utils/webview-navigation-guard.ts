// The authoritative gate for the in-app browser guest. It runs in the main
// process, where a guest page can't route around it; the renderer's
// normalizeAddress is only a convenience on top of this. about:blank is allowed
// solely as the src a new blank browser tab mounts with before
// the user enters a url.
const LOOPBACK_HOSTS = new Set(["localhost", "0.0.0.0", "[::1]"]);
const LOOPBACK_IPV4 = /^127\./;

// Blocks the cloud instance-metadata endpoint. On cloud VMs it returns IAM /
// service-account credentials to any local caller, so a hostile page that
// redirects the webview there could exfiltrate them. Loopback and LAN stay
// allowed: browsing a local dev server is a first-class use of this browser.
//
// WHATWG URL canonicalizes decimal/hex/octal IPv4 (http://2852039166) back to
// dotted form before this runs, so those are covered by the v4 range. The
// entries below close the forms it does NOT fold together: the IPv6-mapped
// address (the OS still connects to the v4 metadata service) and GCP's
// metadata DNS name.
//
// Residual gap this cannot close: DNS rebinding — an attacker domain that
// resolves to 169.254.169.254 passes, because the real defense is checking the
// *resolved* IP at connect time, which will-navigate doesn't expose. Egress
// network policy on the sandbox is the actual boundary for that.
const BLOCKED_METADATA_HOST = /^169\.254\./;
const BLOCKED_METADATA_HOST_V6 = /^\[::ffff:a9fe:a9fe\]$/i;
const BLOCKED_METADATA_HOSTNAMES = new Set(["metadata.google.internal"]);

export function isBlockedWebviewHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    BLOCKED_METADATA_HOST.test(host) ||
    BLOCKED_METADATA_HOST_V6.test(host) ||
    BLOCKED_METADATA_HOSTNAMES.has(host)
  );
}

export function safeProtocol(url: string): string {
  try {
    return new URL(url).protocol;
  } catch {
    return "";
  }
}

function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname) || LOOPBACK_IPV4.test(hostname);
}

export function isAllowedWebviewNavigation(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.href === "about:blank") return true;
  if (isBlockedWebviewHost(parsed.hostname)) return false;
  if (parsed.protocol === "https:") return true;
  return parsed.protocol === "http:" && isLoopbackHost(parsed.hostname);
}

export function isAllowedWebviewRequest(
  url: string,
  resourceType: string,
): boolean {
  if (resourceType === "mainFrame") {
    return isAllowedWebviewNavigation(url);
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.href === "about:blank") return true;
  if (isBlockedWebviewHost(parsed.hostname)) return false;
  if (parsed.protocol === "data:" || parsed.protocol === "blob:") return true;
  if (parsed.protocol === "https:") return true;
  return parsed.protocol === "http:" && isLoopbackHost(parsed.hostname);
}
