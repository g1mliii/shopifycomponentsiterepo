import fs from "node:fs";
import path from "node:path";

let cachedEnv: Record<string, string> | null = null;

function loadDotEnvLocal(): Record<string, string> {
  if (cachedEnv) {
    return cachedEnv;
  }

  const filePath = path.join(process.cwd(), ".env.local");

  if (!fs.existsSync(filePath)) {
    cachedEnv = {};
    return cachedEnv;
  }

  const fileContent = fs.readFileSync(filePath, "utf8");
  const envValues: Record<string, string> = {};

  for (const line of fileContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();

    envValues[key] = value;
  }

  cachedEnv = envValues;
  return cachedEnv;
}

export function getEnvOrEmpty(name: string): string {
  return process.env[name] ?? loadDotEnvLocal()[name] ?? "";
}
