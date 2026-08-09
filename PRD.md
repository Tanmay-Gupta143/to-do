# PRD: Private Daily Study Tracker MVP

## 1. Product Summary

The Private Daily Study Tracker is a single-page, responsive app for planning and completing one day's study tasks. It uses the user's local device for MVP persistence and treats India Standard Time (IST, `Asia/Kolkata`) as the source of truth for the current day.

## 2. Goals

- Let a user schedule today's study tasks once per day.
- Make initial task setup focused with a persistent, active-usage timer.
- Let the user manage and complete tasks after setup without changing or deleting the scheduled plan.
- Permanently lock a day when the user submits it, while preserving a clear completion status.
- Provide a simple local demo admin view as an optional MVP aid for later admin requirements.

## 3. Scope

### In scope

- One single-page responsive experience for mobile and desktop.
- A daily view based on IST and the current calendar date in `Asia/Kolkata`.
- First-time daily setup with task add, edit, delete, and duplicate actions.
- A setup timer that starts at 15 active-usage minutes, pauses when the page is hidden, minimized, or in the background, and persists across reloads.
- A timer presentation that begins large, then minimizes during setup; the timer turns red when 3 minutes or less remain.
- A `Finish Scheduling` action to end setup before the timer expires.
- Post-setup task add, duplicate, complete, and uncomplete actions.
- Duplicate flow with an editable title field before the duplicate is saved.
- Submit-anytime behavior, enabled only when at least one task exists.
- Permanent day locking on submit; unchecked tasks are crossed out when the day is submitted.
- Day status colors: no scheduled day is red, all tasks completed is green, and a partially completed day is yellow; an explicitly submitted day with no completed tasks is red.
- Local MVP persistence, such as browser local storage or an equivalent local data store.
- A local demo admin view may be included to demonstrate future admin visibility and editing.

## 4. Terminology and State Model

- **Today:** The calendar date determined in `Asia/Kolkata`, regardless of the browser or device timezone.
- **Setup:** The editable pre-submit phase for today's task list.
- **Post-setup:** The phase after setup ends and before the day is submitted.
- **Submitted/locked:** A permanent terminal state for that day. No task mutations are allowed after submission.
- **Task:** A record with at least an editable title and a completion state.
- **Scheduled day:** A day with one or more tasks created for it.

Each day should persist at least:

- IST calendar date
- Task list and stable task IDs
- Task titles
- Completion state per task
- Setup state (`not_started`, `active`, or `finished`)
- Remaining setup active-usage time and the last visibility/activity checkpoint needed to resume it correctly
- Submitted/locked state and submission timestamp, if submitted

## 5. User Flows

### Flow A: Schedule today's tasks

1. The user opens the app.
2. The app resolves today's date in IST and loads that day's local state.
3. If today has not been scheduled, the user enters setup and the 15-minute active-usage timer starts.
4. The user adds tasks and may edit, delete, or duplicate them. Duplicate opens an editable title field before saving.
5. The user may select `Finish Scheduling` at any point to end setup early.
6. The user may submit at any time, provided at least one task exists. Submission ends the day and locks it permanently.

### Flow B: Work on today's tasks after setup

1. After setup ends without submission, the user sees the task list in post-setup mode.
2. The user may add a task, duplicate a task, complete a task, or uncomplete a task.
3. The user cannot edit or delete an existing task in this phase.
4. The user may submit at any point if at least one task exists.

### Flow C: Submit and lock the day

1. The user selects submit.
2. The app validates that at least one task exists.
3. The app permanently marks the day submitted/locked.
4. Every task that is still unchecked is crossed out as part of the submitted presentation.
5. The task list and status remain read-only for that day, including after reloads and subsequent visits.

### Flow D: Return to a prior day

The MVP may show persisted prior-day records for status/history, but today's workflow is the primary experience. A submitted day remains locked; a non-submitted prior day must not be silently treated as submitted or changed because the date changed.

### Flow E: Local demo admin view (optional MVP)

An admin demo view may expose all locally stored demo users and their daily records. It may allow viewing and editing those records to validate the future admin concept. It is not required to provide production authentication or server-backed multi-user administration.

## 6. Interaction and Permission Rules

| State | Add | Edit title | Delete | Duplicate | Complete / uncomplete | Submit |
|---|---:|---:|---:|---:|---:|---:|
| Setup | Yes | Yes | Yes | Yes | No | Yes, if at least 1 task |
| Post-setup | Yes | No | No | Yes | Yes | Yes, if at least 1 task |
| Submitted/locked | No | No | No | No | No | No-op/hidden |

Additional rules:

