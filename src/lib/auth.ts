import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { prisma } from "./db";

const COOKIE = "nexq_session";

// Never sign sessions with a known fallback in production — that would let
// anyone forge an admin token. Resolved lazily (not at import) so the
// production build, which runs with NODE_ENV=production, doesn't trip the guard.
let cachedSecret: Uint8Array | null = null;
function getSecret(): Uint8Array {
  if (cachedSecret) return cachedSecret;
  const s = process.env.AUTH_SECRET;
  let value: string;
  if (s && s.length >= 16) {
    value = s;
  } else if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET is missing or too short (set a long random value in production)");
  } else {
    value = "dev-only-change-me-to-a-long-random-string";
  }
  cachedSecret = new TextEncoder().encode(value);
  return cachedSecret;
}

export type SessionUser = {
  id: string;
  email: string;
  role: "CLIENT" | "TECHNICAL";
  name?: string | null;
};

export async function verifyCredentials(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return null;
  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return null;
  return user;
}

export async function createSession(user: { id: string; email: string; role: string; name?: string | null }) {
  const token = await new SignJWT({
    sub: user.id,
    email: user.email,
    role: user.role,
    name: user.name ?? null,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getSecret());

  cookies().set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export function destroySession() {
  cookies().set(COOKIE, "", { path: "/", maxAge: 0 });
}

export async function getSession(): Promise<SessionUser | null> {
  const token = cookies().get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return {
      id: String(payload.sub),
      email: String(payload.email),
      role: payload.role as SessionUser["role"],
      name: (payload.name as string | null) ?? null,
    };
  } catch {
    return null;
  }
}

export async function requireUser() {
  const s = await getSession();
  if (!s) throw new Response("Unauthorized", { status: 401 });
  return s;
}

export async function requireRole(role: SessionUser["role"]) {
  const s = await getSession();
  if (!s || s.role !== role) throw new Response("Forbidden", { status: 403 });
  return s;
}
