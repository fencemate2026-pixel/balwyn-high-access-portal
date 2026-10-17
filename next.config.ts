import type { NextConfig } from "next";

// Security headers on every response.
// - HSTS: browsers only ever use HTTPS for this domain (1 year).
// - Permissions-Policy: the portal never needs camera, microphone, location,
//   payment or USB access, so browsers refuse them outright.
// - Content-Security-Policy is now ENFORCED (AUDIT_SECURITY P2, 18 Oct 2026:
//   a week of report-only traffic showed nothing legitimate being blocked).
//   script-src no longer needs 'unsafe-inline': a repo-wide search found no
//   inline <script> tag or inline event-handler attribute anywhere in app/ or
//   components/ (the Google Identity button loads via a dynamically created
//   <script src="https://accounts.google.com/...">, already covered by the
//   https://accounts.google.com source, never inline content).
//   style-src STILL needs 'unsafe-inline': the app renders React inline
//   `style={{...}}` props (computed per element, e.g. chart colours in
//   components/ui/chart.tsx) as HTML `style="..."` attributes, which CSP
//   governs under style-src/style-src-attr - and, unlike script-src, there is
//   no nonce mechanism for style ATTRIBUTES (only for <style> elements and
//   <link>), so removing 'unsafe-inline' here would require first replacing
//   every dynamic inline style with CSS custom properties/classes. That is a
//   real refactor across several components, out of scope for this pass -
//   TODO(security): do that refactor, then drop 'unsafe-inline' from
//   style-src too.
const csp = [
  "default-src 'self'",
  "script-src 'self' https://accounts.google.com",
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
