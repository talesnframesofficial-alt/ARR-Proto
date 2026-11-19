# ARR-Proto

ARR-Proto is a cloud-backed, single-owner counter billing app for juices, prepared food, packaged goods, gifts, and other products. Sign in with the Tribe shop Owner's email or username `owner`, plus that account's password. Email sign-in checks the password directly with Supabase Auth, so it works even if the optional username Edge Function has not been redeployed. The password is not embedded in the website files. Password reset must be requested for the email attached to the Tribe Owner account; the email signed into the phone browser is unrelated.

## Publish and connect ARR-Proto

1. Upload the contents of this folder to the root of the `ARR-Proto` GitHub repository. Keep `index.html`, `config.js`, `cloud.js`, and `workflow.js` together at the published root.
2. The app includes its Supabase project URL and publishable key and connects automatically. These are public browser credentials; never put a `service_role` or secret key in the app or repository.
3. The existing ARR-Proto schema is already installed. The owner login is resolved from the `Tribe` shop profile, so the unused `Chai Tribe` Owner account is not selected by mistake. The login accepts the Tribe Owner's email or `owner` (also `tribe` and any username saved on that account).
4. If it has not already been run, run `supabase/remove_inventory.sql` once in the Supabase SQL Editor. It disables stock checks and stock deductions on new bills and keeps the current product, sale, and cost data. It also enables shop address settings.
5. For username sign-in, deploy `username-login` from `supabase/functions/username-login/index.ts`; it resolves the Owner account for the `Tribe` shop. Keep `verify_jwt = false` as set in `supabase/config.toml`. Email sign-in does not require this function. Allow your GitHub Pages app URL as a redirect URL in Supabase Authentication settings.
6. Open the HTTPS GitHub Pages site and enter the Tribe Owner email or username (`owner`) and its password. The session stays signed in on that device. Bills and product changes sync immediately, and the app refreshes cloud data every 45 seconds. If you forget the password, select **Forgot owner password?** and enter the Tribe Owner account recovery email to receive a secure reset link.

## Full account and shop reset

If you intentionally want to start over, run `supabase/reset_shop_data.sql` in the Supabase SQL Editor. It permanently deletes all sales and bill lines, purchases, products, categories, shop/profile records, and username mappings. It keeps the database schema and functions. Then delete the old users under Supabase **Authentication → Users**, create one new Owner user there with a password you choose, and sign in to ARR-Proto with that email and password. The app will prompt you to create the `Tribe` shop again and seeds the starter catalogue. The old sales and catalogue cannot be recovered unless you exported them first.

Do not run `recipe_inventory_units.sql` for this version. The app no longer uses ingredient recipes, stock tracking, or supplier purchase bills. Existing database stock and purchase records are left untouched; the app hides them, and new sales no longer read or change stock balances.

## Shop workflows

- Build bills, apply discounts, configure tax, and record cash, UPI, or card payments.
- Print receipts showing the shop name and address. Bills, item costs, profit, and staff attribution are saved in the cloud.
- The owner can add, edit, rename, and archive categories and products; import a large product catalogue by CSV; and review date-filtered sales and product-performance reports.
- Profit reports use each product's cost per item. Enter or update that cost in the Products screen so profit figures are meaningful.
- Database policies continue to protect shop data and owner-only catalogue and settings changes.

The app records the payment method; it does not initiate UPI transfers or process card payments. The counter collects payment through its existing provider or terminal.

## Add many products at once

Download `product-import-template.csv`, open it in Excel or Google Sheets, and add one product per row. Keep the headers unchanged. `category`, `name`, and `selling_price` are required; `cost_per_item` and `emoji` are optional. The template includes a sample row; replace it or remove it before importing. Save as CSV, then use **Reports → Import products CSV**. New categories are created automatically, existing products are not overwritten, and invalid rows are reported before import.

A starter catalogue of juices, shakes, food, dry fruits and nuts, toy cars, and imported chocolates is in `starter-products.csv`. Review the suggested selling prices and item costs before importing.

## Local development

Serve this folder over HTTP or HTTPS and open `index.html`. Browsers generally restrict cloud sign-in from a `file://` URL.
