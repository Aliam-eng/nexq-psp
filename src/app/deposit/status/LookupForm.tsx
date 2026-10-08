"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function LookupForm({ initial }: { initial: string }) {
  const router = useRouter();
  const [ref, setRef] = useState(initial);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = ref.trim();
    if (v) router.push(`/deposit/status?ref=${encodeURIComponent(v)}`);
  }

  return (
    <form onSubmit={submit} className="flex gap-2">
      <input
        value={ref}
        onChange={(e) => setRef(e.target.value)}
        placeholder="NEXQ-XXXXXXXX"
        className="field-input flex-1 font-mono"
      />
      <button type="submit" className="btn-primary shrink-0">
        Track →
      </button>
    </form>
  );
}
