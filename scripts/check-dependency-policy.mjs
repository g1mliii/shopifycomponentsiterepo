import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = process.cwd();
const packageJsonPath = path.join(repoRoot, "package.json");
const pnpmLockPath = path.join(repoRoot, "pnpm-lock.yaml");
const currentFilePath = fileURLToPath(import.meta.url);

const blockedPackageVersions = new Map([
  ["axios", ["1.14.1", "0.30.4"]],
  ["plain-crypto-js", ["4.2.1"]],
]);

const suspiciousIndicators = [
  "sfrclak.com",
  "142.11.206.73",
  "f7d335205b8d7b20208fb3ef93ee6dc817905dc3ae0c10a0b164f4e7d07121cd",
  "617b67a8e1210e4fc87c92d1d1da45a2f311c08d26e89b12307cf583c900d101",
  "92ff08773995ebc8d55ec4b8e1a225d0d1e51efa4ef88b8849d0071230c9645a",
];

const ignoredDirs = new Set([
  ".git",
  ".next",
  "node_modules",
  "output",
  "test-results",
  "tmp",
]);

const failures = [];

function addFailure(message) {
  failures.push(message);
}

function readUtf8(filePath) {
  return readFileSync(filePath, "utf8");
}

function checkDirectManifestVersions() {
  if (!existsSync(packageJsonPath)) {
    addFailure("package.json is missing");
    return;
  }

  const packageJson = JSON.parse(readUtf8(packageJsonPath));
  const dependencyGroups = [
    ["dependencies", packageJson.dependencies ?? {}],
    ["devDependencies", packageJson.devDependencies ?? {}],
    ["optionalDependencies", packageJson.optionalDependencies ?? {}],
    ["peerDependencies", packageJson.peerDependencies ?? {}],
  ];

  for (const [groupName, deps] of dependencyGroups) {
    for (const [pkg, blockedVersions] of blockedPackageVersions.entries()) {
      const declared = deps[pkg];
      if (!declared) {
        continue;
      }

      for (const blockedVersion of blockedVersions) {
        if (declared.includes(blockedVersion)) {
          addFailure(
            `Blocked ${pkg}@${blockedVersion} declared in package.json ${groupName}`,
          );
        }
      }
    }
  }
}

function checkPnpmLockfile() {
  if (!existsSync(pnpmLockPath)) {
    addFailure("pnpm-lock.yaml is missing");
    return;
  }

  const lockfile = readUtf8(pnpmLockPath);
  const packagesSectionIndex = lockfile.indexOf("\npackages:\n");
  const resolvedPackages =
    packagesSectionIndex >= 0
      ? lockfile.slice(packagesSectionIndex)
      : lockfile;

  for (const [pkg, blockedVersions] of blockedPackageVersions.entries()) {
    for (const blockedVersion of blockedVersions) {
      const needle = `${pkg}@${blockedVersion}`;
      if (resolvedPackages.includes(needle)) {
        addFailure(`Blocked lockfile entry detected: ${needle}`);
      }
    }
  }
}

function walkFiles(dirPath, results) {
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, results);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const stats = statSync(fullPath);
    if (stats.size > 1024 * 1024) {
      continue;
    }

    results.push(fullPath);
  }
}

function checkForSuspiciousIndicators() {
  const candidateFiles = [];
  walkFiles(repoRoot, candidateFiles);

  for (const filePath of candidateFiles) {
    if (path.resolve(filePath) === path.resolve(currentFilePath)) {
      continue;
    }

    const ext = path.extname(filePath).toLowerCase();
    if (!["", ".json", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".md", ".yaml", ".yml", ".txt"].includes(ext)) {
      continue;
    }

    const content = readUtf8(filePath);
    for (const indicator of suspiciousIndicators) {
      if (content.includes(indicator)) {
        addFailure(`Suspicious IOC "${indicator}" found in ${path.relative(repoRoot, filePath)}`);
      }
    }
  }
}

checkDirectManifestVersions();
checkPnpmLockfile();
checkForSuspiciousIndicators();

if (failures.length > 0) {
  console.error("Dependency policy check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Dependency policy check passed.");
