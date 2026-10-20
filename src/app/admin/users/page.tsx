import { redirect } from "next/navigation";
import { currentStaff } from "@/lib/access";
import { prisma } from "@/lib/db";
import { STAFF_ROLES } from "@/lib/roles";
import { AdminShell } from "@/components/ui";
import { StaffManager } from "./StaffManager";

export const dynamic = "force-dynamic";

export default async function StaffPage() {
  const staff = await currentStaff();
  if (!staff) redirect("/login");
  if (!staff.isAdmin) redirect("/admin/transactions");

  const users = await prisma.user.findMany({
    where: { role: { in: STAFF_ROLES } },
    orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
    select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true },
  });

  return (
    <AdminShell user={staff} title="Staff" subtitle="Back-office accounts. Admins manage everything; operators handle deposits and withdrawals.">
      <StaffManager
        meId={staff.id}
        users={users.map((u) => ({ ...u, createdAt: u.createdAt.toISOString() }))}
      />
    </AdminShell>
  );
}
