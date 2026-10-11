# ARR-Proto

ARR-Proto is a cloud-backed point-of-sale app for a small counter selling juices, prepared food, packaged goods, gifts, and other items. The browser app uses Supabase Auth and Postgres. Each shop's data is protected by database Row Level Security; a sale and its stock deductions are committed together.

## Publish and connect ARR-Proto

1. Publish the files in this folder on GitHub Pages. Keep `index.html`, `config.js`, `cloud.js`, and `workflow.js` together at the published folder's top level.
2. The published `index.html` includes the ARR-Proto Supabase URL and publishable key, so the app connects automatically on phones, tablets, and computers. `config.js` is also included as a fallback. These are public browser credentials; never put a `service_role` or secret key in this app or repository.
3. The existing ARR-Proto schema and inventory upgrade are already installed. Run [`supabase/username_auth.sql`](supabase/username_auth.sql) once in the Supabase SQL Editor to create the private username mapping table.
4. Deploy the `username-login` and `claim-username` Edge Functions from [`supabase/functions`](supabase/functions) to the same Supabase project. Both functions validate their requests internally, so turn off the Dashboard's **Verify JWT** gateway setting for each; `claim-username` verifies the signed-in user's token itself. The functions use Supabase's built-in server-side service-role secret. Never copy that secret into GitHub or the browser.
5. In **Supabase → Authentication → URL Configuration → Redirect URLs**, allow your GitHub Pages app URL (for example, `https://talesnframesofficial-alt.github.io/ARR-Proto/**`). This is used for email confirmation and password recovery.
6. Open the HTTPS GitHub Pages site. When creating an account, enter a recovery email, choose a username and password, and create the owner shop. Later sign-ins use username and password. Each staff member should have their own account and username, and join with the shop's staff code.

The published project settings take priority over browser-saved settings, so an old value on a phone or tablet cannot override the ARR-Proto connection. The cloud script URL is versioned to avoid stale browser copies. Upload the complete package contents together, with `index.html` at the GitHub Pages publishing root.

For an account created before username sign-in was enabled, sign in once with its recovery email and password, choose a username when prompted, then use that username for later sign-ins.

## Shop workflows

- Search and filter products, build bills, apply discounts, configure tax, and record cash, UPI, or card payments.
- Print receipts; completed bills, item costs, profit, staff attribution, and stock deductions are saved in the cloud.
- Owners can add, edit, rename, and archive categories and products; record supplier purchase bills that receive stock and update average cost; adjust stock; review stock history; and see date-filtered sales and product-performance reports.
- Export sales as CSV and export cloud data as JSON. Import a catalogue without overwriting past sales.
- Staff accounts can bill. Database policies enforce shop membership and owner-only product, stock, and settings changes.

The app records the payment method; it does not initiate UPI transfers or process card payments. The counter still collects payment through its existing provider or terminal.

## Local development

Serve this folder over HTTP or HTTPS and open `index.html`. Browsers generally restrict cloud sign-in from a `file://` URL. Configure the app with a Supabase project before use. The sample catalogue is only illustrative; import or enter the counter's real products and purchase costs.

## Add many products at once

Download `product-import-template.csv`, open it in Excel or Google Sheets, and add one product per row. Keep the header names unchanged. `category`, `name`, and `selling_price` are required; `purchase_cost`, `opening_stock`, and `emoji` are optional. Leave opening stock blank if you do not track it yet. Save or download as CSV, then use **Reports → Import products CSV**. New categories are created automatically, existing products are not overwritten, and the import reports any invalid rows before adding them.

Example row: `Juices,Mango Juice,80,35,12,🥭`

A priced starter list of juices, shakes, food, dry fruits and nuts, toy cars, and imported chocolates is in `starter-products.csv`. Review the suggested selling prices for your portions and suppliers before importing. Add actual purchase costs and opening stock when available; profit reports depend on accurate item costs.
