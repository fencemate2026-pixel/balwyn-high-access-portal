import { useId } from "react";

// Keep the original transparent artwork; map its dark ink to white and blue
// ink to bright blue at render time, consistently on every branded screen.
export default function BrandLogo({ className = "" }: { className?: string }) {
  const filterId = `magic-keys-${useId().replace(/:/g, "")}`;
  return <>
    <svg width="0" height="0" aria-hidden="true" style={{ position: "absolute", pointerEvents: "none" }}>
      <defs><filter id={filterId} colorInterpolationFilters="sRGB">
        <feColorMatrix type="matrix" values="1 0 -1 0 1  .45 0 -.45 0 1  0 0 0 0 1  0 0 0 1 0" />
      </filter></defs>
    </svg>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img className={`magic-brand-logo ${className}`} src="/magic-keys-logo.png" width={800} height={330}
      style={{ filter: `url(#${filterId})` }}
      alt="Magic Keys — Secure access. Safer schools. Protecting futures." decoding="sync" loading="eager" />
  </>;
}
