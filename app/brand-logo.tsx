// Render the supplied raster artwork without its empty outer canvas. The shared
// SVG filter makes the light backing transparent without redrawing the logo.
export default function BrandLogo({ className = "" }: { className?: string }) {
  return (
    <svg className={`magic-brand-logo ${className}`} viewBox="40 380 1184 488" role="img" aria-label="Magic Keys — Secure access. Safer schools. Protecting futures.">
      <image href="/magic-keys-school-logo.png" width="1254" height="1254" filter="url(#logo-clear-background)" />
    </svg>
  );
}
