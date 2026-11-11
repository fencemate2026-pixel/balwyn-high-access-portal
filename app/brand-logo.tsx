// Supplied Magic Keys lockup: schoolhouse shield, black MAGIC, blue KEYS,
// tagline "Secure access | Safer environments | Protecting futures."
// public/magic-keys-lockup.png is 1601 x 641 and transparent. Both tones use
// that file so the black stays black and the blue stays blue. Do not invert it.
// On a dark surface, put a white plate behind it in CSS. The black word is
// unreadable on navy.
export default function BrandLogo({ className = "", tone = "light" }: { className?: string; tone?: "light" | "dark" }) {
  void tone;
  return (
    <img
      className={`magic-brand-logo ${className}`}
      src="/magic-keys-lockup.png"
      width={1601}
      height={641}
      alt="Magic Keys — Secure access. Safer environments. Protecting futures."
      decoding="sync"
      loading="eager"
    />
  );
}
