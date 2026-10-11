# ARR-Proto

ARR-Proto is a cloud-backed point-of-sale app for a small counter selling juices, prepared food, packaged goods, gifts, and other items. The browser app uses Supabase Auth and Postgres. Each shop's data is protected by database Row Level Security; a sale and its stock deductions are committed together.

## Set up the cloud project

1. Use the Supabase project you already have, if it is one you control. ARR-Proto uses its own `arr_`-prefixed tables and functions to reduce the chance of conflicts with other apps. If you create a separate project, choose a region close to the counter and save the database password.
2. Open the project's **SQL Editor**, create a new query, paste all of [`supabase/schema.sql`](supabase/schema.sql), and run it once. This creates the `arr_`-prefixed shop, user, product, sale, sale-item, stock-movement, category, and purchase tables with their access policies. If the base schema is already installed, run [`supabase/upgrade_products_inventory.sql`](supabase/upgrade_products_inventory.sql) once to add category management and purchase receiving. The ARR-Proto project has this upgrade installed.
3. In the project settings, copy the **Project URL** and **publishable key** (or legacy `anon` key). In ARR-Proto, paste those into the cloud connection screen. Never use a `service_role` or secret key in the browser.
4. Open the app from an HTTPS web host. After signing in, create the owner shop. Share the generated staff join code with staff; each staff member creates their own account and joins with that code.

Supabase project values are stored in this browser. For a preconfigured local copy, duplicate `config.js.example` as `config.js` and fill in the same URL and publishable key. `config.js` is intentionally ignored by Git.

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

A starter list of juices, shakes, food, dry fruits and nuts, toy cars, and imported chocolates is in `starter-products.csv`. Fill its selling prices before importing; purchase costs and opening stock can be filled when available.
