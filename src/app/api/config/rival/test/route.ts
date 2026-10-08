import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { checkHealth } from "@/lib/rival";

export async function POST() {
  const session = await getSession();
  if (!session || session.role !== "TECHNICAL")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const result = await checkHealth();
  return NextResponse.json(result);
}
