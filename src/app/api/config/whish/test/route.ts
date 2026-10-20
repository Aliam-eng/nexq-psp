import { NextResponse } from "next/server";
import { currentAdmin } from "@/lib/access";
import { checkConnection } from "@/lib/whish";

// Authenticated connection test — reads the Whish account balance with the saved credentials.
export async function POST() {
  if (!(await currentAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json(await checkConnection("USD"));
}
