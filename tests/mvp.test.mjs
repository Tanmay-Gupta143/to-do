import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("the live MVP responds successfully", async () => {
  const response = await fetch("http://localhost:5173/");
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Daily Study/i);
});

test("the auth endpoint rejects anonymous requests and accepts the default admin credential", async () => {
  const anonymous = await fetch("http://localhost:5173/api/auth");
  assert.equal(anonymous.status, 401);
  const login = await fetch("http://localhost:5173/api/auth", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "tanmay-admin", password: "tavash123" }),
  });
  assert.equal(login.status, 200);
  const loginPayload = await login.json();
  assert.equal(loginPayload.username, "tanmay-admin");
  assert.equal(loginPayload.role, "admin");
  assert.equal(typeof loginPayload.name, "string");
});

test("the timer checkpoints active time and pauses sessions on reload or hide", () => {
  assert.match(page, /activeSeconds: active, setupStartedAt: checkpoint/);
  assert.match(page, /setupStartedAt: undefined/);
  assert.match(page, /document\.visibilityState === "visible"/);
  assert.match(page, /localStorage\.setItem\(storageKey/);
  assert.match(page, /STORAGE_KEY}:\$\{session\.username\}/);
});

test("task permissions and duplicate editing follow the PRD", () => {
  assert.match(page, /if \(setupOpen\).*tasks: current\.tasks\.filter/);
  assert.match(page, /if \(!setupOpen && record\?\.scheduled && !record\.submitted\)/);
  assert.match(page, /draftDuplicate/);
  assert.match(page, /if \(draftDuplicate\?\.id === id\)/);
  assert.match(page, /setupOpen && <button className="text-btn"/);
  assert.match(page, /submittedAt: Date\.now\(\)/);
});

