import type { NextConfig } from "next";

// Security headers on every response.
// - HSTS: browsers only ever use HTTPS for this domain (1 year).
// - Permissions-Policy: the portal never needs camera, microphone, location,
//   payment or USB access, so browsers refuse them outright.
// - Content-Security-Policy is sent in REPORT-ONLY mode first: it reports what
//   would be blocked without blocking it, so Google sign-in cannot be broken
//   by a missed source. Switch the header name to "Content-Security-Policy"
//   once a week of browser reports shows nothing legitimate would be blocked.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://accounts.google.com",
  "style-src 'self' 'unsafe-inline' https://accounts.google.com",
  "img-src 'self' data: blob: https://*.googleusercontent.com",
  "font-src 'self' data:",
  "connect-src 'self' https://accounts.google.com",
  "frame-src https://accounts.google.com",
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
      { key: "Content-Security-Policy-Report-Only", value: csp },
    ] }];
  },
};
export default config;
