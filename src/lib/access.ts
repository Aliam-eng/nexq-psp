import { getSession } from "./auth";
import { prisma } from "./db";

import { ADMIN_ROLE, isStaffRole } from "./roles";

export { ADMIN_ROLE, OPERATOR_ROLE, ROLE_LABEL, STAFF_ROLES, isStaffRole } from "./roles";

export type Staff = { id: string; email: string; name: string | null; role: string; isAdmin: boolean };

// The signed-in back-office user, re-checked against the database on every call
// so a disabled account or a role change takes effect immediately (not when the
// 7-day session cookie expires).
export async function currentStaff(): Promise<Staff | null> {
  const session = await getSession();
  if (!session) return null;
  const user = await prisma.user.findUnique({ where: { id: session.id } });
  if (!user || !user.isActive || !isStaffRole(user.role)) return null;
  return { id: user.id, email: user.email, name: user.name, role: user.role, isAdmin: user.role === ADMIN_ROLE };
}

export async function currentAdmin(): Promise<Staff | null> {
  const staff = await currentStaff();
  return staff?.isAdmin ? staff : null;
}
