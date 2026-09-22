#!/usr/bin/env python3
"""
Log WHY Google sign-in fails instead of swallowing it.

app/api/auth/google/route.ts wraps the whole credential exchange in one
`catch {}` that logs a fixed string. That hides which step failed: the
challenge lookup, Google's certificate fetch, portal seeding, the snapshot
read, or the session cookie.

This logs the error's name and message only. No credentials, no tokens, no
request bodies. The response the browser sees is unchanged.

Verifies before writing. If the file has drifted, nothing is modified.
"""
import sys, pathlib

OLD = '''  } catch {
    console.error("Google sign-in could not be completed.");
    return Response.json({ error: "Google sign-in is temporarily unavailable." }, { status: 503, headers });
  }'''

NEW = '''  } catch (error) {
    // Name + message only. Never the credential, the state or the database key.
    console.error("google_signin_failed", {
      name: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
    });
    return Response.json({ error: "Google sign-in is temporarily unavailable." }, { status: 503, headers });
  }'''

root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".")
path = root / "app/api/auth/google/route.ts"
if not path.exists():
    sys.exit(f"ABORT: {path} not found. Run this from the repository root.")
text = path.read_text(encoding="utf-8")
n = text.count(OLD)
if n != 1:
    sys.exit(f"ABORT: expected 1 match, found {n}. Nothing changed.")
path.write_text(text.replace(OLD, NEW), encoding="utf-8")
print("patched  app/api/auth/google/route.ts")
print("Now: npm run build   then commit and push.")
