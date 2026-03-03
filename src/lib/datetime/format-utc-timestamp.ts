function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

export function formatUtcTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  const year = parsed.getUTCFullYear();
  const month = pad2(parsed.getUTCMonth() + 1);
  const day = pad2(parsed.getUTCDate());
  const hours = pad2(parsed.getUTCHours());
  const minutes = pad2(parsed.getUTCMinutes());
  const seconds = pad2(parsed.getUTCSeconds());

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds} UTC`;
}
