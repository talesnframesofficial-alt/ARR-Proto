-- ARR-Proto upgrade: editable categories, purchase bills, and receiving stock.
-- Run after schema.sql in the ARR-Proto Supabase project's SQL Editor.

create table if not exists public.arr_categories (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.arr_shops(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (shop_id, name)
);

insert into public.arr_categories(shop_id, name)
select s.id, c.name
from public.arr_shops s
cross join (values ('Juices'), ('Food'), ('Packed items'), ('Gifts'), ('Other')) as c(name)
on conflict (shop_id, name) do nothing;

create or replace function public.arr_seed_categories()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.arr_categories(shop_id, name)
  values (new.id, 'Juices'), (new.id, 'Food'), (new.id, 'Packed items'), (new.id, 'Gifts'), (new.id, 'Other')
  on conflict (shop_id, name) do nothing;
  return new;
end;
$$;
drop trigger if exists arr_shop_seed_categories on public.arr_shops;
create trigger arr_shop_seed_categories after insert on public.arr_shops
for each row execute function public.arr_seed_categories();

create or replace function public.arr_list_categories()
returns setof text language sql stable security definer set search_path = '' as $$
  select c.name from public.arr_categories c
  where c.shop_id = public.arr_current_shop_id() and c.active
  order by case c.name when 'Juices' then 1 when 'Food' then 2 when 'Packed items' then 3 when 'Gifts' then 4 when 'Other' then 5 else 6 end, c.name;
$$;

create or replace function public.arr_create_category(p_name text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_shop uuid := public.arr_current_shop_id(); v_name text := trim(coalesce(p_name, ''));
begin
  if v_shop is null or not public.arr_is_shop_owner() then raise exception 'Owner access required'; end if;
  if length(v_name) < 1 or length(v_name) > 80 or lower(v_name) = 'all items' then raise exception 'Choose a valid category name'; end if;
  if exists(select 1 from public.arr_categories where shop_id=v_shop and lower(name)=lower(v_name) and active) then raise exception 'That category already exists'; end if;
  insert into public.arr_categories(shop_id, name) values (v_shop, v_name);
  return v_name;
exception when unique_violation then raise exception 'That category already exists';
end;
$$;

create or replace function public.arr_rename_category(p_old_name text, p_new_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_shop uuid := public.arr_current_shop_id(); v_old text := trim(coalesce(p_old_name,'')); v_new text := trim(coalesce(p_new_name, ''));
begin
  if v_shop is null or not public.arr_is_shop_owner() then raise exception 'Owner access required'; end if;
  if length(v_new) < 1 or length(v_new) > 80 or lower(v_new) = 'all items' then raise exception 'Choose a valid category name'; end if;
  if exists(select 1 from public.arr_categories where shop_id=v_shop and lower(name)=lower(v_new) and name<>v_old and active) then raise exception 'That category already exists'; end if;
  update public.arr_categories set name=v_new where shop_id=v_shop and name=v_old and active;
  if not found then raise exception 'Category not found'; end if;
  update public.arr_products set category=v_new, updated_at=now() where shop_id=v_shop and category=v_old;
exception when unique_violation then raise exception 'That category already exists';
end;
$$;

create or replace function public.arr_archive_category(p_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_shop uuid := public.arr_current_shop_id(); v_name text := trim(coalesce(p_name, ''));
begin
  if v_shop is null or not public.arr_is_shop_owner() then raise exception 'Owner access required'; end if;
  if lower(v_name) = 'other' then raise exception 'The Other category must stay available'; end if;
  if exists(select 1 from public.arr_products where shop_id=v_shop and category=v_name and active) then
    raise exception 'Move or archive the items in this category first';
  end if;
  update public.arr_categories set active=false where shop_id=v_shop and name=v_name and active;
  if not found then raise exception 'Category not found'; end if;
end;
$$;

create table if not exists public.arr_purchases (
  id uuid primary key default gen_random_uuid(),
  receipt_no bigint generated always as identity,
  shop_id uuid not null references public.arr_shops(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  supplier text not null check (length(trim(supplier)) between 1 and 160),
  invoice_no text not null default '',
  payment_method text not null check (payment_method in ('Cash','UPI','Card','Credit')),
  subtotal numeric(12,2) not null check (subtotal >= 0),
  total numeric(12,2) not null check (total >= 0),
  created_at timestamptz not null default now(),
  unique(shop_id, receipt_no)
);
create table if not exists public.arr_purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.arr_purchases(id) on delete restrict,
  shop_id uuid not null references public.arr_shops(id) on delete cascade,
  product_id uuid references public.arr_products(id) on delete set null,
  item_name text not null,
  quantity integer not null check (quantity > 0),
  unit_cost numeric(12,2) not null check (unit_cost >= 0),
  line_total numeric(12,2) not null check (line_total >= 0),
  created_at timestamptz not null default now()
);
create index if not exists arr_categories_shop_active_idx on public.arr_categories(shop_id, active, name);
create index if not exists arr_purchases_shop_created_idx on public.arr_purchases(shop_id, created_at desc);
create index if not exists arr_purchase_items_purchase_idx on public.arr_purchase_items(purchase_id);

create or replace function public.arr_record_purchase(
  p_supplier text, p_invoice_no text, p_payment_method text, p_items jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_shop uuid := public.arr_current_shop_id();
  v_uid uuid := auth.uid();
  v_item record;
  v_product public.arr_products%rowtype;
  v_purchase public.arr_purchases%rowtype;
  v_subtotal numeric(12,2) := 0;
  v_old_stock integer;
  v_new_stock integer;
begin
  if v_uid is null or v_shop is null or not public.arr_is_shop_owner() then raise exception 'Owner access required'; end if;
  if length(trim(coalesce(p_supplier,''))) < 1 or length(trim(p_supplier)) > 160 then raise exception 'Enter a supplier name'; end if;
  if p_payment_method not in ('Cash','UPI','Card','Credit') then raise exception 'Choose a valid purchase payment method'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'A purchase bill needs at least one item'; end if;
  if exists(
    select 1 from jsonb_to_recordset(p_items) as x(product_id uuid, quantity integer, unit_cost numeric)
    where x.product_id is null or x.quantity is null or x.quantity <= 0 or x.unit_cost is null or x.unit_cost < 0
  ) then raise exception 'Enter valid products, whole quantities, and purchase costs'; end if;
  if exists(
    select 1 from jsonb_to_recordset(p_items) as x(product_id uuid, quantity integer, unit_cost numeric)
    left join public.arr_products p on p.id=x.product_id and p.shop_id=v_shop
    where p.id is null or p.active=false
  ) then raise exception 'A selected item is unavailable'; end if;

  select round(sum(x.quantity*x.unit_cost),2) into v_subtotal
  from jsonb_to_recordset(p_items) as x(product_id uuid, quantity integer, unit_cost numeric);
  insert into public.arr_purchases(shop_id,created_by,supplier,invoice_no,payment_method,subtotal,total)
  values(v_shop,v_uid,trim(p_supplier),trim(coalesce(p_invoice_no,'')),p_payment_method,v_subtotal,v_subtotal)
  returning * into v_purchase;

  for v_item in
    select x.product_id, sum(x.quantity)::integer as quantity, sum(x.quantity*x.unit_cost) as cost_total,
      sum(x.quantity*x.unit_cost)/sum(x.quantity) as average_cost
    from jsonb_to_recordset(p_items) as x(product_id uuid, quantity integer, unit_cost numeric)
    group by x.product_id order by x.product_id
  loop
    select * into v_product from public.arr_products where id=v_item.product_id and shop_id=v_shop for update;
    v_old_stock := coalesce(v_product.stock,0);
    v_new_stock := v_old_stock + v_item.quantity;
    update public.arr_products set stock=v_new_stock,
      cost=case when v_new_stock=0 then v_item.average_cost else round(((v_old_stock*cost)+(v_item.quantity*v_item.average_cost))/v_new_stock,2) end,
      updated_at=now() where id=v_product.id;
    insert into public.arr_purchase_items(purchase_id,shop_id,product_id,item_name,quantity,unit_cost,line_total)
    select v_purchase.id,v_shop,v_product.id,v_product.name,x.quantity,x.unit_cost,round(x.quantity*x.unit_cost,2)
    from jsonb_to_recordset(p_items) as x(product_id uuid, quantity integer, unit_cost numeric)
    where x.product_id=v_product.id;
    insert into public.arr_stock_movements(shop_id,product_id,item_name,quantity_change,reason,created_by)
    values(v_shop,v_product.id,v_product.name,v_item.quantity,'Purchase #'||v_purchase.receipt_no,v_uid);
  end loop;
  return jsonb_build_object('id',v_purchase.id,'receipt_no',v_purchase.receipt_no,'subtotal',v_subtotal,'total',v_subtotal,'created_at',v_purchase.created_at);
end;
$$;

alter table public.arr_categories enable row level security;
alter table public.arr_purchases enable row level security;
alter table public.arr_purchase_items enable row level security;
drop policy if exists arr_categories_member_read on public.arr_categories;
create policy arr_categories_member_read on public.arr_categories for select to authenticated using (shop_id=public.arr_current_shop_id());
drop policy if exists arr_purchases_owner_read on public.arr_purchases;
create policy arr_purchases_owner_read on public.arr_purchases for select to authenticated using (shop_id=public.arr_current_shop_id() and public.arr_is_shop_owner());
drop policy if exists arr_purchase_items_owner_read on public.arr_purchase_items;
create policy arr_purchase_items_owner_read on public.arr_purchase_items for select to authenticated using (shop_id=public.arr_current_shop_id() and public.arr_is_shop_owner());
revoke all on public.arr_categories, public.arr_purchases, public.arr_purchase_items from anon, authenticated;
grant select on public.arr_categories to authenticated;
grant select on public.arr_purchases, public.arr_purchase_items to authenticated;
grant usage,select on all sequences in schema public to authenticated;
revoke all on function public.arr_list_categories() from public, anon;
revoke all on function public.arr_create_category(text) from public, anon;
revoke all on function public.arr_rename_category(text,text) from public, anon;
revoke all on function public.arr_archive_category(text) from public, anon;
revoke all on function public.arr_record_purchase(text,text,text,jsonb) from public, anon;
grant execute on function public.arr_list_categories(), public.arr_create_category(text), public.arr_rename_category(text,text), public.arr_archive_category(text), public.arr_record_purchase(text,text,text,jsonb) to authenticated;
