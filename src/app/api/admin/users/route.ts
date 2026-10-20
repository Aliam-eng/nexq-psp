import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { currentAdmin } from "@/lib/access";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { STAFF_ROLES } from "@/lib/roles";

const schema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  name: z.string().trim().max(120).optional(),
  role: z.enum(STAFF_ROLES as [string, ...string[]]),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
});

// Create a back-office account. Admins only.
export async function POST(req: Request) {
  const admin = await currentAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid input" }, { status: 400 });
  const d = parsed.data;

  if (await prisma.user.findUnique({ where: { email: d.email } })) {
    return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
  }
  const user = await prisma.user.create({
    data: { email: d.email, name: d.name || null, role: d.role, password: await bcrypt.hash(d.password, 10) },
  });
  await logAudit(admin, "user.create", { type: "User", id: user.id }, { email: user.email, role: user.role });
  return NextResponse.json({ ok: true, id: user.id });
}
