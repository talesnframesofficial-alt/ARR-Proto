-- ARR-Proto: stop reading/changing inventory when recording bills.
-- Run once after the existing ARR-Proto schema. Existing stock and purchase records remain stored.
begin;

alter table public.arr_shops add column if not exists address text not null default '';

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

drop function if exists public.arr_update_shop_settings(text,numeric);
drop function if exists public.arr_update_shop_settings(text,text,numeric,text);
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

-- Preserve validation, prices, taxes, bill rows, and profits; ignore all stock balances.
create or replace function public.arr_record_sale(
  p_customer text, p_payment_method text, p_discount numeric, p_tax_rate numeric, p_items jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_shop uuid := public.arr_current_shop_id(); v_uid uuid := auth.uid(); v_item record; v_product public.arr_products%rowtype;
  v_subtotal numeric(12,2) := 0; v_discount numeric(12,2); v_tax numeric(12,2); v_total numeric(12,2);
  v_profit numeric(12,2); v_ratio numeric; v_shop_tax numeric(5,2); v_sale public.arr_sales%rowtype; v_qty integer;
begin
  if v_uid is null or v_shop is null then raise exception 'Shop account required'; end if;
  if p_payment_method not in ('Cash','UPI','Card') then raise exception 'Invalid payment method'; end if;
  if not public.arr_is_shop_owner() and p_discount > 0 then raise exception 'Only the owner can apply a discount'; end if;
  select s.tax_rate into v_shop_tax from public.arr_shops s where s.id=v_shop;
  if p_tax_rate < 0 or p_tax_rate > 100 or p_discount < 0 then raise exception 'Invalid tax or discount'; end if;
  if p_tax_rate <> v_shop_tax then raise exception 'Shop tax changed; review the bill and try again'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'A sale needs at least one item'; end if;
  if exists(
    select 1 from jsonb_to_recordset(p_items) as x(product_id uuid,quantity integer,expected_price numeric)
    where x.product_id is null or x.quantity is null or x.quantity <= 0 or x.expected_price is null
  ) then raise exception 'Invalid item quantity or price'; end if;

  for v_item in
    select (value->>'product_id')::uuid as product_id,
      sum((value->>'quantity')::integer)::integer as quantity,
      min((value->>'expected_price')::numeric) as expected_price,
      max((value->>'expected_price')::numeric) as max_expected_price
    from jsonb_array_elements(p_items) group by (value->>'product_id')::uuid
  loop
    if v_item.quantity <= 0 then raise exception 'Quantity must be positive'; end if;
    select * into v_product from public.arr_products
      where id=v_item.product_id and shop_id=v_shop and active=true for update;
    if not found then raise exception 'An item is no longer available'; end if;
    if v_item.expected_price <> v_item.max_expected_price or v_product.price <> v_item.expected_price then
      raise exception 'An item price changed; review the bill and try again';
    end if;
    v_subtotal := v_subtotal + v_product.price * v_item.quantity;
  end loop;

  v_discount := least(p_discount,v_subtotal);
  v_tax := round((v_subtotal-v_discount)*p_tax_rate/100,2);
  v_total := v_subtotal-v_discount+v_tax;
  v_ratio := case when v_subtotal=0 then 1 else (v_subtotal-v_discount)/v_subtotal end;

  select coalesce(round(sum((p.price-p.cost)*x.quantity*v_ratio),2),0) into v_profit
  from (
    select product_id,sum(quantity)::integer as quantity
    from jsonb_to_recordset(p_items) as x(product_id uuid,quantity integer,expected_price numeric)
    group by product_id
  ) x join public.arr_products p on p.id=x.product_id and p.shop_id=v_shop;

  insert into public.arr_sales(shop_id,created_by,customer,payment_method,subtotal,discount,tax_rate,tax,total,gross_profit)
    values(v_shop,v_uid,trim(coalesce(p_customer,'')),p_payment_method,v_subtotal,v_discount,p_tax_rate,v_tax,v_total,v_profit)
    returning * into v_sale;

  for v_item in
    select (value->>'product_id')::uuid as product_id,sum((value->>'quantity')::integer)::integer as quantity
    from jsonb_array_elements(p_items) group by (value->>'product_id')::uuid
  loop
    select * into v_product from public.arr_products where id=v_item.product_id and shop_id=v_shop;
    v_qty := v_item.quantity;
    insert into public.arr_sale_items(sale_id,shop_id,product_id,item_name,quantity,unit_price,unit_cost,line_total,line_profit)
      values(v_sale.id,v_shop,v_product.id,v_product.name,v_qty,v_product.price,v_product.cost,
        round(v_product.price*v_qty,2),round((v_product.price-v_product.cost)*v_qty*v_ratio,2));
  end loop;

  return jsonb_build_object('id',v_sale.id,'receipt_no',v_sale.receipt_no,'subtotal',v_sale.subtotal,
    'discount',v_sale.discount,'tax',v_sale.tax,'tax_rate',v_sale.tax_rate,'total',v_sale.total,
    'profit',case when public.arr_is_shop_owner() then v_sale.gross_profit else null end,
    'created_at',v_sale.created_at);
end;
$$;

revoke all on function public.arr_update_shop_settings(text,text,numeric,text) from public,anon;
revoke all on function public.arr_update_staff_name(uuid,text) from public,anon;
revoke all on function public.arr_remove_staff(uuid) from public,anon;
revoke all on function public.arr_get_shop_settings() from public,anon;
grant execute on function public.arr_get_shop_settings(),
  public.arr_update_shop_settings(text,text,numeric,text),
  public.arr_update_staff_name(uuid,text),public.arr_remove_staff(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
