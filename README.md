# Daily Study Tracker

A private daily task tracker with an India time calendar, a 15-minute active-use setup window, member accounts, credits, and an admin view. Submitted days are locked. Study data is cached per account in the browser and synchronized to Supabase when configured.

## Run locally

Requires Node.js 22 and pnpm. Install dependencies and set local seed credentials before starting a new member store:

```powershell
pnpm install
$env:ADMIN_NAME = "Admin"
$env:ADMIN_USERNAME = "your-admin-name"
$env:ADMIN_PASSWORD = "a-unique-admin-password"
$env:USER_USERNAME = "your-student-name"
$env:USER_PASSWORD = "a-unique-student-password"
$env:AUTH_SECRET = "a-long-random-secret"
pnpm dev
```

Without Supabase variables, development accounts are stored in `.data/members.json` and study data stays in each browser's account-scoped local storage. Set `MEMBERS_DATA_FILE` to a separate path when running disposable tests. The seeded student starts without credits and must receive credits from an admin before signing in. The seed credentials are used only when the member store is first created; changing an environment password later does not reset an existing account.

## Production setup

Run the SQL files in `supabase/migrations/` in numeric order. Configure these server-only environment variables:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `AUTH_SECRET`

The five seed variables shown above are also needed when the `members` table is empty. Use unique passwords before exposing the app. Never prefix the service role key with `NEXT_PUBLIC_` or put it in browser code. Production member and study-data access requires Supabase configuration. Admin password resets issue temporary passwords that members must change at their next sign-in.

## Checks

```powershell
pnpm test
pnpm typecheck
pnpm build
```

The regular tests use isolated temporary member data. Optional live HTTP checks run when `LIVE_TEST_URL`, `ADMIN_USERNAME`, and `ADMIN_PASSWORD` are set for a running test server. The build uses webpack because the local Windows Turbopack worker has failed while processing CSS.
