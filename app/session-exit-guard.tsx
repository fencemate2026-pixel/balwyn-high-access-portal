"use client";

import { useEffect } from "react";

// Signs the operator out the moment they leave the portal.
//
// - Closing the tab or window, navigating to another site, or reloading the
//   page fires `pagehide`; a logout beacon is sent, which clears the session
//   and admin-unlock cookies on the server response.
// - The session cookie itself has no Max-Age (lib/portal-auth.ts), so closing
//   the browser also discards it even if the beacon never arrives.
// - If the browser restores the page from its back/forward cache, the page is
//   reloaded so the cleared session takes effect and the login screen shows.
//
// Site decision (23 Sep 2026): staff are signed out whenever they leave the
// site, regardless of how. Reloading the page therefore also signs out.
export default function SessionExitGuard() {
  useEffect(() => {
    const signOut = () => {
      try {
        // Empty text body keeps this a simple same-origin POST the logout
        // route accepts; sendBeacon survives the page being torn down.
        navigator.sendBeacon("/api/auth/logout", new Blob([""], { type: "text/plain" }));
      } catch {
        // Browser refused the beacon; the session cookie still dies with the browser.
      }
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.reload();
    };
    window.addEventListener("pagehide", signOut);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("pagehide", signOut);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);
  return null;
}
