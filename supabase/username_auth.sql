-- Private username-to-auth-user mapping for ARR-Proto username sign-in.
-- Only the Supabase Edge Functions use the service role to read/write this table.
create table if not exists public.arr_login_names (
  username_normalized text primary key,
  username text not null,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint arr_login_names_username_format check (
    username_normalized ~ '^[a-z0-9][a-z0-9._-]{2,23}$'
  )
);

alter table public.arr_login_names enable row level security;
revoke all on public.arr_login_names from anon, authenticated;
grant all on public.arr_login_names to service_role;
