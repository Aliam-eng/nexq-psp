import { NextResponse } from "next/server";
import { currentAdmin } from "@/lib/access";
import { checkConnection } from "@/lib/threepay";

// Authenticated connection test — reads the 3Pay merchant balance (also proves the server IP is whitelisted).
export async function POST() {
  if (!(await currentAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json(await checkConnection());
}
