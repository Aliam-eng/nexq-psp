import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { mt5TestConnect } from "@/lib/mt5";

export async function POST() {
  const session = await getSession();
  if (!session || session.role !== "TECHNICAL")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const result = await mt5TestConnect();
  return NextResponse.json(result);
}
