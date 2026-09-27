// Magic Keys 2026 artwork on a transparent background.
// tone="dark" uses a pre-rendered copy for navy backgrounds: the black "MAGIC"
// lettering and tagline are white there, the blue shield and key are unchanged.
// No CSS filter is used, so the logo cannot vanish into a dark sidebar.
// NOTE: the supplied artwork is 300 x 110 px. It is sharp up to about 300 CSS px
// wide on standard screens; larger placements need a higher-resolution original.
export default function BrandLogo({ className = "", tone = "light" }: { className?: string; tone?: "light" | "dark" }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img className={`magic-brand-logo ${className}`} src={tone === "dark" ? "/magic-keys-logo-2026-on-dark.png" : "/magic-keys-logo-2026.webp"} width={300} height={110}
      alt="Magic Keys — Secure access. Safer environments. Protecting futures." decoding="sync" loading="eager" />
  );
}
