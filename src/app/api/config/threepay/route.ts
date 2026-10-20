import { NextResponse } from "next/server";
import { z } from "zod";
import { currentAdmin } from "@/lib/access";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";

const schema = z.object({
  baseUrl: z.string().url().optional().nullable(),
  apiKey: z.string().trim().optional().nullable(),
  apiSecret: z.string().optional().nullable(),
  webhookSecret: z.string().optional().nullable(),
  minDeposit: z.coerce.number().min(1).max(1_000_000).optional(),
  enabled: z.boolean().optional(),
  withdrawalsEnabled: z.boolean().optional(),
});

// Save 3Pay settings. Admins only. Empty secrets mean "leave unchanged".
export async function PUT(req: Request) {
  const admin = await currentAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid input" }, { status: 400 });
  const d = parsed.data;

  const data: Record<string, unknown> = {
    baseUrl: d.baseUrl ?? undefined,
    apiKey: d.apiKey || undefined,
    minDeposit: d.minDeposit ?? undefined,
    enabled: d.enabled ?? undefined,
    withdrawalsEnabled: d.withdrawalsEnabled ?? undefined,
  };
  if (d.apiSecret) data.apiSecret = d.apiSecret;
  if (d.webhookSecret) data.webhookSecret = d.webhookSecret;

  const cfg = await prisma.threePayConfig.upsert({ where: { id: "threepay" }, update: data, create: { id: "threepay", ...data } });
  const changed = Object.keys(d).filter((k) => (d as Record<string, unknown>)[k] !== undefined && (d as Record<string, unknown>)[k] !== "");
  await logAudit(admin, "settings.threepay", { type: "Settings", id: "threepay" }, { changed, enabled: cfg.enabled, withdrawalsEnabled: cfg.withdrawalsEnabled, minDeposit: cfg.minDeposit });

  return NextResponse.json({
    ok: true,
    hasApiSecret: !!cfg.apiSecret,
    hasWebhookSecret: !!cfg.webhookSecret,
    enabled: cfg.enabled,
    withdrawalsEnabled: cfg.withdrawalsEnabled,
    minDeposit: cfg.minDeposit,
  });
}
