# Officer login setup

The website now requires **officer sign-in**. Random visitors with the URL can no longer read or change auction data.

The **Discord bot is unchanged** — it uses the Supabase **service role** key and bypasses row-level security for check-in only.

---

## 1. Run the migration

In **Supabase → SQL Editor**, run:

`supabase/migrations/005_officer_auth.sql`

This creates the `officers` allowlist and replaces open MVP policies with officer-only access.

---

## 2. Enable email auth in Supabase

1. Supabase → **Authentication → Providers**
2. Ensure **Email** is enabled
3. For a small officer team, turn **off** public sign-ups:
   - **Authentication → Settings** → disable “Allow new users to sign up”
   - Officers are created manually by you in the dashboard

---

## 3. Create officer accounts

For each guild officer:

1. Supabase → **Authentication → Users → Add user**
2. Choose **Create new user**, set email + password, confirm email if prompted
3. Copy the user’s **UUID** from the users list

Then in **SQL Editor**, add them to the allowlist:

```sql
insert into officers (user_id, email)
values ('PASTE_USER_UUID', 'officer@example.com');
```

Repeat for each officer.

---

## 4. Sign in on the website

1. Open the site → you’ll be redirected to **/login**
2. Sign in with the officer email + password
3. Non-allowlisted accounts see: *“This account is not authorized as a guild officer.”*

---

## Adding or removing officers later

**Add:**

```sql
insert into officers (user_id, email)
select id, email from auth.users where email = 'new.officer@example.com';
```

**Remove:**

```sql
delete from officers where email = 'former.officer@example.com';
```

Optionally delete their Auth user in the Supabase dashboard as well.

---

## Security notes

| Layer | What it does |
|-------|----------------|
| **Middleware** | Redirects unauthenticated users to `/login` |
| **Officer allowlist** | Even with a valid login, non-officers cannot use the app |
| **RLS policies** | Database rejects reads/writes without `is_officer()` |
| **Discord bot** | Still uses service role — not affected by officer login |

Before deploying publicly, run migration `005` on your production Supabase project and create at least one officer account.
