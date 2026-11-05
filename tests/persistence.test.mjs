import assert from "node:assert/strict";
import test from "node:test";

import { calendarStatusFor, durableStore, mergeConcurrentStores, mergeStores, normalizeStore, rhythmFromStore, streakFromStore } from "../lib/study-data.ts";

const date = "2026-10-16";
const task = (id, completed = false) => ({ id, title: id, completed });
const day = (tasks, extras = {}) => ({ date, scheduled: true, activeSeconds: 10, setupComplete: false, submitted: false, tasks, ...extras });
const store = (record) => ({ records: { [date]: record }, reminderTime: "20:00", displayName: "Student" });

test("a saved task may be deleted or marked incomplete", () => {
  const saved = store(day([task("delete"), task("uncheck", true)]));
  const edited = store(day([task("uncheck")]));
  assert.deepEqual(mergeStores(saved, edited).records[date].tasks, [task("uncheck")]);
});

test("a previously submitted day remains locked during a merge", () => {
  const submitted = store(day([task("original", true)], { setupComplete: true, submitted: true, submittedAt: 123 }));
  const edited = store(day([task("changed")]));
  assert.deepEqual(mergeStores(submitted, edited).records[date], submitted.records[date]);
});

test("a conflict preserves local deletion and uncheck plus a remote addition", () => {
  const base = store(day([task("delete"), task("uncheck", true)]));
  const local = store(day([task("uncheck")]));
  const remote = store(day([task("delete"), task("uncheck", true), task("remote")]));
  assert.deepEqual(mergeConcurrentStores(base, local, remote).records[date].tasks, [task("uncheck"), task("remote")]);
});

test("durable data never carries a running setup timestamp", () => {
  const running = store(day([task("one")], { setupStartedAt: 1_760_000_000_000 }));
  assert.equal(durableStore(running).records[date].setupStartedAt, undefined);
  assert.equal(durableStore(running).records[date].activeSeconds, 10);
});

test("a streak carries through today until the day is missed", () => {
  const yesterday = "2026-10-15";
  const twoDaysAgo = "2026-10-14";
  const streakStore = {
    ...store(day([task("today")])),
    records: {
      [date]: day([task("today")]),
      [yesterday]: { ...day([task("yesterday")], { submitted: true }), date: yesterday },
      [twoDaysAgo]: { ...day([task("two-days-ago")], { submitted: true }), date: twoDaysAgo },
    },
  };
  assert.equal(streakFromStore(streakStore, date), 2);
  assert.equal(rhythmFromStore(streakStore, date).days, 2);
});

test("a streak resets after a full missed day", () => {
  const twoDaysAgo = "2026-10-14";
  const streakStore = { ...store(day([task("today")])), records: { [twoDaysAgo]: { ...day([task("old")], { submitted: true }), date: twoDaysAgo } } };
  assert.equal(streakFromStore(streakStore, date), 0);
});

test("streak calculation handles month rollover and ignores invalid record dates", () => {
  const leapDay = "2024-02-29";
  const marchFirst = "2024-03-01";
  const streakStore = {
    ...store(day([task("today")])),
    records: {
      [leapDay]: { ...day([task("leap")], { submitted: true }), date: leapDay },
      [marchFirst]: { ...day([task("march")], { submitted: true }), date: marchFirst },
      "2024-02-30": { ...day([task("invalid")], { submitted: true }), date: "2024-02-30" },
    },
  };
  assert.equal(streakFromStore(streakStore, marchFirst), 2);
  assert.equal(normalizeStore(streakStore).records["2024-02-30"], undefined);
});

test("upcoming calendar days are neutral while empty past days remain missed", () => {
  assert.equal(calendarStatusFor(undefined, "2026-10-17", date), "none");
  assert.equal(calendarStatusFor(undefined, "2026-10-15", date), "red");
  assert.equal(calendarStatusFor(day([task("done", true)]), date, date), "green");
});
