"use client";

import { useState } from "react";

type WhishCfg = {
  baseUrl: string;
  channel: string;
  websiteUrl: string;
  userAgent: string;
  minDeposit: number;
  enabled: boolean;
  withdrawalsEnabled: boolean;
  hasSecret: boolean;
  callbackUrl: string;
  envFields: ("baseUrl" | "channel" | "secret" | "websiteUrl" | "userAgent")[]; // pinned by server .env
};

const ENV_HINT = "Set on the server (.env) — edit it there";

const WHISH_ENVIRONMENTS = [
  { label: "Sandbox", url: "https://partner.api.sbx.whish.money/itel-service/api" },
  { label: "Production", url: "https://api.whish.money/itel-service/api" },
];
type ThreePayCfg = {
  baseUrl: string;
  apiKey: string;
  hasApiSecret: boolean;
  hasWebhookSecret: boolean;
  minDeposit: number;
  enabled: boolean;
  withdrawalsEnabled: boolean;
  webhookUrl: string;
  envFields: ("baseUrl" | "apiKey" | "apiSecret" | "webhookSecret")[]; // pinned by server .env
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
  return <span className={`text-sm font-semibold ${ok ? "text-success" : "text-danger"}`}>{text}</span>;
}

export function SettingsForms({ whish, threepay, mt5 }: { whish: WhishCfg; threepay: ThreePayCfg; mt5: Mt5Cfg }) {
  return (
    <>
      <WhishForm cfg={whish} />
      <ThreePayForm cfg={threepay} />
      <Mt5Form cfg={mt5} />
    </>
  );
}

