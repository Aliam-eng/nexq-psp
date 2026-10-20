import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyCredentials, createSession } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { isStaffRole } from "@/lib/roles";

const schema = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const user = await verifyCredentials(parsed.data.email, parsed.data.password);
  if (!user) {
    await logAudit({ email: parsed.data.email }, "auth.login_failed");
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  await createSession(user);
  if (isStaffRole(user.role)) await logAudit({ id: user.id, email: user.email }, "auth.login", { type: "User", id: user.id });
  return NextResponse.json({ ok: true, role: user.role });
}
