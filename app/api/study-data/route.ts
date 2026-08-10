import { NextResponse } from "next/server";

import { requestSession } from "../../../lib/auth";
import { findMember } from "../../../lib/members";
import { isSupabaseConfigured, supabaseAdmin } from "../../../lib/supabase-admin";
import { mergeStores, normalizeStore, type StudyStore } from "../../../lib/study-data";

export const runtime = "nodejs";

const sameOrigin = (request: Request) => {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
};

async function authenticatedMember(request: Request) {
  const session = requestSession(request);
  if (!session) return null;
  const member = await findMember(session.username);
  return member && member.status === "active" ? member : null;
}

const unauthorized = () => NextResponse.json({ error: "Unauthenticated" }, { status: 401 });

export async function GET(request: Request) {
  const member = await authenticatedMember(request);
  if (!member) return unauthorized();
  if (!isSupabaseConfigured()) return NextResponse.json({ store: null, durable: false });
  try {
    const { data, error } = await supabaseAdmin().from("study_data").select("data").eq("member_id", member.id).maybeSingle();
    if (error) throw error;
    return NextResponse.json({ store: data ? normalizeStore(data.data, member.name) : null, durable: true });
  } catch {
    return NextResponse.json({ error: "Durable study storage is unavailable." }, { status: 503 });
  }
}

export async function PUT(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const member = await authenticatedMember(request);
  if (!member) return unauthorized();
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Durable storage is not configured." }, { status: 503 });
  const body = await request.json().catch(() => null) as { store?: StudyStore } | null;
  if (!body?.store) return NextResponse.json({ error: "A study store is required." }, { status: 400 });
  const clientStore = normalizeStore(body.store, member.name);
  try {
    const { data: existing, error: readError } = await supabaseAdmin().from("study_data").select("data").eq("member_id", member.id).maybeSingle();
    if (readError) throw readError;
    const merged = mergeStores(existing?.data, clientStore, member.name);
    const { error } = await supabaseAdmin().from("study_data").upsert({ member_id: member.id, data: merged }, { onConflict: "member_id" });
    if (error) throw error;
    return NextResponse.json({ store: merged, durable: true });
  } catch {
    return NextResponse.json({ error: "Durable study storage is unavailable." }, { status: 503 });
  }
}
