#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import {
  ALLOWED_PACKAGE_SCRIPTS,
  assertAllowedScript,
  assertReadableRepoPath,
  assertSafeBranchName,
  protectedBranchSet,
  resolveRepoPath,
} from "./repo-policy.mjs";

const repoRoot = path.resolve(process.env.BALWYN_REPO_ROOT ?? process.cwd());
const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
const packageScripts = packageJson.scripts ?? {};

const tools = [
  {
    name: "list_directory",
    description: "List non-hidden files and folders inside the repository, excluding blocked paths.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        path: { type: "string", default: "." },
      },
    },
  },
  {
    name: "read_file",
    description: "Read a repository file with optional line slicing. Blocks .env secrets and VCS internals.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["path"],
      properties: {
        path: { type: "string" },
        startLine: { type: "integer", minimum: 1 },
        endLine: { type: "integer", minimum: 1 },
      },
    },
  },
  {
    name: "search_code",
    description: "Search repository code with ripgrep. Read-only and repo-scoped.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["pattern"],
      properties: {
        pattern: { type: "string" },
        path: { type: "string", default: "." },
        glob: { type: "string" },
        maxResults: { type: "integer", minimum: 1, maximum: 200, default: 50 },
      },
    },
  },
  {
    name: "run_repo_script",
    description: `Run one repo-defined maintenance script: ${[...ALLOWED_PACKAGE_SCRIPTS].join(", ")}.`,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["script"],
      properties: {
        script: { type: "string", enum: [...ALLOWED_PACKAGE_SCRIPTS] },
      },
    },
  },
  {
    name: "git_create_branch",
    description: "Create and switch to a non-protected branch.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["branch"],
      properties: {
        branch: { type: "string" },
      },
    },
  },
  {
    name: "git_commit",
    description: "Stage repository changes and create a commit on the current non-protected branch.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["message"],
      properties: {
        message: { type: "string", minLength: 1 },
      },
    },
  },
  {
    name: "git_push_branch",
    description: "Push the current or named non-protected branch to origin without force.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        branch: { type: "string" },
      },
    },
  },
  {
    name: "git_open_pull_request",
    description: "Open a pull request from a non-protected branch using the GitHub CLI.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["title", "body"],
      properties: {
        title: { type: "string", minLength: 1 },
        body: { type: "string", minLength: 1 },
        base: { type: "string" },
        head: { type: "string" },
      },
    },
  },
];

