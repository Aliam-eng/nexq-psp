import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

const schema = z.object({
  apiKey: z.string().optional().nullable(),
  baseUrl: z.string().url().optional().nullable(),
  createPaymentPath: z.string().optional().nullable(),
  statusPath: z.string().optional().nullable(),
  healthPath: z.string().optional().nullable(),
  minDeposit: z.coerce.number().min(0).max(1_000_000).optional(),
  webhookSecret: z.string().optional().nullable(),
  enabled: z.boolean().optional(),
});

export async function PUT(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "TECHNICAL")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const d = parsed.data;
  // Empty string apiKey means "leave unchanged" so we never wipe a saved key by accident.
  const data: Record<string, unknown> = {
    baseUrl: d.baseUrl ?? undefined,
    createPaymentPath: d.createPaymentPath ?? undefined,
    statusPath: d.statusPath ?? undefined,
    healthPath: d.healthPath ?? undefined,
    minDeposit: d.minDeposit ?? undefined,
    enabled: d.enabled ?? undefined,
  };
  if (d.apiKey) data.apiKey = d.apiKey;
  if (d.webhookSecret) data.webhookSecret = d.webhookSecret;

  const cfg = await prisma.providerConfig.upsert({
    where: { id: "rival" },
    update: data,
    create: { id: "rival", ...data, apiKey: d.apiKey ?? null },
  });

  return NextResponse.json({
    ok: true,
    hasKey: !!cfg.apiKey,
    hasWebhookSecret: !!cfg.webhookSecret,
    enabled: cfg.enabled,
    minDeposit: cfg.minDeposit,
  });
}
