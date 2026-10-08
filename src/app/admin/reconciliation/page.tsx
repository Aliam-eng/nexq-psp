import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { PageHeader, TopBar } from "@/components/ui";
import { ScanClient } from "./ScanClient";

export const dynamic = "force-dynamic";

export default async function ReconciliationPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "TECHNICAL") redirect("/deposit");

  return (
    <>
      <TopBar user={session} />
      <main className="mx-auto max-w-5xl px-5 py-8">
        <PageHeader
          title="Reconciliation"
          subtitle="Spot deposits credited to MT5 more than once. Read-only — nothing in MT5 is changed."
        />
        <div className="mt-6 animate-fade-up" style={{ animationDelay: "60ms" }}>
          <ScanClient />
        </div>
      </main>
    </>
  );
}