function writeMessage(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

function ok(id, result) {
  writeMessage({ jsonrpc: "2.0", id, result });
}

function failure(id, error) {
  writeMessage({
    jsonrpc: "2.0",
    id,
    error: {
      code: -32000,
      message: error instanceof Error ? error.message : String(error),
    },
  });
}

async function run(command, args, { cwd = repoRoot } = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}

function textResult(text, isError = false) {
  return { content: [{ type: "text", text }], isError };
}

async function currentBranch() {
  const result = await run("git", ["branch", "--show-current"]);
  if (result.code !== 0) throw new Error(result.stderr || "Could not determine the current branch.");
  return result.stdout.trim();
}

async function handleToolCall(name, args) {
  switch (name) {
    case "list_directory": {
      const { absolute, relative } = resolveRepoPath(repoRoot, args.path ?? ".");
      assertReadableRepoPath(relative);
      const details = await stat(absolute);
      if (!details.isDirectory()) throw new Error(`${relative} is not a directory.`);
      const entries = (await readdir(absolute, { withFileTypes: true }))
        .filter((entry) => !entry.name.startsWith("."))
        .map((entry) => `${entry.isDirectory() ? "dir " : "file"} ${path.posix.join(relative === "." ? "" : relative, entry.name) || entry.name}`);
      return textResult(entries.join("\n") || "(empty)");
    }
    case "read_file": {
      const { absolute, relative } = resolveRepoPath(repoRoot, args.path);
      assertReadableRepoPath(relative);
      const contents = await readFile(absolute, "utf8");
      const lines = contents.split("\n");
      const start = Math.max((args.startLine ?? 1) - 1, 0);
      const end = Math.min(args.endLine ?? lines.length, lines.length);
      const selected = lines.slice(start, end).map((line, index) => `${start + index + 1}. ${line}`);
      return textResult(selected.join("\n"));
    }
    case "search_code": {
      const { absolute, relative } = resolveRepoPath(repoRoot, args.path ?? ".");
      assertReadableRepoPath(relative);
      const rgArgs = ["--line-number", "--color", "never", "--max-count", String(args.maxResults ?? 50)];
      if (args.glob) rgArgs.push("--glob", args.glob);
      rgArgs.push(args.pattern, absolute);
      const result = await run("rg", rgArgs);
      if (result.code > 1) throw new Error(result.stderr || "Code search failed.");
      return textResult(result.stdout || "(no matches)");
    }
    case "run_repo_script": {
      assertAllowedScript(args.script, packageScripts);
      const result = await run("npm", ["run", args.script]);
      const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
      return textResult(output || `npm run ${args.script} finished with exit code ${result.code}.`, result.code !== 0);
    }
    case "git_create_branch": {
      const branch = assertSafeBranchName(args.branch);
      const result = await run("git", ["switch", "-c", branch]);
      if (result.code !== 0) throw new Error(result.stderr || `Could not create ${branch}.`);
      return textResult(result.stdout || `Created ${branch}.`);
    }
    case "git_commit": {
      const branch = assertSafeBranchName(await currentBranch());
      const add = await run("git", ["add", "-A"]);
      if (add.code !== 0) throw new Error(add.stderr || "git add failed.");
      const commit = await run("git", ["commit", "-m", args.message]);
      if (commit.code !== 0) throw new Error(commit.stderr || "git commit failed.");
      return textResult(commit.stdout || `Committed on ${branch}.`);
    }
    case "git_push_branch": {
      const branch = assertSafeBranchName(args.branch ?? await currentBranch());
      const result = await run("git", ["push", "origin", branch]);
      if (result.code !== 0) throw new Error(result.stderr || `Could not push ${branch}.`);
      return textResult(result.stdout || `Pushed ${branch} to origin.`);
    }
    case "git_open_pull_request": {
      const base = args.base ?? [...protectedBranchSet()][0];
      const head = assertSafeBranchName(args.head ?? await currentBranch(), base);
      if (protectedBranchSet(base).has(head)) throw new Error("Pull requests must come from a non-protected branch.");
      const result = await run("gh", ["pr", "create", "--base", base, "--head", head, "--title", args.title, "--body", args.body]);
      if (result.code !== 0) throw new Error(result.stderr || "gh pr create failed.");
      return textResult(result.stdout || `Opened a pull request from ${head} to ${base}.`);
    }
    default:
      throw new Error(`Unknown tool ${name}.`);
  }
}

async function handleRequest(request) {
  const { id, method, params = {} } = request;
  if (method === "initialize") {
    return ok(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "balwyn-repo-guard", version: "1.0.0" },
    });
  }
  if (method === "tools/list") {
    return ok(id, { tools });
  }
  if (method === "tools/call") {
    try {
      return ok(id, await handleToolCall(params.name, params.arguments ?? {}));
    } catch (error) {
      return ok(id, textResult(error instanceof Error ? error.message : String(error), true));
    }
  }
  if (method === "notifications/initialized") return;
  return failure(id, new Error(`Unsupported method ${method}.`));
}

let buffer = Buffer.alloc(0);
let expectedLength = null;
process.stdin.on("data", async (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    if (expectedLength === null) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;
      const headers = buffer.slice(0, headerEnd).toString("utf8").split("\r\n");
      const lengthHeader = headers.find((header) => header.toLowerCase().startsWith("content-length:"));
      if (!lengthHeader) {
        buffer = buffer.subarray(headerEnd + 4);
        continue;
      }
      expectedLength = Number(lengthHeader.split(":")[1].trim());
      buffer = buffer.subarray(headerEnd + 4);
    }
    if (buffer.byteLength < expectedLength) break;
    const body = buffer.subarray(0, expectedLength);
    buffer = buffer.subarray(expectedLength);
    expectedLength = null;
    try {
      await handleRequest(JSON.parse(body.toString("utf8")));
    } catch (error) {
      failure(null, error);
    }
  }
});
