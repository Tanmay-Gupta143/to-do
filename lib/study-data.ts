export type StudyTask = { id: string; title: string; completed: boolean };
export type StudyDayRecord = { date: string; scheduled: boolean; setupStartedAt?: number; activeSeconds: number; setupComplete: boolean; submitted: boolean; submittedAt?: number; tasks: StudyTask[] };
export type StudyStore = { records: Record<string, StudyDayRecord>; reminderTime: string; displayName: string };

export const EMPTY_STORE: StudyStore = { records: {}, reminderTime: "20:00", displayName: "Tanmay" };

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const taskIdPattern = /^[a-zA-Z0-9._-]{1,120}$/;
const cleanTask = (value: unknown): StudyTask | null => {
  if (!value || typeof value !== "object") return null;
  const task = value as Partial<StudyTask>;
  if (typeof task.id !== "string" || !taskIdPattern.test(task.id) || typeof task.title !== "string" || !task.title.trim() || task.title.length > 500) return null;
  return { id: task.id, title: task.title.trim(), completed: task.completed === true };
};

export function normalizeStore(value: unknown, fallbackName = EMPTY_STORE.displayName): StudyStore {
  const input = value && typeof value === "object" ? value as Partial<StudyStore> : {};
  const records: Record<string, StudyDayRecord> = {};
  if (input.records && typeof input.records === "object") for (const [date, raw] of Object.entries(input.records as Record<string, unknown>).slice(0, 2000)) {
    if (!datePattern.test(date) || !raw || typeof raw !== "object") continue;
    const record = raw as Partial<StudyDayRecord>;
    const tasks = Array.isArray(record.tasks) ? record.tasks.map(cleanTask).filter((task): task is StudyTask => Boolean(task)).slice(0, 500) : [];
    records[date] = { date, scheduled: record.scheduled === true, activeSeconds: typeof record.activeSeconds === "number" ? Math.max(0, Math.min(900, Math.floor(record.activeSeconds))) : 0, setupComplete: record.setupComplete === true, submitted: record.submitted === true, ...(typeof record.setupStartedAt === "number" ? { setupStartedAt: Math.max(0, Math.floor(record.setupStartedAt)) } : {}), ...(typeof record.submittedAt === "number" ? { submittedAt: Math.max(0, Math.floor(record.submittedAt)) } : {}), tasks };
  }
  const displayName = typeof input.displayName === "string" && input.displayName.trim() ? input.displayName.trim().slice(0, 120) : fallbackName;
  const reminderTime = typeof input.reminderTime === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(input.reminderTime) ? input.reminderTime : EMPTY_STORE.reminderTime;
  return { records, reminderTime, displayName };
}

function mergeRecord(left: StudyDayRecord | undefined, right: StudyDayRecord | undefined, date: string): StudyDayRecord {
  const first = left || { date, scheduled: false, activeSeconds: 0, setupComplete: false, submitted: false, tasks: [] };
  const second = right || first;
  const tasks = new Map<string, StudyTask>();
  for (const task of [...first.tasks, ...second.tasks]) { const existing = tasks.get(task.id); tasks.set(task.id, existing ? { ...existing, title: task.title || existing.title, completed: existing.completed || task.completed } : task); }
  return { date, scheduled: first.scheduled || second.scheduled, activeSeconds: Math.max(first.activeSeconds, second.activeSeconds), setupComplete: first.setupComplete || second.setupComplete, submitted: first.submitted || second.submitted, ...(first.setupStartedAt || second.setupStartedAt ? { setupStartedAt: Math.max(first.setupStartedAt || 0, second.setupStartedAt || 0) } : {}), ...(first.submittedAt || second.submittedAt ? { submittedAt: Math.max(first.submittedAt || 0, second.submittedAt || 0) } : {}), tasks: [...tasks.values()] };
}

export function mergeStores(serverValue: unknown, clientValue: unknown, fallbackName = EMPTY_STORE.displayName): StudyStore {
  const server = normalizeStore(serverValue, fallbackName); const client = normalizeStore(clientValue, fallbackName); const records: Record<string, StudyDayRecord> = {};
  for (const date of new Set([...Object.keys(server.records), ...Object.keys(client.records)])) records[date] = mergeRecord(server.records[date], client.records[date], date);
  return { records, reminderTime: client.reminderTime || server.reminderTime, displayName: client.displayName || server.displayName || fallbackName };
}

export function mergeInitialStores(serverValue: unknown, clientValue: unknown, fallbackName = EMPTY_STORE.displayName): StudyStore {
  const server = normalizeStore(serverValue, fallbackName); const client = normalizeStore(clientValue, fallbackName);
  return { records: { ...client.records, ...server.records }, reminderTime: serverValue ? server.reminderTime : client.reminderTime, displayName: serverValue ? server.displayName : client.displayName || fallbackName };
}

export function rhythmFromStore(value: unknown, today: string) {
  const records = normalizeStore(value).records; let days = 0; let cursor = today;
  while (records[cursor]?.submitted) { days += 1; const [year, month, day] = cursor.split("-").map(Number); const previous = new Date(Date.UTC(year, month - 1, day - 1)); cursor = `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, "0")}-${String(previous.getUTCDate()).padStart(2, "0")}`; }
  const todayRecord = records[today];
  return { days, todayStatus: !todayRecord?.scheduled || !todayRecord.tasks.length ? "Not scheduled" : todayRecord.submitted ? "Submitted" : "In progress" };
}
