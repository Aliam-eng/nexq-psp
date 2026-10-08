"use client";

import { useState } from "react";

type RivalCfg = {
  baseUrl: string;
  createPaymentPath: string;
  statusPath: string;
  healthPath: string;
  minDeposit: number;
  enabled: boolean;
  hasKey: boolean;
  hasWebhookSecret: boolean;
  webhookUrl: string;
};
type Mt5Cfg = {
  mt5Server: string;
  mt5Login: string;
  cryptMethod: "NONE" | "AES256OFB";
  defaultGroup: string;
  enabled: boolean;
  hasPassword: boolean;
};

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
        on ? "bg-brand shadow-glow-sm" : "bg-surface-overlay border border-line"
      }`}
    >
      <span className={`inline-block h-4 w-4 rounded-full bg-white transition ${on ? "translate-x-6" : "translate-x-1"}`} />
    </button>
  );
}

function TestResult({ text }: { text: string | null }) {
  if (!text) return null;
  const ok = text.toLowerCase().includes("connect") || text.toLowerCase().includes("reachable");
  return <span className={`text-sm ${ok ? "text-brand-400" : "text-ink-muted"}`}>{text}</span>;
}

export function SettingsForms({ rival, mt5 }: { rival: RivalCfg; mt5: Mt5Cfg }) {
  return (
    <div className="space-y-6">
      <RivalForm cfg={rival} />
      <Mt5Form cfg={mt5} />
    </div>
  );
}

function SectionHeader({ title, desc, on, onToggle }: { title: string; desc: string; on: boolean; onToggle: (v: boolean) => void }) {
  return (
    <div className="mb-5 flex items-start justify-between gap-4">
      <div>
        <h2 className="font-bold text-ink">{title}</h2>
        <p className="text-sm text-ink-muted">{desc}</p>
      </div>
      <div className="flex items-center gap-2 pt-0.5">
        <span className="text-xs text-ink-dim">{on ? "Enabled" : "Disabled"}</span>
        <Toggle on={on} onChange={onToggle} />
      </div>
    </div>
  );
}

function RivalForm({ cfg }: { cfg: RivalCfg }) {
  const [form, setForm] = useState({ ...cfg, apiKey: "", webhookSecret: "" });
  const [copied, setCopied] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [test, setTest] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    const res = await fetch("/api/config/rival", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey: form.apiKey || undefined,
        baseUrl: form.baseUrl || undefined,
        createPaymentPath: form.createPaymentPath || undefined,
        statusPath: form.statusPath || undefined,
        healthPath: form.healthPath || undefined,
        minDeposit: Number(form.minDeposit) || 0,
        webhookSecret: form.webhookSecret || undefined,
        enabled: form.enabled,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    setMsg(res.ok ? "Saved." : data.error || "Save failed");
    if (res.ok) setForm((f) => ({ ...f, apiKey: "", webhookSecret: "", hasKey: data.hasKey, hasWebhookSecret: data.hasWebhookSecret }));
  }

  async function runTest() {
    setTest("Testing…");
    const res = await fetch("/api/config/rival/test", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setTest(data.ok ? `Reachable (${data.detail})` : `Unreachable: ${data.detail || data.error}`);
  }

  return (
    <form onSubmit={save} className="card p-6 animate-fade-up">
      <SectionHeader
        title="Rival · Whish Pay"
        desc="Payment provider API key and endpoint."
        on={form.enabled}
        onToggle={(v) => setForm({ ...form, enabled: v })}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="API key (Bearer)" hint={cfg.hasKey ? "A key is saved · leave blank to keep it" : "tsk_<prefix>_<secret>"}>
          <input type="password" placeholder={cfg.hasKey ? "•••••••• (unchanged)" : "tsk_…"} value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} className="field-input" />
        </Field>
        <Field label="Base URL" hint="Include /v1">
          <input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} className="field-input" />
        </Field>
        <Field label="Create payment path">
          <input value={form.createPaymentPath} onChange={(e) => setForm({ ...form, createPaymentPath: e.target.value })} className="field-input" />
        </Field>
        <Field label="Status path" hint="Use {id} placeholder">
          <input value={form.statusPath} onChange={(e) => setForm({ ...form, statusPath: e.target.value })} className="field-input" />
        </Field>
        <Field label="Health path">
          <input value={form.healthPath} onChange={(e) => setForm({ ...form, healthPath: e.target.value })} className="field-input" />
        </Field>
        <Field label="Minimum deposit (USD)" hint="Clients can't deposit less than this">
          <input
            type="number"
            min="0"
            step="0.01"
            value={form.minDeposit}
            onChange={(e) => setForm({ ...form, minDeposit: e.target.value as unknown as number })}
            className="field-input font-mono"
          />
        </Field>
        <Field label="Webhook secret" hint={cfg.hasWebhookSecret ? "Saved · leave blank to keep" : "verifies incoming Rival webhooks"}>
          <input
            type="password"
            placeholder={cfg.hasWebhookSecret ? "•••••••• (unchanged)" : ""}
            value={form.webhookSecret}
            onChange={(e) => setForm({ ...form, webhookSecret: e.target.value })}
            className="field-input"
          />
        </Field>
      </div>

      <div className="mt-4 rounded-xl border border-line bg-surface-raised/40 p-3.5">
        <p className="text-[13px] font-medium text-ink-muted">Webhook URL — register this in Rival</p>
        <div className="mt-1.5 flex items-center gap-2">
          <code className="flex-1 truncate rounded-lg bg-bg/60 px-3 py-2 font-mono text-xs text-brand-400">{cfg.webhookUrl}</code>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(cfg.webhookUrl);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="btn-ghost px-3 py-1.5 text-xs"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="field-hint">Rival calls this on payment events; we then re-check status and credit MT5.</p>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={saving} className="btn-primary">{saving ? "Saving…" : "Save"}</button>
        <button type="button" onClick={runTest} className="btn-ghost">Test connection</button>
        {msg && <span className="text-sm text-ink-muted">{msg}</span>}
        <TestResult text={test} />
      </div>
    </form>
  );
}

function Mt5Form({ cfg }: { cfg: Mt5Cfg }) {
  const [form, setForm] = useState({ ...cfg, mt5Password: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const [test, setTest] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    const res = await fetch("/api/config/mt5", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mt5Server: form.mt5Server || undefined,
        mt5Login: form.mt5Login || undefined,
        mt5Password: form.mt5Password || undefined,
        cryptMethod: form.cryptMethod,
        defaultGroup: form.defaultGroup || undefined,
        enabled: form.enabled,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    setMsg(res.ok ? "Saved." : data.error || "Save failed");
    if (res.ok) setForm((f) => ({ ...f, mt5Password: "", hasPassword: data.hasPassword }));
  }

  async function runTest() {
    setTesting(true);
    setTest("Connecting…");
    const res = await fetch("/api/config/mt5/test", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setTesting(false);
    setTest(data.ok ? `Connected (${data.detail})` : `Failed: ${data.detail || data.error}`);
  }

  return (
    <form onSubmit={save} className="card p-6 animate-fade-up">
      <SectionHeader
        title="MT5 · WebAPI"
        desc="Direct WebAPI connection used to credit deposits to MT5."
        on={form.enabled}
        onToggle={(v) => setForm({ ...form, enabled: v })}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="WebAPI host : port" hint="e.g. 185.67.127.231:443">
          <input value={form.mt5Server} onChange={(e) => setForm({ ...form, mt5Server: e.target.value })} placeholder="host:port" className="field-input font-mono" />
        </Field>
        <Field label="Manager login" hint="must have WebAPI access enabled by the broker">
          <input value={form.mt5Login} onChange={(e) => setForm({ ...form, mt5Login: e.target.value })} placeholder="1001" className="field-input font-mono" />
        </Field>
        <Field label="Manager password" hint={cfg.hasPassword ? "Saved · leave blank to keep" : "WebAPI manager password"}>
          <input type="password" placeholder={cfg.hasPassword ? "•••••••• (unchanged)" : ""} value={form.mt5Password} onChange={(e) => setForm({ ...form, mt5Password: e.target.value })} className="field-input" />
        </Field>
        <Field label="Crypt method" hint="AES256OFB support coming — use NONE for now">
          <select value={form.cryptMethod} onChange={(e) => setForm({ ...form, cryptMethod: e.target.value as Mt5Cfg["cryptMethod"] })} className="field-input appearance-none">
            <option value="NONE" className="bg-surface text-ink">NONE</option>
            <option value="AES256OFB" className="bg-surface text-ink">AES256OFB</option>
          </select>
        </Field>
        <Field label="Default MT5 group" hint="optional">
          <input value={form.defaultGroup} onChange={(e) => setForm({ ...form, defaultGroup: e.target.value })} className="field-input" />
        </Field>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={saving} className="btn-primary">{saving ? "Saving…" : "Save"}</button>
        <button type="button" onClick={runTest} disabled={testing} className="btn-ghost">{testing ? "Testing…" : "Test connection"}</button>
        {msg && <span className="text-sm text-ink-muted">{msg}</span>}
        <TestResult text={test} />
      </div>
    </form>
  );
}