test("the admin navigation is role-gated and the demo label is removed", () => {
  assert.match(page, /const visibleNav = isAdmin \? nav\.filter\(\(\[id\]\) => id === "admin"\) : nav\.filter\(\(\[id\]\) => id !== "admin"\)/);
  assert.doesNotMatch(page, /\["admin", "Admin demo"/);
  assert.match(page, /if \(isAdmin && view !== "admin"\) setView\("admin"\)/);
  assert.match(page, /if \(!isAdmin && view === "admin"\) setView\("today"\)/);
  assert.match(page, /setView\(nextSession\.role === "admin" \? "admin" : "today"\)/);
  assert.doesNotMatch(page, /tanmay@example\.com/);
  assert.doesNotMatch(page, /<span>\{session\.username\}<\/span>/);
});

test("authentication failures render the account-access popup", () => {
  assert.match(page, /role="alertdialog"/);
  assert.match(page, /Your account is suspended\. Please contact the admin for more information\./);
  assert.match(page, /Your account credits have expired\. Please contact the admin\./);
  assert.match(page, /Invalid username or password/);
  assert.match(page, /setLoginError\(""\)/);
  assert.match(page, /setLoginUsername\(""\); setLoginPassword\(""\); setLoginError\(""\)/);
});

test("IST calendar calculations do not depend on the device timezone", () => {
  assert.match(page, /new Date\(Date\.UTC\(year, month - 1, 1\)\)\.getUTCDay\(\)/);
  assert.match(page, /new Date\(`\$\{key\}-01T12:00:00Z`\)/);
  assert.match(page, /const TIME_ZONE = "Asia\/Kolkata"/);
});

test("timer urgency, minimized presentation, and submitted incomplete styling exist", () => {
  assert.match(page, /timer-panel-minimized/);
  assert.match(page, /const urgent = remaining <= 180/);
  assert.match(css, /\.timer-panel-urgent/);
  assert.match(css, /\.task-row\.done \.check:disabled:empty ~ \.task-title/);
  assert.match(css, /content: "X"/);
});

test("the note uses a locally bundled daily motivational quote", () => {
  assert.match(page, /from "success-motivational-quotes"/);
  assert.match(page, /quoteLibrary\.getAllQuotes\(\)/);
  assert.match(page, /today\.replaceAll\("-", ""\)/);
  assert.match(page, /motivationalQuote\.body/);
  assert.match(page, /motivationalQuote\.by/);
});

test("the branded orange notebook icon is served and used by the app", async () => {
  const response = await fetch("http://localhost:5173/daily-study-icon.png");
  assert.equal(response.status, 200);
  assert.match(css, /background-image: url\("\/daily-study-icon\.png\?v=2"\)/);
  assert.match(await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"), /daily-study-icon\.png/);
});

test("member identity and streak presentation are data-driven", () => {
  assert.match(page, /type AuthSession = \{ username: string; name: string;/);
  assert.match(page, /readStore\(session \? `\$\{STORAGE_KEY\}:\$\{session\.username\}` : STORAGE_KEY, session\?\.name\)/);
  assert.match(page, /while \(store\.records\[cursor\]\?\.submitted\)/);
  assert.doesNotMatch(page, /<strong>4 days<\/strong>/);
});

test("member avatars use consistent short names derived from full names", () => {
  assert.match(page, /const shortName = \(fullName: string\)/);
  assert.match(page, /if \(parts\[0\]\.length <= 2\) return parts\[0\]\.toUpperCase\(\)/);
  assert.match(page, /shortName\(store\.displayName \|\| session\.name\)/);
  assert.match(page, /shortName\(member\.name\)/);
  assert.doesNotMatch(page, /member\.name\.slice\(0, 2\)\.toUpperCase\(\)/);
});

test("member deletion is admin-only and logout lives in settings", async () => {
  const route = await readFile(new URL("../app/api/members/route.ts", import.meta.url), "utf8");
  assert.match(route, /export async function DELETE/);
  assert.match(route, /session\?\.role !== "admin"/);
  assert.match(page, /settings-logout/);
  assert.match(page, /admin-signout/);
  assert.doesNotMatch(page, /className="avatar" aria-label="Sign out"/);
  assert.doesNotMatch(page, /className="icon-btn" aria-label="Sign out"/);
});

test("member access expires credits daily and supports reversible suspension", async () => {
  const members = await readFile(new URL("../lib/members.ts", import.meta.url), "utf8");
  const authRoute = await readFile(new URL("../app/api/auth/route.ts", import.meta.url), "utf8");
  const memberRoute = await readFile(new URL("../app/api/members/route.ts", import.meta.url), "utf8");
  assert.match(members, /INACTIVITY_MS = 4 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(members, /next\.credits = Math\.max\(0, next\.credits - daysSinceDeduction\)/);
  assert.match(members, /next\.status = "suspended"/);
  assert.match(members, /export async function restoreMember/);
  assert.match(authRoute, /ACCOUNT_SUSPENDED/);
  assert.match(authRoute, /CREDITS_EXPIRED/);
  assert.match(memberRoute, /body\.action === "restore"/);
  assert.match(page, /SUSPENDED_MESSAGE/);
});

test("Supabase member persistence is configured for production", async () => {
  const members = await readFile(new URL("../lib/members.ts", import.meta.url), "utf8");
  const client = await readFile(new URL("../lib/supabase-admin.ts", import.meta.url), "utf8");
  const migration = await readFile(new URL("../supabase/migrations/001_create_members.sql", import.meta.url), "utf8");
  assert.match(members, /readSupabaseMembers/);
  assert.match(members, /from\("members"\)/);
  assert.match(client, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(client, /autoRefreshToken: false/);
  assert.match(migration, /create table if not exists public\.members/);
  assert.match(migration, /username text not null unique/);
  assert.match(migration, /enable row level security/);
});

test("user settings show the authenticated member credit balance", async () => {
  const auth = await readFile(new URL("../lib/auth.ts", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/auth/route.ts", import.meta.url), "utf8");
  assert.match(auth, /credits: number/);
  assert.match(auth, /credits: member\.credits/);
  assert.match(route, /credits: session\.credits/);
  assert.match(page, /Credits remaining/);
  assert.match(page, /className="credits-value">\{session\.credits\}/);
  assert.match(css, /\.credits-value/);
});

test("the garbled top-bar date chip is hidden", () => {
  assert.match(css, /\.date-chip\s*\{[\s\S]*display: none/);
});
