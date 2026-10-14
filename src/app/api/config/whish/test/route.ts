import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { checkConnection } from "@/lib/whish";

// Authenticated connection test — reads the Whish account balance with the saved credentials.
export async function POST() {
  const session = await getSession();
  if (!session || session.role !== "TECHNICAL")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json(await checkConnection("USD"));
}
