import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import path from "node:path";
import { isSupabaseConfigured, supabaseAdmin } from "./supabase-admin";

const scrypt = promisify(scryptCallback);

export type MemberRole = "user" | "admin";
export type Member = {
  id: string;
  name: string;
  username: string;
  role: MemberRole;
  credits: number;
  status: "active" | "suspended" | "expired";
  lastLoginAt?: string;
  lastCreditDeductedOn?: string;
  suspendedAt?: string;
  suspensionReason?: string;
  suspensionUntil?: string;
  forcePasswordChange?: boolean;
  passwordHash: string;
  passwordSalt: string;
  createdAt: string;
};

export type PublicMember = Omit<Member, "passwordHash" | "passwordSalt">;

type MemberFile = { members: Member[] };

type MemberRow = {
  id: string;
  name: string;
  username: string;
  role: MemberRole;
  credits: number;
  status: Member["status"];
  last_login_at: string | null;
  last_credit_deducted_on: string | null;
  suspended_at: string | null;
  suspension_reason?: string | null;
  suspension_until?: string | null;
  force_password_change?: boolean | null;
  password_hash: string;
  password_salt: string;
  created_at: string;
};

const dataFile = () => process.env.MEMBERS_DATA_FILE || (process.env.VERCEL ? "/tmp/daily-study-members.json" : path.join(process.cwd(), ".data", "members.json"));
let cached: MemberFile | null = null;
let writeQueue = Promise.resolve();

