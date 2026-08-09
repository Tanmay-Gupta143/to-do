import { NextResponse } from "next/server";

import { COOKIE_NAME, requestSession, serializeSession, sessionForMember, SESSION_AGE } from "../../../lib/auth";
import { recordSuccessfulLogin, verifyMember } from "../../../lib/members";

const setSessionCookie = (response: NextResponse, value: string, maxAge = SESSION_AGE) => response.cookies.set({ name: COOKIE_NAME, value, httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge });

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { username?: string; password?: string };
  const member = body.username && body.password ? await verifyMember(body.username, body.password) : null;
  if (!member) return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  if (member.status === "suspended") return NextResponse.json({ code: "ACCOUNT_SUSPENDED", error: "Your account is suspended. Please contact the admin for more information." }, { status: 403 });
  if (member.status === "expired") return NextResponse.json({ code: "CREDITS_EXPIRED", error: "Your account credits have expired. Please contact the admin." }, { status: 403 });
  const activeMember = await recordSuccessfulLogin(member.id);
  const session = sessionForMember(activeMember);
  const response = NextResponse.json({ username: session.username, name: session.name, role: session.role, credits: session.credits });
  setSessionCookie(response, serializeSession(session));
  return response;
}

export async function GET(request: Request) {
  const session = requestSession(request);
  return session ? NextResponse.json({ username: session.username, name: session.name, role: session.role, credits: session.credits }) : NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  setSessionCookie(response, "", 0);
  return response;
}
