import { NextResponse } from "next/server";

import { requestSession } from "../../../lib/auth";
import { findMember } from "../../../lib/members";
import { isSupabaseConfigured, supabaseAdmin } from "../../../lib/supabase-admin";
import { mergeStores, normalizeStore, type StudyStore } from "../../../lib/study-data";

export const runtime = "nodejs";
const noStore = { "Cache-Control": "no-store, max-age=0" };
const sameOrigin = (request: Request) => !request.headers.get("origin") || request.headers.get("origin") === new URL(request.url).origin;
const authenticatedMember = async (request: Request) => { const session = requestSession(request); const member = session ? await findMember(session.username) : null; return member?.status === "active" ? member : null; };
const unauthorized = () => NextResponse.json({ error: "Unauthenticated" }, { status: 401, headers: noStore });

export async function GET(request: Request) {
  const member = await authenticatedMember(request); if (!member) return unauthorized();
  if (!isSupabaseConfigured()) return NextResponse.json({ store: null, durable: false }, { headers: noStore });
  try { const { data, error } = await supabaseAdmin().from("study_data").select("data").eq("member_id", member.id).maybeSingle(); if (error) throw error; return NextResponse.json({ store: data ? normalizeStore(data.data, member.name) : null, durable: true }, { headers: noStore }); }
  catch { return NextResponse.json({ error: "Durable study storage is unavailable." }, { status: 503, headers: noStore }); }
}

export async function PUT(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStore });
  const member = await authenticatedMember(request); if (!member) return unauthorized();
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Durable storage is not configured." }, { status: 503, headers: noStore });
  const body = await request.json().catch(() => null) as { store?: StudyStore } | null; if (!body?.store) return NextResponse.json({ error: "A study store is required." }, { status: 400, headers: noStore });
  try { const clientStore = normalizeStore(body.store, member.name); const { data: existing, error: readError } = await supabaseAdmin().from("study_data").select("data").eq("member_id", member.id).maybeSingle(); if (readError) throw readError; const store = mergeStores(existing?.data, clientStore, member.name); const { error } = await supabaseAdmin().from("study_data").upsert({ member_id: member.id, data: store }, { onConflict: "member_id" }); if (error) throw error; return NextResponse.json({ store, durable: true }, { headers: noStore }); }
  catch { return NextResponse.json({ error: "Durable study storage is unavailable." }, { status: 503, headers: noStore }); }
}
