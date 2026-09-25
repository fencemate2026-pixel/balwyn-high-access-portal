#!/usr/bin/env node
/**
 * Build gate: fail if compiled CSS contains any purple/violet colour.
 * Usage:  node scripts/check-no-purple.mjs [dir]   (default .next/static)
 * Checks #rgb, #rrggbb, rgb(), rgba() literals.
 * Banned: hue 255-330 deg AND saturation > 20 % AND lightness 8-95 %
 * (so near-black / near-white greys with a faint tint do not trip it).
 * Exit 0 clean | 1 purple found | 2 no CSS found (a build with no CSS is itself wrong).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2] ?? ".next/static";
const files = [];
(function walk(d) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".css")) files.push(p);
  }
})(root);
if (files.length === 0) { console.error(`check-no-purple: no .css under ${root}`); process.exit(2); }

/** RGB 0-255 -> [hue deg, saturation 0-1, lightness 0-1] */
function hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (d === 0) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

const hits = [];
const re = /#([0-9a-f]{6}|[0-9a-f]{3})\b|rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/gi;
for (const f of files) {
  const css = readFileSync(f, "utf8");
  for (const m of css.matchAll(re)) {
    let r, g, b;
    if (m[1]) {
      const x = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
      [r, g, b] = [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16));
    } else [r, g, b] = [m[2], m[3], m[4]].map(Number);
    const [h, s, l] = hsl(r, g, b);
    if (h >= 255 && h <= 330 && s > 0.2 && l > 0.08 && l < 0.95) {
      const ctx = css.slice(Math.max(0, m.index - 50), m.index).replace(/\s+/g, " ");
      hits.push(`  ${f}: ${m[0]} (hue ${Math.round(h)}) ...${ctx}`);
    }
  }
}
if (hits.length) { console.error(`check-no-purple: FAIL, ${hits.length} purple colour(s)\n${hits.join("\n")}`); process.exit(1); }
console.log(`check-no-purple: clean (${files.length} CSS files)`);
