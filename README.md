# ARR-Proto

ARR-Proto is a cloud-backed point-of-sale app for a small counter selling juices, prepared food, packaged goods, gifts, and other items. The browser app uses Supabase Auth and Postgres. Each shop's data is protected by database Row Level Security; a sale and its stock deductions are committed together.

## Publish and connect ARR-Proto

1. Publish the files in this folder on GitHub Pages. Keep `index.html`, `config.js`, `cloud.js`, and `workflow.js` together at the published folder's top level.
2. `config.js` is preconfigured for the ARR-Proto Supabase project. It contains only the project's publishable key, which is designed for browser use when the database Row Level Security policies are enabled. Never put a `service_role` or secret key in this app or repository.
3. The ARR-Proto database schema and inventory upgrade have already been installed in this project. If setting up a different Supabase project, run [`supabase/schema.sql`](supabase/schema.sql), then run [`supabase/upgrade_products_inventory.sql`](supabase/upgrade_products_inventory.sql) in the Supabase SQL Editor.
4. Open the HTTPS GitHub Pages site. Create an account, then create the owner shop. The owner can share the generated staff join code; each staff member creates their own account and joins with that code.

Supabase project values are also saved in the browser after first connection. This package includes `config.js`, so the hosted app connects automatically on new browsers and devices.

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