const makeId = () => `${Date.now()}-${randomBytes(5).toString("hex")}`;
const cleanUsername = (value: string) => value.trim().toLowerCase();
const publicMember = ({ passwordHash: _hash, passwordSalt: _salt, ...member }: Member): PublicMember => member;
const INACTIVITY_MS = 4 * 24 * 60 * 60 * 1000;
const istDateKey = (date = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(date);
const dateKeyToUtc = (key: string) => {
  const [year, month, day] = key.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
};
const elapsedDays = (from: string, to: string) => Math.max(0, Math.floor((dateKeyToUtc(to) - dateKeyToUtc(from)) / 86_400_000));
const validDateKey = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(dateKeyToUtc(value)).toISOString().slice(0, 10) === value;
const creditStatus = (member: Member, credits: number): Member["status"] =>
  member.role === "admin" || member.status === "suspended" ? member.status : credits > 0 ? "active" : "expired";
const resumeEndedSuspension = (member: Member, today: string): Member => {
  if (member.status !== "suspended" || !member.suspensionUntil || today <= member.suspensionUntil) return member;
  return { ...member, status: member.credits > 0 ? "active" : "expired", lastLoginAt: new Date().toISOString(),
    lastCreditDeductedOn: today, suspendedAt: undefined, suspensionReason: undefined, suspensionUntil: undefined };
};

const fromRow = (row: MemberRow): Member => ({
  id: row.id, name: row.name, username: row.username, role: row.role, credits: row.credits, status: row.status,
  lastLoginAt: row.last_login_at || undefined, lastCreditDeductedOn: row.last_credit_deducted_on || undefined,
  suspendedAt: row.suspended_at || undefined, suspensionReason: row.suspension_reason || undefined, suspensionUntil: row.suspension_until || undefined, forcePasswordChange: Boolean(row.force_password_change), passwordHash: row.password_hash, passwordSalt: row.password_salt, createdAt: row.created_at,
});
const toRow = (member: Member): MemberRow => ({
  id: member.id, name: member.name, username: member.username, role: member.role, credits: member.credits, status: member.status,
  last_login_at: member.lastLoginAt || null, last_credit_deducted_on: member.lastCreditDeductedOn || null,
  suspended_at: member.suspendedAt || null, suspension_reason: member.suspensionReason || null, suspension_until: member.suspensionUntil || null, force_password_change: Boolean(member.forcePasswordChange), password_hash: member.passwordHash, password_salt: member.passwordSalt, created_at: member.createdAt,
});

async function readSupabaseMembers() {
  const { data, error } = await supabaseAdmin().from("members").select("*").order("created_at", { ascending: true });
  if (error) throw error;
  if (data?.length) return (data as MemberRow[]).map(fromRow);
  const seeded = await seedMembers();
  const { error: seedError } = await supabaseAdmin().from("members").insert(seeded.members.map(toRow));
  if (seedError) throw seedError;
  return seeded.members;
}

async function updateSupabaseMember(id: string, changes: Partial<Member>) {
  const row: Record<string, unknown> = {};
  if (changes.name !== undefined) row.name = changes.name;
  if (changes.username !== undefined) row.username = changes.username;
  if (changes.role !== undefined) row.role = changes.role;
  if (changes.credits !== undefined) row.credits = changes.credits;
  if (changes.status !== undefined) row.status = changes.status;
  if (changes.lastLoginAt !== undefined) row.last_login_at = changes.lastLoginAt || null;
  if (changes.lastCreditDeductedOn !== undefined) row.last_credit_deducted_on = changes.lastCreditDeductedOn || null;
  if (changes.suspendedAt !== undefined) row.suspended_at = changes.suspendedAt || null;
  if (changes.suspensionReason !== undefined) row.suspension_reason = changes.suspensionReason || null;
  if (changes.suspensionUntil !== undefined) row.suspension_until = changes.suspensionUntil || null;
  if (changes.forcePasswordChange !== undefined) row.force_password_change = changes.forcePasswordChange;
  if (changes.passwordHash !== undefined) row.password_hash = changes.passwordHash;
  if (changes.passwordSalt !== undefined) row.password_salt = changes.passwordSalt;
  const { data, error } = await supabaseAdmin().from("members").update(row).eq("id", id).select("*").maybeSingle();
  if (error) throw error;
  return data ? fromRow(data as MemberRow) : null;
}

async function hashPassword(password: string, salt = randomBytes(16).toString("hex")) {
  const hash = await scrypt(password, salt, 64) as Buffer;
  return { passwordHash: hash.toString("hex"), passwordSalt: salt };
}

export async function passwordMatches(password: string, member: Member) {
  const { passwordHash } = await hashPassword(password, member.passwordSalt);
  const expected = Buffer.from(member.passwordHash, "hex");
  const actual = Buffer.from(passwordHash, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function seededMember(name: string, username: string, password: string, role: MemberRole): Promise<Member> {
  return {
    id: makeId(), name, username: cleanUsername(username), role, credits: 0,
    status: role === "admin" ? "active" : "expired",
    ...(await hashPassword(password)), createdAt: new Date().toISOString(),
  };
}

async function seedMembers(): Promise<MemberFile> {
  const adminName = process.env.ADMIN_NAME;
  const adminUsername = process.env.ADMIN_USERNAME;
  const adminPassword = process.env.ADMIN_PASSWORD;
  const userUsername = process.env.USER_USERNAME;
  const userPassword = process.env.USER_PASSWORD;
  if (!adminName || !adminUsername || !adminPassword || !userUsername || !userPassword) {
    throw new Error("Member seed credentials must be configured; refusing to create default accounts.");
  }
  return {
    members: [
      await seededMember(adminName, adminUsername, adminPassword, "admin"),
      await seededMember("Student", userUsername, userPassword, "user"),
    ],
  };
}

async function readMembers(): Promise<MemberFile> {
  if (cached) return cached;
  try {
    const parsed = JSON.parse(await readFile(dataFile(), "utf8")) as MemberFile;
    if (!Array.isArray(parsed.members)) throw new Error("Invalid member store");
    cached = parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    cached = await seedMembers();
    await persistMembers(cached);
  }
  return cached;
}

async function persistMembers(file: MemberFile) {
  const target = dataFile();
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(file, null, 2), "utf8");
  for (let attempt = 0; ; attempt += 1) {
    try { await rename(temporary, target); break; }
    catch (error) {
      if (attempt >= 2 || !["EPERM", "EACCES"].includes((error as NodeJS.ErrnoException).code || "")) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
}

async function updateMembers(mutator: (file: MemberFile) => MemberFile | Promise<MemberFile>) {
  const task = writeQueue.then(async () => {
    const next = await mutator(await readMembers());
    cached = next;
    await persistMembers(next);
    return next;
  });
  writeQueue = task.then(() => undefined, () => undefined);
  return task;
}

export async function listMembers() {
  await reconcileMembers();
  if (isSupabaseConfigured()) return (await readSupabaseMembers()).map(publicMember);
  return (await readMembers()).members.map(publicMember);
}

export async function findMember(username: string) {
  await reconcileMembers();
  if (isSupabaseConfigured()) return (await readSupabaseMembers()).find((member) => member.username === cleanUsername(username)) || null;
  return (await readMembers()).members.find((member) => member.username === cleanUsername(username)) || null;
}

export async function verifyMember(username: string, password: string) {
  const member = await findMember(username);
  return member && await passwordMatches(password, member) ? member : null;
}

async function reconcileMembers() {
  const today = istDateKey();
  if (isSupabaseConfigured()) {
    const members = await readSupabaseMembers();
    for (const member of members) {
      if (member.role === "admin") continue;
      const next = resumeEndedSuspension({ ...member }, today);
      const lastDeductedOn = next.lastCreditDeductedOn || istDateKey(new Date(next.createdAt));
      const daysSinceDeduction = elapsedDays(lastDeductedOn, today);
      if (next.status === "active" && daysSinceDeduction > 0) {
        next.credits = Math.max(0, next.credits - daysSinceDeduction);
        next.lastCreditDeductedOn = today;
        if (next.credits === 0) next.status = "expired";
      }
      if (next.status === "active" && next.credits === 0) next.status = "expired";
      const lastSeen = new Date(next.lastLoginAt || next.createdAt).getTime();
      if (next.status === "active" && Date.now() - lastSeen >= INACTIVITY_MS) {
        next.status = "suspended";
        next.suspendedAt = new Date().toISOString();
      }
      if (next.credits !== member.credits || next.status !== member.status || next.lastCreditDeductedOn !== member.lastCreditDeductedOn || next.suspendedAt !== member.suspendedAt) {
        await updateSupabaseMember(member.id, { credits: next.credits, status: next.status, lastLoginAt: next.lastLoginAt,
          lastCreditDeductedOn: next.lastCreditDeductedOn, suspendedAt: next.suspendedAt || "", suspensionReason: next.suspensionReason || "", suspensionUntil: next.suspensionUntil || "" });
      }
    }
    return;
  }
  await updateMembers((file) => {
    let changed = false;
    const members = file.members.map((member) => {
      if (member.role === "admin") return member;
      const next = resumeEndedSuspension({ ...member }, today);
      if (next.status !== member.status) changed = true;
      const lastDeductedOn = next.lastCreditDeductedOn || istDateKey(new Date(next.createdAt));
      const daysSinceDeduction = elapsedDays(lastDeductedOn, today);
      if (next.status === "active" && daysSinceDeduction > 0) {
        next.credits = Math.max(0, next.credits - daysSinceDeduction);
        next.lastCreditDeductedOn = today;
        if (next.credits === 0) next.status = "expired";
        changed = true;
      }
      if (next.status === "active" && next.credits === 0) { next.status = "expired"; changed = true; }
      const lastSeen = new Date(next.lastLoginAt || next.createdAt).getTime();
      if (next.status === "active" && Date.now() - lastSeen >= INACTIVITY_MS) {
        next.status = "suspended";
        next.suspendedAt = new Date().toISOString();
        changed = true;
      }
      return next;
    });
    return changed ? { members } : file;
  });
}

export async function createMember(input: { name: string; username: string; password: string; credits: number }) {
  const name = input.name.trim();
  const username = cleanUsername(input.username);
  if (name.length < 2 || name.length > 80) throw new Error("Name must be between 2 and 80 characters.");
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw new Error("Username must be 3-40 characters using letters, numbers, ., _, or -.");
  if (input.password.length < 8) throw new Error("Password must be at least 8 characters.");
  if (!Number.isInteger(input.credits) || input.credits < 0 || input.credits > 1_000_000) throw new Error("Credits must be a whole number from 0 to 1,000,000.");
  const member = { id: makeId(), name, username, role: "user" as const, credits: input.credits, status: input.credits > 0 ? "active" as const : "expired" as const, lastCreditDeductedOn: istDateKey(), ...(await hashPassword(input.password)), createdAt: new Date().toISOString() };
  if (isSupabaseConfigured()) {
    const { data, error } = await supabaseAdmin().from("members").insert(toRow(member)).select("*").single();
    if (error) {
      if (error.code === "23505") throw new Error("That username is already in use.");
      throw error;
    }
    return publicMember(fromRow(data as MemberRow));
  }
  await updateMembers((file) => {
    if (file.members.some((existing) => existing.username === username)) throw new Error("That username is already in use.");
    return { members: [...file.members, member] };
  });
  return publicMember(member);
}

export async function updateMemberCredits(id: string, credits: number) {
  if (!Number.isInteger(credits) || credits < 0 || credits > 1_000_000) throw new Error("Credits must be a whole number from 0 to 1,000,000.");
  if (isSupabaseConfigured()) {
    const existing = (await readSupabaseMembers()).find((member) => member.id === id);
    if (!existing) throw new Error("Member not found.");
    return publicMember(await updateSupabaseMember(id, { credits, status: creditStatus(existing, credits), lastCreditDeductedOn: istDateKey() }) || existing);
  }
  let updated: PublicMember | null = null;
  await updateMembers((file) => ({ members: file.members.map((member) => {
    if (member.id !== id) return member;
    const status = creditStatus(member, credits);
    updated = publicMember({ ...member, credits, status, lastCreditDeductedOn: istDateKey() });
    return { ...member, credits, status, lastCreditDeductedOn: istDateKey() };
  }) }));
  if (!updated) throw new Error("Member not found.");
  return updated;
}

export async function updateMemberProfile(id: string, input: { name?: string; username?: string; role?: MemberRole }) {
  const name = input.name?.trim();
  const username = input.username === undefined ? undefined : cleanUsername(input.username);
  if (name !== undefined && (name.length < 2 || name.length > 80)) throw new Error("Name must be between 2 and 80 characters.");
  if (username !== undefined && !/^[a-z0-9._-]{3,40}$/.test(username)) throw new Error("Username must be 3-40 characters using letters, numbers, ., _, or -.");
  if (input.role !== undefined && input.role !== "user" && input.role !== "admin") throw new Error("Invalid role.");
  const changes = { ...(name === undefined ? {} : { name }), ...(username === undefined ? {} : { username }), ...(input.role === undefined ? {} : { role: input.role }) };
  if (isSupabaseConfigured()) {
    const members = await readSupabaseMembers();
    const existing = members.find((member) => member.id === id);
    if (!existing) throw new Error("Member not found.");
    if (existing.role === "admin" && input.role === "user" && !members.some((member) => member.id !== id && member.role === "admin")) throw new Error("At least one admin account is required.");
    return publicMember(await updateSupabaseMember(id, changes) || existing);
  }
  let updated: PublicMember | null = null;
  await updateMembers((file) => {
    if (username && file.members.some((member) => member.id !== id && member.username === username)) throw new Error("That username is already in use.");
    if (input.role === "user" && file.members.some((member) => member.id === id && member.role === "admin") && !file.members.some((member) => member.id !== id && member.role === "admin")) throw new Error("At least one admin account is required.");
    return { members: file.members.map((member) => member.id === id ? ({ ...member, ...changes, username: username || member.username }) : member) };
  });
  const member = (await readMembers()).members.find((item) => item.id === id);
  if (!member) throw new Error("Member not found.");
  updated = publicMember(member);
  return updated;
}

export async function resetMemberPassword(id: string, password: string) {
  if (password.length < 8) throw new Error("Temporary password must be at least 8 characters.");
  const credentials = await hashPassword(password);
  if (isSupabaseConfigured()) {
    const existing = (await readSupabaseMembers()).find((member) => member.id === id);
    if (!existing) throw new Error("Member not found.");
    return publicMember(await updateSupabaseMember(id, { ...credentials, forcePasswordChange: true }) || existing);
  }
  await updateMembers((file) => ({ members: file.members.map((member) => member.id === id ? { ...member, ...credentials, forcePasswordChange: true } : member) }));
  const member = (await readMembers()).members.find((item) => item.id === id);
  if (!member) throw new Error("Member not found.");
  return publicMember(member);
}

export async function changeMemberPassword(id: string, currentPassword: string, newPassword: string) {
  if (newPassword.length < 8) throw new Error("New password must be at least 8 characters.");
  if (currentPassword === newPassword) throw new Error("Choose a different password.");
  if (isSupabaseConfigured()) {
    const member = (await readSupabaseMembers()).find((item) => item.id === id);
    if (!member) throw new Error("Member not found.");
    if (!await passwordMatches(currentPassword, member)) throw new Error("Current password is incorrect.");
    const updated = await updateSupabaseMember(id, { ...(await hashPassword(newPassword)), forcePasswordChange: false });
    if (!updated) throw new Error("Member not found.");
    return publicMember(updated);
  }
  let updated: PublicMember | null = null;
  const credentials = await hashPassword(newPassword);
  await updateMembers(async (file) => {
    const member = file.members.find((item) => item.id === id);
    if (!member) throw new Error("Member not found.");
    if (!await passwordMatches(currentPassword, member)) throw new Error("Current password is incorrect.");
    const changed = { ...member, ...credentials, forcePasswordChange: false };
    updated = publicMember(changed);
    return { members: file.members.map((item) => item.id === id ? changed : item) };
  });
  if (!updated) throw new Error("Member not found.");
  return updated;
}

export async function suspendMember(id: string, reason: string, until?: string) {
  const cleanReason = reason.trim();
  if (!cleanReason) throw new Error("A suspension reason is required.");
  if (until && (!validDateKey(until) || until < istDateKey())) throw new Error("End date must be a valid date today or later (YYYY-MM-DD).");
  const changes = { status: "suspended" as const, suspendedAt: new Date().toISOString(), suspensionReason: cleanReason.slice(0, 240), suspensionUntil: until || "" };
  if (isSupabaseConfigured()) {
    const existing = (await readSupabaseMembers()).find((member) => member.id === id);
    if (!existing) throw new Error("Member not found.");
    return publicMember(await updateSupabaseMember(id, changes) || existing);
  }
  await updateMembers((file) => ({ members: file.members.map((member) => member.id === id ? { ...member, ...changes } : member) }));
  const member = (await readMembers()).members.find((item) => item.id === id);
  if (!member) throw new Error("Member not found.");
  return publicMember(member);
}

export async function bulkAdjustCredits(amount: number) {
  if (!Number.isInteger(amount) || amount === 0) throw new Error("Credit adjustment must be a non-zero whole number.");
  const apply = (member: Member) => {
    if (member.role !== "user" || member.status !== "active") return member;
    const credits = Math.max(0, Math.min(1_000_000, member.credits + amount));
    return { ...member, credits, status: credits > 0 ? "active" as const : "expired" as const, lastCreditDeductedOn: istDateKey() };
  };
  if (isSupabaseConfigured()) {
    const members = await readSupabaseMembers();
    const targets = members.filter((member) => member.role === "user" && member.status === "active");
    await Promise.all(targets.map((member) => updateSupabaseMember(member.id, apply(member))));
    return targets.length;
  }
  let affected = 0;
  await updateMembers((file) => ({ members: file.members.map((member) => {
    if (member.role === "user" && member.status === "active") affected += 1;
    return apply(member);
  }) }));
  return affected;
}

export async function recordSuccessfulLogin(id: string) {
  if (isSupabaseConfigured()) {
    const updated = await updateSupabaseMember(id, { lastLoginAt: new Date().toISOString() });
    if (!updated) throw new Error("Member not found.");
    return updated;
  }
  let updated: Member | null = null;
  await updateMembers((file) => ({ members: file.members.map((member) => {
    if (member.id !== id) return member;
    updated = { ...member, lastLoginAt: new Date().toISOString() };
    return updated;
  }) }));
  if (!updated) throw new Error("Member not found.");
  return updated;
}

export async function restoreMember(id: string) {
  if (isSupabaseConfigured()) {
    const existing = (await readSupabaseMembers()).find((member) => member.id === id);
    if (!existing) throw new Error("Member not found.");
    const now = new Date().toISOString();
    return publicMember(await updateSupabaseMember(id, { status: existing.credits > 0 ? "active" : "expired", lastLoginAt: now, lastCreditDeductedOn: istDateKey(), suspendedAt: "", suspensionReason: "", suspensionUntil: "" }) || existing);
  }
  let updated: PublicMember | null = null;
  await updateMembers((file) => ({ members: file.members.map((member) => {
    if (member.id !== id) return member;
    const now = new Date().toISOString();
    const restored = { ...member, status: member.credits > 0 ? "active" as const : "expired" as const, lastLoginAt: now, lastCreditDeductedOn: istDateKey(), suspendedAt: undefined, suspensionReason: undefined, suspensionUntil: undefined };
    updated = publicMember(restored);
    return restored;
  }) }));
  if (!updated) throw new Error("Member not found.");
  return updated;
}

export async function deleteMember(id: string, requesterUsername: string) {
  if (isSupabaseConfigured()) {
    const members = await readSupabaseMembers();
    const target = members.find((member) => member.id === id);
    if (!target) throw new Error("Member not found.");
    if (target.username === requesterUsername) throw new Error("You cannot delete the account you are currently using.");
    if (target.role === "admin" && !members.some((member) => member.id !== id && member.role === "admin")) throw new Error("At least one admin account is required.");
    const { error } = await supabaseAdmin().from("members").delete().eq("id", id);
    if (error) throw error;
    return publicMember(target);
  }
  let deleted: PublicMember | null = null;
  await updateMembers((file) => {
    const target = file.members.find((member) => member.id === id);
    if (!target) throw new Error("Member not found.");
    if (target.username === requesterUsername) throw new Error("You cannot delete the account you are currently using.");
    if (target.role === "admin" && !file.members.some((member) => member.id !== id && member.role === "admin")) throw new Error("At least one admin account is required.");
    deleted = publicMember(target);
    return { members: file.members.filter((member) => member.id !== id) };
  });
  return deleted;
}
