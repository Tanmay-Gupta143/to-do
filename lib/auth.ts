import { createHmac, timingSafeEqual } from "node:crypto";

import type { Member } from "./members";

export type Session = { username: string; name: string; role: "user" | "admin"; credits: number; expiresAt: number };
export const COOKIE_NAME = "daily_study_session";
export const SESSION_AGE = 8 * 60 * 60;

const secret = () => process.env.AUTH_SECRET || "daily-study-local-mvp-change-me";
const encode = (value: string) => Buffer.from(value, "utf8").toString("base64url");
const sign = (value: string) => createHmac("sha256", secret()).update(value).digest("base64url");

export const serializeSession = (session: Session) => {
  const payload = encode(JSON.stringify(session));
  return `${payload}.${sign(payload)}`;
};

export function parseSession(token?: string): Session | null {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload);
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Session;
    return session.expiresAt > Date.now() ? session : null;
  } catch { return null; }
}

export function requestSession(request: Request) {
  const token = request.headers.get("cookie")?.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]+)`))?.[1];
  return parseSession(token);
}

export function sessionForMember(member: Member): Session {
  return { username: member.username, name: member.name, role: member.role, credits: member.credits, expiresAt: Date.now() + SESSION_AGE * 1000 };
}
