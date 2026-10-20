"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ADMIN_ROLE, OPERATOR_ROLE, ROLE_LABEL } from "@/lib/roles";

type StaffUser = { id: string; email: string; name: string | null; role: string; isActive: boolean; createdAt: string };

function generatePassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint32Array(14));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

export function StaffManager({ users, meId }: { users: StaffUser[]; meId: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function patch(id: string, body: Record<string, unknown>, okText: string) {
    setMsg(null);
    const res = await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    setMsg(res.ok ? { ok: true, text: okText } : { ok: false, text: data.error || "Update failed" });
    if (res.ok) router.refresh();
  }

  async function resetPassword(u: StaffUser) {
    const pw = generatePassword();
    await patch(u.id, { password: pw }, `New password for ${u.email}: ${pw} — share it securely; they can change it in Settings.`);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <section className="card overflow-hidden">
        <div className="border-b border-line px-5 py-4">
          <h2 className="font-extrabold text-ink">Accounts</h2>
          <p className="text-sm text-ink-muted">{users.filter((u) => u.isActive).length} active</p>
        </div>
        {msg && (
          <p className={`border-b border-line px-5 py-3 text-sm font-medium ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-danger"}`}>
            {msg.text}
          </p>
        )}
        <ul className="divide-y divide-line">
          {users.map((u) => {
            const me = u.id === meId;
            return (
              <li key={u.id} className={`flex flex-wrap items-center gap-4 px-5 py-4 ${u.isActive ? "" : "opacity-60"}`}>
                <span className="bg-brand-gradient grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-bold uppercase text-white">
                  {u.email.charAt(0)}
                </span>
                <div className="min-w-0 flex-1 basis-[calc(100%-3.5rem)] sm:basis-auto">
                  <p className="truncate text-sm font-bold text-ink">
                    {u.name || u.email} {me && <span className="font-normal text-ink-dim">(you)</span>}
                  </p>
                  <p className="truncate text-xs text-ink-muted">
                    {u.email} · {u.isActive ? "Active" : "Disabled"}
                  </p>
                </div>
                <select
                  aria-label={`Role for ${u.email}`}
                  value={u.role}
                  disabled={me}
                  onChange={(e) => patch(u.id, { role: e.target.value }, `${u.email} is now ${ROLE_LABEL[e.target.value]}`)}
                  className="field-input ml-14 w-auto appearance-none py-1.5 pr-8 text-xs font-semibold sm:ml-0"
                >
                  <option value={ADMIN_ROLE}>Admin</option>
                  <option value={OPERATOR_ROLE}>Operator</option>
                </select>
                <div className="flex gap-2">
                  <button onClick={() => resetPassword(u)} className="btn-ghost px-3 py-1.5 text-xs">
                    Reset password
                  </button>
                  {!me && (
                    <button
                      onClick={() => patch(u.id, { isActive: !u.isActive }, `${u.email} ${u.isActive ? "disabled" : "enabled"}`)}
                      className={`btn px-3 py-1.5 text-xs ${u.isActive ? "border border-rose-200 bg-white text-danger hover:bg-rose-50" : "btn-ghost"}`}
                    >
                      {u.isActive ? "Disable" : "Enable"}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <CreateStaff onCreated={() => router.refresh()} />
    </div>
  );
}

function CreateStaff({ onCreated }: { onCreated: () => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState(OPERATOR_ROLE);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, name, role, password }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMsg({ ok: false, text: data.error || "Could not create the account" });
    setMsg({ ok: true, text: `Created ${email}. Share the password securely — they can change it in Settings.` });
    setEmail("");
    setName("");
    setPassword("");
    onCreated();
  }

  return (
    <form onSubmit={create} className="card h-fit overflow-hidden">
      <div className="bg-brand-gradient h-1" />
      <div className="space-y-4 p-5">
        <div>
          <h2 className="font-extrabold text-ink">Add a staff account</h2>
          <p className="text-sm text-ink-muted">They sign in at /login.</p>
        </div>
        <label className="block">
          <span className="field-label">Email</span>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="field-input" />
        </label>
        <label className="block">
          <span className="field-label">Name <span className="font-normal text-ink-dim">· optional</span></span>
          <input value={name} onChange={(e) => setName(e.target.value)} className="field-input" />
        </label>
        <div>
          <span className="field-label">Role</span>
          <div className="grid grid-cols-2 gap-2">
            {[
              { v: OPERATOR_ROLE, t: "Operator", d: "Deposits & withdrawals" },
              { v: ADMIN_ROLE, t: "Admin", d: "Everything + settings" },
            ].map((o) => (
              <button
                key={o.v}
                type="button"
                onClick={() => setRole(o.v)}
                className={`rounded-xl border p-3 text-left transition ${role === o.v ? "border-brand bg-brand/10" : "border-line hover:border-line-strong"}`}
              >
                <span className="block text-sm font-bold text-ink">{o.t}</span>
                <span className="block text-xs text-ink-muted">{o.d}</span>
              </button>
            ))}
          </div>
        </div>
        <label className="block">
          <span className="field-label">Temporary password</span>
          <div className="flex gap-2">
            <input required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className="field-input font-mono" />
            <button type="button" onClick={() => setPassword(generatePassword())} className="btn-ghost shrink-0 px-3 text-xs">
              Generate
            </button>
          </div>
          <span className="field-hint">At least 8 characters.</span>
        </label>
        {msg && (
          <p className={`rounded-xl px-3.5 py-2.5 text-sm font-medium ${msg.ok ? "bg-emerald-50 text-emerald-800" : "border border-danger/30 bg-rose-50 text-danger"}`}>
            {msg.text}
          </p>
        )}
        <button type="submit" disabled={busy} className="btn-primary w-full">
          {busy ? "Creating…" : "Create account"}
        </button>
      </div>
    </form>
  );
}