// Two-column settings row: what it is on the left, the form card on the right.
export function SettingsSection({
  title,
  desc,
  toggles,
  onSubmit,
  footer,
  children,
}: {
  title: string;
  desc: React.ReactNode;
  toggles?: { label: string; on: boolean; onChange: (v: boolean) => void }[];
  onSubmit: (e: React.FormEvent) => void;
  footer: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-5 border-b border-line py-8 first:pt-0 last:border-0 md:grid-cols-[260px_1fr] md:gap-10">
      <div>
        <h2 className="text-base font-extrabold text-ink">{title}</h2>
        <p className="mt-1 text-sm leading-relaxed text-ink-muted">{desc}</p>
        {toggles && toggles.length > 0 && (
          <div className="mt-4 divide-y divide-line rounded-xl border border-line bg-surface">
            {toggles.map((t) => (
              <div key={t.label} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <span className="text-sm font-semibold text-ink">{t.label}</span>
                <span className="flex items-center gap-2">
                  <span className={`text-xs font-semibold ${t.on ? "text-success" : "text-ink-dim"}`}>{t.on ? "Live" : "Off"}</span>
                  <Toggle on={t.on} onChange={t.onChange} />
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      <form onSubmit={onSubmit} className="card overflow-hidden">
        <div className="p-6">{children}</div>
        <div className="flex flex-wrap items-center gap-3 border-t border-line bg-surface-raised px-6 py-3.5">{footer}</div>
      </form>
    </section>
  );
}

function WhishForm({ cfg }: { cfg: WhishCfg }) {
  const [form, setForm] = useState({ ...cfg, secret: "" });
  const [copied, setCopied] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [test, setTest] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const preset = WHISH_ENVIRONMENTS.find((e) => e.url === form.baseUrl);
  const pinned = (f: WhishCfg["envFields"][number]) => cfg.envFields.includes(f);
  // Only send fields this form actually controls; env-pinned ones are ignored server-side anyway.
  const editable = (f: WhishCfg["envFields"][number], v: string) => (pinned(f) ? undefined : v || undefined);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    const res = await fetch("/api/config/whish", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseUrl: editable("baseUrl", form.baseUrl),
        channel: editable("channel", form.channel),
        secret: editable("secret", form.secret),
        websiteUrl: editable("websiteUrl", form.websiteUrl),
        userAgent: editable("userAgent", form.userAgent),
        minDeposit: Number(form.minDeposit) || 0,
        enabled: form.enabled,
        withdrawalsEnabled: form.withdrawalsEnabled,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    setMsg(res.ok ? "Saved." : data.error || "Save failed");
    if (res.ok) setForm((f) => ({ ...f, secret: "", hasSecret: data.hasSecret }));
  }

  async function runTest() {
    setTesting(true);
    setTest("Testing…");
    const res = await fetch("/api/config/whish/test", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setTesting(false);
    setTest(data.ok ? `Connected (${data.detail})` : `Failed: ${data.detail || data.error}`);
  }

  return (
    <SettingsSection
      title="Whish Pay"
      desc="Direct Whish API credentials, as issued by Whish. Whish withdrawals are paid out manually by your team."
      toggles={[
        { label: "Deposits", on: form.enabled, onChange: (v) => setForm({ ...form, enabled: v }) },
        { label: "Withdrawals", on: form.withdrawalsEnabled, onChange: (v) => setForm({ ...form, withdrawalsEnabled: v }) },
      ]}
      onSubmit={save}
      footer={
        <>
          <button type="submit" disabled={saving} className="btn-primary">{saving ? "Saving…" : "Save changes"}</button>
          <button type="button" onClick={runTest} disabled={testing} className="btn-ghost">{testing ? "Testing…" : "Test connection"}</button>
          {msg && <span className="text-sm text-ink-muted">{msg}</span>}
          <TestResult text={test} />
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Environment" hint={pinned("baseUrl") ? `${ENV_HINT} · ${form.baseUrl}` : form.baseUrl}>
          <select
            disabled={pinned("baseUrl")}
            value={preset ? preset.url : "custom"}
            onChange={(e) => e.target.value !== "custom" && setForm({ ...form, baseUrl: e.target.value })}
            className="field-input appearance-none"
          >
            {WHISH_ENVIRONMENTS.map((env) => (
              <option key={env.url} value={env.url} className="bg-surface text-ink">{env.label}</option>
            ))}
            {!preset && <option value="custom" className="bg-surface text-ink">Custom</option>}
          </select>
        </Field>
        <Field label="Channel" hint={pinned("channel") ? ENV_HINT : undefined}>
          <input readOnly={pinned("channel")} value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })} className="field-input font-mono" />
        </Field>
        <Field label="Secret" hint={pinned("secret") ? ENV_HINT : cfg.hasSecret ? "Saved · leave blank to keep it" : "Provided by Whish"}>
          <input type="password" disabled={pinned("secret")} value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })} className="field-input" />
        </Field>
        <Field label="Website URL" hint={pinned("websiteUrl") ? ENV_HINT : "The websiteUrl value provided by Whish"}>
          <input readOnly={pinned("websiteUrl")} value={form.websiteUrl} onChange={(e) => setForm({ ...form, websiteUrl: e.target.value })} className="field-input" />
        </Field>
        <Field label="User-Agent" hint={pinned("userAgent") ? ENV_HINT : "Exactly as issued by Whish, e.g. AppName/1.0 (https://site; contact)"}>
          <input readOnly={pinned("userAgent")} value={form.userAgent} onChange={(e) => setForm({ ...form, userAgent: e.target.value })} className="field-input font-mono" />
        </Field>
        <Field label="Minimum deposit (USD)" hint="Whish's own minimum is 1.00 USD">
          <input
            type="number"
            min="0"
            step="0.01"
            value={form.minDeposit}
            onChange={(e) => setForm({ ...form, minDeposit: e.target.value as unknown as number })}
            className="field-input font-mono"
          />
        </Field>
      </div>

      <div className="mt-5 border-t border-line pt-5">
        <p className="text-[13px] font-semibold text-ink">Callback URL <span className="font-normal text-ink-muted">· sent to Whish automatically with each payment</span></p>
        <div className="mt-1.5 flex items-center gap-2">
          <code className="flex-1 truncate rounded-lg bg-surface-overlay px-3 py-2 font-mono text-xs text-brand-400">{cfg.callbackUrl}</code>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(cfg.callbackUrl);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="btn-ghost px-3 py-1.5 text-xs"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="field-hint">
          Must be publicly reachable (Whish rejects localhost). If a firewall filters inbound traffic, allowlist Whish&apos;s
          callback IPs — production 18.213.222.45, 52.21.189.51 · sandbox 52.21.55.64, 52.4.4.47.
        </p>
      </div>
    </SettingsSection>
  );
}

function ThreePayForm({ cfg }: { cfg: ThreePayCfg }) {
  const [form, setForm] = useState({ ...cfg, apiSecret: "", webhookSecret: "" });
  const [copied, setCopied] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [test, setTest] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const pinned = (f: ThreePayCfg["envFields"][number]) => cfg.envFields.includes(f);
  const editable = (f: ThreePayCfg["envFields"][number], v: string) => (pinned(f) ? undefined : v || undefined);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    const res = await fetch("/api/config/threepay", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseUrl: editable("baseUrl", form.baseUrl),
        apiKey: editable("apiKey", form.apiKey),
        apiSecret: editable("apiSecret", form.apiSecret),
        webhookSecret: editable("webhookSecret", form.webhookSecret),
        minDeposit: Number(form.minDeposit) || 1,
        enabled: form.enabled,
        withdrawalsEnabled: form.withdrawalsEnabled,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    setMsg(res.ok ? "Saved." : data.error || "Save failed");
    if (res.ok) setForm((f) => ({ ...f, apiSecret: "", webhookSecret: "", hasApiSecret: data.hasApiSecret, hasWebhookSecret: data.hasWebhookSecret }));
  }

  async function runTest() {
    setTesting(true);
    setTest("Testing…");
    const res = await fetch("/api/config/threepay/test", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setTesting(false);
    setTest(data.ok ? `Connected (${data.detail})` : `Failed: ${data.detail || data.error}`);
  }

  return (
    <SettingsSection
      title="3Pay · USDT (TRC20)"
      desc="USDT deposits and payouts through 3Pay. Register this server's IP in the 3Pay dashboard (Settings → IP Whitelist) first."
      toggles={[
        { label: "Deposits", on: form.enabled, onChange: (v) => setForm({ ...form, enabled: v }) },
        { label: "Withdrawals", on: form.withdrawalsEnabled, onChange: (v) => setForm({ ...form, withdrawalsEnabled: v }) },
      ]}
      onSubmit={save}
      footer={
        <>
          <button type="submit" disabled={saving} className="btn-primary">{saving ? "Saving…" : "Save changes"}</button>
          <button type="button" onClick={runTest} disabled={testing} className="btn-ghost">{testing ? "Testing…" : "Test connection"}</button>
          {msg && <span className="text-sm text-ink-muted">{msg}</span>}
          <TestResult text={test} />
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="API key" hint={pinned("apiKey") ? ENV_HINT : "The apikey from Settings → API Credentials"}>
          <input readOnly={pinned("apiKey")} value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} className="field-input font-mono" />
        </Field>
        <Field label="API secret" hint={pinned("apiSecret") ? ENV_HINT : cfg.hasApiSecret ? "Saved · leave blank to keep it" : "The x-api-secret"}>
          <input type="password" disabled={pinned("apiSecret")} value={form.apiSecret} onChange={(e) => setForm({ ...form, apiSecret: e.target.value })} className="field-input" />
        </Field>
        <Field label="Webhook secret" hint={pinned("webhookSecret") ? ENV_HINT : cfg.hasWebhookSecret ? "Saved · leave blank to keep it" : "Settings → Webhook Secret — required to trust webhooks"}>
          <input type="password" disabled={pinned("webhookSecret")} value={form.webhookSecret} onChange={(e) => setForm({ ...form, webhookSecret: e.target.value })} className="field-input" />
        </Field>
        <Field label="Minimum deposit (USDT)" hint="3Pay's own minimum is 1 USDT">
          <input
            type="number"
            min="1"
            step="0.01"
            value={form.minDeposit}
            onChange={(e) => setForm({ ...form, minDeposit: e.target.value as unknown as number })}
            className="field-input font-mono"
          />
        </Field>
        <Field label="API base URL" hint={pinned("baseUrl") ? ENV_HINT : "Normally https://pay.3pa-y.com/api/v1"}>
          <input readOnly={pinned("baseUrl")} value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} className="field-input font-mono text-xs" />
        </Field>
      </div>

      <div className="mt-5 border-t border-line pt-5">
        <p className="text-[13px] font-semibold text-ink">Webhook URL <span className="font-normal text-ink-muted">· sent to 3Pay with every deposit (becomes your account default)</span></p>
        <div className="mt-1.5 flex items-center gap-2">
          <code className="flex-1 truncate rounded-lg bg-surface-overlay px-3 py-2 font-mono text-xs text-brand-400">{cfg.webhookUrl}</code>
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
        <p className="field-hint">
          Payout webhooks also go here. Without a webhook secret, events are only used as a hint and re-checked through 3Pay&apos;s API.
          Payouts: 3Pay deducts a 2 USDT fee from each TRC20 payout.
        </p>
      </div>
    </SettingsSection>
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
    <SettingsSection
      title="MT5 · WebAPI"
      desc="Manager connection used to credit paid deposits to client accounts. The broker must allowlist this server's IP."
      toggles={[{ label: "Connection", on: form.enabled, onChange: (v) => setForm({ ...form, enabled: v }) }]}
      onSubmit={save}
      footer={
        <>
          <button type="submit" disabled={saving} className="btn-primary">{saving ? "Saving…" : "Save changes"}</button>
          <button type="button" onClick={runTest} disabled={testing} className="btn-ghost">{testing ? "Testing…" : "Test connection"}</button>
          {msg && <span className="text-sm text-ink-muted">{msg}</span>}
          <TestResult text={test} />
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="WebAPI host : port" hint="e.g. 185.67.127.231:443">
          <input value={form.mt5Server} onChange={(e) => setForm({ ...form, mt5Server: e.target.value })} className="field-input font-mono" />
        </Field>
        <Field label="Manager login" hint="must have WebAPI access enabled by the broker">
          <input value={form.mt5Login} onChange={(e) => setForm({ ...form, mt5Login: e.target.value })} className="field-input font-mono" />
        </Field>
        <Field label="Manager password" hint={cfg.hasPassword ? "Saved · leave blank to keep" : "WebAPI manager password"}>
          <input type="password" value={form.mt5Password} onChange={(e) => setForm({ ...form, mt5Password: e.target.value })} className="field-input" />
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
    </SettingsSection>
  );
}
