import "server-only";

import { createServiceRoleSupabaseClient } from "./service-role";

type SignedStorageUrlOptions = {
  downloadFileName?: string;
  expiresInSeconds?: number;
};

const DEFAULT_SIGNED_URL_EXPIRY_SECONDS = 60;

function normalizeExpirySeconds(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_SIGNED_URL_EXPIRY_SECONDS;
  }

  const asInt = Math.floor(value ?? DEFAULT_SIGNED_URL_EXPIRY_SECONDS);
  return Math.min(3600, Math.max(1, asInt));
}

export async function createSignedStorageObjectUrl(
  bucket: string,
  pathValue: string,
  options?: SignedStorageUrlOptions,
): Promise<{ signedUrl: string | null; errorMessage: string | null }> {
  const serviceRole = createServiceRoleSupabaseClient();
  const { data, error } = await serviceRole.storage
    .from(bucket)
    .createSignedUrl(pathValue, normalizeExpirySeconds(options?.expiresInSeconds), {
      ...(options?.downloadFileName ? { download: options.downloadFileName } : {}),
    });

  if (error) {
    return {
      signedUrl: null,
      errorMessage: error.message,
    };
  }

  return {
    signedUrl: data?.signedUrl ?? null,
    errorMessage: data?.signedUrl ? null : "Missing signed URL from storage response.",
  };
}
