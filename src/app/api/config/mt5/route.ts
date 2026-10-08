import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

const schema = z.object({
  mt5Server: z.string().optional().nullable(),
  mt5Login: z.string().optional().nullable(),
  mt5Password: z.string().optional().nullable(),
  cryptMethod: z.enum(["NONE", "AES256OFB"]).optional(),
  defaultGroup: z.string().optional().nullable(),
  enabled: z.boolean().optional(),
});

export async function PUT(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "TECHNICAL")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const d = parsed.data;
  const data: Record<string, unknown> = {
    mt5Server: d.mt5Server ?? undefined,
    mt5Login: d.mt5Login ?? undefined,
    cryptMethod: d.cryptMethod ?? undefined,
    defaultGroup: d.defaultGroup ?? undefined,
    enabled: d.enabled ?? undefined,
  };
  // Empty password = leave unchanged (never wipe a saved secret).
  if (d.mt5Password) data.mt5Password = d.mt5Password;

  const cfg = await prisma.mt5Config.upsert({
    where: { id: "mt5" },
    update: data,
    create: { id: "mt5", ...data, mt5Password: d.mt5Password ?? null },
  });

  return NextResponse.json({ ok: true, hasPassword: !!cfg.mt5Password, enabled: cfg.enabled });
}
