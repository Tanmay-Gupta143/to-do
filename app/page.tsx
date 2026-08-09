"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import quoteLibrary from "success-motivational-quotes";
import {
  ArrowRight,
  CalendarDays,
  Check,
  Copy,
  LayoutDashboard,
  LogOut,
  MoreHorizontal,
  Pencil,
  Plus,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";

type Task = { id: string; title: string; completed: boolean };
type DayRecord = {
  date: string;
  scheduled: boolean;
  setupStartedAt?: number;
  activeSeconds: number;
  setupComplete: boolean;
  submitted: boolean;
  submittedAt?: number;
  tasks: Task[];
};
type Store = { records: Record<string, DayRecord>; reminderTime: string; displayName: string };
type AuthSession = { username: string; name: string; role: "user" | "admin"; credits: number };
type Member = { id: string; name: string; username: string; role: "user" | "admin"; credits: number; status: "active" | "suspended" | "expired"; lastLoginAt?: string; createdAt: string };

const STORAGE_KEY = "daily-study-tracker-mvp";
const SETUP_SECONDS = 15 * 60;
const TIME_ZONE = "Asia/Kolkata";
const CONTACT_EMAIL = "kingluther12345@gmail.com";
const SUSPENDED_MESSAGE = `This account was suspended after 4 days of inactivity. Contact the admin at ${CONTACT_EMAIL} for more information.`;
const EXPIRED_MESSAGE = `This account has no credits remaining. Contact the admin at ${CONTACT_EMAIL} for more information.`;
const blankStore: Store = { records: {}, reminderTime: "20:00", displayName: "Tanmay" };

const shortName = (fullName: string) => {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0][0].toUpperCase();
  if (parts[0].length <= 2) return parts[0].toUpperCase();
  return `${parts[0][0]}${(parts.at(-1) || parts[0])[0]}`.toUpperCase();
};

