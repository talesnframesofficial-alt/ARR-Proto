/* Owner workflows for editable product categories, inventory, and supplier bills. */
let manageCategory = 'All categories';
let purchaseLineCount = 0;

function parseProductsCSV(source) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  const text = source.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell === '') quoted = true;
    else if (char === ',') { row.push(cell.trim()); cell = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(cell.trim());
      if (row.some(value => value !== '')) rows.push(row);
      row = []; cell = '';
    } else cell += char;
  }
  row.push(cell.trim());
  if (row.some(value => value !== '')) rows.push(row);
  if (quoted) throw new Error('The CSV has an opening quote without a closing quote.');
  if (rows.length < 2) throw new Error('Add at least one product row beneath the header.');
  const headers = rows.shift().map(value => value.trim().toLowerCase());
  const required = ['category', 'name', 'selling_price'];
  const missing = required.filter(name => !headers.includes(name));
  if (missing.length) throw new Error(`CSV is missing required columns: ${missing.join(', ')}.`);
  const column = name => headers.indexOf(name);
  const productsToImport = [];
  const issues = [];
  rows.forEach((row, index) => {
    const name = row[column('name')]?.trim();
    const cat = row[column('category')]?.trim() || 'Other';
    const priceRaw = row[column('selling_price')]?.trim();
    const costRaw = column('purchase_cost') < 0 ? '' : (row[column('purchase_cost')] || '').trim();
    const stockRaw = column('opening_stock') < 0 ? '' : (row[column('opening_stock')] || '').trim();
    const price = Number(priceRaw), cost = costRaw === '' ? 0 : Number(costRaw);
    const stock = stockRaw === '' ? null : Number(stockRaw);
    const line = index + 2;
    if (!name) issues.push(`Line ${line}: item name is required.`);
    else if (name.length > 160) issues.push(`Line ${line}: item name must be 160 characters or fewer.`);
    else if (!priceRaw || !Number.isFinite(price) || price < 0) issues.push(`Line ${line}: selling_price must be a valid non-negative number.`);
    else if (!Number.isFinite(cost) || cost < 0) issues.push(`Line ${line}: purchase_cost must be blank or a non-negative number.`);
    else if (stock !== null && (!Number.isInteger(stock) || stock < 0)) issues.push(`Line ${line}: opening_stock must be blank or a whole number of 0 or more.`);
    else if (cat.length > 80 || cat.toLowerCase() === 'all items') issues.push(`Line ${line}: choose a category name up to 80 characters.`);
    else productsToImport.push({ name, category:cat, price, cost, stock, emoji:row[column('emoji')]?.trim() || '📦', active:true });
  });
  if (issues.length) throw new Error(`Please fix these CSV rows and try again:\n${issues.slice(0, 8).join('\n')}${issues.length > 8 ? `\n…and ${issues.length - 8} more issue(s).` : ''}`);
  return productsToImport;
}

window.importProductsCSV = async function (input) {
  if (activeRole !== 'Owner') { input.value = ''; return toast('Owner access required'); }
  const file = input.files?.[0];
  if (!file) return;
  try {
    const rows = parseProductsCSV(await file.text());
    if (!confirm(`Import ${rows.length} products? Existing products will stay as they are.`)) return;
    const existing = new Set(cats.filter(name => name !== 'All items').map(name => name.toLowerCase()));
    for (const name of [...new Set(rows.map(item => item.category))]) {
      if (existing.has(name.toLowerCase())) continue;
      const { error } = await window.arrCloud.createCategory(name);
      if (error) throw error;
      existing.add(name.toLowerCase());
    }
    const { error } = await window.arrCloud.importProducts(rows);
    if (error) throw error;
    await window.arrCloud.refresh();
    toast(`${rows.length} products imported`);
  } catch (error) {
    toast(error.message || 'Could not import this CSV');
  } finally {
    input.value = '';
  }
};

function populateCategorySelect(selected) {
  const select = document.getElementById('newCat');
  if (!select) return;
  const options = cats.filter(name => name !== 'All items');
  select.innerHTML = options.map(name => `<option value="${esc(name)}">${esc(name)}</option>`).join('');
  if (selected && options.includes(selected)) select.value = selected;
  else if (options.length && !options.includes(select.value)) select.value = options[0];
}

