import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Whish client against the documented contract (Whish Pay v1.4.4), with the DB
// config row and the network both faked.

const config = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
vi.mock("@/lib/db", () => ({
  prisma: { providerConfig: { findUnique: vi.fn(async () => config.current) } },
}));

import {
  WhishError,
  WhishPendingError,
  checkConnection,
  createPayment,
  formatAmount,
  getCollectStatus,
  whishEnvFields,
} from "@/lib/whish";

const CREDS = {
  id: "whish",
  baseUrl: "https://partner.api.sbx.whish.money/itel-service/api/",
  channel: "CH1",
  secret: "S3CRET",
  websiteUrl: "https://nexq.example",
  userAgent: "nexQDeposit/1.0 (https://nexq.example; ops@nexq.example)",
  enabled: true,
  minDeposit: 0,
};

const PAYMENT = {
  amount: 50,
  currency: "usd",
  invoice: "NEXQ-1 - MT5 5000123",
  externalId: "ext-1",
  successCallbackUrl: "https://portal.example/api/webhooks/whish?externalId=ext-1&result=success",
  failureCallbackUrl: "https://portal.example/api/webhooks/whish?externalId=ext-1&result=failure",
  successRedirectUrl: "https://portal.example/deposit/return?tx=t1",
  failureRedirectUrl: "https://portal.example/deposit/return?tx=t1",
};

const fetchMock = vi.fn();
const envelope = (data: unknown) => ({ status: true, code: null, dialog: null, extra: null, data });
const reply = (body: unknown, status = 200) =>
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  config.current = { ...CREDS };
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("formatAmount", () => {
  it("sends USD with exactly two decimals", () => {
    expect(formatAmount(50, "USD")).toBe("50.00");
    expect(formatAmount(1.5, "usd")).toBe("1.50");
    expect(formatAmount(10.005, "USD")).toBe("10.01");
  });
  it("sends LBP as a whole number", () => {
    expect(formatAmount(150000.7, "LBP")).toBe("150001");
  });
});

