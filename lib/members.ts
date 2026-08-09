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

const fromRow = (row: MemberRow): Member => ({
  id: row.id, name: row.name, username: row.username, role: row.role, credits: row.credits, status: row.status,
  lastLoginAt: row.last_login_at || undefined, lastCreditDeductedOn: row.last_credit_deducted_on || undefined,
  suspendedAt: row.suspended_at || undefined, passwordHash: row.password_hash, passwordSalt: row.password_salt, createdAt: row.created_at,
});
const toRow = (member: Member): MemberRow => ({
  id: member.id, name: member.name, username: member.username, role: member.role, credits: member.credits, status: member.status,
  last_login_at: member.lastLoginAt || null, last_credit_deducted_on: member.lastCreditDeductedOn || null,
  suspended_at: member.suspendedAt || null, password_hash: member.passwordHash, password_salt: member.passwordSalt, created_at: member.createdAt,
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
    status: "active",
    ...(await hashPassword(password)), createdAt: new Date().toISOString(),
  };
}

async function seedMembers(): Promise<MemberFile> {
  return {
    members: [
      await seededMember(process.env.ADMIN_NAME || "Tanmay", process.env.ADMIN_USERNAME || "tanmay-admin", process.env.ADMIN_PASSWORD || "tavash123", "admin"),
      await seededMember("Student", process.env.USER_USERNAME || "student", process.env.USER_PASSWORD || "study123", "user"),
    ],
  };
}

