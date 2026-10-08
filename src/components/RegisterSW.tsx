"use client";

import { useEffect } from "react";

export function RegisterSW() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // In development, make sure no stale service worker/caches are serving old
    // assets — unregister everything instead of caching.
    if (process.env.NODE_ENV !== "production") {
      navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister()));
      if (window.caches) caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
      return;
    }

    // When the new (pass-through) SW takes control, reload once so any device
    // that had stale cached chunks picks up fresh assets automatically.
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });

    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* best-effort */
    });
  }, []);
  return null;
}
