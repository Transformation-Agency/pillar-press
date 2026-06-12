import { isIP } from "node:net";

export class HostedProviderUrlError extends Error {
  status = 422;
  code = "invalid_provider_base_url";

  constructor(message = "Use a public HTTPS provider base URL.") {
    super(message);
    this.name = "HostedProviderUrlError";
  }
}

function normalizeHost(hostname: string) {
  return hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
}

function privateIpv4(host: string) {
  const parts = host.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

function privateIpv6(host: string) {
  return (
    host === "::1" ||
    host === "::" ||
    host.startsWith("fc") ||
    host.startsWith("fd") ||
    host.startsWith("fe80:")
  );
}

function privateHostname(host: string) {
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".lan") ||
    host.endsWith(".home") ||
    host.endsWith(".test")
  );
}

export function normalizeHostedProviderBaseUrl(value: string | undefined | null): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HostedProviderUrlError("Provider base URL must be a valid HTTPS URL.");
  }

  if (url.protocol !== "https:") {
    throw new HostedProviderUrlError("Hosted provider base URLs must use HTTPS.");
  }
  if (url.username || url.password) {
    throw new HostedProviderUrlError("Provider base URLs must not include embedded credentials.");
  }

  const host = normalizeHost(url.hostname);
  if (!host) throw new HostedProviderUrlError("Provider base URL must include a host.");
  if (privateHostname(host)) {
    throw new HostedProviderUrlError("Provider base URL must be a public provider endpoint, not a local network host.");
  }
  const ipKind = isIP(host);
  if (ipKind === 4 && privateIpv4(host)) {
    throw new HostedProviderUrlError("Provider base URL must not point to a private or local IP address.");
  }
  if (ipKind === 6 && privateIpv6(host)) {
    throw new HostedProviderUrlError("Provider base URL must not point to a private or local IPv6 address.");
  }

  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/+$/, "");
}
