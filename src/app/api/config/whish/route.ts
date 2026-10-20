import { NextResponse } from "next/server";
import { z } from "zod";
import { currentAdmin } from "@/lib/access";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";

const schema = z.object({
  baseUrl: z.string().url().optional().nullable(),
  channel: z.string().trim().optional().nullable(),
  secret: z.string().optional().nullable(),
  websiteUrl: z.string().trim().optional().nullable(),
  userAgent: z.string().trim().optional().nullable(),
  minDeposit: z.coerce.number().min(0).max(1_000_000).optional(),
  enabled: z.boolean().optional(),
  withdrawalsEnabled: z.boolean().optional(),
});

export async function PUT(req: Request) {
  const admin = await currentAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const d = parsed.data;
  const data: Record<string, unknown> = {
    baseUrl: d.baseUrl ?? undefined,
    channel: d.channel ?? undefined,
    websiteUrl: d.websiteUrl ?? undefined,
    userAgent: d.userAgent ?? undefined,
    minDeposit: d.minDeposit ?? undefined,
    enabled: d.enabled ?? undefined,
    withdrawalsEnabled: d.withdrawalsEnabled ?? undefined,
  };
  // Empty secret means "leave unchanged" so we never wipe a saved secret by accident.
  if (d.secret) data.secret = d.secret;

  const cfg = await prisma.providerConfig.upsert({
    where: { id: "whish" },
    update: data,
    create: { id: "whish", ...data },
  });

  const changed = Object.keys(d).filter((k) => (d as Record<string, unknown>)[k] !== undefined && (d as Record<string, unknown>)[k] !== "");
  await logAudit(admin, "settings.whish", { type: "Settings", id: "whish" }, { changed, enabled: cfg.enabled, withdrawalsEnabled: cfg.withdrawalsEnabled, minDeposit: cfg.minDeposit });

  return NextResponse.json({
    ok: true,
    hasSecret: !!cfg.secret,
    enabled: cfg.enabled,
    withdrawalsEnabled: cfg.withdrawalsEnabled,
    minDeposit: cfg.minDeposit,
  });
}