describe("createPayment", () => {
  it("POSTs to /payment/whish with the Whish auth headers and returns the collectUrl", async () => {
    reply(envelope({ collectUrl: "https://whish.money/pay/8nQS2mL" }));
    const out = await createPayment(PAYMENT);
    expect(out).toEqual({ collectUrl: "https://whish.money/pay/8nQS2mL" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://partner.api.sbx.whish.money/itel-service/api/payment/whish");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      channel: "CH1",
      secret: "S3CRET",
      websiteUrl: "https://nexq.example",
      "User-Agent": CREDS.userAgent,
      "Content-Type": "application/json",
    });
    expect(JSON.parse(init.body)).toEqual({ ...PAYMENT, amount: "50.00", currency: "USD" });
  });

  it("refuses to create payments while Whish is disabled", async () => {
    config.current = { ...CREDS, enabled: false };
    await expect(createPayment(PAYMENT)).rejects.toMatchObject({ code: "DISABLED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses when credentials are incomplete", async () => {
    config.current = { ...CREDS, secret: null };
    await expect(createPayment(PAYMENT)).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats code 500 as pending (outcome unknown), never as a plain failure", async () => {
    reply({ status: false, code: "500", dialog: null, data: null });
    const err = await createPayment(PAYMENT).catch((e) => e);
    expect(err).toBeInstanceOf(WhishPendingError);
  });

  it("accepts a numeric 500 code as pending too", async () => {
    reply({ status: false, code: 500, dialog: null, data: null });
    await expect(createPayment(PAYMENT)).rejects.toBeInstanceOf(WhishPendingError);
  });

  it("surfaces business errors with their exact code and dialog message", async () => {
    reply({ status: false, code: "fail", dialog: { message: "Amount not allowed" }, data: null });
    const err = await createPayment(PAYMENT).catch((e) => e);
    expect(err).toBeInstanceOf(WhishError);
    expect(err).not.toBeInstanceOf(WhishPendingError);
    expect(err.code).toBe("fail");
    expect(err.message).toBe("Amount not allowed");
  });

  it("explains the HTML 403 Whish returns for non-public callback URLs", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>Forbidden</html>", { status: 403 }));
    const err = await createPayment(PAYMENT).catch((e) => e);
    expect(err.code).toBe("BAD_RESPONSE");
    expect(err.message).toMatch(/HTTP 403.*public.*APP_BASE_URL/);
  });

  it("rejects a success envelope without a collectUrl", async () => {
    reply(envelope({}));
    await expect(createPayment(PAYMENT)).rejects.toMatchObject({ code: "BAD_RESPONSE" });
  });
});

describe("getCollectStatus", () => {
  it("POSTs currency + externalId and returns the collect status", async () => {
    reply(envelope({ collectStatus: "success", payerPhoneNumber: "96170123456" }));
    const out = await getCollectStatus("ext-1", "usd");
    expect(out).toEqual({ collectStatus: "success", payerPhoneNumber: "96170123456" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/payment\/collect\/status$/);
    expect(JSON.parse(init.body)).toEqual({ currency: "USD", externalId: "ext-1" });
  });

  it.each(["pending", "failed", "refunded", "unknown"])("passes through '%s'", async (s) => {
    reply(envelope({ collectStatus: s }));
    expect((await getCollectStatus("ext-1", "USD")).collectStatus).toBe(s);
  });

  it("normalises case and maps unexpected values to 'unknown'", async () => {
    reply(envelope({ collectStatus: "SUCCESS" }));
    expect((await getCollectStatus("ext-1", "USD")).collectStatus).toBe("success");
    reply(envelope({ collectStatus: "settled??" }));
    expect((await getCollectStatus("ext-1", "USD")).collectStatus).toBe("unknown");
  });

  it("raises the documented error code for an unknown externalId", async () => {
    reply({ status: false, code: "external_id.not_exists", dialog: null, data: null });
    await expect(getCollectStatus("nope", "USD")).rejects.toMatchObject({ code: "external_id.not_exists" });
  });
});

describe("checkConnection", () => {
  it("reads the USD balance with a GET (no body, no Content-Type)", async () => {
    reply(envelope({ balance: 10439 }));
    expect(await checkConnection()).toEqual({ ok: true, detail: "balance USD 10439.00" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/payment\/account\/balance\?currency=USD$/);
    expect(init.method).toBe("GET");
    expect(init.headers["Content-Type"]).toBeUndefined();
  });

  it("reports failures instead of throwing", async () => {
    reply({ status: false, code: "request.invalid", dialog: { message: "bad headers" }, data: null });
    expect(await checkConnection()).toEqual({ ok: false, detail: "request.invalid: bad headers" });
  });

  it("reports network errors", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    expect(await checkConnection()).toEqual({ ok: false, detail: "ECONNREFUSED" });
  });
});

describe("credentials from the server environment (.env)", () => {
  const LIVE = {
    WHISH_BASE_URL: "https://api.whish.money/itel-service/api",
    WHISH_CHANNEL: "ENV-CH",
    WHISH_SECRET: "ENV-SECRET",
    WHISH_WEBSITE_URL: "Nexqcapital.com",
    WHISH_USER_AGENT: "nexQDeposit/1.0 (https://nexqcapital.com)",
  };
  const stubAll = () => Object.entries(LIVE).forEach(([k, v]) => vi.stubEnv(k, v));

  it("the test run never sees real credentials (vitest blanks WHISH_*)", () => {
    for (const k of Object.keys(LIVE)) expect(process.env[k] ?? "").toBe("");
    expect(whishEnvFields()).toEqual([]);
  });

  it("environment values override the values saved in Settings", async () => {
    stubAll();
    reply(envelope({ collectUrl: "https://whish.money/pay/x" }));
    await createPayment(PAYMENT);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.whish.money/itel-service/api/payment/whish");
    expect(init.headers).toMatchObject({
      channel: "ENV-CH",
      secret: "ENV-SECRET",
      websiteUrl: "Nexqcapital.com",
      "User-Agent": LIVE.WHISH_USER_AGENT,
    });
  });

  it("fills only the fields that are set, falling back to Settings for the rest", async () => {
    vi.stubEnv("WHISH_SECRET", "ENV-SECRET");
    reply(envelope({ balance: 1 }));
    await checkConnection();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/^https:\/\/partner\.api\.sbx\.whish\.money\//); // from Settings
    expect(init.headers).toMatchObject({ channel: "CH1", secret: "ENV-SECRET" });
    expect(whishEnvFields()).toEqual(["secret"]);
  });

  it("ignores blank or whitespace-only variables", async () => {
    vi.stubEnv("WHISH_CHANNEL", "   ");
    reply(envelope({ balance: 1 }));
    await checkConnection();
    expect(fetchMock.mock.calls[0][1].headers.channel).toBe("CH1");
    expect(whishEnvFields()).toEqual([]);
  });

  it("works with no Settings row at all (connection test)", async () => {
    config.current = null;
    stubAll();
    reply(envelope({ balance: 43481.017 }));
    expect(await checkConnection()).toEqual({ ok: true, detail: "balance USD 43481.02" });
    expect(whishEnvFields()).toEqual(["baseUrl", "channel", "secret", "websiteUrl", "userAgent"]);
  });

  it("still requires the admin on/off switch: env credentials alone never take payments", async () => {
    stubAll();
    config.current = { ...CREDS, enabled: false };
    await expect(createPayment(PAYMENT)).rejects.toMatchObject({ code: "DISABLED" });
    config.current = null;
    await expect(createPayment(PAYMENT)).rejects.toMatchObject({ code: "DISABLED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
