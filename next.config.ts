import type { NextConfig } from "next";

// Security headers on every response.
// - HSTS: browsers only ever use HTTPS for this domain (1 year).
// - Permissions-Policy: the portal never needs camera, microphone, location,
//   payment or USB access, so browsers refuse them outright.
// - Content-Security-Policy is ENFORCED (30 Oct 2026, audit M4). It ran in
//   report-only mode first; on 30 Oct 2026 the public pages and all 10 signed-in
//   sections showed zero violations in a real browser (a securitypolicyviolation
//   listener, proven by a deliberate test violation it caught). If a
//   legitimate source is ever blocked, add it to the matching directive below
//   rather than returning to report-only.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://accounts.google.com",
  "style-src 'self' 'unsafe-inline' https://accounts.google.com",
  "img-src 'self' data: blob: https://*.googleusercontent.com",
  "font-src 'self' data:",
  "connect-src 'self' https://accounts.google.com",
  // 'self': the CCTV and Emergency guidance pages frame /dashboard-illustration.html.
  "frame-src 'self' https://accounts.google.com",
  "frame-ancestors 'self'",
  "form-action 'self' https://login.microsoftonline.com",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

const config: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
      { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
      { key: "Content-Security-Policy", value: csp },
    ] }];
  },
};
export default config;
