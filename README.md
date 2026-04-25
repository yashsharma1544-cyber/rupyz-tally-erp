# Rupyz · Tally ERP

Order management & Tally bridge for **Sushil Agencies**.
Built on Next.js 14 + Supabase (Mumbai). Phase 1.5 — masters, auth, sidebar.

---

## What this codebase contains (Phase 1.5)

- **Auth** — email + password, invite-only, role-based (admin / approver / accounts / dispatch / delivery / salesman)
- **Masters UI** — Customers (1,096) · Products (43) · Salesmen (5) · Beats (23)
- **Users page** — admin-only invite + role/active management
- **RLS** — everyone authenticated reads masters, only admin writes
- **Dashboard** — counts, system status placeholders for upcoming phases

Phases ahead: Rupyz scraper (2) · Order management (3) · Tally bridge (4) · WATi WhatsApp (5).

---

## One-time setup

### 1. Push to GitHub

```bash
cd rupyz-tally-erp
git init
git add .
git commit -m "Phase 1.5 — masters, auth, sidebar"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/rupyz-tally-erp.git
git push -u origin main
```

### 2. Run the SQL files (in order) in Supabase → SQL Editor

If you already ran `01` and `02`, just run `03`:

| File | What it does |
|---|---|
| `sql/01_schema_phase1.sql` | Tables, enums, indexes, seeded salesmen |
| `sql/02_import_phase1.sql` | 1 category, 10 brands, 23 beats, 43 products, 1,096 customers |
| `sql/03_phase1_5_auth_and_rls.sql` | Signup trigger + RLS policies |

### 3. Get Supabase keys

Supabase → Project Settings → **API**:

- **Project URL** → goes into `NEXT_PUBLIC_SUPABASE_URL`
- **Project API keys → anon public** → goes into `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- **Project API keys → service_role secret** → goes into `SUPABASE_SERVICE_ROLE_KEY`

### 4. Deploy on Vercel

1. Vercel → **Add New Project** → import the GitHub repo
2. Framework: **Next.js** (auto-detected)
3. Add environment variables (Settings → Environment Variables):

   | Key | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | from step 3 |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | from step 3 |
   | `SUPABASE_SERVICE_ROLE_KEY` | from step 3 (mark as **Sensitive**) |
   | `NEXT_PUBLIC_APP_URL` | your Vercel URL, e.g. `https://rupyz-tally-erp.vercel.app` |

4. Click **Deploy**.

### 5. Configure Supabase auth redirect

Supabase → **Authentication → URL Configuration**:

- **Site URL** = your Vercel URL
- **Redirect URLs** = add `https://YOUR-APP.vercel.app/auth/callback` and `http://localhost:3000/auth/callback`

### 6. Create the first admin

The very first user has to be created via the Supabase dashboard, because the in-app invite flow needs an existing admin to authorize it.

1. Supabase → **Authentication → Users → Add user → Create new user**
2. Email = your email, Password = strong password, **Auto-confirm email** = ON
3. SQL Editor:
   ```sql
   update public.app_users set role = 'admin' where email = 'YOUR-EMAIL@example.com';
   ```
4. Visit your Vercel URL, sign in, you're admin.
5. From now on, invite users from **Users** page in the app.

---

## Local development

```bash
cp .env.example .env.local
# fill in keys from Supabase
npm install
npm run dev
# open http://localhost:3000
```

---

## Project structure

```
app/
├── (app)/              ← Protected layout group (sidebar)
│   ├── dashboard/
│   ├── customers/      ← server page + customers-client.tsx
│   ├── products/
│   ├── salesmen/
│   ├── beats/
│   ├── users/          ← admin only; uses server actions
│   └── settings/
├── login/              ← Public login screen
└── auth/callback/      ← Supabase OAuth/PKCE callback

components/
├── layout/             ← Sidebar, page header
└── ui/                 ← Button, Input, Sheet, Select, Badge

lib/
├── supabase/           ← client / server / middleware / admin helpers
├── types.ts            ← TypeScript types matching DB
└── utils.ts            ← cn(), formatINR(), formatNumber()

sql/
├── 01_schema_phase1.sql
├── 02_import_phase1.sql
└── 03_phase1_5_auth_and_rls.sql

middleware.ts           ← Auth gate — redirects to /login if not signed in
```

---

## Stack

- **Next.js 14** (App Router, Server Components)
- **Supabase** — Postgres, Auth, RLS
- **TypeScript** — strict mode
- **Tailwind CSS** — refined utilitarian theme (paper/ink/teal)
- **Radix UI primitives** — accessible Sheet, Select, Label
- **Lucide icons**, **sonner** toasts

Design tokens live in `tailwind.config.ts`. Fonts are IBM Plex Sans + JetBrains Mono.

---

## Known limitations (intentional, addressed later)

- **Pricing rules** — only base price exists. Customer-specific rates come in Phase 3.
- **Salesman ↔ customer mapping** — empty on import; populated from order data in Phase 2/3.
- **GSTINs** — empty on import; synced from Tally in Phase 4.

---

## Troubleshooting

**"Account not provisioned"** after sign-in — your auth row exists but the trigger didn't create your `app_users` row. Run:

```sql
insert into public.app_users (id, full_name, email, role)
select id, email, email, 'admin'::user_role
from auth.users where email = 'YOUR-EMAIL@example.com'
on conflict (id) do nothing;
```

**RLS denying writes for admin** — confirm `select public.is_admin();` returns `true` while logged in. If false, your role isn't 'admin' or your row isn't active.

**Invite emails not arriving** — check Supabase → Authentication → Logs. The default email provider has rate limits; for production, configure a custom SMTP under Auth → Email Templates → SMTP Settings.
