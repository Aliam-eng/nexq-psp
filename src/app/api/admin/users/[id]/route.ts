import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { currentAdmin } from "@/lib/access";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { ADMIN_ROLE, STAFF_ROLES } from "@/lib/roles";

const schema = z.object({
  role: z.enum(STAFF_ROLES as [string, ...string[]]).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(8, "Password must be at least 8 characters").max(200).optional(),
});

// Change role, enable/disable, or reset the password of a back-office account. Admins only.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const admin = await currentAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid input" }, { status: 400 });
  const d = parsed.data;

  const user = await prisma.user.findUnique({ where: { id: params.id } });
  if (!user) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const demoting = d.role !== undefined && d.role !== ADMIN_ROLE && user.role === ADMIN_ROLE;
  const disabling = d.isActive === false && user.isActive;
  if (user.id === admin.id && (demoting || disabling)) {
    return NextResponse.json({ error: "You can't remove your own admin access" }, { status: 400 });
  }
  // Never leave the back office without an active admin.
  if ((demoting || disabling) && user.role === ADMIN_ROLE) {
    const otherAdmins = await prisma.user.count({ where: { role: ADMIN_ROLE, isActive: true, id: { not: user.id } } });
    if (otherAdmins === 0) return NextResponse.json({ error: "Keep at least one active admin" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (d.role !== undefined) data.role = d.role;
  if (d.isActive !== undefined) data.isActive = d.isActive;
  if (d.password) data.password = await bcrypt.hash(d.password, 10);
  if (Object.keys(data).length === 0) return NextResponse.json({ error: "Nothing to change" }, { status: 400 });

  const updated = await prisma.user.update({ where: { id: user.id }, data });
  await logAudit(admin, "user.update", { type: "User", id: user.id }, {
    email: user.email,
    ...(d.role !== undefined && d.role !== user.role ? { role: `${user.role} → ${d.role}` } : {}),
    ...(d.isActive !== undefined && d.isActive !== user.isActive ? { active: d.isActive } : {}),
    ...(d.password ? { passwordReset: true } : {}),
  });
  return NextResponse.json({ ok: true, role: updated.role, isActive: updated.isActive });
}
