// The real Magic Keys logo, unaltered artwork, pre-cropped to the logo itself
// with a transparent background (public/magic-keys-logo.png, 800 x 330).
//
// Previously this was an SVG that cropped the full 1254 x 1254 square with a
// viewBox and relied on an SVG filter to hide the white backing. The shared
// .magic-brand-logo rule sets overflow: visible, so the uncropped white square
// spilled outside the logo card on the login page. A plain image cannot spill.
export default function BrandLogo({ className = "" }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static brand asset, fixed size, no optimisation needed
    <img
      className={`magic-brand-logo ${className}`}
      src="/magic-keys-logo.png"
      width={800}
      height={330}
      alt="Magic Keys — Secure access. Safer schools. Protecting futures."
      decoding="async"
    />
  );
}
