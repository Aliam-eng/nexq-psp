import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyCredentials, createSession } from "@/lib/auth";

const schema = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const user = await verifyCredentials(parsed.data.email, parsed.data.password);
  if (!user) return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });

  await createSession(user);
  return NextResponse.json({ ok: true, role: user.role });
}