function renderCategoryAdmin() {
  const container = document.getElementById('categoryAdminList');
  if (!container) return;
  const names = cats.filter(name => name !== 'All items');
  container.innerHTML = `<button class="cat ${manageCategory === 'All categories' ? 'active' : ''}" onclick="setManageCategory('All categories')">All categories</button>` + names.map((name, index) => `
    <span class="category-admin-chip"><button onclick="setManageCategoryByIndex(${index})">${esc(name)}</button>
    <button title="Rename ${esc(name)}" aria-label="Rename ${esc(name)} category" onclick="renameCategory(${index})">✎</button>
    ${name.toLowerCase() === 'other' ? '' : `<button title="Archive ${esc(name)}" aria-label="Archive ${esc(name)} category" onclick="archiveCategory(${index})">×</button>`}</span>`).join('');
}

function setManageCategory(name) {
  manageCategory = name;
  renderProductManager();
}
function setManageCategoryByIndex(index) { setManageCategory(cats.filter(name => name !== 'All items')[index]); }

function renderProductManager() {
  populateCategorySelect();
  renderCategoryAdmin();
  const list = document.getElementById('productManageList');
  if (!list) return;
  const visible = products.filter(p => manageCategory === 'All categories' || p.cat === manageCategory);
  list.className = 'manage-list';
  list.innerHTML = visible.map(p => `<div class="manage-item"><div><span class="manage-title">${esc(p.name)}</span><small style="display:block;color:var(--muted)">${esc(p.cat || 'Other')} · ${money(p.price)} · stock ${p.stock == null || p.stock === '' ? 'not tracked' : p.stock}${p.active === false ? ' · archived' : ''}</small></div><div class="manage-actions"><button onclick="editItemById('${esc(p.id)}')">Edit</button><button onclick="toggleArchiveById('${esc(p.id)}')">${p.active === false ? 'Restore' : 'Archive'}</button></div></div>`).join('') || '<small>No items in this category yet.</small>';
}

window.openManage = function () {
  if (activeRole !== 'Owner') return toast('Product management is available to the owner');
  editingItemId = null;
  manageCategory = 'All categories';
  document.getElementById('manageTitle').textContent = 'Products';
  ['newName','newPrice','newCost','newEmoji','newStock'].forEach(id => document.getElementById(id).value = '');
  populateCategorySelect();
  renderProductManager();
  document.getElementById('manage').classList.add('show');
};
window.editItemById = function (id) {
  const p = products.find(item => String(item.id) === String(id));
  if (!p) return;
  editingItemId = p.id;
  document.getElementById('manageTitle').textContent = 'Edit item';
  populateCategorySelect(p.cat);
  document.getElementById('newName').value = p.name;
  document.getElementById('newPrice').value = p.price;
  document.getElementById('newCost').value = p.cost || 0;
  document.getElementById('newEmoji').value = p.emoji || '';
  document.getElementById('newStock').value = p.stock ?? '';
  document.getElementById('productManageList').scrollTop = 0;
};
window.toggleArchiveById = function (id) { toggleArchive(id); };

window.addCategory = async function () {
  if (activeRole !== 'Owner') return toast('Owner access required');
  const input = document.getElementById('newCategoryName');
  const name = input.value.trim();
  if (!name) return toast('Enter a category name');
  const { error } = await window.arrCloud.createCategory(name);
  if (error) return toast(error.message);
  input.value = '';
  await window.arrCloud.refresh();
  toast('Category added');
};
window.renameCategory = async function (index) {
  if (activeRole !== 'Owner') return toast('Owner access required');
  const oldName = cats.filter(name => name !== 'All items')[index];
  if (!oldName) return;
  const nextName = prompt(`Rename “${oldName}” to:`, oldName);
  if (nextName === null) return;
  const clean = nextName.trim();
  if (!clean) return toast('Enter a category name');
  const { error } = await window.arrCloud.renameCategory(oldName, clean);
  if (error) return toast(error.message);
  await window.arrCloud.refresh();
  if (category === oldName) { category = clean; renderCats(); renderProducts(); }
  if (manageCategory === oldName) manageCategory = clean;
  renderProductManager();
  toast('Category renamed');
};
window.archiveCategory = async function (index) {
  if (activeRole !== 'Owner') return toast('Owner access required');
  const name = cats.filter(item => item !== 'All items')[index];
  if (!name || !confirm(`Archive “${name}”? Active items must be moved or archived first.`)) return;
  const { error } = await window.arrCloud.archiveCategory(name);
  if (error) return toast(error.message);
  if (category === name) category = 'All items';
  if (manageCategory === name) manageCategory = 'All categories';
  await window.arrCloud.refresh();
  toast('Category archived');
};

