import assert from "node:assert/strict";
import test from "node:test";

import { durableStore, mergeConcurrentStores, mergeStores } from "../lib/study-data.ts";

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
