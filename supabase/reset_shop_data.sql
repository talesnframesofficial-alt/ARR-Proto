-- ARR-Proto full shop data reset.
-- This permanently deletes all bills, bill items, shop settings, products,
-- categories, purchase records, stock records, and login-name mappings.
-- It does not delete Authentication users or database tables/functions.
-- After this runs, delete the old users in Supabase Authentication > Users,
-- then create ONE new Owner user there and sign in with that email/password.
-- The app will prompt you to create the Tribe shop again.
begin;

delete from public.arr_sale_items;
delete from public.arr_sales;
delete from public.arr_purchase_items;
delete from public.arr_purchases;
delete from public.arr_stock_movements;
delete from public.arr_categories;
delete from public.arr_products;
delete from public.arr_login_names;
delete from public.arr_profiles;
delete from public.arr_shops;

commit;
