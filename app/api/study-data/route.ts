import { NextResponse } from "next/server";

import { requestSession, sessionMatchesMember } from "../../../lib/auth";
import { findMember } from "../../../lib/members";
import { isSupabaseConfigured, supabaseAdmin } from "../../../lib/supabase-admin";
import { durableStore, type StudyStore } from "../../../lib/study-data";

export const runtime = "nodejs";
const noStore = { "Cache-Control": "no-store, max-age=0" };
const sameOrigin = (request: Request) => !request.headers.get("origin") || request.headers.get("origin") === new URL(request.url).origin;
const authenticatedMember = async (request: Request) => {
  const session = requestSession(request);
  if (!session) return null;
  const member = await findMember(session.username);
  return member && sessionMatchesMember(session, member) ? member : null;
};
const unauthorized = () => NextResponse.json({ error: "Unauthenticated" }, { status: 401, headers: noStore });
const passwordChangeRequired = () => NextResponse.json({ error: "PASSWORD_CHANGE_REQUIRED" }, { status: 403, headers: noStore });

async function readStudyData(memberId: string, memberName: string) {
  const { data, error } = await supabaseAdmin().from("study_data").select("data,updated_at").eq("member_id", memberId).maybeSingle();
  if (error) throw error;
  return { store: data ? durableStore(data.data, memberName) : null, revision: data?.updated_at ?? null };
}

export async function GET(request: Request) {
  const member = await authenticatedMember(request);
  if (!member || member.status !== "active") return unauthorized();
  if (member.forcePasswordChange) return passwordChangeRequired();
  if (!isSupabaseConfigured()) return NextResponse.json({ store: null, revision: null, durable: false }, { headers: noStore });
  try {
    return NextResponse.json({ ...await readStudyData(member.id, member.name), durable: true }, { headers: noStore });
  } catch {
    return NextResponse.json({ error: "Durable study storage is unavailable." }, { status: 503, headers: noStore });
  }
}

export async function PUT(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStore });
  const member = await authenticatedMember(request);
  if (!member || member.status !== "active") return unauthorized();
  if (member.forcePasswordChange) return passwordChangeRequired();
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Durable storage is not configured." }, { status: 503, headers: noStore });
  const body = await request.json().catch(() => null) as { store?: StudyStore; revision?: string | null } | null;
  if (!body?.store || !(body.revision === null || typeof body.revision === "string")) {
    return NextResponse.json({ error: "A study store and revision are required." }, { status: 400, headers: noStore });
  }
  try {
    const current = await readStudyData(member.id, member.name);
    const conflict = () => NextResponse.json({ error: "Study data changed on another device.", ...current }, { status: 409, headers: noStore });
    if (current.revision !== body.revision) return conflict();

    const incoming = durableStore(body.store, member.name);
    for (const [date, prior] of Object.entries(current.store?.records || {})) {
      if (prior.submitted && JSON.stringify(incoming.records[date]) !== JSON.stringify(prior)) {
        return NextResponse.json({ error: "A submitted day is locked.", ...current }, { status: 409, headers: noStore });
      }
    }
    for (const record of Object.values(incoming.records)) {
      if (record.submitted && (!record.scheduled || !record.tasks.length)) {
        return NextResponse.json({ error: "A submitted day must contain scheduled tasks." }, { status: 400, headers: noStore });
      }
    }

    if (current.revision === null) {
      const { data, error } = await supabaseAdmin().from("study_data").insert({ member_id: member.id, data: incoming }).select("data,updated_at").single();
      if (error) {
        if (error.code === "23505") return NextResponse.json({ error: "Study data changed on another device.", ...await readStudyData(member.id, member.name) }, { status: 409, headers: noStore });
        throw error;
      }
      return NextResponse.json({ store: durableStore(data.data, member.name), revision: data.updated_at, durable: true }, { headers: noStore });
    }

    // PostgreSQL evaluates the timestamp predicate atomically with this update.
    const { data, error } = await supabaseAdmin().from("study_data")
      .update({ data: incoming })
      .eq("member_id", member.id)
      .eq("updated_at", current.revision)
      .select("data,updated_at")
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Study data changed on another device.", ...await readStudyData(member.id, member.name) }, { status: 409, headers: noStore });
    return NextResponse.json({ store: durableStore(data.data, member.name), revision: data.updated_at, durable: true }, { headers: noStore });
  } catch {
    return NextResponse.json({ error: "Durable study storage is unavailable." }, { status: 503, headers: noStore });
  }
}
