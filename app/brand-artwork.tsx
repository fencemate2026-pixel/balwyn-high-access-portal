import { useId } from "react";
import BrandLogo from "./brand-logo";
import AiFaceFx from "./ai-face-fx";

// Lay out the existing logo and AI artwork independently so neither is stretched
// or confined to the old split-screen Balwyn background.
//
// tone="light" (default): the original artwork on white, as used on the public home page.
// tone="dark": the sign-in stage. The AI head is drawn from
// /magic-keys-ai-head-clear.png — the same artwork with its white background
// removed — so it sits on the dark glass stage without a white box behind it.
export default function BrandArtwork({ className = "", fillHeight = false, tone = "light" }: { className?: string; fillHeight?: boolean; tone?: "light" | "dark" }) {
  const aiHeadClipId = useId();

  if (tone === "dark") {
    return (
      <div className={`magic-wide-artwork is-dark ${className}`}>
        <BrandLogo className="magic-wide-wordmark" />
        {/* eslint-disable-next-line @next/next/no-img-element -- decorative local artwork with transparency */}
        <img className="magic-wide-ai-head" src="/magic-keys-ai-head-clear.png" width={463} height={984} alt="" aria-hidden="true" decoding="async" />
      </div>
    );
  }

  return (
    <div className={`magic-wide-artwork ${className}`}>
      <BrandLogo className="magic-wide-wordmark" />
      <svg className="magic-wide-ai-head" viewBox="800 0 463 984" preserveAspectRatio={fillHeight ? "xMinYMid slice" : "xMaxYMid meet"} aria-hidden="true" focusable="false">
        <defs>
          <clipPath id={aiHeadClipId} clipPathUnits="userSpaceOnUse">
            <rect x="800" y="0" width="463" height="984" />
          </clipPath>
        </defs>
        <image href="/magic-keys-brand-background.png" width="1263" height="984" clipPath={`url(#${aiHeadClipId})`} />
      </svg>
      {/* Sign-in panel only: animated light over the AI face (decorative, reduced-motion safe). */}
      {fillHeight && <AiFaceFx />}
    </div>
  );
}
