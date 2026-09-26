// Use the original transparent Magic Keys artwork without recolouring it.
export default function BrandLogo({ className = "" }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img className={`magic-brand-logo ${className}`} src="/magic-keys-logo.png" width={800} height={330}
      alt="Magic Keys — Secure access. Safer schools. Protecting futures." decoding="sync" loading="eager" />
  );
}
