-- ARR-Proto cloud database. Run once in Supabase SQL Editor.
create table if not exists public.arr_shops (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  owner_id uuid not null references auth.users(id) on delete restrict,
  invite_code text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
  tax_rate numeric(5,2) not null default 0 check (tax_rate between 0 and 100),
  created_at timestamptz not null default now()
);
create table if not exists public.arr_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  shop_id uuid not null references public.arr_shops(id) on delete restrict,
  role text not null check (role in ('owner','staff')),
  display_name text not null default '',
  created_at timestamptz not null default now()
);
create table if not exists public.arr_products (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.arr_shops(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 160),
  category text not null default 'Other',
  price numeric(12,2) not null check (price >= 0),
  cost numeric(12,2) not null default 0 check (cost >= 0),
  emoji text not null default '📦',
  stock integer check (stock is null or stock >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.arr_sales (
  id uuid primary key default gen_random_uuid(),
  receipt_no bigint generated always as identity,
  shop_id uuid not null references public.arr_shops(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  customer text not null default '',
  payment_method text not null check (payment_method in ('Cash','UPI','Card')),
  subtotal numeric(12,2) not null,
  discount numeric(12,2) not null default 0,
  tax_rate numeric(5,2) not null default 0,
  tax numeric(12,2) not null default 0,
  total numeric(12,2) not null,
  gross_profit numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  unique(shop_id, receipt_no)
);
create table if not exists public.arr_sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.arr_sales(id) on delete restrict,
  shop_id uuid not null references public.arr_shops(id) on delete cascade,
  product_id uuid references public.arr_products(id) on delete set null,
  item_name text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12,2) not null,
  unit_cost numeric(12,2) not null,
  line_total numeric(12,2) not null,
  line_profit numeric(12,2) not null,
  created_at timestamptz not null default now()
);
create table if not exists public.arr_stock_movements (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.arr_shops(id) on delete cascade,
  product_id uuid references public.arr_products(id) on delete set null,
  item_name text not null,
  quantity_change integer not null check (quantity_change <> 0),
  reason text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists arr_products_shop_active_name_idx on public.arr_products(shop_id, active, name);
create index if not exists arr_sales_shop_created_idx on public.arr_sales(shop_id, created_at desc);
create index if not exists arr_sale_items_sale_idx on public.arr_sale_items(sale_id);
create index if not exists arr_stock_movements_shop_created_idx on public.arr_stock_movements(shop_id, created_at desc);

create or replace function public.arr_current_shop_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select p.shop_id from public.arr_profiles p where p.user_id = (select auth.uid()) limit 1;
$$;
create or replace function public.arr_is_shop_owner()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.arr_profiles p where p.user_id = (select auth.uid()) and p.role = 'owner');
$$;

create or replace function public.arr_create_shop(p_name text, p_display_name text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_shop public.arr_shops%rowtype;
begin
  if v_uid is null then raise exception 'Sign in first'; end if;
  if exists(select 1 from public.arr_profiles where user_id = v_uid) then raise exception 'This account already belongs to a shop'; end if;
  insert into public.arr_shops(name, owner_id) values (trim(p_name), v_uid) returning * into v_shop;
  insert into public.arr_profiles(user_id, shop_id, role, display_name) values (v_uid, v_shop.id, 'owner', trim(coalesce(p_display_name,'')));
  return jsonb_build_object('shop_id', v_shop.id, 'name', v_shop.name, 'tax_rate', v_shop.tax_rate, 'invite_code', v_shop.invite_code, 'role', 'owner');
end;
$$;
create or replace function public.arr_join_shop(p_invite_code text, p_display_name text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_shop public.arr_shops%rowtype;
begin
  if v_uid is null then raise exception 'Sign in first'; end if;
  if exists(select 1 from public.arr_profiles where user_id = v_uid) then raise exception 'This account already belongs to a shop'; end if;
  select * into v_shop from public.arr_shops where invite_code = upper(trim(p_invite_code));
  if not found then raise exception 'That staff invite code was not found'; end if;
  insert into public.arr_profiles(user_id, shop_id, role, display_name) values (v_uid, v_shop.id, 'staff', trim(coalesce(p_display_name,'')));
  return jsonb_build_object('shop_id', v_shop.id, 'name', v_shop.name, 'tax_rate', v_shop.tax_rate, 'role', 'staff');
end;
$$;
create or replace function public.arr_get_shop_settings()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_profile public.arr_profiles%rowtype; v_shop public.arr_shops%rowtype;
begin
  select * into v_profile from public.arr_profiles where user_id = auth.uid();
  if not found then raise exception 'Create a shop or join with a staff code'; end if;
  select * into v_shop from public.arr_shops where id = v_profile.shop_id;
  return jsonb_build_object('shop_id',v_shop.id,'name',v_shop.name,'tax_rate',v_shop.tax_rate,'role',v_profile.role,'display_name',v_profile.display_name,
    'invite_code',case when v_profile.role = 'owner' then v_shop.invite_code else null end);
end;
$$;
create or replace function public.arr_update_shop_settings(p_name text, p_tax_rate numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare v_shop uuid := public.arr_current_shop_id();
begin
  if v_shop is null or not public.arr_is_shop_owner() then raise exception 'Owner access required'; end if;
  if p_tax_rate < 0 or p_tax_rate > 100 then raise exception 'Tax must be between 0 and 100'; end if;
  update public.arr_shops set name=trim(p_name), tax_rate=p_tax_rate where id=v_shop;
end;
$$;
create or replace function public.arr_record_sale(p_customer text, p_payment_method text, p_discount numeric, p_tax_rate numeric, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_shop uuid := public.arr_current_shop_id(); v_uid uuid := auth.uid(); v_item record; v_product public.arr_products%rowtype;
  v_subtotal numeric(12,2) := 0; v_discount numeric(12,2); v_tax numeric(12,2); v_total numeric(12,2); v_profit numeric(12,2); v_ratio numeric; v_shop_tax numeric(5,2);
  v_sale public.arr_sales%rowtype; v_qty integer;
begin
  if v_uid is null or v_shop is null then raise exception 'Shop account required'; end if;
  if p_payment_method not in ('Cash','UPI','Card') then raise exception 'Invalid payment method'; end if;
  if not public.arr_is_shop_owner() and p_discount > 0 then raise exception 'Only the owner can apply a discount'; end if;
  select s.tax_rate into v_shop_tax from public.arr_shops s where s.id=v_shop;
  if p_tax_rate < 0 or p_tax_rate > 100 or p_discount < 0 then raise exception 'Invalid tax or discount'; end if;
  if p_tax_rate <> v_shop_tax then raise exception 'Shop tax changed; review the bill and try again'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'A sale needs at least one item'; end if;
  if exists(select 1 from jsonb_to_recordset(p_items) as x(product_id uuid,quantity integer,expected_price numeric) where x.quantity is null or x.quantity <= 0 or x.expected_price is null) then raise exception 'Invalid item quantity or price'; end if;
  for v_item in select (value->>'product_id')::uuid as product_id, sum((value->>'quantity')::integer)::integer as quantity, min((value->>'expected_price')::numeric) as expected_price, max((value->>'expected_price')::numeric) as max_expected_price
                from jsonb_array_elements(p_items) group by (value->>'product_id')::uuid loop
    if v_item.quantity <= 0 then raise exception 'Quantity must be positive'; end if;
    select * into v_product from public.arr_products where id=v_item.product_id and shop_id=v_shop and active=true for update;
    if not found then raise exception 'An item is no longer available'; end if;
    if v_item.expected_price <> v_item.max_expected_price or v_product.price <> v_item.expected_price then raise exception 'An item price changed; review the bill and try again'; end if;
    if v_product.stock is not null and v_product.stock < v_item.quantity then raise exception 'Insufficient stock for %', v_product.name; end if;
    v_subtotal := v_subtotal + v_product.price * v_item.quantity;
  end loop;
  v_discount := least(p_discount, v_subtotal);
  v_tax := round((v_subtotal-v_discount)*p_tax_rate/100,2);
  v_total := v_subtotal-v_discount+v_tax;
  v_ratio := case when v_subtotal=0 then 1 else (v_subtotal-v_discount)/v_subtotal end;
  select coalesce(round(sum((p.price-p.cost)*x.quantity*v_ratio),2),0) into v_profit
    from (select product_id,sum(quantity)::integer as quantity from jsonb_to_recordset(p_items) as x(product_id uuid,quantity integer,expected_price numeric) group by product_id) x
    join public.arr_products p on p.id=x.product_id and p.shop_id=v_shop;
  insert into public.arr_sales(shop_id,created_by,customer,payment_method,subtotal,discount,tax_rate,tax,total,gross_profit)
    values(v_shop,v_uid,trim(coalesce(p_customer,'')),p_payment_method,v_subtotal,v_discount,p_tax_rate,v_tax,v_total,v_profit)
    returning * into v_sale;
  for v_item in select (value->>'product_id')::uuid as product_id, sum((value->>'quantity')::integer)::integer as quantity
                from jsonb_array_elements(p_items) group by (value->>'product_id')::uuid loop
    select * into v_product from public.arr_products where id=v_item.product_id and shop_id=v_shop for update;
    v_qty := v_item.quantity;
    insert into public.arr_sale_items(sale_id,shop_id,product_id,item_name,quantity,unit_price,unit_cost,line_total,line_profit)
      values(v_sale.id,v_shop,v_product.id,v_product.name,v_qty,v_product.price,v_product.cost,
        round(v_product.price*v_qty,2),round((v_product.price-v_product.cost)*v_qty*v_ratio,2));
    if v_product.stock is not null then
      update public.arr_products set stock=stock-v_qty, updated_at=now() where id=v_product.id;
      insert into public.arr_stock_movements(shop_id,product_id,item_name,quantity_change,reason,created_by)
        values(v_shop,v_product.id,v_product.name,-v_qty,'Sale #'||v_sale.receipt_no,v_uid);
    end if;
  end loop;
  return jsonb_build_object('id',v_sale.id,'receipt_no',v_sale.receipt_no,'subtotal',v_sale.subtotal,'discount',v_sale.discount,'tax',v_sale.tax,'tax_rate',v_sale.tax_rate,'total',v_sale.total,'profit',case when public.arr_is_shop_owner() then v_sale.gross_profit else null end,'created_at',v_sale.created_at);
end;
$$;
create or replace function public.arr_list_products()
returns setof jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id',p.id,'shop_id',p.shop_id,'name',p.name,'category',p.category,'price',p.price,
    'cost',case when public.arr_is_shop_owner() then p.cost else 0 end,
    'emoji',p.emoji,'stock',p.stock,'active',p.active,'created_at',p.created_at,'updated_at',p.updated_at
  ) from public.arr_products p where p.shop_id=public.arr_current_shop_id() order by p.name;
$$;

create or replace function public.arr_adjust_stock(p_product_id uuid, p_delta integer, p_unit_cost numeric default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_shop uuid := public.arr_current_shop_id(); v_product public.arr_products%rowtype; v_next integer;
begin
  if v_shop is null or not public.arr_is_shop_owner() then raise exception 'Owner access required'; end if;
  if p_delta=0 then raise exception 'Enter a non-zero stock change'; end if;
  if p_unit_cost is not null and p_unit_cost < 0 then raise exception 'Cost cannot be negative'; end if;
  select * into v_product from public.arr_products where id=p_product_id and shop_id=v_shop for update;
  if not found then raise exception 'Item not found'; end if;
  v_next := coalesce(v_product.stock,0)+p_delta;
  if v_next < 0 then raise exception 'Stock cannot be negative'; end if;
  update public.arr_products set stock=v_next,cost=coalesce(p_unit_cost,cost),updated_at=now() where id=p_product_id;
  insert into public.arr_stock_movements(shop_id,product_id,item_name,quantity_change,reason,created_by)
    values(v_shop,p_product_id,v_product.name,p_delta,'Owner stock adjustment',auth.uid());
end;
$$;

alter table public.arr_shops enable row level security;
alter table public.arr_profiles enable row level security;
alter table public.arr_products enable row level security;
alter table public.arr_sales enable row level security;
alter table public.arr_sale_items enable row level security;
alter table public.arr_stock_movements enable row level security;
create policy arr_shop_member_read on public.arr_shops for select to authenticated using (id=public.arr_current_shop_id());
create policy arr_shop_owner_update on public.arr_shops for update to authenticated using (id=public.arr_current_shop_id() and public.arr_is_shop_owner()) with check (id=public.arr_current_shop_id() and public.arr_is_shop_owner());
create policy arr_profile_self_or_owner_read on public.arr_profiles for select to authenticated using (user_id=(select auth.uid()) or (shop_id=public.arr_current_shop_id() and public.arr_is_shop_owner()));
create policy arr_products_shop_read on public.arr_products for select to authenticated using (shop_id=public.arr_current_shop_id());
create policy arr_products_owner_insert on public.arr_products for insert to authenticated with check (shop_id=public.arr_current_shop_id() and public.arr_is_shop_owner());
create policy arr_products_owner_update on public.arr_products for update to authenticated using (shop_id=public.arr_current_shop_id() and public.arr_is_shop_owner()) with check (shop_id=public.arr_current_shop_id() and public.arr_is_shop_owner());
create policy arr_products_owner_delete on public.arr_products for delete to authenticated using (shop_id=public.arr_current_shop_id() and public.arr_is_shop_owner());
create policy arr_sales_owner_read on public.arr_sales for select to authenticated using (shop_id=public.arr_current_shop_id() and public.arr_is_shop_owner());
create policy arr_sale_items_owner_read on public.arr_sale_items for select to authenticated using (shop_id=public.arr_current_shop_id() and public.arr_is_shop_owner());
create policy arr_stock_owner_read on public.arr_stock_movements for select to authenticated using (shop_id=public.arr_current_shop_id() and public.arr_is_shop_owner());

-- Never expose the staff invite code through ordinary table reads.
revoke all on public.arr_shops, public.arr_profiles, public.arr_products, public.arr_sales, public.arr_sale_items, public.arr_stock_movements from anon;
revoke all on public.arr_shops, public.arr_profiles, public.arr_products, public.arr_sales, public.arr_sale_items, public.arr_stock_movements from authenticated;
grant select(id,name,owner_id) on public.arr_shops to authenticated;
grant update(name) on public.arr_shops to authenticated;
grant select(user_id,shop_id,role,display_name,created_at) on public.arr_profiles to authenticated;
grant select(id,shop_id,name,category,price,emoji,stock,active,created_at,updated_at) on public.arr_products to authenticated;
grant insert,update,delete on public.arr_products to authenticated;
grant select on public.arr_sales, public.arr_sale_items, public.arr_stock_movements to authenticated;
grant usage,select on all sequences in schema public to authenticated;
revoke all on function public.arr_create_shop(text,text) from public, anon;
revoke all on function public.arr_join_shop(text,text) from public, anon;
revoke all on function public.arr_get_shop_settings() from public, anon;
revoke all on function public.arr_update_shop_settings(text,numeric) from public, anon;
revoke all on function public.arr_record_sale(text,text,numeric,numeric,jsonb) from public, anon;
revoke all on function public.arr_adjust_stock(uuid,integer,numeric) from public, anon;
revoke all on function public.arr_list_products() from public, anon;
grant execute on function public.arr_create_shop(text,text), public.arr_join_shop(text,text), public.arr_get_shop_settings(), public.arr_update_shop_settings(text,numeric), public.arr_record_sale(text,text,numeric,numeric,jsonb), public.arr_adjust_stock(uuid,integer,numeric), public.arr_list_products() to authenticated;
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
