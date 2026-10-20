import { NextResponse } from "next/server";
import { currentAdmin } from "@/lib/access";
import { mt5TestConnect } from "@/lib/mt5";

export async function POST() {
  if (!(await currentAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const result = await mt5TestConnect();
  return NextResponse.json(result);
}
