/**
 * url-guard — SSRF protection for any server-side fetch that includes
 * user/database-controlled URLs.
 *
 * Rejects:
 *   - Non-http(s) schemes (file:, gopher:, ftp:, javascript:)
 *   - Hosts that resolve to private/loopback/link-local IPs
 *   - Hosts on the explicit IPv4/IPv6 deny-list (cloud metadata, k8s API, etc.)
 *
 * Limits:
 *   - Hard response body cap to prevent OOM via giant pages
 *   - Wraps fetch with AbortSignal + timeout
 *
 * Use `safeFetch(url, { maxBytes, timeoutMs })` in any provider that
 * accepts URLs derived from external data.
 */
import { isIP } from "node:net";
import dns from "node:dns/promises";
import type { LookupAddress } from "node:dns";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

// Cloud metadata services and other high-risk hosts
const HOST_DENYLIST = new Set([
  "metadata.google.internal",
  "metadata.goog",
  "169.254.169.254",        // AWS / GCP / Azure / Alibaba IMDS
  "100.100.100.200",        // Alibaba metadata
  "fd00:ec2::254",          // AWS IMDSv2 IPv6
]);

/**
 * Check if a textual IPv4/IPv6 address is a private, loopback, link-local,
 * multicast, or otherwise non-internet-routable address.
 */
function isPrivateIP(ip: string): boolean {
  const v = isIP(ip);
  if (v === 0) return false;

  if (v === 4) {
    const parts = ip.split(".").map(Number);
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
      return true; // malformed → treat as private to be safe
    }
    const [a, b] = parts;
    // 10/8
    if (a === 10) return true;
    // 172.16/12
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.168/16
    if (a === 192 && b === 168) return true;
    // 127/8 loopback
    if (a === 127) return true;
    // 169.254/16 link-local (incl. cloud metadata)
    if (a === 169 && b === 254) return true;
    // 0/8 "this network"
    if (a === 0) return true;
    // 100.64/10 carrier-grade NAT
    if (a === 100 && b >= 64 && b <= 127) return true;
    // 224/4 multicast
    if (a >= 224 && a <= 239) return true;
    // 240/4 reserved
    if (a >= 240) return true;
    return false;
  }

  // IPv6
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;          // loopback / unspecified
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local fc00::/7
  if (lower.startsWith("fe80:")) return true;                   // link-local
  if (lower.startsWith("ff")) return true;                      // multicast
  if (lower.startsWith("::ffff:")) {
    // IPv4-mapped — extract and recurse
    const mapped = lower.slice(7);
    if (isIP(mapped) === 4) return isPrivateIP(mapped);
  }
  return false;
}

export class SSRFError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SSRFError";
  }
}

/**
 * Validate that a URL is safe to fetch from a server context.
 * Throws SSRFError if the URL targets a private/internal host or uses an
 * unsupported protocol.
 *
 * Resolves DNS to confirm the host is publicly routable. Note: this is a TOCTOU
 * window — DNS could rebind between this check and the actual fetch. Modern Node
 * fetch doesn't expose a way to pin the resolved IP, so we accept this small
 * residual risk and recommend running behind an egress proxy in production.
 */
export async function assertPublicHttpUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SSRFError(`Invalid URL: ${rawUrl}`);
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new SSRFError(`Disallowed protocol: ${parsed.protocol}`);
  }

  const host = parsed.hostname.toLowerCase();
  if (HOST_DENYLIST.has(host)) {
    throw new SSRFError(`Denylisted host: ${host}`);
  }

  // Direct IP literal — check immediately
  if (isIP(host)) {
    if (isPrivateIP(host)) {
      throw new SSRFError(`Private/loopback IP rejected: ${host}`);
    }
    return parsed;
  }

  // Hostname → resolve and verify all addresses are public
  let addrs: LookupAddress[];
  try {
    addrs = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new SSRFError(`DNS resolution failed for ${host}`);
  }
  if (addrs.length === 0) {
    throw new SSRFError(`No DNS records for ${host}`);
  }
  for (const a of addrs) {
    if (isPrivateIP(a.address)) {
      throw new SSRFError(`Hostname ${host} resolves to private IP ${a.address}`);
    }
  }
  return parsed;
}

interface SafeFetchOptions {
  maxBytes?: number;
  timeoutMs?: number;
  headers?: Record<string, string>;
  redirect?: "follow" | "manual" | "error";
}

/**
 * SSRF-safe fetch with bounded response size.
 *
 * Performs the SSRF check on the initial URL. Note: if `redirect: 'follow'` is
 * used (default), redirects are NOT re-validated — a malicious site could redirect
 * to internal hosts. For high-risk providers, use `redirect: 'manual'` and
 * validate each hop yourself, or set up an egress proxy.
 */
export async function safeFetch(
  url: string,
  opts: SafeFetchOptions = {}
): Promise<{ ok: boolean; status: number; text: string; headers: Headers; finalUrl: string } | null> {
  const maxBytes = opts.maxBytes ?? 5_000_000; // 5 MB default cap
  const timeoutMs = opts.timeoutMs ?? 10_000;

  try {
    await assertPublicHttpUrl(url);
  } catch (e) {
    if (e instanceof SSRFError) {
      // Caller-side decides how loud this is — providers should treat null as "no result"
      console.warn(`[safeFetch] SSRF guard rejected ${url}: ${e.message}`);
      return null;
    }
    throw e;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: opts.redirect ?? "follow",
      headers: opts.headers,
    });

    // Best-effort post-redirect re-validation if we ended up somewhere different
    if (res.url && res.url !== url) {
      try { await assertPublicHttpUrl(res.url); }
      catch (e) {
        if (e instanceof SSRFError) {
          console.warn(`[safeFetch] Redirect target rejected: ${res.url}: ${e.message}`);
          return null;
        }
      }
    }

    // Pre-flight Content-Length cap (advisory; some servers omit/lie)
    const cl = res.headers.get("content-length");
    if (cl) {
      const declared = parseInt(cl, 10);
      if (!Number.isNaN(declared) && declared > maxBytes) {
        return { ok: false, status: 413, text: "", headers: res.headers, finalUrl: res.url };
      }
    }

    // Stream-and-cap to handle servers that omit/lie about Content-Length
    const reader = res.body?.getReader();
    if (!reader) {
      return { ok: res.ok, status: res.status, text: "", headers: res.headers, finalUrl: res.url };
    }

    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return { ok: false, status: 413, text: "", headers: res.headers, finalUrl: res.url };
      }
      chunks.push(value);
    }

    const buffer = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) { buffer.set(c, offset); offset += c.byteLength; }
    const text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);

    return { ok: res.ok, status: res.status, text, headers: res.headers, finalUrl: res.url };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
