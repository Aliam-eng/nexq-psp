"use client";

import { useState } from "react";
import { SettingsSection } from "./SettingsForms";

export function ChangePassword({ email }: { email: string }) {
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNew] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (newPassword !== confirm) {
      setMsg({ ok: false, text: "New passwords do not match" });
      return;
    }
    setSaving(true);
    const res = await fetch("/api/account/password", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (res.ok) {
      setMsg({ ok: true, text: "Password updated." });
      setCurrent("");
      setNew("");
      setConfirm("");
    } else {
      setMsg({ ok: false, text: data.error || "Could not update password" });
    }
  }

  return (
    <SettingsSection
      title="Your account"
      desc={<>Signed in as <span className="font-semibold text-ink">{email}</span>. Use a long, unique password.</>}
      onSubmit={submit}
      footer={
        <>
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? "Saving…" : "Change password"}
          </button>
          {msg && <span className={`text-sm font-semibold ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</span>}
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block">
          <span className="field-label">Current password</span>
          <input type="password" required autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrent(e.target.value)} className="field-input" />
        </label>
        <label className="block">
          <span className="field-label">New password</span>
          <input type="password" required autoComplete="new-password" value={newPassword} onChange={(e) => setNew(e.target.value)} className="field-input" />
        </label>
        <label className="block">
          <span className="field-label">Confirm new</span>
          <input type="password" required autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="field-input" />
        </label>
      </div>
    </SettingsSection>
  );
}
