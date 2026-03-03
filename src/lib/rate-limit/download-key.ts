const MAX_USER_AGENT_KEY_LENGTH = 160;
const MAX_ACCEPT_LANGUAGE_KEY_LENGTH = 64;
const TRUSTED_PROVIDER_IP_HEADERS = [
  "x-vercel-forwarded-for",
  "cf-connecting-ip",
  "fly-client-ip",
  "fastly-client-ip",
  "true-client-ip",
] as const;
const TRUSTED_PROXY_REAL_IP_HEADER = "x-real-ip";

function normalizeKeyToken(value: string | null, maxLength: number): string {
  if (!value) {
    return "";
  }

  return value.trim().toLowerCase().replace(/\s+/g, " ").slice(0, maxLength);
}

function normalizeIp(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized.length > 64) {
    return null;
  }

  if (!/^[a-z0-9:.]+$/i.test(normalized)) {
    return null;
  }

  return normalized;
}

function getForwardedForIp(request: Request): string | null {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (!forwardedFor) {
    return null;
  }

  const firstIp = forwardedFor.split(",")[0] ?? "";
  return normalizeIp(firstIp);
}

export function getDownloadRateLimitKey(request: Request): string {
  for (const headerName of TRUSTED_PROVIDER_IP_HEADERS) {
    const ip = normalizeIp(request.headers.get(headerName));
    if (ip) {
      return `ip:${ip}`;
    }
  }

  if (process.env.TRUST_PROXY_X_REAL_IP === "true") {
    const realIp = normalizeIp(request.headers.get(TRUSTED_PROXY_REAL_IP_HEADER));
    if (realIp) {
      return `ip:${realIp}`;
    }
  }

  if (process.env.TRUST_PROXY_X_FORWARDED_FOR === "true") {
    const forwardedIp = getForwardedForIp(request);
    if (forwardedIp) {
      return `ip:${forwardedIp}`;
    }
  }

  const userAgent = normalizeKeyToken(request.headers.get("user-agent"), MAX_USER_AGENT_KEY_LENGTH);
  const acceptLanguage = normalizeKeyToken(
    request.headers.get("accept-language"),
    MAX_ACCEPT_LANGUAGE_KEY_LENGTH,
  );

  if (userAgent || acceptLanguage) {
    return `fp:${userAgent}|${acceptLanguage}`;
  }

  return "fp:unknown";
}
