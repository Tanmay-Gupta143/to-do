import { NextResponse } from "next/server";

import { requestSession } from "../../../lib/auth";
import { createMember, deleteMember, findMember, listMembers, restoreMember, updateMemberCredits } from "../../../lib/members";

const adminSession = async (request: Request) => {
  const session = requestSession(request);
  if (!session) return null;
  const member = await findMember(session.username);
  return member && member.role === "admin" && member.status === "active" ? member : null;
};
const errorResponse = (error: unknown) => NextResponse.json({ error: error instanceof Error ? error.message : "Request failed." }, { status: 400 });
const sameOrigin = (request: Request) => {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
};

export async function GET(request: Request) {
  if (!await adminSession(request)) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  return NextResponse.json({ members: await listMembers() });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  if (!await adminSession(request)) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { name?: string; username?: string; password?: string; confirmPassword?: string; credits?: number };
  if (!body.name || !body.username || !body.password || body.password !== body.confirmPassword) return NextResponse.json({ error: "Name, username, password, and matching password confirmation are required." }, { status: 400 });
  try { return NextResponse.json({ member: await createMember({ name: body.name, username: body.username, password: body.password, credits: Number(body.credits ?? 0) }) }, { status: 201 }); }
  catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  if (!await adminSession(request)) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { id?: string; credits?: number; action?: string };
  if (!body.id) return errorResponse(new Error("Member id is required."));
  try {
    if (body.action === "restore") return NextResponse.json({ member: await restoreMember(body.id) });
    return NextResponse.json({ member: await updateMemberCredits(body.id, Number(body.credits)) });
  }
  catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const session = await adminSession(request);
  if (!session) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { id?: string };
  if (!body.id) return errorResponse(new Error("Member id is required."));
  try { return NextResponse.json({ member: await deleteMember(body.id, session.username) }); }
  catch (error) { return errorResponse(error); }
}
