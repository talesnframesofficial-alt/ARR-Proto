-- ARR-Proto: measured inventory, recipes, shop address, and staff management.
-- Run after schema.sql, upgrade_products_inventory.sql, and username_auth.sql.
begin;

alter table public.arr_products
  alter column stock type numeric(14,3) using stock::numeric,
  alter column cost type numeric(12,4) using cost::numeric,
  add column if not exists stock_unit text not null default 'each',
  add column if not exists is_sellable boolean not null default true;
alter table public.arr_products drop constraint if exists arr_products_stock_unit_check;
alter table public.arr_products add constraint arr_products_stock_unit_check check (stock_unit in ('each','g','ml'));

alter table public.arr_stock_movements
  alter column quantity_change type numeric(14,3) using quantity_change::numeric,
  add column if not exists unit text not null default 'each';
update public.arr_stock_movements m set unit=p.stock_unit
from public.arr_products p where m.product_id=p.id and m.unit='each' and p.stock_unit<>'each';

alter table public.arr_purchase_items
  alter column quantity type numeric(14,3) using quantity::numeric,
  alter column unit_cost type numeric(12,4) using unit_cost::numeric;

alter table public.arr_sale_items
  alter column unit_cost type numeric(12,4) using unit_cost::numeric;

alter table public.arr_shops add column if not exists address text not null default '';

create table if not exists public.arr_product_recipes (
  shop_id uuid not null references public.arr_shops(id) on delete cascade,
  product_id uuid not null references public.arr_products(id) on delete cascade,
  ingredient_product_id uuid not null references public.arr_products(id) on delete restrict,
  quantity_per_sale numeric(14,3) not null check (quantity_per_sale > 0),
  created_at timestamptz not null default now(),
  primary key (product_id, ingredient_product_id),
  check (product_id <> ingredient_product_id)
);
create index if not exists arr_product_recipes_shop_product_idx
  on public.arr_product_recipes(shop_id, product_id);

alter table public.arr_product_recipes enable row level security;
drop policy if exists arr_product_recipes_owner_read on public.arr_product_recipes;
create policy arr_product_recipes_owner_read on public.arr_product_recipes
  for select to authenticated using (shop_id=public.arr_current_shop_id() and public.arr_is_shop_owner());
revoke all on public.arr_product_recipes from anon, authenticated;
grant select on public.arr_product_recipes to authenticated;

drop function if exists public.arr_update_shop_settings(text,numeric);
create or replace function public.arr_get_shop_settings()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_profile public.arr_profiles%rowtype; v_shop public.arr_shops%rowtype;
begin
  select * into v_profile from public.arr_profiles where user_id=auth.uid();
  if not found then raise exception 'Create a shop or join with a staff code'; end if;
  select * into v_shop from public.arr_shops where id=v_profile.shop_id;
  return jsonb_build_object('shop_id',v_shop.id,'name',v_shop.name,'address',v_shop.address,
    'tax_rate',v_shop.tax_rate,'role',v_profile.role,'display_name',v_profile.display_name,
    'invite_code',case when v_profile.role='owner' then v_shop.invite_code else null end);
end;
$$;

create or replace function public.arr_update_shop_settings(
  p_name text, p_address text, p_tax_rate numeric, p_display_name text
) returns void language plpgsql security definer set search_path = '' as $$
declare v_shop uuid := public.arr_current_shop_id();
begin
  if v_shop is null or not public.arr_is_shop_owner() then raise exception 'Owner access required'; end if;
  if length(trim(coalesce(p_name,''))) not between 1 and 120 then raise exception 'Shop name is required'; end if;
  if length(coalesce(p_address,'')) > 500 then raise exception 'Address must be 500 characters or fewer'; end if;
  if p_tax_rate < 0 or p_tax_rate > 100 then raise exception 'Tax must be between 0 and 100'; end if;
  update public.arr_shops set name=trim(p_name),address=trim(coalesce(p_address,'')),tax_rate=p_tax_rate where id=v_shop;
  update public.arr_profiles set display_name=trim(coalesce(p_display_name,'')) where user_id=auth.uid() and shop_id=v_shop;
end;
$$;