function purchaseProductOptions() {
  return products.filter(p => p.active !== false).map(p => `<option value="${esc(p.id)}">${esc(p.name)} · ${esc(p.cat || 'Other')}</option>`).join('');
}
function updatePurchaseTotal() {
  const total = [...document.querySelectorAll('.purchase-line')].reduce((sum, row) => {
    const qty = Number(row.querySelector('[data-qty]').value || 0);
    const cost = Number(row.querySelector('[data-cost]').value || 0);
    return sum + qty * cost;
  }, 0);
  document.getElementById('purchaseTotal').textContent = money(total);
}
window.addPurchaseLine = function (preset = {}) {
  const row = document.createElement('div');
  row.className = 'purchase-line';
  row.dataset.line = String(++purchaseLineCount);
  row.innerHTML = `<select data-product aria-label="Purchase item"><option value="">Select item</option>${purchaseProductOptions()}</select><input data-qty type="number" min="1" step="1" placeholder="Qty" aria-label="Quantity"><input data-cost type="number" min="0" step="0.01" placeholder="Unit cost ₹" aria-label="Purchase cost"><button type="button" title="Remove line" aria-label="Remove purchase line">×</button>`;
  const select = row.querySelector('[data-product]');
  const qty = row.querySelector('[data-qty]');
  const cost = row.querySelector('[data-cost]');
  select.value = preset.productId || '';
  qty.value = preset.quantity || '';
  cost.value = preset.unitCost ?? '';
  select.addEventListener('change', () => {
    const product = products.find(p => String(p.id) === select.value);
    if (product && cost.value === '') cost.value = Number(product.cost || 0).toFixed(2);
    updatePurchaseTotal();
  });
  qty.addEventListener('input', updatePurchaseTotal);
  cost.addEventListener('input', updatePurchaseTotal);
  row.querySelector('button').addEventListener('click', () => { row.remove(); updatePurchaseTotal(); });
  document.getElementById('purchaseLines').appendChild(row);
  if (!preset.productId && products.filter(p => p.active !== false).length) {
    select.value = products.find(p => p.active !== false).id;
    const first = products.find(p => p.active !== false);
    if (cost.value === '') cost.value = Number(first.cost || 0).toFixed(2);
  }
  updatePurchaseTotal();
};

function renderPurchaseHistory() {
  const body = document.getElementById('purchaseHistoryRows');
  if (!body) return;
  body.innerHTML = purchaseLog.length ? purchaseLog.map(p => `<tr><td>#${p.receipt_no}</td><td>${esc(p.supplier)}</td><td>${esc(p.invoice_no || '—')}</td><td>${new Date(p.created_at).toLocaleString()}</td><td>${esc(p.payment_method)}</td><td>${money(p.total)}</td></tr>`).join('') : '<tr><td colspan="6">No purchase bills recorded yet.</td></tr>';
}
window.openPurchases = function () {
  if (activeRole !== 'Owner') return toast('Purchases are available to the owner');
  openPurchaseModal();
};
window.openPurchaseModal = function () {
  if (activeRole !== 'Owner') return toast('Owner access required');
  document.getElementById('purchaseSupplier').value = '';
  document.getElementById('purchaseInvoice').value = '';
  document.getElementById('purchasePayment').value = 'Cash';
  document.getElementById('purchaseLines').innerHTML = '';
  purchaseLineCount = 0;
  addPurchaseLine();
  renderPurchaseHistory();
  document.getElementById('purchaseModal').classList.add('show');
};
window.closePurchaseModal = function () { document.getElementById('purchaseModal').classList.remove('show'); };
window.savePurchaseBill = async function () {
  if (activeRole !== 'Owner') return toast('Owner access required');
  const supplier = document.getElementById('purchaseSupplier').value.trim();
  if (!supplier) return toast('Enter the supplier name');
  const lines = [...document.querySelectorAll('.purchase-line')].map(row => ({
    product_id: row.querySelector('[data-product]').value,
    quantity: Number(row.querySelector('[data-qty]').value),
    unit_cost: Number(row.querySelector('[data-cost]').value)
  })).filter(line => line.product_id);
  if (!lines.length) return toast('Add at least one item to the purchase bill');
  if (lines.some(line => !Number.isInteger(line.quantity) || line.quantity < 1 || !Number.isFinite(line.unit_cost) || line.unit_cost < 0)) return toast('Enter a whole quantity and valid unit cost for every item');
  const result = await window.arrCloud.recordPurchase({
    p_supplier: supplier,
    p_invoice_no: document.getElementById('purchaseInvoice').value.trim(),
    p_payment_method: document.getElementById('purchasePayment').value,
    p_items: lines
  });
  if (result.error) return toast(result.error.message);
  await window.arrCloud.refresh();
  closePurchaseModal();
  closeStock();
  toast(`Purchase bill #${result.data.receipt_no} saved · stock received`);
};

populateCategorySelect();
