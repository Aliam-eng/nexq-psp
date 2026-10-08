import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { scanDuplicateCredits } from "@/lib/reconcile-scan";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // scanning many accounts can take a while

export async function POST() {
  const session = await getSession();
  if (!session || session.role !== "TECHNICAL") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const result = await scanDuplicateCredits();
  return NextResponse.json(result);
}
