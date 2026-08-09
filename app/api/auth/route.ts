import { NextResponse } from "next/server";

import { COOKIE_NAME, requestSession, serializeSession, sessionForMember, SESSION_AGE } from "../../../lib/auth";
import { findMember, recordSuccessfulLogin, verifyMember } from "../../../lib/members";

const CONTACT_EMAIL = "kingluther12345@gmail.com";
const INVALID_CREDENTIALS_MESSAGE = `This is a private workspace. Contact the admin at ${CONTACT_EMAIL} for more information.`;
const SUSPENDED_ACCOUNT_MESSAGE = `This account was suspended after 4 days of inactivity. Contact the admin at ${CONTACT_EMAIL} for more information.`;
const EXPIRED_ACCOUNT_MESSAGE = `This account has no credits remaining. Contact the admin at ${CONTACT_EMAIL} for more information.`;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

const setSessionCookie = (response: NextResponse, value: string, maxAge = SESSION_AGE) => response.cookies.set({ name: COOKIE_NAME, value, httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge });
const sameOrigin = (request: Request) => {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
};
const clientKey = (request: Request, username: string) => `${request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"}:${username.trim().toLowerCase()}`;
const isRateLimited = (key: string) => {
  const attempt = loginAttempts.get(key);
  if (!attempt || attempt.resetAt <= Date.now()) { loginAttempts.delete(key); return false; }
  return attempt.count >= LOGIN_MAX_ATTEMPTS;
};
const registerFailedAttempt = (key: string) => {
  const now = Date.now();
  const current = loginAttempts.get(key);
  if (!current || current.resetAt <= now) loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
  else loginAttempts.set(key, { ...current, count: current.count + 1 });
};
const clearFailedAttempts = (key: string) => loginAttempts.delete(key);

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { username?: string; password?: string };
  const attemptKey = clientKey(request, body.username || "");
  if (isRateLimited(attemptKey)) return NextResponse.json({ error: "Too many sign-in attempts. Please try again in 15 minutes." }, { status: 429 });
  const member = body.username && body.password ? await verifyMember(body.username, body.password) : null;
  if (!member) { registerFailedAttempt(attemptKey); return NextResponse.json({ error: INVALID_CREDENTIALS_MESSAGE }, { status: 401 }); }
  clearFailedAttempts(attemptKey);
  if (member.status === "suspended") return NextResponse.json({ code: "ACCOUNT_SUSPENDED", error: SUSPENDED_ACCOUNT_MESSAGE }, { status: 403 });
  if (member.status === "expired") return NextResponse.json({ code: "CREDITS_EXPIRED", error: EXPIRED_ACCOUNT_MESSAGE }, { status: 403 });
  const activeMember = await recordSuccessfulLogin(member.id);
  const session = sessionForMember(activeMember);
  const response = NextResponse.json({ username: session.username, name: session.name, role: session.role, credits: session.credits });
  setSessionCookie(response, serializeSession(session));
  return response;
}

export async function GET(request: Request) {
  const session = requestSession(request);
  if (!session) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const member = await findMember(session.username);
  if (!member || member.status !== "active") {
    const response = NextResponse.json({ error: "Session expired" }, { status: 401 });
    setSessionCookie(response, "", 0);
    return response;
  }
  return NextResponse.json({ username: member.username, name: member.name, role: member.role, credits: member.credits });
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  setSessionCookie(response, "", 0);
  return response;
}
