import { getSupabaseUrl } from "./env";

type PublicStorageUrlOptions = {
  downloadFileName?: string;
};

function encodeStoragePath(pathValue: string): string {
  return pathValue
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export function getPublicStorageObjectUrl(
  bucket: string,
  pathValue: string,
  options?: PublicStorageUrlOptions,
): string {
  const baseUrl = getSupabaseUrl().replace(/\/+$/, "");
  const encodedBucket = encodeURIComponent(bucket);
  const encodedPath = encodeStoragePath(pathValue);
  const objectUrl = `${baseUrl}/storage/v1/object/public/${encodedBucket}/${encodedPath}`;

  if (!options?.downloadFileName) {
    return objectUrl;
  }

  const url = new URL(objectUrl);
  url.searchParams.set("download", options.downloadFileName);
  return url.toString();
}