const todayKey = () => new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(new Date());
const makeId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const formatDate = (key: string) => new Intl.DateTimeFormat("en-IN", {
  weekday: "long", day: "numeric", month: "long", timeZone: TIME_ZONE,
}).format(new Date(`${key}T12:00:00Z`));
const formatMonth = (key: string) => new Intl.DateTimeFormat("en-IN", {
  month: "long", year: "numeric", timeZone: TIME_ZONE,
}).format(new Date(`${key}-01T12:00:00Z`));
const shiftMonth = (key: string, amount: number) => {
  const [year, month] = key.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1 + amount, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
};
const previousDayKey = (key: string) => {
  const [year, month, day] = key.split("-").map(Number);
  const previous = new Date(Date.UTC(year, month - 1, day - 1));
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, "0")}-${String(previous.getUTCDate()).padStart(2, "0")}`;
};
const statusFor = (record?: DayRecord) => {
  if (!record?.scheduled || !record.tasks.length) return "none";
  const done = record.tasks.filter((task) => task.completed).length;
  return done === record.tasks.length ? "green" : done ? "yellow" : "red";
};
const statusLabel = (status: string) => status === "green" ? "Complete" : status === "yellow" ? "In progress" : status === "red" ? "Not complete" : "Not scheduled";
const emptyRecord = (date: string): DayRecord => ({ date, scheduled: false, activeSeconds: 0, setupComplete: false, submitted: false, tasks: [] });

function readStore(storageKey = STORAGE_KEY, defaultDisplayName = blankStore.displayName): Store {
  if (typeof window === "undefined") return blankStore;
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) || "{}");
    const records = Object.fromEntries(Object.entries(parsed.records || {}).map(([key, value]) => {
      const record = value as Partial<DayRecord>;
      return [key, {
        ...emptyRecord(key),
        ...record,
        // Any active session is paused during a reload. activeSeconds is checkpointed continuously.
        setupStartedAt: undefined,
        tasks: Array.isArray(record.tasks) ? record.tasks : [],
      }];
    }));
    const storedDisplayName = typeof parsed.displayName === "string" ? parsed.displayName.trim() : "";
    const displayName = !storedDisplayName || (storedDisplayName === blankStore.displayName && defaultDisplayName !== blankStore.displayName) ? defaultDisplayName : storedDisplayName;
    return { ...blankStore, ...parsed, displayName, records };
  } catch {
    return { ...blankStore, displayName: defaultDisplayName };
  }
}

export default function Home() {
  const [store, setStore] = useState<Store>(blankStore);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginSubmitting, setLoginSubmitting] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [memberForm, setMemberForm] = useState({ name: "", username: "", password: "", confirmPassword: "", credits: "0" });
  const [memberError, setMemberError] = useState("");
  const [memberNotice, setMemberNotice] = useState("");
  const [memberSaving, setMemberSaving] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [view, setView] = useState("today");
  const [newTitle, setNewTitle] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [draftDuplicate, setDraftDuplicate] = useState<Task | null>(null);
  const [visible, setVisible] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [timerExpanded, setTimerExpanded] = useState(false);
  const [monthKey, setMonthKey] = useState(() => todayKey().slice(0, 7));
  const today = todayKey();
  const record = store.records[today];
  const streak = useMemo(() => {
    let count = 0;
    let cursor = today;
    while (store.records[cursor]?.submitted) {
      count += 1;
      cursor = previousDayKey(cursor);
    }
    return count;
  }, [store.records, today]);

  const updateToday = useCallback((fn: (current: DayRecord) => DayRecord) => setStore((current) => {
    const existing = current.records[today] || emptyRecord(today);
    return { ...current, records: { ...current.records, [today]: fn(existing) } };
  }), [today]);

  const storageKey = session ? `${STORAGE_KEY}:${session.username}` : STORAGE_KEY;
  useEffect(() => {
    if (authLoading) return;
    setStore(readStore(session ? `${STORAGE_KEY}:${session.username}` : STORAGE_KEY, session?.name));
    setHydrated(true);
  }, [authLoading, session?.username]);
  useEffect(() => {
    fetch("/api/auth", { credentials: "same-origin" })
      .then((response) => response.ok ? response.json() : null)
      .then((nextSession) => { setSession(nextSession as AuthSession | null); setView(nextSession?.role === "admin" ? "admin" : "today"); })
      .catch(() => setSession(null))
      .finally(() => setAuthLoading(false));
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(storageKey, JSON.stringify(store)); } catch { /* Keep the in-memory session usable if storage is unavailable. */ }
  }, [hydrated, storageKey, store]);
  useEffect(() => {
    const onVisibility = () => setVisible(document.visibilityState === "visible");
    const onBlur = () => setVisible(false);
    const onFocus = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pagehide", onBlur);
    window.addEventListener("pageshow", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pagehide", onBlur);
      window.removeEventListener("pageshow", onFocus);
    };
  }, []);
  useEffect(() => {
    if (!visible) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [visible]);
  useEffect(() => {
    if (hydrated && visible && record?.scheduled && !record.setupComplete && !record.submitted && !record.setupStartedAt) {
      updateToday((current) => ({ ...current, setupStartedAt: Date.now() }));
    }
  }, [hydrated, visible, record?.scheduled, record?.setupComplete, record?.submitted, record?.setupStartedAt, updateToday]);
  useEffect(() => {
    if (!record?.setupStartedAt || !visible || record.setupComplete || record.submitted) return;
    const id = window.setInterval(() => setStore((current) => {
      const currentRecord = current.records[today];
      if (!currentRecord?.setupStartedAt) return current;
      const checkpoint = Date.now();
      const active = Math.min(SETUP_SECONDS, currentRecord.activeSeconds + Math.floor((checkpoint - currentRecord.setupStartedAt) / 1000));
      const nextRecord = active >= SETUP_SECONDS
        ? { ...currentRecord, activeSeconds: SETUP_SECONDS, setupStartedAt: undefined, setupComplete: true }
        : { ...currentRecord, activeSeconds: active, setupStartedAt: checkpoint };
      return { ...current, records: { ...current.records, [today]: nextRecord } };
    }), 1000);
    return () => window.clearInterval(id);
  }, [record?.setupStartedAt, record?.setupComplete, record?.submitted, today, visible]);
  useEffect(() => {
    if (record?.setupStartedAt && !visible) {
      updateToday((current) => ({
        ...current,
        activeSeconds: Math.min(SETUP_SECONDS, current.activeSeconds + Math.floor((Date.now() - (current.setupStartedAt || Date.now())) / 1000)),
        setupStartedAt: undefined,
      }));
    }
  }, [visible, record?.setupStartedAt, updateToday]);
  useEffect(() => {
    if (!record?.scheduled || record.setupComplete || record.submitted) return;
    setTimerExpanded(true);
    const id = window.setTimeout(() => setTimerExpanded(false), 2400);
    return () => window.clearTimeout(id);
  }, [record?.scheduled, record?.setupComplete, record?.submitted]);

  const active = record?.activeSeconds || 0;
  const remaining = Math.max(0, SETUP_SECONDS - active - (record?.setupStartedAt && visible ? Math.floor((now - record.setupStartedAt) / 1000) : 0));
  const setupOpen = Boolean(record?.scheduled && !record.setupComplete && !record.submitted && remaining > 0);
  const urgent = remaining <= 180;
  const progress = record?.tasks.length ? Math.round(record.tasks.filter((task) => task.completed).length / record.tasks.length * 100) : 0;
  const motivationalQuote = useMemo(() => {
    const quotes = quoteLibrary.getAllQuotes();
    const dayNumber = Number(today.replaceAll("-", ""));
    return quotes[dayNumber % quotes.length] || { body: "Keep moving forward.", by: "Daily Study" };
  }, [today]);
  const startSchedule = () => { setTimerExpanded(true); updateToday((current) => ({ ...current, scheduled: true, setupStartedAt: Date.now(), setupComplete: false })); };
  const finishSetup = () => updateToday((current) => ({ ...current, activeSeconds: Math.min(SETUP_SECONDS, current.activeSeconds + Math.floor((Date.now() - (current.setupStartedAt || Date.now())) / 1000)), setupStartedAt: undefined, setupComplete: true }));
  const addTask = (title: string) => {
    const clean = title.trim();
    if (!clean || record?.submitted) return;
    updateToday((current) => ({ ...current, tasks: [...current.tasks, { id: makeId(), title: clean, completed: false }] }));
    setNewTitle("");
  };
  const deleteTask = (id: string) => { if (setupOpen) updateToday((current) => ({ ...current, tasks: current.tasks.filter((task) => task.id !== id) })); };
  const toggleTask = (id: string) => { if (!setupOpen && record?.scheduled && !record.submitted) updateToday((current) => ({ ...current, tasks: current.tasks.map((task) => task.id === id ? { ...task, completed: !task.completed } : task) })); };
  const cancelEdit = () => { setEditingId(null); setEditingTitle(""); setDraftDuplicate(null); };
  const saveEdit = (id: string) => {
    const clean = editingTitle.trim();
    if (!clean) { cancelEdit(); return; }
    if (draftDuplicate?.id === id) {
      updateToday((current) => ({ ...current, tasks: [...current.tasks, { ...draftDuplicate, title: clean }] }));
    } else if (setupOpen) {
      updateToday((current) => ({ ...current, tasks: current.tasks.map((task) => task.id === id ? { ...task, title: clean } : task) }));
    }
    cancelEdit();
  };
  const editTask = (task: Task) => { if (setupOpen) { setEditingId(task.id); setEditingTitle(task.title); } };
  const duplicateTask = (task: Task) => {
    if (record?.submitted) return;
    const draft = { id: makeId(), title: task.title, completed: false };
    setDraftDuplicate(draft);
    setEditingId(draft.id);
    setEditingTitle(draft.title);
  };
  const submit = () => {
    if (record?.tasks.length && !record.submitted) updateToday((current) => ({ ...current, submitted: true, submittedAt: Date.now(), setupStartedAt: undefined, setupComplete: true }));
  };
  const calendarDays = useMemo(() => {
    const [year, month] = monthKey.split("-").map(Number);
    const firstDay = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    const total = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const blanks = firstDay === 0 ? 6 : firstDay - 1;
    return [...Array(blanks).fill(null), ...Array.from({ length: total }, (_, index) => `${year}-${String(month).padStart(2, "0")}-${String(index + 1).padStart(2, "0")}`)];
  }, [monthKey]);

  const nav = [["today", "Today", <LayoutDashboard size={17} key="today-icon" />], ["calendar", "Calendar", <CalendarDays size={17} key="calendar-icon" />], ["settings", "Settings", <Settings size={17} key="settings-icon" />], ["admin", "Admin", <ShieldCheck size={17} key="admin-icon" />]] as const;
  const isAdmin = session?.role === "admin";
  const visibleNav = isAdmin ? nav.filter(([id]) => id === "admin") : nav.filter(([id]) => id !== "admin");
  const loadMembers = useCallback(async () => {
    const response = await fetch("/api/members", { credentials: "same-origin" });
    if (!response.ok) return;
    const data = await response.json() as { members: Member[] };
    setMembers(data.members);
  }, []);
  useEffect(() => { if (isAdmin) void loadMembers(); }, [isAdmin, loadMembers]);
  const createMember = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMemberError(""); setMemberNotice(""); setMemberSaving(true);
    const response = await fetch("/api/members", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...memberForm, credits: Number(memberForm.credits) }) });
    const data = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) setMemberError(data.error || "Could not create the member.");
    else { setMemberNotice("Member created successfully."); setMemberForm({ name: "", username: "", password: "", confirmPassword: "", credits: "0" }); await loadMembers(); }
    setMemberSaving(false);
  };
  const saveCredits = async (member: Member, credits: string) => {
    const response = await fetch("/api/members", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: member.id, credits: Number(credits) }) });
    const data = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) setMemberError(data.error || "Could not update credits."); else { setMemberNotice(`Credits updated for ${member.name}.`); await loadMembers(); }
  };
  const removeMember = async (member: Member) => {
    if (!window.confirm(`Delete ${member.name}'s account? They will no longer be able to sign in.`)) return;
    setMemberError(""); setMemberNotice("");
    const response = await fetch("/api/members", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: member.id }) });
    const data = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) setMemberError(data.error || "Could not delete the member."); else { setMemberNotice(`${member.name} was deleted.`); await loadMembers(); }
  };
  const restoreMember = async (member: Member) => {
    setMemberError(""); setMemberNotice("");
    const response = await fetch("/api/members", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: member.id, action: "restore" }) });
    const data = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) setMemberError(data.error || "Could not restore the member."); else { setMemberNotice(`${member.name}'s account was restored.`); await loadMembers(); }
  };
  const login = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loginSubmitting) return;
    setLoginError("");
    setLoginSubmitting(true);
    try {
      const response = await fetch("/api/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: loginUsername, password: loginPassword }) });
      if (!response.ok) { const data = await response.json().catch(() => ({})) as { code?: string; error?: string }; setLoginError(data.code === "ACCOUNT_SUSPENDED" ? SUSPENDED_MESSAGE : data.code === "CREDITS_EXPIRED" ? EXPIRED_MESSAGE : data.error || "Invalid username or password."); return; }
      const nextSession = await response.json() as AuthSession;
      setSession(nextSession);
      setView(nextSession.role === "admin" ? "admin" : "today");
      setLoginPassword("");
    } catch {
      setLoginError("Could not reach the workspace. Please try again.");
    } finally {
      setLoginSubmitting(false);
    }
  };
  const logout = async () => { await fetch("/api/auth", { method: "DELETE" }); setSession(null); setView("today"); };
  useEffect(() => {
    if (isAdmin && view !== "admin") setView("admin");
    if (!isAdmin && view === "admin") setView("today");
  }, [view, isAdmin]);
  const timerText = `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`;
  const timerPanel = setupOpen ? <div className={`timer-panel ${timerExpanded ? "timer-panel-expanded" : "timer-panel-minimized"} ${urgent ? "timer-panel-urgent" : ""}`}><div className="timer-copy"><span className="timer-kicker">SETUP WINDOW</span><strong>{timerText}</strong><span>Build the list you will actually keep.</span></div><div className="timer-actions"><button className="finish-btn" onClick={finishSetup}>Finish scheduling <ArrowRight size={15} /></button>{record?.tasks.length ? <button className="submit-btn" onClick={submit}>Submit today <ArrowRight size={15} /></button> : null}</div></div> : null;

  if (authLoading) return <main className="auth-shell"><div className="auth-card"><span className="brand-mark">DS</span><strong>Loading workspace</strong><span>Checking your credentials...</span></div></main>;
  if (!session) return <main className="auth-shell"><form className="auth-card auth-form" onSubmit={login}><span className="brand-mark">DS</span><div><span className="eyebrow">PRIVATE WORKSPACE</span><h1>Daily Study</h1><p>Sign in to continue to your daily practice.</p></div><label>Username<input value={loginUsername} onChange={(event) => setLoginUsername(event.target.value)} autoComplete="username" disabled={loginSubmitting} required /></label><label>Password<input type="password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} autoComplete="current-password" disabled={loginSubmitting} required /></label><button className="primary-btn" type="submit" disabled={loginSubmitting}>{loginSubmitting ? <><span className="loading-spinner" aria-hidden="true" /> Signing in...</> : <>Sign in <ArrowRight size={15} /></>}</button></form>{loginError && <div className="auth-popup-backdrop"><div className="auth-popup" role="alertdialog" aria-modal="true" aria-labelledby="auth-popup-title"><span className="auth-popup-icon"><ShieldCheck size={18} /></span><h2 id="auth-popup-title">Account access</h2><p>{loginError}</p><button className="primary-btn" type="button" onClick={() => { setLoginUsername(""); setLoginPassword(""); setLoginError(""); }}>Try again</button></div></div>}</main>;
  return <main className="app-shell"><aside className="sidebar"><div className="brand"><span className="brand-mark">DS</span><span>Daily Study</span></div><div className="workspace-label">PRIVATE WORKSPACE</div><nav className="nav" aria-label="Main navigation">{visibleNav.map(([id, label, icon]) => <button className={view === id ? "nav-item active" : "nav-item"} onClick={() => setView(id)} key={id}><span>{icon}</span>{id === "admin" ? "Admin" : label}</button>)}</nav><div className="sidebar-bottom"><div className="mini-avatar">{shortName(store.displayName || session.name)}</div><div><strong>{store.displayName}</strong><span>{session.role === "admin" ? "Administrator" : "Student account"}</span></div></div></aside><section className="content"><header className="topbar"><div><p className="eyebrow">{view === "today" ? "YOUR DAILY PRACTICE" : view.toUpperCase()}</p><h1>{view === "today" ? "Today" : view === "calendar" ? "Calendar" : view === "settings" ? "Settings" : "Admin overview"}</h1></div><div className="top-actions"><span className="date-chip">India time ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â· {new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: TIME_ZONE }).format(new Date(`${today}T12:00:00Z`))}</span></div></header>
    {view === "today" && <div className="today-layout"><section className="main-column"><div className="hero-row"><div><span className="date-line">{formatDate(today)}</span><h2>Keep the promise you made today.</h2><p className="muted">A short, honest list. No rescheduling, no hiding.</p></div>{record?.submitted && <span className="locked-pill"><Check size={13} /> Day locked</span>}</div>{!record?.scheduled ? <div className="schedule-panel"><div className="panel-icon"><Sparkles size={19} /></div><div><h3>Start with your real list</h3><p>Schedule today&apos;s tasks to open a focused 15-minute setup window. Finish early when the list feels honest.</p></div><button className="primary-btn" onClick={startSchedule}>Schedule today&apos;s tasks <ArrowRight size={15} /></button></div> : <>{timerPanel}{!record.submitted && !setupOpen && record.tasks.length > 0 && <div className="timer-panel"><div className="timer-copy"><span className="timer-kicker">TASKS IN MOTION</span><strong>{progress}% complete</strong><span>Add honestly. Complete honestly.</span></div><button className="submit-btn" onClick={submit}>Submit today <ArrowRight size={15} /></button></div>}{record.submitted && <div className="timer-panel"><div className="timer-copy"><span className="timer-kicker">SUBMITTED</span><strong>Today is locked</strong><span>Your unchecked tasks are saved as incomplete.</span></div></div>}{setupOpen && <div className="setup-note"><span className="live-dot" /> Setup mode ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â· add, edit, delete, or duplicate. Completion starts after setup.</div>}<div className="task-header"><div><span className="section-label">TODAY&apos;S TASKS</span><h3>{record.tasks.length} {record.tasks.length === 1 ? "task" : "tasks"}</h3></div><span className={`status-text ${statusFor(record)}`}>{statusLabel(statusFor(record))}</span></div><div className="task-list">{record.tasks.map((task) => <div className={`task-row ${task.completed || (record.submitted && !task.completed) ? "done" : ""}`} key={task.id}><button className="check" onClick={() => toggleTask(task.id)} aria-label={task.completed ? `Mark ${task.title} incomplete` : `Complete ${task.title}`} disabled={setupOpen || record.submitted}>{task.completed ? <Check size={13} /> : null}</button>{editingId === task.id ? <input className="edit-input" autoFocus value={editingTitle} onChange={(e) => setEditingTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveEdit(task.id); if (e.key === "Escape") cancelEdit(); }} onBlur={() => saveEdit(task.id)} /> : <span className="task-title">{task.title}</span>}<div className="task-actions">{!record.submitted && <>{setupOpen && <button className="text-btn" onClick={() => editTask(task)} aria-label={`Edit ${task.title}`}><Pencil size={13} /></button>}<button className="text-btn" onClick={() => duplicateTask(task)} aria-label={`Duplicate ${task.title}`}><Copy size={13} /></button>{setupOpen && <button className="delete-btn" onClick={() => deleteTask(task.id)} aria-label={`Delete ${task.title}`}><Trash2 size={14} /></button>}</>}</div></div>)}{draftDuplicate && editingId === draftDuplicate.id && <div className="task-row task-row-draft"><button className="check" disabled aria-label="New duplicate task" /><input className="edit-input" autoFocus value={editingTitle} onChange={(e) => setEditingTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveEdit(draftDuplicate.id); if (e.key === "Escape") cancelEdit(); }} onBlur={() => saveEdit(draftDuplicate.id)} /><button className="text-btn" onClick={cancelEdit} aria-label="Cancel duplicate"><Trash2 size={14} /></button></div>}{!record.tasks.length && !draftDuplicate && <div className="empty-tasks">Your list is empty. Add the tasks you genuinely intend to do.</div>}</div>{!record.submitted && <form className="add-task" onSubmit={(e) => { e.preventDefault(); addTask(newTitle); }}><Plus size={17} /><input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Add another task..." aria-label="New task title" /><button type="submit">Add task</button></form>}</> }</section><aside className="right-rail"><div className="rail-card progress-card"><div className="card-heading"><span>Today&apos;s progress</span><span className="mini-date">{new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", timeZone: TIME_ZONE }).format(new Date(`${today}T12:00:00Z`))}</span></div><div className="progress-ring" style={{ "--progress": `${progress * 3.6}deg` } as React.CSSProperties}><div><strong>{progress}%</strong><span>complete</span></div></div><p>{record?.tasks.length ? `${record.tasks.filter((task) => task.completed).length} of ${record.tasks.length} tasks complete` : "No tasks scheduled yet"}</p></div><div className="rail-card quiet-card"><span className="card-kicker">A note for today</span><p>&quot;{motivationalQuote.body}&quot;</p><span className="note-by">- {motivationalQuote.by}</span></div><div className="rail-card streak-card"><span className="card-heading">Current rhythm</span><strong>{streak} {streak === 1 ? "day" : "days"}</strong><span>{streak ? "Keep showing up." : "Submit a day to start your streak."}</span></div></aside></div>}
    {view === "calendar" && <section className="page-panel calendar-panel"><div className="calendar-toolbar"><div><span className="section-label">MONTHLY VIEW</span><h2>{formatMonth(monthKey)}</h2></div><div><button className="round-btn" onClick={() => setMonthKey((key) => shiftMonth(key, -1))} aria-label="Previous month">&lt;</button><button className="round-btn" onClick={() => setMonthKey((key) => shiftMonth(key, 1))} aria-label="Next month">&gt;</button></div></div><div className="legend"><span><i className="legend-dot green" /> Complete</span><span><i className="legend-dot yellow" /> Partial</span><span><i className="legend-dot red" /> Missed / empty</span></div><div className="calendar-grid">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => <span className="weekday" key={day}>{day}</span>)}{calendarDays.map((day, index) => day ? <button className={`calendar-day ${day === today ? "today-day" : ""}`} key={day} onClick={() => day === today && setView("today")}><span>{Number(day.slice(-2))}</span><i className={statusFor(store.records[day])} /></button> : <span className="calendar-blank" key={`blank-${index}`} />)}</div></section>}
    {view === "settings" && <section className="page-panel settings-panel"><span className="section-label">YOUR PREFERENCES</span><h2>Make the workspace yours.</h2><div className="settings-list"><label>Display name<input value={store.displayName} onChange={(e) => setStore((current) => ({ ...current, displayName: e.target.value }))} /></label><label>Daily reminder time<input type="time" value={store.reminderTime} onChange={(e) => setStore((current) => ({ ...current, reminderTime: e.target.value }))} /><small>Reminder timing applies immediately. It nudges you only when tasks remain.</small></label><div className="settings-row"><div><strong>Credits remaining</strong><span>Credits expire at one per day.</span></div><strong className="credits-value">{session.credits}</strong></div><div className="settings-row"><div><strong>India time</strong><span>All daily records use Asia/Kolkata.</span></div><span className="toggle on">On</span></div><div className="settings-row settings-logout-row"><div><strong>Sign out</strong><span>End this session on this device.</span></div><button className="small-outline settings-logout" onClick={logout}>Sign out <LogOut size={14} /></button></div><div className="settings-row"><div><strong>Private workspace</strong><span>Your task history stays on this device in the MVP.</span></div><span className="toggle on">On</span></div></div></section>}
    {view === "admin" && <section className="page-panel admin-panel"><div className="admin-banner"><div><span className="section-label">ADMIN MODE</span><h2>Manage members and credits.</h2><p>Create a private login for each member. Passwords are confirmed twice and stored as hashes; one credit expires per day.</p></div><div className="admin-actions"><span className="admin-badge">Full access</span><button type="button" className="small-outline admin-signout" onClick={logout}><LogOut size={14} /> Sign out</button></div></div><form className="member-create" onSubmit={createMember}><div className="member-create-heading"><span className="section-label">ADD MEMBER</span><strong>New member access</strong></div><div className="member-form-grid"><label>Full name<input value={memberForm.name} onChange={(event) => setMemberForm((current) => ({ ...current, name: event.target.value }))} placeholder="e.g. Aditi Sharma" required /></label><label>Username<input value={memberForm.username} onChange={(event) => setMemberForm((current) => ({ ...current, username: event.target.value }))} placeholder="aditi" autoComplete="username" required /></label><label>Create password<input type="password" value={memberForm.password} onChange={(event) => setMemberForm((current) => ({ ...current, password: event.target.value }))} minLength={8} autoComplete="new-password" required /></label><label>Confirm password<input type="password" value={memberForm.confirmPassword} onChange={(event) => setMemberForm((current) => ({ ...current, confirmPassword: event.target.value }))} minLength={8} autoComplete="new-password" required /></label><label>Initial credits<input type="number" min="0" max="1000000" step="1" value={memberForm.credits} onChange={(event) => setMemberForm((current) => ({ ...current, credits: event.target.value }))} required /></label><button className="primary-btn" type="submit" disabled={memberSaving}>{memberSaving ? "Creating..." : "Create member"} <Plus size={15} /></button></div>{memberError && <p className="member-feedback error">{memberError}</p>}{memberNotice && <p className="member-feedback success">{memberNotice}</p>}</form><div className="user-table"><div className="table-head member-table-head"><span>Member</span><span>Username</span><span>Credits</span><span>Access</span></div>{members.map((member) => <div className="table-row member-row" key={member.id}><div className="student-cell"><span className="mini-avatar">{shortName(member.name)}</span><div><strong>{member.name}</strong><span>{member.role === "admin" ? "Administrator" : "Member"}</span></div></div><span>@{member.username}</span><div className="credit-edit"><input aria-label={`Credits for ${member.name}`} type="number" min="0" max="1000000" defaultValue={member.credits} key={`${member.id}-${member.credits}`} /><button className="small-outline" onClick={(event) => { const input = event.currentTarget.previousElementSibling as HTMLInputElement; void saveCredits(member, input.value); }}>Save</button></div><div className="member-actions"><span className={`member-access member-status-${member.status}`}>{member.role === "admin" ? "Admin" : member.status === "active" ? "Login enabled" : member.status === "suspended" ? "Suspended" : "Credits expired"}</span>{member.status !== "active" && member.username !== session.username && <button type="button" className="small-outline" onClick={() => void restoreMember(member)}>Restore</button>}{member.username !== session.username && <button type="button" className="small-outline danger-outline" onClick={() => void removeMember(member)}>Delete</button>}</div></div>)}</div></section>}
    <footer className="footer"><span>Built for honest daily practice</span><span>Asia/Kolkata ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â· Local MVP</span></footer></section></main>;
}
