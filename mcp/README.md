# Balwyn repo-guard MCP profile

This repository includes a **scoped MCP server profile** for future AI-assisted maintenance work on the Balwyn High access portal.

## Files

- `mcp/mcp.json` — example MCP client configuration.
- `mcp/server.mjs` — stdio MCP server with a small explicit tool allowlist.
- `mcp/repo-policy.mjs` — shared policy checks for path, script, and branch restrictions.

## Allowed tools

### Read-only repository inspection

- `list_directory`
- `read_file`
- `search_code`

These tools are restricted to the repository root and block sensitive/runtime locations such as `.git/`, `node_modules/`, `.next/`, `dist/`, `.sites-runtime/`, and any real `.env*` file. `.env.example` remains readable as a template.

### Bounded maintenance commands

- `run_repo_script`

This tool can only run package scripts already defined in `package.json`, and only for this allowlist:

- `build`
- `build:render`
- `lint`
- `test`
- `test:doors`
- `test:netlify-gate`
- `typecheck`

No arbitrary shell command execution is exposed.

### Constrained git operations

- `git_create_branch`
- `git_commit`
- `git_push_branch`
- `git_open_pull_request`

These operations are intentionally narrow:

- branches named `main` or `master` are protected
- pushes go to `origin` only
- force-push is not implemented
- branch deletion is not implemented
- pull requests must originate from a non-protected branch

## Why the boundaries are strict

This repository models physical access-control flows for a school. Even in a demo environment, maintenance automation should be **auditable, least-privilege, and fail-closed**.

The MCP profile therefore avoids:

- unrestricted shell access
- reading deployed secret files or VCS internals
- direct write access to the default branch
- destructive git operations such as force-push or branch deletion

That keeps routine maintenance practical while reducing the chance of unsafe door-control changes, secret leakage, or unaudited history rewrites.

## Using the profile

Point an MCP-capable client at `mcp/mcp.json`, or copy the `balwyn-repo-guard` entry into your user-level MCP settings and keep the working directory at the repository root.

If you need broader capabilities, add them deliberately in code review rather than replacing this profile with a general shell bridge.
