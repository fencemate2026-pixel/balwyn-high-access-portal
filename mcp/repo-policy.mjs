import path from "node:path";

export const ALLOWED_PACKAGE_SCRIPTS = new Set([
  "build",
  "build:render",
  "lint",
  "test",
  "test:doors",
  "test:netlify-gate",
  "typecheck",
]);

const PROTECTED_BRANCHES = new Set(["main", "master"]);
const BLOCKED_PATH_PREFIXES = [".git", ".next", ".sites-runtime", "dist", "node_modules"];

export function protectedBranchSet(defaultBranch = process.env.BALWYN_DEFAULT_BRANCH ?? "main") {
  return new Set([...PROTECTED_BRANCHES, defaultBranch.trim() || "main"]);
}

export function assertAllowedScript(script, packageScripts) {
  if (!ALLOWED_PACKAGE_SCRIPTS.has(script) || !Object.hasOwn(packageScripts, script)) {
    throw new Error(`Script "${script}" is not on the maintenance allowlist.`);
  }
}

export function assertSafeBranchName(branch, defaultBranch = process.env.BALWYN_DEFAULT_BRANCH ?? "main") {
  if (typeof branch !== "string" || !branch.trim()) throw new Error("Branch name is required.");
  const normalized = branch.trim();
  if (normalized.startsWith("-")) throw new Error("Branch names cannot start with '-'.");
  if (protectedBranchSet(defaultBranch).has(normalized)) {
    throw new Error(`Branch "${normalized}" is protected.`);
  }
  return normalized;
}

export function resolveRepoPath(repoRoot, requestedPath = ".") {
  const target = path.resolve(repoRoot, requestedPath);
  const relative = path.relative(repoRoot, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Path escapes the repository root.");
  }
  return { absolute: target, relative: relative || "." };
}

export function assertReadableRepoPath(relativePath) {
  const normalized = relativePath.replaceAll("\\", "/");
  if (BLOCKED_PATH_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`))) {
    throw new Error(`Reading ${normalized} is not allowed.`);
  }
  const basename = path.posix.basename(normalized);
  if (basename.startsWith(".env") && basename !== ".env.example") {
    throw new Error(`Reading ${normalized} is not allowed.`);
  }
}
