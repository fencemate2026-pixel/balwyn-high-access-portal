#!/usr/bin/env python3
"""Check the configured static publication. Requires Python 3.11+, no packages.

This is a content/asset check, not authentication or hardware verification.
No network requests or relay commands are made. Credentials are never printed.
"""
import argparse
import base64
import json
import os
from pathlib import Path
import re
import sys
import tomllib
from html.parser import HTMLParser
from urllib.parse import unquote, urljoin, urlsplit


def publish_target(root, env):
    config = tomllib.loads((root / "netlify.toml").read_text())
    build = dict(config.get("build", {}))
    contexts = config.get("context", {})
    context = env.get("CONTEXT") or "production"
    build.update(contexts.get(context, {}))
    branch = env.get("BRANCH")
    if branch and branch != context:
        build.update(contexts.get(branch, {}))
    publish = build.get("publish")
    if not isinstance(publish, str) or not publish.strip():
        raise ValueError("netlify.toml must explicitly configure build.publish")
    base = (root / build.get("base", ".")).resolve()
    target = (base / publish).resolve()
    if not target.is_relative_to(root.resolve()) or target == root.resolve():
        raise ValueError("Publication must be a dedicated directory inside the repository")
    override = env.get("NETLIFY_OUT_DIR")
    if override and (root / override).resolve() != target:
        raise ValueError("NETLIFY_OUT_DIR differs from the configured publication directory")
    if env.get("ALLOW_DETACHED_SCAN") == "1":
        raise ValueError("Detached scans are not permitted by the deployment gate")
    return target, base


class AssetReferences(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.refs = []
        self.base = None
        self.preview = False

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        if tag == "base" and self.base is None and attrs.get("href"):
            self.base = attrs["href"]
        if tag == "meta" and (attrs.get("name") or "").lower() == "codex-preview":
            self.preview = True
        for name in ("src", "href"):
            ref = attrs.get(name)
            if ref and urlsplit(ref).path.lower().endswith((".js", ".mjs", ".css")):
                self.refs.append(ref)

    handle_startendtag = handle_starttag


JWT = re.compile(r"(?<![\w-])([A-Za-z0-9_-]{8,})\.([A-Za-z0-9_-]{8,})\.([A-Za-z0-9_-]{4,})(?![\w-])")
MARKERS = (
    ("privileged credential reference", re.compile(r"service_role|SUPABASE_SERVICE_ROLE|sb_secret_[A-Za-z0-9_-]{8,}")),
    ("localhost URL", re.compile(r"https?://(?:localhost|127[.]0[.]0[.]1)(?=[:/\s\"'?#]|$)", re.I)),
    ("superseded facility name", re.compile(r"Tom Frizza")),
    ("development preview metadata", re.compile(r"name\s*=\s*[\"']?codex-preview", re.I)),
)


def check_output(target):
    errors = []
    required_name = False
    index = target / "index.html"
    if not target.is_dir():
        return ["Publication directory does not exist"]
    if not index.is_file() or index.stat().st_size < 1024:
        errors.append("index.html is missing or smaller than 1 KB")

    def walk_error(error):
        raise error

    for directory, dirs, files in os.walk(target, onerror=walk_error, followlinks=False):
        for name in dirs + files:
            if (Path(directory) / name).is_symlink():
                errors.append(f"Symlink cannot be verified: {(Path(directory) / name).relative_to(target)}")
        for name in files:
            path = Path(directory) / name
            if path.is_symlink():
                continue
            relative = path.relative_to(target)
            # Read failures propagate and block deployment. Binary files are read too.
            text = path.read_bytes().decode("utf-8", errors="replace")
            required_name = required_name or "Tony Frizza" in text
            for label, pattern in MARKERS:
                if pattern.search(text):
                    errors.append(f"{label}: {relative}")
            for token in JWT.finditer(text):
                try:
                    segment = token.group(2)
                    payload = json.loads(base64.urlsafe_b64decode(segment + "=" * (-len(segment) % 4)))
                except (ValueError, UnicodeError):
                    continue
                if isinstance(payload, dict) and payload.get("role") == "service_role":
                    errors.append(f"Privileged JWT claim: {relative}")
                    break
            if path.suffix.lower() != ".html":
                continue
            parser = AssetReferences()
            parser.feed(text)
            if parser.preview:
                errors.append(f"development preview metadata: {relative}")
            page_url = "https://publication.invalid/" + relative.as_posix()
            base_url = urljoin(page_url, parser.base) if parser.base else page_url
            for ref in parser.refs:
                url = urlsplit(urljoin(base_url, ref))
                if url.scheme not in ("http", "https") or url.netloc != "publication.invalid":
                    continue
                candidate = (target / unquote(url.path).lstrip("/")).resolve()
                if not candidate.is_relative_to(target.resolve()) or not candidate.is_file():
                    # Do not print query strings, which may contain credentials.
                    errors.append(f"Missing local asset from {relative}: {url.path}")
    if not required_name:
        errors.append("Tony Frizza is absent from the publication")
    return sorted(set(errors))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument("--print-target", action="store_true")
    parser.add_argument("--print-base", action="store_true")
    args = parser.parse_args()
    try:
        target, base = publish_target(args.root.resolve(), os.environ)
        if args.print_target or args.print_base:
            print(base if args.print_base else target)
            return 0
        errors = check_output(target)
    except (OSError, ValueError, TypeError) as error:
        # OSError contents may include file contents only when callers supply them;
        # this scanner reports paths/errors only, never matching credential bytes.
        print(f"Verification could not complete: {error}", file=sys.stderr)
        return 2
    if errors:
        for error in errors:
            print(f"CHECK FAILED: {error}", file=sys.stderr)
        return 2
    print("Content and local JS/CSS asset checks passed for the configured publication.")
    print("This does not verify sign-in, dashboard behaviour, or physical gate operation.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