- Setup does not allow completing or uncompleting tasks.
- `Finish Scheduling` ends setup only; it does not submit the day and does not lock it.
- The timer ending should end setup and move the day to post-setup; it should not submit the day automatically.
- Duplicate must not silently reuse the source title. It opens an editable title field and saves only after the user confirms a valid title.
- Task titles must not be empty or whitespace-only.
- Submit is disabled or rejected when the task list is empty.
- Submission is permanent for the day. There is no MVP undo, unlock, or reschedule action.
- The app must not infer completion for an unchecked task before submission. The crossed-out treatment is applied at submission for unchecked tasks.

## 7. Timer Requirements

- Initial duration: 15 minutes of active usage.
- Active usage is elapsed time while the page is visible and in the foreground.
- The timer pauses when the document becomes hidden, the tab is backgrounded, the window is minimized, or equivalent browser visibility state indicates the page is not actively visible.
- The timer resumes when the page becomes visible/foregrounded again.
- Remaining time and timer state persist across reloads. Reloading must not reset the timer to 15 minutes or count hidden time as active usage.
- The timer begins as a prominent large display and minimizes into a compact persistent control during setup.
- The timer display and any urgent treatment turn red at 3:00 remaining or less.
- At 0:00, setup ends automatically and the day enters post-setup.
- `Finish Scheduling` stops the timer and ends setup immediately.

## 8. Day Status Rules

Status is derived from the persisted day state and displayed consistently wherever a day is shown:

| Condition | Status | Color |
|---|---|---|
| No tasks scheduled | Not scheduled | Red |
| At least one task, no submission, and every task completed | Complete | Green |
| At least one task, no submission, and some but not all tasks completed | Partial | Yellow |
| Submitted with at least one completed task but not all completed | Partial | Yellow |
| Submitted with no completed tasks | Not complete | Red |
| Submitted with all tasks completed | Complete | Green |

The absence of a scheduled day is always red. A day with tasks is never treated as "not scheduled," even if no task is complete.

## 9. Persistence and Data Boundaries

- Local persistence is acceptable for the MVP; no backend is required for the core user flow.
- State must survive page reloads and normal browser restarts where the chosen local storage mechanism permits it.
- Records are keyed by IST calendar date and, for the optional admin demo, by local demo user.
- The app should handle corrupted or unavailable local state with a recoverable empty-state path rather than silently claiming a day was submitted.
- MVP data is private to the local device/browser and is not a security boundary.

## 10. Acceptance Criteria

1. The app renders as one usable responsive page on mobile and desktop widths.
2. The displayed current day matches `Asia/Kolkata`, including around local midnight and when the device timezone differs.
3. A new day can be scheduled only through its setup flow, and setup supports add, edit, delete, and duplicate.
4. Setup does not expose working complete/uncomplete controls.
5. `Finish Scheduling` ends setup without submitting the day.
6. After setup, add and duplicate work, complete/uncomplete work, and edit/delete are unavailable or rejected.
7. Duplicating a task always provides an editable title before creating the new task.
8. Submit is unavailable or rejected with zero tasks and works with one or more tasks at any time during setup or post-setup.
9. Submitting permanently locks that day, crosses out every unchecked task, and preserves this state after reload.
10. A locked day cannot be mutated through the UI or normal client actions.
11. The timer starts at 15 active-usage minutes, pauses while hidden/minimized/backgrounded, resumes when visible, and does not reset on reload.
12. The timer presentation starts large, minimizes during setup, and is red at 3 minutes remaining or less.
13. Timer expiry ends setup but does not submit the day.
14. Day status colors match the rules: no scheduled day red, all completed green, partial yellow, and submitted with none completed red.
15. Local persistence restores task lists, completion states, setup state, timer state, and lock state after reload.
16. Automated or manual verification covers the primary flows, permission restrictions, IST date handling, timer visibility pause/resume, reload persistence, submission locking, and status colors.

## 11. Explicitly Out of Scope

- Production authentication, account creation, password reset, roles, or permissions.
- Server-side persistence, synchronization across devices, backups, or offline conflict resolution.
- A production multi-user admin console. A local demo admin view is optional only.
- Editing or deleting tasks after setup has ended.
- Completing or uncompleting tasks during setup.
- Unlocking, undoing, or resubmitting a submitted day.
- Automatic submission when the timer expires.
- Recurring schedules, future-day planning, calendar integrations, reminders, notifications, alarms, or push messaging.
- Subjects, chapters, tags, priorities, notes, attachments, time estimates, analytics, streaks, gamification, or study-session timing beyond the setup timer.
- Import/export, sharing, collaboration, and public profiles.
- Server-grade security or treating local browser storage as confidential storage.
- Native mobile or desktop apps; the MVP is a responsive web page.
