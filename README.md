# ARR-Proto

ARR-Proto is a cloud-backed, single-owner counter billing app for juices, prepared food, packaged goods, gifts, and other products. The sign-in screen asks only for the owner password; the app uses the existing `owner` account behind the scenes. The password is stored by Supabase Authentication and is not embedded in the website files.

## Publish and connect ARR-Proto

1. Upload the contents of this folder to the root of the `ARR-Proto` GitHub repository. Keep `index.html`, `config.js`, `cloud.js`, and `workflow.js` together at the published root.
2. The app includes its Supabase project URL and publishable key and connects automatically. These are public browser credentials; never put a `service_role` or secret key in the app or repository.
3. The existing ARR-Proto schema is already installed. Run `supabase/username_auth.sql` only if username sign-in was not set up earlier.
4. If it has not already been run, run `supabase/remove_inventory.sql` once in the Supabase SQL Editor. It disables stock checks and stock deductions on new bills and keeps the current product, sale, and cost data. It also enables shop address settings.
5. Deploy the `username-login` and `claim-username` Edge Functions from `supabase/functions` if they are not already deployed. In Supabase Authentication settings, allow your GitHub Pages app URL as a redirect URL.
6. Open the HTTPS GitHub Pages site and enter the password for the existing `owner` account. The session stays signed in on that device. Bills and product changes sync immediately, and the app refreshes cloud data every 45 seconds. If the shop has no products yet, the starter catalogue is added automatically at first owner sign-in. If you forget the password, select **Forgot owner password?** and enter the owner account recovery email to receive a secure reset link.

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
