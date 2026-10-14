"use client";

import { useRouter } from "next/navigation";

export function LogoutButton({ onDark = false }: { onDark?: boolean }) {
  const router = useRouter();
  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }
  return (
    <button onClick={signOut} className={onDark ? "btn-on-dark" : "btn-quiet"} type="button">
      Sign out
    </button>
  );
}
