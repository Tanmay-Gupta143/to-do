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
  if (left?.submitted) return left;
  return right || left || { date, scheduled: false, activeSeconds: 0, setupComplete: false, submitted: false, tasks: [] };
}

export function mergeStores(serverValue: unknown, clientValue: unknown, fallbackName = EMPTY_STORE.displayName): StudyStore {
  const server = normalizeStore(serverValue, fallbackName); const client = normalizeStore(clientValue, fallbackName); const records: Record<string, StudyDayRecord> = {};
  for (const date of new Set([...Object.keys(server.records), ...Object.keys(client.records)])) records[date] = mergeRecord(server.records[date], client.records[date], date);
  return { records, reminderTime: client.reminderTime || server.reminderTime, displayName: client.displayName || server.displayName || fallbackName };
}

export function mergeInitialStores(serverValue: unknown, clientValue: unknown, fallbackName = EMPTY_STORE.displayName): StudyStore {
  const server = normalizeStore(serverValue, fallbackName); const client = normalizeStore(clientValue, fallbackName);
  return { records: Object.fromEntries(Object.entries({ ...client.records, ...server.records }).map(([date, record]) => [date, { ...record, setupStartedAt: undefined }])), reminderTime: serverValue ? server.reminderTime : client.reminderTime, displayName: serverValue ? server.displayName : client.displayName || fallbackName };
}

/** Running setup belongs to the visible tab. Only elapsed checkpoints are durable. */
export function durableStore(value: unknown, fallbackName = EMPTY_STORE.displayName): StudyStore {
  const store = normalizeStore(value, fallbackName);
  return { ...store, records: Object.fromEntries(Object.entries(store.records).map(([date, record]) => [date, { ...record, setupStartedAt: undefined }])) };
}

/** Rebase unsaved local edits after a conditional save finds a newer server copy. */
export function mergeConcurrentStores(baseValue: unknown, localValue: unknown, remoteValue: unknown, fallbackName = EMPTY_STORE.displayName): StudyStore {
  const base = durableStore(baseValue, fallbackName);
  const local = durableStore(localValue, fallbackName);
  const remote = durableStore(remoteValue, fallbackName);
  const changed = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);
  const choose = <T>(oldValue: T, localValue: T, remoteValue: T) => changed(localValue, oldValue) ? localValue : remoteValue;
  const records: Record<string, StudyDayRecord> = {};
  for (const date of new Set([...Object.keys(base.records), ...Object.keys(local.records), ...Object.keys(remote.records)])) {
    const oldDay = base.records[date];
    const localDay = local.records[date];
    const remoteDay = remote.records[date];
    if (remoteDay?.submitted) { records[date] = remoteDay; continue; }
    if (!changed(localDay, oldDay)) { if (remoteDay) records[date] = remoteDay; continue; }
    if (!changed(remoteDay, oldDay)) { if (localDay) records[date] = localDay; continue; }
    if (!localDay) continue;
    if (!remoteDay) { records[date] = localDay; continue; }
    const oldTasks = new Map(oldDay?.tasks.map((task) => [task.id, task]) || []);
    const localTasks = new Map(localDay.tasks.map((task) => [task.id, task]));
    const remoteTasks = new Map(remoteDay.tasks.map((task) => [task.id, task]));
    const tasks: StudyTask[] = [];
    for (const id of new Set([...localTasks.keys(), ...remoteTasks.keys()])) {
      const oldTask = oldTasks.get(id);
      const localTask = localTasks.get(id);
      const remoteTask = remoteTasks.get(id);
      // A deletion of an existing task wins over a simultaneous edit.
      if (oldTask && (!localTask || !remoteTask)) continue;
      if (!localTask || !remoteTask) { const task = localTask || remoteTask; if (task) tasks.push(task); continue; }
      tasks.push(oldTask ? {
        id,
        title: choose(oldTask.title, localTask.title, remoteTask.title),
        completed: choose(oldTask.completed, localTask.completed, remoteTask.completed),
      } : localTask);
    }
    records[date] = {
      date,
      scheduled: choose(oldDay?.scheduled ?? false, localDay.scheduled, remoteDay.scheduled),
      activeSeconds: Math.max(localDay.activeSeconds, remoteDay.activeSeconds),
      setupComplete: choose(oldDay?.setupComplete ?? false, localDay.setupComplete, remoteDay.setupComplete),
      submitted: choose(oldDay?.submitted ?? false, localDay.submitted, remoteDay.submitted),
      ...(choose(oldDay?.submittedAt, localDay.submittedAt, remoteDay.submittedAt) !== undefined ? { submittedAt: choose(oldDay?.submittedAt, localDay.submittedAt, remoteDay.submittedAt) } : {}),
      tasks,
    };
  }
  return {
    records,
    reminderTime: choose(base.reminderTime, local.reminderTime, remote.reminderTime),
    displayName: choose(base.displayName, local.displayName, remote.displayName),
  };
}

export function rhythmFromStore(value: unknown, today: string) {
  const records = normalizeStore(value).records; let days = 0; let cursor = today;
  while (records[cursor]?.submitted) { days += 1; const [year, month, day] = cursor.split("-").map(Number); const previous = new Date(Date.UTC(year, month - 1, day - 1)); cursor = `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, "0")}-${String(previous.getUTCDate()).padStart(2, "0")}`; }
  const todayRecord = records[today];
  return { days, todayStatus: !todayRecord?.scheduled || !todayRecord.tasks.length ? "Not scheduled" : todayRecord.submitted ? "Submitted" : "In progress" };
}