async function readMembers(): Promise<MemberFile> {
  if (cached) return cached;
  try {
    const parsed = JSON.parse(await readFile(dataFile(), "utf8")) as MemberFile;
    if (!Array.isArray(parsed.members)) throw new Error("Invalid member store");
    cached = parsed;
    const configuredAdminUsername = cleanUsername(process.env.ADMIN_USERNAME || "tanmay-admin");
    const configuredAdminPassword = process.env.ADMIN_PASSWORD || "tavash123";
    const legacyAdmin = cached.members.find((member) => member.role === "admin" && member.username === "admin");
    if (legacyAdmin && configuredAdminUsername !== "admin") {
      const credentials = await hashPassword(configuredAdminPassword);
      legacyAdmin.username = configuredAdminUsername;
      legacyAdmin.passwordHash = credentials.passwordHash;
      legacyAdmin.passwordSalt = credentials.passwordSalt;
      await persistMembers(cached);
    }
  } catch {
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
  await rename(temporary, target);
}

async function updateMembers(mutator: (file: MemberFile) => MemberFile) {
  const task = writeQueue.then(async () => {
    const next = mutator(await readMembers());
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
  const configuredAdminUsername = cleanUsername(process.env.ADMIN_USERNAME || "tanmay-admin");
  const configuredAdminPassword = process.env.ADMIN_PASSWORD || "tavash123";
  if (cleanUsername(username) === configuredAdminUsername && password === configuredAdminPassword) {
    if (isSupabaseConfigured()) {
      const admin = (await readSupabaseMembers()).find((member) => member.role === "admin");
      if (admin) {
        const credentials = await hashPassword(configuredAdminPassword);
        return await updateSupabaseMember(admin.id, { username: configuredAdminUsername, ...credentials }) || admin;
      }
      return null;
    }
    const file = await readMembers();
    const admin = file.members.find((member) => member.role === "admin");
    if (admin) {
      admin.username = configuredAdminUsername;
      const credentials = await hashPassword(configuredAdminPassword);
      admin.passwordHash = credentials.passwordHash;
      admin.passwordSalt = credentials.passwordSalt;
      void persistMembers(file).catch(() => undefined);
      return admin;
    }
  }
  const member = await findMember(username);
  return member && await passwordMatches(password, member) ? member : null;
}

async function reconcileMembers() {
  const today = istDateKey();
  if (isSupabaseConfigured()) {
    const members = await readSupabaseMembers();
    for (const member of members) {
      if (member.role === "admin") continue;
      const next = { ...member };
      const lastDeductedOn = next.lastCreditDeductedOn || istDateKey(new Date(next.createdAt));
      const daysSinceDeduction = elapsedDays(lastDeductedOn, today);
      if (next.status === "active" && daysSinceDeduction > 0) {
        next.credits = Math.max(0, next.credits - daysSinceDeduction);
        next.lastCreditDeductedOn = today;
        if (next.credits === 0) next.status = "expired";
      }
      const lastSeen = new Date(next.lastLoginAt || next.createdAt).getTime();
      if (next.status === "active" && Date.now() - lastSeen >= INACTIVITY_MS) {
        next.status = "suspended";
        next.suspendedAt = new Date().toISOString();
      }
      if (next.credits !== member.credits || next.status !== member.status || next.lastCreditDeductedOn !== member.lastCreditDeductedOn || next.suspendedAt !== member.suspendedAt) {
        await updateSupabaseMember(member.id, { credits: next.credits, status: next.status, lastCreditDeductedOn: next.lastCreditDeductedOn, suspendedAt: next.suspendedAt });
      }
    }
    return;
  }
  await updateMembers((file) => {
    let changed = false;
    const members = file.members.map((member) => {
      if (member.role === "admin") return member;
      const next = { ...member };
      const lastDeductedOn = next.lastCreditDeductedOn || istDateKey(new Date(next.createdAt));
      const daysSinceDeduction = elapsedDays(lastDeductedOn, today);
      if (next.status === "active" && daysSinceDeduction > 0) {
        next.credits = Math.max(0, next.credits - daysSinceDeduction);
        next.lastCreditDeductedOn = today;
        if (next.credits === 0) next.status = "expired";
        changed = true;
      }
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
    return publicMember(await updateSupabaseMember(id, { credits, status: existing.role === "admin" ? existing.status : credits > 0 ? "active" : "expired", lastCreditDeductedOn: istDateKey() }) || existing);
  }
  let updated: PublicMember | null = null;
  await updateMembers((file) => ({ members: file.members.map((member) => {
    if (member.id !== id) return member;
    const status = member.role === "admin" ? member.status : credits > 0 ? "active" : "expired";
    updated = publicMember({ ...member, credits, status, lastCreditDeductedOn: istDateKey() });
    return { ...member, credits, status, lastCreditDeductedOn: istDateKey() };
  }) }));
  if (!updated) throw new Error("Member not found.");
  return updated;
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
    return publicMember(await updateSupabaseMember(id, { status: existing.credits > 0 ? "active" : "expired", lastLoginAt: now, lastCreditDeductedOn: istDateKey(), suspendedAt: "" }) || existing);
  }
  let updated: PublicMember | null = null;
  await updateMembers((file) => ({ members: file.members.map((member) => {
    if (member.id !== id) return member;
    const now = new Date().toISOString();
    const restored = { ...member, status: member.credits > 0 ? "active" as const : "expired" as const, lastLoginAt: now, lastCreditDeductedOn: istDateKey(), suspendedAt: undefined };
    updated = publicMember(restored);
    return restored;
  }) }));
  if (!updated) throw new Error("Member not found.");
  return updated;
}

export async function deleteMember(id: string, requesterUsername: string) {
  if (isSupabaseConfigured()) {
    const target = (await readSupabaseMembers()).find((member) => member.id === id);
    if (!target) throw new Error("Member not found.");
    if (target.username === requesterUsername) throw new Error("You cannot delete the account you are currently using.");
    const { error } = await supabaseAdmin().from("members").delete().eq("id", id);
    if (error) throw error;
    return publicMember(target);
  }
  let deleted: PublicMember | null = null;
  await updateMembers((file) => {
    const target = file.members.find((member) => member.id === id);
    if (!target) throw new Error("Member not found.");
    if (target.username === requesterUsername) throw new Error("You cannot delete the account you are currently using.");
    deleted = publicMember(target);
    return { members: file.members.filter((member) => member.id !== id) };
  });
  return deleted;
}
