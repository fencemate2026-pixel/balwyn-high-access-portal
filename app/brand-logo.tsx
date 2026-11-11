// Official 2026 Magic Keys mark: shield and key, blue wordmark, transparent background.
// public/magic-keys-logo-2026.webp is 300 x 110. Both tones use that file so the
// blues stay blue. Do not invert or recolour it in CSS.
export default function BrandLogo({ className = "", tone = "light" }: { className?: string; tone?: "light" | "dark" }) {
  void tone;
  return (
    <img
      className={`magic-brand-logo ${className}`}
      src="/magic-keys-logo-2026.webp"
      width={300}
      height={110}
      alt="Magic Keys — Secure access. Safer environments. Protecting futures."
      decoding="sync"
      loading="eager"
    />
  );
}
