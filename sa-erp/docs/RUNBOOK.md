# SA ERP — Runbook

## Local checks (what every slice must pass)

```powershell
npm ci
npm run typecheck
npm run lint
npm test            # unit tests (formatting, JC calendar)
```

`npm run test:db` applies every migration to a throwaway Postgres and runs `tests/db/*_test.sql`. It needs Postgres 15+ on Linux or Mac (Claude runs it on every slice). It's optional on Windows.

## First-time setup

1. **Supabase project.** Create a new project in region Mumbai (`ap-south-1`).
2. **Migrations.** In Supabase → SQL Editor, run each file in `supabase/migrations/` **in filename order**. Run one file at a time and wait for "Success" before starting the next.
3. **Owner login.**
   1. Supabase → Authentication → Users → *Add user* → enter your email and a password, and tick *Auto confirm*.
   2. In the SQL Editor, run:
      ```sql
      select private.bootstrap_owner('your-email@example.com', 'Your Name');
      ```
4. **Auth URLs.** Supabase → Authentication → URL Configuration:
   - Site URL = your Vercel URL.
   - Add `https://<your-vercel-url>/auth/callback` to the Redirect URLs.
5. **Vercel.**
   - Import the GitHub repo.
   - If the app is still inside `rupyz-tally-erp`, set **Root Directory = `sa-erp`**.
   - Add these environment variables (Production and Preview):
     - `NEXT_PUBLIC_SUPABASE_URL`
     - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
     - `SUPABASE_SERVICE_ROLE_KEY`
     - `NEXT_PUBLIC_APP_URL`

## Adding a new financial year

Each March, open **JC calendar** → **+ Generate FY xx-yy** (owner only). The SQL alternative is `select public.generate_journey_cycles(2027);`.
