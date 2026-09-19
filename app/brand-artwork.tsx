import { useId } from "react";
import BrandLogo from "./brand-logo";

// Lay out the existing logo and AI artwork independently so neither is stretched
// or confined to the old split-screen Balwyn background.
export default function BrandArtwork({ className = "" }: { className?: string }) {
  const aiHeadClipId = useId();

  return (
    <div className={`magic-wide-artwork ${className}`}>
      <BrandLogo className="magic-wide-wordmark" />
      <svg className="magic-wide-ai-head" viewBox="800 0 463 984" preserveAspectRatio="xMaxYMid meet" aria-hidden="true" focusable="false">
        <defs>
          <clipPath id={aiHeadClipId} clipPathUnits="userSpaceOnUse">
            <rect x="800" y="0" width="463" height="984" />
          </clipPath>
        </defs>
        <image href="/magic-keys-brand-background.png" width="1263" height="984" clipPath={`url(#${aiHeadClipId})`} />
      </svg>
    </div>
  );
}
