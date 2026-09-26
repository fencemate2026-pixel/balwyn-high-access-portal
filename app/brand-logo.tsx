// Original transparent Magic Keys artwork. tone="dark" uses the pre-rendered
// on-dark version (white ink, bright blue key) for navy backgrounds, so no CSS
// filter is needed and the logo cannot disappear into the sidebar.
export default function BrandLogo({ className = "", tone = "light" }: { className?: string; tone?: "light" | "dark" }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img className={`magic-brand-logo ${className}`} src={tone === "dark" ? "/magic-keys-logo-on-dark.png" : "/magic-keys-logo.png"} width={800} height={330}
      alt="Magic Keys — Secure access. Safer schools. Protecting futures." decoding="sync" loading="eager" />
  );
}
