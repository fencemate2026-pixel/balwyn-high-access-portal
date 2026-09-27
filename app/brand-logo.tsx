// Magic Keys official artwork on a transparent background.
// tone="dark" uses the pre-rendered navy cut so black ink stays visible.
// Light tone uses public/magic-keys-logo.png (800 x 330).
export default function BrandLogo({ className = "", tone = "light" }: { className?: string; tone?: "light" | "dark" }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img className={`magic-brand-logo ${className}`} src={tone === "dark" ? "/magic-keys-logo-2026-on-dark.png" : "/magic-keys-logo.png"} width={800} height={330}
      alt="Magic Keys — Secure access. Safer environments. Protecting futures." decoding="sync" loading="eager" />
  );
}
