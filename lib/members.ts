import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import path from "node:path";

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

const dataFile = () => process.env.MEMBERS_DATA_FILE || path.join(process.cwd(), ".data", "members.json");
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
  return (await readMembers()).members.map(publicMember);
}

export async function findMember(username: string) {
  await reconcileMembers();
  return (await readMembers()).members.find((member) => member.username === cleanUsername(username)) || null;
}

export async function verifyMember(username: string, password: string) {
  const member = await findMember(username);
  return member && await passwordMatches(password, member) ? member : null;
}

async function reconcileMembers() {
  const today = istDateKey();
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
  await updateMembers((file) => {
    if (file.members.some((existing) => existing.username === username)) throw new Error("That username is already in use.");
    return { members: [...file.members, member] };
  });
  return publicMember(member);
}

export async function updateMemberCredits(id: string, credits: number) {
  if (!Number.isInteger(credits) || credits < 0 || credits > 1_000_000) throw new Error("Credits must be a whole number from 0 to 1,000,000.");
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