create or replace function public.arr_update_staff_name(p_user_id uuid, p_display_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_shop uuid := public.arr_current_shop_id();
begin
  if v_shop is null or not public.arr_is_shop_owner() then raise exception 'Owner access required'; end if;
  if p_user_id=auth.uid() then raise exception 'Use shop settings to change the owner name'; end if;
  if length(trim(coalesce(p_display_name,''))) not between 1 and 120 then raise exception 'Enter a staff name'; end if;
  update public.arr_profiles set display_name=trim(p_display_name)
    where user_id=p_user_id and shop_id=v_shop and role='staff';
  if not found then raise exception 'Staff account not found'; end if;
end;
$$;

create or replace function public.arr_remove_staff(p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_shop uuid := public.arr_current_shop_id();
begin
  if v_shop is null or not public.arr_is_shop_owner() then raise exception 'Owner access required'; end if;
  delete from public.arr_profiles where user_id=p_user_id and shop_id=v_shop and role='staff';
  if not found then raise exception 'Staff account not found'; end if;
end;
$$;

create or replace function public.arr_list_products()
returns setof jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id',p.id,'shop_id',p.shop_id,'name',p.name,'category',p.category,'price',p.price,
    'cost',case when public.arr_is_shop_owner() then p.cost else 0 end,
    'emoji',p.emoji,'stock',p.stock,'stock_unit',p.stock_unit,'is_sellable',p.is_sellable,
    'active',p.active,'created_at',p.created_at,'updated_at',p.updated_at
  ) from public.arr_products p where p.shop_id=public.arr_current_shop_id() order by p.name;
$$;

drop function if exists public.arr_adjust_stock(uuid,integer,numeric);
create or replace function public.arr_adjust_stock(p_product_id uuid, p_delta numeric, p_unit_cost numeric default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_shop uuid := public.arr_current_shop_id(); v_product public.arr_products%rowtype; v_next numeric(14,3);
begin
  if v_shop is null or not public.arr_is_shop_owner() then raise exception 'Owner access required'; end if;
  if p_delta=0 or p_delta<>round(p_delta,3) then raise exception 'Enter a non-zero amount with up to 3 decimals'; end if;
  if p_unit_cost is not null and p_unit_cost<0 then raise exception 'Cost cannot be negative'; end if;
  select * into v_product from public.arr_products where id=p_product_id and shop_id=v_shop for update;
  if not found then raise exception 'Item not found'; end if;
  v_next:=coalesce(v_product.stock,0)+p_delta;
  if v_next<0 then raise exception 'Stock cannot be negative'; end if;
  update public.arr_products set stock=v_next,cost=coalesce(p_unit_cost,cost),updated_at=now() where id=p_product_id;
  insert into public.arr_stock_movements(shop_id,product_id,item_name,quantity_change,unit,reason,created_by)
    values(v_shop,p_product_id,v_product.name,p_delta,v_product.stock_unit,'Owner stock adjustment',auth.uid());
end;
$$;

create or replace function public.arr_list_product_recipes()
returns table(product_id uuid,ingredient_product_id uuid,quantity_per_sale numeric)
language sql stable security definer set search_path = '' as $$
  select r.product_id,r.ingredient_product_id,r.quantity_per_sale
  from public.arr_product_recipes r
  where r.shop_id=public.arr_current_shop_id() and public.arr_is_shop_owner()
  order by r.product_id,r.ingredient_product_id;
$$;

create or replace function public.arr_save_product_recipe(p_product_id uuid,p_components jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_shop uuid:=public.arr_current_shop_id();
begin
  if v_shop is null or not public.arr_is_shop_owner() then raise exception 'Owner access required'; end if;
  if not exists(select 1 from public.arr_products where id=p_product_id and shop_id=v_shop and active) then raise exception 'Sale item not found'; end if;
  if jsonb_typeof(p_components)<>'array' then raise exception 'Recipe components must be a list'; end if;
  if exists(
    select 1 from jsonb_to_recordset(p_components) as x(ingredient_product_id uuid,quantity_per_sale numeric)
    where x.ingredient_product_id is null or x.quantity_per_sale is null or x.quantity_per_sale<=0 or x.quantity_per_sale<>round(x.quantity_per_sale,3)
  ) then raise exception 'Each component needs a valid amount with up to 3 decimals'; end if;
  if exists(
    select 1 from jsonb_to_recordset(p_components) as x(ingredient_product_id uuid,quantity_per_sale numeric)
    left join public.arr_products i on i.id=x.ingredient_product_id and i.shop_id=v_shop and i.active
    where i.id is null or i.id=p_product_id or i.stock_unit not in ('each','g','ml')
  ) then raise exception 'Choose active inventory items as components'; end if;
  if exists(
    select 1 from jsonb_to_recordset(p_components) as x(ingredient_product_id uuid,quantity_per_sale numeric)
    join public.arr_product_recipes nested on nested.product_id=x.ingredient_product_id and nested.shop_id=v_shop
  ) then raise exception 'A recipe component must be a stock item without its own recipe'; end if;
  if exists(select 1 from public.arr_product_recipes where ingredient_product_id=p_product_id and shop_id=v_shop) then
    raise exception 'This item is already used as an ingredient; remove it from those recipes first';
  end if;
  delete from public.arr_product_recipes where product_id=p_product_id and shop_id=v_shop;
  insert into public.arr_product_recipes(shop_id,product_id,ingredient_product_id,quantity_per_sale)
  select v_shop,p_product_id,x.ingredient_product_id,sum(x.quantity_per_sale)::numeric(14,3)
  from jsonb_to_recordset(p_components) as x(ingredient_product_id uuid,quantity_per_sale numeric)
  group by x.ingredient_product_id;
end;
$$;

drop function if exists public.arr_record_purchase(text,text,text,jsonb);
create or replace function public.arr_record_purchase(
  p_supplier text,p_invoice_no text,p_payment_method text,p_items jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_shop uuid:=public.arr_current_shop_id(); v_uid uuid:=auth.uid(); v_item record;
  v_product public.arr_products%rowtype; v_purchase public.arr_purchases%rowtype;
  v_subtotal numeric(12,2):=0; v_old_stock numeric(14,3); v_new_stock numeric(14,3);
begin
  if v_uid is null or v_shop is null or not public.arr_is_shop_owner() then raise exception 'Owner access required'; end if;
  if length(trim(coalesce(p_supplier,'')))<1 or length(trim(p_supplier))>160 then raise exception 'Enter a supplier name'; end if;
  if p_payment_method not in ('Cash','UPI','Card','Credit') then raise exception 'Choose a valid purchase payment method'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'A purchase bill needs at least one item'; end if;
  if exists(select 1 from jsonb_to_recordset(p_items) as x(product_id uuid,quantity numeric,unit_cost numeric)
    where x.product_id is null or x.quantity is null or x.quantity<=0 or x.quantity<>round(x.quantity,3) or x.unit_cost is null or x.unit_cost<0)
    then raise exception 'Enter valid stock amounts and purchase costs'; end if;
  if exists(select 1 from jsonb_to_recordset(p_items) as x(product_id uuid,quantity numeric,unit_cost numeric)
    left join public.arr_products p on p.id=x.product_id and p.shop_id=v_shop
    where p.id is null or p.active=false)
    then raise exception 'A selected item is unavailable'; end if;
  select round(sum(x.quantity*x.unit_cost),2) into v_subtotal
    from jsonb_to_recordset(p_items) as x(product_id uuid,quantity numeric,unit_cost numeric);
  insert into public.arr_purchases(shop_id,created_by,supplier,invoice_no,payment_method,subtotal,total)
    values(v_shop,v_uid,trim(p_supplier),trim(coalesce(p_invoice_no,'')),p_payment_method,v_subtotal,v_subtotal)
    returning * into v_purchase;
  for v_item in
    select x.product_id,sum(x.quantity)::numeric(14,3) quantity,
      sum(x.quantity*x.unit_cost) cost_total,sum(x.quantity*x.unit_cost)/sum(x.quantity) average_cost
    from jsonb_to_recordset(p_items) as x(product_id uuid,quantity numeric,unit_cost numeric)
    group by x.product_id order by x.product_id
  loop
    select * into v_product from public.arr_products where id=v_item.product_id and shop_id=v_shop for update;
    v_old_stock:=coalesce(v_product.stock,0); v_new_stock:=v_old_stock+v_item.quantity;
    update public.arr_products set stock=v_new_stock,
      cost=case when v_new_stock=0 then v_item.average_cost else round(((v_old_stock*cost)+(v_item.quantity*v_item.average_cost))/v_new_stock,4) end,
      updated_at=now() where id=v_product.id;
    insert into public.arr_purchase_items(purchase_id,shop_id,product_id,item_name,quantity,unit_cost,line_total)
      select v_purchase.id,v_shop,v_product.id,v_product.name,x.quantity,x.unit_cost,round(x.quantity*x.unit_cost,2)
      from jsonb_to_recordset(p_items) as x(product_id uuid,quantity numeric,unit_cost numeric) where x.product_id=v_product.id;
    insert into public.arr_stock_movements(shop_id,product_id,item_name,quantity_change,unit,reason,created_by)
      values(v_shop,v_product.id,v_product.name,v_item.quantity,v_product.stock_unit,'Purchase #'||v_purchase.receipt_no,v_uid);
  end loop;
  return jsonb_build_object('id',v_purchase.id,'receipt_no',v_purchase.receipt_no,'subtotal',v_subtotal,'total',v_subtotal,'created_at',v_purchase.created_at);
end;
$$;

create or replace function public.arr_record_sale(
  p_customer text,p_payment_method text,p_discount numeric,p_tax_rate numeric,p_items jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_shop uuid:=public.arr_current_shop_id(); v_uid uuid:=auth.uid(); v_item record; v_product public.arr_products%rowtype;
  v_subtotal numeric(12,2):=0; v_discount numeric(12,2); v_tax numeric(12,2); v_total numeric(12,2);
  v_profit numeric(12,2):=0; v_ratio numeric; v_shop_tax numeric(5,2); v_sale public.arr_sales%rowtype;
  v_unit_cost numeric(12,4); v_line_total numeric(12,2); v_need record;
begin
  if v_uid is null or v_shop is null then raise exception 'Shop account required'; end if;
  if p_payment_method not in ('Cash','UPI','Card') then raise exception 'Invalid payment method'; end if;
  if not public.arr_is_shop_owner() and p_discount>0 then raise exception 'Only the owner can apply a discount'; end if;
  select s.tax_rate into v_shop_tax from public.arr_shops s where s.id=v_shop;
  if p_tax_rate<0 or p_tax_rate>100 or p_discount<0 then raise exception 'Invalid tax or discount'; end if;
  if p_tax_rate<>v_shop_tax then raise exception 'Shop tax changed; review the bill and try again'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'A sale needs at least one item'; end if;
  if exists(select 1 from jsonb_to_recordset(p_items) as x(product_id uuid,quantity integer,expected_price numeric)
    where x.product_id is null or x.quantity is null or x.quantity<=0 or x.expected_price is null)
    then raise exception 'Invalid item quantity or price'; end if;
  for v_item in
    select x.product_id,sum(x.quantity)::integer quantity,min(x.expected_price) expected_price,max(x.expected_price) max_expected_price
    from jsonb_to_recordset(p_items) as x(product_id uuid,quantity integer,expected_price numeric)
    group by x.product_id order by x.product_id
  loop
    select * into v_product from public.arr_products where id=v_item.product_id and shop_id=v_shop and active and is_sellable for update;
    if not found then raise exception 'An item is no longer available for sale'; end if;
    if v_item.expected_price<>v_item.max_expected_price or v_product.price<>v_item.expected_price then raise exception 'An item price changed; review the bill and try again'; end if;
    v_subtotal:=v_subtotal+v_product.price*v_item.quantity;
  end loop;
  v_discount:=least(p_discount,v_subtotal);
  v_tax:=round((v_subtotal-v_discount)*p_tax_rate/100,2);
  v_total:=v_subtotal-v_discount+v_tax;
  v_ratio:=case when v_subtotal=0 then 1 else (v_subtotal-v_discount)/v_subtotal end;

  for v_need in
    with sale_lines as (
      select (value->>'product_id')::uuid product_id,sum((value->>'quantity')::integer)::numeric(14,3) quantity
      from jsonb_array_elements(p_items) group by (value->>'product_id')::uuid
    ), requirements as (
      select r.ingredient_product_id product_id,sum(r.quantity_per_sale*l.quantity)::numeric(14,3) quantity,true component
      from sale_lines l join public.arr_product_recipes r on r.product_id=l.product_id and r.shop_id=v_shop
      group by r.ingredient_product_id
      union all
      select l.product_id,l.quantity,false
      from sale_lines l where not exists(select 1 from public.arr_product_recipes r where r.product_id=l.product_id and r.shop_id=v_shop)
    )
    select product_id,sum(quantity)::numeric(14,3) quantity,bool_or(component) component
    from requirements group by product_id order by product_id
  loop
    select * into v_product from public.arr_products where id=v_need.product_id and shop_id=v_shop for update;
    if not found then raise exception 'An inventory component is unavailable'; end if;
    if v_need.component and v_product.stock is null then raise exception 'Add stock for ingredient % before selling',v_product.name; end if;
    if v_product.stock is not null and v_product.stock<v_need.quantity then
      raise exception 'Not enough %: need %, have % %',v_product.name,v_need.quantity,v_product.stock,v_product.stock_unit;
    end if;
  end loop;

  insert into public.arr_sales(shop_id,created_by,customer,payment_method,subtotal,discount,tax_rate,tax,total,gross_profit)
    values(v_shop,v_uid,trim(coalesce(p_customer,'')),p_payment_method,v_subtotal,v_discount,p_tax_rate,v_tax,v_total,0)
    returning * into v_sale;
  for v_item in
    select x.product_id,sum(x.quantity)::integer quantity
    from jsonb_to_recordset(p_items) as x(product_id uuid,quantity integer,expected_price numeric)
    group by x.product_id order by x.product_id
  loop
    select * into v_product from public.arr_products where id=v_item.product_id and shop_id=v_shop;
    if exists(select 1 from public.arr_product_recipes r where r.product_id=v_product.id and r.shop_id=v_shop) then
      select coalesce(sum(r.quantity_per_sale*i.cost),0)::numeric(12,4) into v_unit_cost
      from public.arr_product_recipes r join public.arr_products i on i.id=r.ingredient_product_id and i.shop_id=v_shop
      where r.product_id=v_product.id and r.shop_id=v_shop;
    else
      v_unit_cost:=v_product.cost;
    end if;
    v_line_total:=round(v_product.price*v_item.quantity,2);
    v_profit:=v_profit+round((v_product.price-v_unit_cost)*v_item.quantity*v_ratio,2);
    insert into public.arr_sale_items(sale_id,shop_id,product_id,item_name,quantity,unit_price,unit_cost,line_total,line_profit)
      values(v_sale.id,v_shop,v_product.id,v_product.name,v_item.quantity,v_product.price,v_unit_cost,
        v_line_total,round((v_product.price-v_unit_cost)*v_item.quantity*v_ratio,2));
  end loop;

  for v_need in
    with sale_lines as (
      select (value->>'product_id')::uuid product_id,sum((value->>'quantity')::integer)::numeric(14,3) quantity
      from jsonb_array_elements(p_items) group by (value->>'product_id')::uuid
    ), requirements as (
      select r.ingredient_product_id product_id,sum(r.quantity_per_sale*l.quantity)::numeric(14,3) quantity,true component
      from sale_lines l join public.arr_product_recipes r on r.product_id=l.product_id and r.shop_id=v_shop
      group by r.ingredient_product_id
      union all
      select l.product_id,l.quantity,false
      from sale_lines l where not exists(select 1 from public.arr_product_recipes r where r.product_id=l.product_id and r.shop_id=v_shop)
    )
    select product_id,sum(quantity)::numeric(14,3) quantity,bool_or(component) component
    from requirements group by product_id order by product_id
  loop
    update public.arr_products set stock=stock-v_need.quantity,updated_at=now()
      where id=v_need.product_id and shop_id=v_shop and stock is not null;
    if found then
      select * into v_product from public.arr_products where id=v_need.product_id and shop_id=v_shop;
      insert into public.arr_stock_movements(shop_id,product_id,item_name,quantity_change,unit,reason,created_by)
        values(v_shop,v_product.id,v_product.name,-v_need.quantity,v_product.stock_unit,
          'Sale #'||v_sale.receipt_no||case when v_need.component then ' (recipe)' else '' end,v_uid);
    end if;
  end loop;
  update public.arr_sales set gross_profit=v_profit where id=v_sale.id;
  return jsonb_build_object('id',v_sale.id,'receipt_no',v_sale.receipt_no,'subtotal',v_subtotal,'discount',v_discount,'tax',v_tax,
    'tax_rate',p_tax_rate,'total',v_total,'profit',case when public.arr_is_shop_owner() then v_profit else null end,'created_at',v_sale.created_at);
end;
$$;

revoke all on function public.arr_list_product_recipes() from public,anon;
revoke all on function public.arr_save_product_recipe(uuid,jsonb) from public,anon;
revoke all on function public.arr_record_sale(text,text,numeric,numeric,jsonb) from public,anon;
revoke all on function public.arr_record_purchase(text,text,text,jsonb) from public,anon;
revoke all on function public.arr_adjust_stock(uuid,numeric,numeric) from public,anon;
revoke all on function public.arr_update_shop_settings(text,text,numeric,text) from public,anon;
revoke all on function public.arr_update_staff_name(uuid,text) from public,anon;
revoke all on function public.arr_remove_staff(uuid) from public,anon;
grant execute on function public.arr_list_product_recipes(),public.arr_save_product_recipe(uuid,jsonb),
  public.arr_record_sale(text,text,numeric,numeric,jsonb),public.arr_record_purchase(text,text,text,jsonb),
  public.arr_adjust_stock(uuid,numeric,numeric),public.arr_update_shop_settings(text,text,numeric,text),
  public.arr_update_staff_name(uuid,text),public.arr_remove_staff(uuid) to authenticated;

commit;
