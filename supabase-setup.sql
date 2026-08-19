-- ============================================================
-- ReceiptPro — Supabase setup
-- Run this whole file once in: Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. PROFILES (one row per registered business/user)
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  business_name text not null,
  email text not null,
  phone text,
  address text,
  logo_url text,
  default_template text default 'classic',
  currency text default 'UGX',
  tax_rate numeric default 0,
  created_at timestamptz default now()
);

alter table public.profiles enable row level security;

create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- 2. RECEIPTS / INVOICES
create table if not exists public.receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  doc_type text not null default 'receipt',       -- 'receipt' or 'invoice'
  doc_number text not null,
  template text not null default 'classic',       -- 'marshalls' | 'culinary' | 'brentford'
  customer_name text,
  customer_phone text,
  customer_address text,
  items jsonb not null default '[]',              -- [{description, qty, unit_price}]
  subtotal numeric not null default 0,
  tax_rate numeric not null default 0,
  tax_amount numeric not null default 0,
  total numeric not null default 0,
  amount_paid numeric not null default 0,
  status text not null default 'paid',            -- 'paid' | 'unpaid' | 'partial'
  payment_method text,
  notes text,
  created_at timestamptz default now()
);

alter table public.receipts enable row level security;

create policy "Users can view own receipts"
  on public.receipts for select
  using (auth.uid() = user_id);

create policy "Users can insert own receipts"
  on public.receipts for insert
  with check (auth.uid() = user_id);

create policy "Users can update own receipts"
  on public.receipts for update
  using (auth.uid() = user_id);

create policy "Users can delete own receipts"
  on public.receipts for delete
  using (auth.uid() = user_id);

create index if not exists receipts_user_id_idx on public.receipts (user_id, created_at desc);

-- 3. STORAGE BUCKET FOR BUSINESS LOGOS
insert into storage.buckets (id, name, public)
values ('logos', 'logos', true)
on conflict (id) do nothing;

create policy "Logo images are publicly readable"
  on storage.objects for select
  using (bucket_id = 'logos');

create policy "Users can upload their own logo"
  on storage.objects for insert
  with check (bucket_id = 'logos' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can update their own logo"
  on storage.objects for update
  using (bucket_id = 'logos' and auth.uid()::text = (storage.foldername(name))[1]);

-- ============================================================
-- Done. After running this, disable "Confirm email" under
-- Authentication → Providers → Email if you want instant sign-up,
-- or leave it on to require email confirmation.
-- ============================================================
