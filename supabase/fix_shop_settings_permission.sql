-- Allow signed-in ARR-Proto users to call the shop settings RPC.
-- The function checks auth.uid() and returns only that user's shop settings.
revoke all on function public.arr_get_shop_settings() from public, anon;
grant execute on function public.arr_get_shop_settings() to authenticated;
notify pgrst, 'reload schema';
