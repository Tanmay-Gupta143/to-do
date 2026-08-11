import { NextResponse } from "next/server";

import { requestSession } from "../../../lib/auth";
import { bulkAdjustCredits, createMember, deleteMember, findMember, listMembers, resetMemberPassword, restoreMember, suspendMember, updateMemberCredits, updateMemberProfile } from "../../../lib/members";
import { isSupabaseConfigured, supabaseAdmin } from "../../../lib/supabase-admin";
import { rhythmFromStore } from "../../../lib/study-data";

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
  const members = await listMembers();
  if (!isSupabaseConfigured()) return NextResponse.json({ members });
  const { data, error } = await supabaseAdmin().from("study_data").select("member_id,data");
  if (error) return errorResponse(error);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const rhythms = new Map((data || []).map((row) => [row.member_id as string, rhythmFromStore(row.data, today)]));
  return NextResponse.json({ members: members.map((member) => ({ ...member, rhythm: rhythms.get(member.id) || { days: 0, todayStatus: "Not scheduled" } })) });
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
  const body = await request.json().catch(() => ({})) as { id?: string; credits?: number; action?: string; name?: string; username?: string; role?: "user" | "admin"; password?: string; reason?: string; until?: string; amount?: number };
  try {
    if (body.action === "bulk-credits") return NextResponse.json({ affected: await bulkAdjustCredits(Number(body.amount)) });
    if (!body.id) return errorResponse(new Error("Member id is required."));
    if (body.action === "restore") return NextResponse.json({ member: await restoreMember(body.id) });
    if (body.action === "suspend") return NextResponse.json({ member: await suspendMember(body.id, body.reason || "", body.until) });
    if (body.action === "reset-password") return NextResponse.json({ member: await resetMemberPassword(body.id, body.password || "") });
    if (body.action === "update-profile") return NextResponse.json({ member: await updateMemberProfile(body.id, { name: body.name, username: body.username, role: body.role }) });
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
