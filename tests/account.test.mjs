import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test, { after } from "node:test";

// Node strips TypeScript types for these tests; copied imports use explicit extensions.
const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const dataRoot = path.join(root, ".data");
await mkdir(dataRoot, { recursive: true });
const directory = await mkdtemp(path.join(dataRoot, "account-test-"));
process.env.MEMBERS_DATA_FILE = path.join(directory, "members.json");
process.env.ADMIN_NAME = "Test Admin";
process.env.ADMIN_USERNAME = "test-admin";
process.env.ADMIN_PASSWORD = "initial-admin-password";
process.env.USER_USERNAME = "test-student";
process.env.USER_PASSWORD = "initial-student-password";
process.env.AUTH_SECRET = "local-account-test-signing-secret";
process.env.SUPABASE_URL = "";
process.env.SUPABASE_SERVICE_ROLE_KEY = "";
process.env.NODE_ENV = "test";

await writeFile(path.join(directory, "supabase-admin.ts"), await readFile(path.join(root, "lib", "supabase-admin.ts"), "utf8"));
const memberSource = (await readFile(path.join(root, "lib", "members.ts"), "utf8"))
  .replace('from "./supabase-admin"', 'from "./supabase-admin.ts"');
await writeFile(path.join(directory, "members.ts"), memberSource);
const authSource = (await readFile(path.join(root, "lib", "auth.ts"), "utf8"))
  .replace('from "./members"', 'from "./members.ts"');
await writeFile(path.join(directory, "auth.ts"), authSource);
const members = await import(pathToFileURL(path.join(directory, "members.ts")).href);
const auth = await import(pathToFileURL(path.join(directory, "auth.ts")).href);
after(async () => {
  const resolved = path.resolve(directory);
  if (!resolved.startsWith(path.resolve(dataRoot) + path.sep) || !path.basename(resolved).startsWith("account-test-")) throw new Error("Unsafe test cleanup path");
  await rm(resolved, { recursive: true, force: true });
});

test("credit edits preserve suspension and expired credits block access", async () => {
  const seededStudent = await members.findMember("test-student");
  assert.equal(seededStudent.status, "expired");
  const member = await members.createMember({ name: "Test Member", username: "member-one", password: "first-password-123", credits: 5 });
  await members.suspendMember(member.id, "Manual review");
  const credited = await members.updateMemberCredits(member.id, 10);
  assert.equal(credited.status, "suspended");
  const restored = await members.restoreMember(member.id);
  assert.equal(restored.status, "active");
  const expired = await members.updateMemberCredits(member.id, 0);
  assert.equal(expired.status, "expired");
});

test("password reset requires change and old passwords no longer work", async () => {
  const member = await members.createMember({ name: "Another Member", username: "member-two", password: "first-password-123", credits: 5 });
  const oldSession = auth.sessionForMember(await members.findMember("member-two"));
  await members.resetMemberPassword(member.id, "temporary-password-123");
  assert.equal(auth.sessionMatchesMember(oldSession, await members.findMember("member-two")), false);
  assert.equal(await members.verifyMember("member-two", "first-password-123"), null);
  const temporary = await members.verifyMember("member-two", "temporary-password-123");
  assert.equal(temporary.forcePasswordChange, true);
  const changed = await members.changeMemberPassword(member.id, "temporary-password-123", "new-password-123");
  assert.equal(changed.forcePasswordChange, false);
  assert.equal(auth.sessionMatchesMember(auth.sessionForMember(await members.findMember("member-two")), await members.findMember("member-two")), true);
  assert.equal(await members.verifyMember("member-two", "temporary-password-123"), null);
  assert.ok(await members.verifyMember("member-two", "new-password-123"));
});
