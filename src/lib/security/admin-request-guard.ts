const ADMIN_CSRF_HEADER = "x-admin-csrf";
const REQUIRED_ADMIN_CSRF_VALUE = "1";

type AdminRequestGuardSuccess = {
  ok: true;
};

type AdminRequestGuardFailure = {
  ok: false;
  status: 403 | 500;
  code: "invalid_csrf" | "invalid_origin" | "origin_not_configured";
  message: string;
};

export type AdminRequestGuardResult = AdminRequestGuardSuccess | AdminRequestGuardFailure;

function getFirstCsvValue(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const first = value.split(",")[0]?.trim();
  return first || null;
}

function normalizeOrigin(value: string | null): string | null {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function getRequestProtocol(request: Request): "http" | "https" {
  const forwardedProto = getFirstCsvValue(request.headers.get("x-forwarded-proto"));
  if (forwardedProto === "http" || forwardedProto === "https") {
    return forwardedProto;
  }

  try {
    const protocol = new URL(request.url).protocol;
    return protocol === "http:" ? "http" : "https";
  } catch {
    return "https";
  }
}

function getRequestHost(request: Request): string | null {
  const forwardedHost = getFirstCsvValue(request.headers.get("x-forwarded-host"));
  if (forwardedHost) {
    return forwardedHost;
  }

  const host = request.headers.get("host")?.trim();
  return host || null;
}

function getAllowedOrigins(request: Request): Set<string> {
  const allowedOrigins = new Set<string>();

  const configuredAppOrigin = normalizeOrigin(process.env.APP_ORIGIN ?? null);
  if (configuredAppOrigin) {
    allowedOrigins.add(configuredAppOrigin);
  }

  const host = getRequestHost(request);
  if (host) {
    const protocol = getRequestProtocol(request);
    allowedOrigins.add(`${protocol}://${host}`);
  }

  return allowedOrigins;
}

export function guardAdminMutationRequest(request: Request): AdminRequestGuardResult {
  if (request.headers.get(ADMIN_CSRF_HEADER) !== REQUIRED_ADMIN_CSRF_VALUE) {
    return {
      ok: false,
      status: 403,
      code: "invalid_csrf",
      message: "Admin mutation request rejected.",
    };
  }

  const requestOrigin = normalizeOrigin(request.headers.get("origin"));
  if (!requestOrigin) {
    return {
      ok: false,
      status: 403,
      code: "invalid_origin",
      message: "Admin mutation request origin is invalid.",
    };
  }

  const allowedOrigins = getAllowedOrigins(request);
  if (allowedOrigins.size === 0) {
    return {
      ok: false,
      status: 500,
      code: "origin_not_configured",
      message: "Server could not verify request origin.",
    };
  }

  if (!allowedOrigins.has(requestOrigin)) {
    return {
      ok: false,
      status: 403,
      code: "invalid_origin",
      message: "Admin mutation request origin is not allowed.",
    };
  }

  return { ok: true };
}
