/* Owner workflows for editable product categories, measured inventory, recipes, and supplier bills. */
const inventoryFactors = { each:1, g:1, kg:1000, ml:1, L:1000 };
function inventoryOptions(base) { return base==='g'?['g','kg']:base==='ml'?['ml','L']:['each']; }
function inventoryFactor(unit) { return inventoryFactors[unit]||1; }
function inventoryAmountToBase(amount,unit) { return Math.round(Number(amount)*inventoryFactor(unit)*1000)/1000; }
function inventoryBaseCost(cost,unit) { return Number(cost)/inventoryFactor(unit); }
function formatInventory(amount,unit='each') {
  if(amount==null||amount==='')return 'not tracked';
  const n=Number(amount),tidy=x=>Number(x.toFixed(3)).toLocaleString();
  if(unit==='g'&&n>=1000)return `${tidy(n/1000)} kg`;
  if(unit==='ml'&&n>=1000)return `${tidy(n/1000)} L`;
  return `${tidy(n)} ${unit==='each'?'each':unit}`;
}
let manageCategory='All categories';
let purchaseLineCount=0;
let recipeProductId=null;

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
    const unitRaw = column('stock_unit') < 0 ? 'each' : ((row[column('stock_unit')] || '').trim().toLowerCase() || 'each');
    const sellableRaw = column('is_sellable') < 0 ? 'true' : ((row[column('is_sellable')] || '').trim().toLowerCase() || 'true');
    const price = Number(priceRaw), cost = costRaw === '' ? 0 : Number(costRaw);
    const stock = stockRaw === '' ? null : Number(stockRaw);
    const line = index + 2;
    if (!name) issues.push(`Line ${line}: item name is required.`);
    else if (name.length > 160) issues.push(`Line ${line}: item name must be 160 characters or fewer.`);
    else if (!priceRaw || !Number.isFinite(price) || price < 0) issues.push(`Line ${line}: selling_price must be a valid non-negative number.`);
    else if (!Number.isFinite(cost) || cost < 0) issues.push(`Line ${line}: purchase_cost must be blank or a non-negative number.`);
    else if (stock !== null && (!Number.isFinite(stock) || stock < 0 || stock !== Math.round(stock*1000)/1000)) issues.push(`Line ${line}: opening_stock must be non-negative with up to 3 decimals.`);
    else if (!['each','g','ml'].includes(unitRaw)) issues.push(`Line ${line}: stock_unit must be each, g, or ml.`);
    else if (!['true','yes','1','false','no','0'].includes(sellableRaw)) issues.push(`Line ${line}: is_sellable must be true or false.`);
    else if (cat.length > 80 || cat.toLowerCase() === 'all items') issues.push(`Line ${line}: choose a category name up to 80 characters.`);
    else productsToImport.push({ name, category:cat, price, cost, stock, stock_unit:unitRaw, is_sellable:!['false','no','0'].includes(sellableRaw), emoji:row[column('emoji')]?.trim() || '📦', active:true });
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
  list.innerHTML = visible.map(p => {
    const recipe=(window.productRecipes||[]).filter(r=>String(r.product_id)===String(p.id));
    const inventoryText=recipe.length?`Recipe: ${recipe.length} ingredient${recipe.length===1?'':'s'}`:`stock ${formatInventory(p.stock,p.stock_unit||'each')}`;
    return `<div class="manage-item"><div><span class="manage-title">${esc(p.name)}</span><small style="display:block;color:var(--muted)">${esc(p.cat||'Other')} · ${money(p.price)} · ${inventoryText}${p.sellable===false?' · ingredient only':''}${p.active===false?' · archived':''}</small></div><div class="manage-actions"><button onclick="editItemById('${esc(p.id)}')">Edit</button>${p.sellable===false?'':`<button onclick="openRecipeEditor('${esc(p.id)}')">Recipe</button>`}<button onclick="toggleArchiveById('${esc(p.id)}')">${p.active===false?'Restore':'Archive'}</button></div></div>`;
  }).join('') || '<small>No items in this category yet.</small>';
}

window.openManage = function () {
  if (activeRole !== 'Owner') return toast('Product management is available to the owner');
  editingItemId = null;
  manageCategory = 'All categories';
  document.getElementById('manageTitle').textContent = 'Products';
  ['newName','newPrice','newCost','newEmoji','newStock'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('newStockUnit').value='each'; document.getElementById('newSellable').checked=true;
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
  document.getElementById('newStockUnit').value=p.stock_unit||'each'; document.getElementById('newSellable').checked=p.sellable!==false;
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
  return products.filter(p => p.active !== false).map(p => `<option value="${esc(p.id)}">${esc(p.name)} · ${esc(p.cat||'Other')} (${esc(p.stock_unit||'each')})</option>`).join('');
}
function setPurchaseUnits(row,product,selected='') {
  const select=row.querySelector('[data-unit]');
  const units=inventoryOptions(product?.stock_unit||'each');
  select.innerHTML=units.map(unit=>`<option value="${unit}">${unit}</option>`).join('');
  select.value=units.includes(selected)?selected:(units.includes('kg')?'kg':units.includes('L')?'L':units[0]);
  row.querySelector('[data-cost]').placeholder=`Cost per ${select.value} ₹`;
  select.onchange=()=>{row.querySelector('[data-cost]').placeholder=`Cost per ${select.value} ₹`;updatePurchaseTotal();};
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
  row.innerHTML = `<select data-product aria-label="Purchase item"><option value="">Select item</option>${purchaseProductOptions()}</select><input data-qty type="number" min="0.001" step="0.001" placeholder="Qty" aria-label="Quantity"><select data-unit aria-label="Purchase unit"></select><input data-cost type="number" min="0" step="0.0001" placeholder="Cost per unit ₹" aria-label="Cost per selected unit"><button type="button" title="Remove line" aria-label="Remove purchase line">×</button>`;
  const select=row.querySelector('[data-product]'),qty=row.querySelector('[data-qty]'),unit=row.querySelector('[data-unit]'),cost=row.querySelector('[data-cost]');
  select.value=preset.productId||'';
  const initial=products.find(p=>String(p.id)===select.value);
  if(initial)setPurchaseUnits(row,initial,preset.unit||'');
  qty.value=preset.quantity||'';
  cost.value=preset.unitCost??'';
  select.addEventListener('change',()=>{
    const product=products.find(p=>String(p.id)===select.value);
    if(!product)return;
    setPurchaseUnits(row,product);
    if(cost.value==='')cost.value=(Number(product.cost||0)*inventoryFactor(unit.value)).toFixed(4);
    updatePurchaseTotal();
  });
  unit.addEventListener('change',updatePurchaseTotal);
  qty.addEventListener('input',updatePurchaseTotal);
  cost.addEventListener('input',updatePurchaseTotal);
  row.querySelector('button').addEventListener('click', () => { row.remove(); updatePurchaseTotal(); });
  document.getElementById('purchaseLines').appendChild(row);
  if (!preset.productId && products.filter(p => p.active !== false).length) {
    select.value = products.find(p => p.active !== false).id;
    const first = products.find(p => p.active !== false);
    setPurchaseUnits(row,first);
    if (cost.value === '') cost.value = (Number(first.cost || 0)*inventoryFactor(row.querySelector('[data-unit]').value)).toFixed(4);
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
  const lines=[...document.querySelectorAll('.purchase-line')].map(row=>{
    const qty=Number(row.querySelector('[data-qty]').value),unit=row.querySelector('[data-unit]').value;
    const enteredCost=Number(row.querySelector('[data-cost]').value);
    return {product_id:row.querySelector('[data-product]').value,quantity:inventoryAmountToBase(qty,unit),unit_cost:inventoryBaseCost(enteredCost,unit),_enteredQty:qty,_enteredCost:enteredCost};
  }).filter(line=>line.product_id);
  if(!lines.length)return toast('Add at least one item to the purchase bill');
  if(lines.some(line=>!Number.isFinite(line._enteredQty)||line._enteredQty<=0||line._enteredQty!==Math.round(line._enteredQty*1000)/1000||!Number.isFinite(line._enteredCost)||line._enteredCost<0))return toast('Enter a positive quantity (up to 3 decimals) and a valid unit cost for every item');
  for(const line of lines){delete line._enteredQty;delete line._enteredCost;}
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


function recipeIngredientOptions(productId) {
  return products.filter(p=>p.active!==false&&String(p.id)!==String(productId))
    .map(p=>`<option value="${esc(p.id)}">${esc(p.name)} · ${esc(p.stock_unit||'each')}</option>`).join('');
}
function setRecipeRowUnits(row,product,selected='') {
  const unit=row.querySelector('[data-recipe-unit]'),options=inventoryOptions(product?.stock_unit||'each');
  unit.innerHTML=options.map(x=>`<option value="${x}">${x}</option>`).join('');
  unit.value=options.includes(selected)?selected:(options.includes('kg')?'kg':options.includes('L')?'L':options[0]);
}
window.addRecipeRow=function(component={}) {
  const row=document.createElement('div');row.className='recipe-row';
  row.innerHTML=`<select data-ingredient aria-label="Ingredient"><option value="">Choose ingredient</option>${recipeIngredientOptions(recipeProductId)}</select><input data-recipe-qty type="number" min="0.001" step="0.001" placeholder="Amount"><select data-recipe-unit aria-label="Ingredient unit"></select><button type="button" class="close" aria-label="Remove ingredient">×</button>`;
  const select=row.querySelector('[data-ingredient]'),product=products.find(p=>String(p.id)===String(component.ingredient_product_id));
  select.value=component.ingredient_product_id||'';
  if(product)setRecipeRowUnits(row,product,component.unit||'');
  else {const first=products.find(p=>p.active!==false&&String(p.id)!==String(recipeProductId));if(first){select.value=first.id;setRecipeRowUnits(row,first);}else setRecipeRowUnits(row,null);}
  row.querySelector('[data-recipe-qty]').value=component.entered_quantity??'';
  select.addEventListener('change',()=>{const p=products.find(x=>String(x.id)===select.value);if(p)setRecipeRowUnits(row,p);});
  row.querySelector('button').addEventListener('click',()=>row.remove());
  document.getElementById('recipeRows').appendChild(row);
};
window.openRecipeEditor=async function(productId) {
  if(activeRole!=='Owner')return toast('Owner access required');
  recipeProductId=productId;
  const product=products.find(p=>String(p.id)===String(productId));
  if(!product)return toast('Product not found');
  document.getElementById('recipeProductName').textContent=product.name;
  document.getElementById('recipeRows').innerHTML='';
  const components=(window.productRecipes||[]).filter(r=>String(r.product_id)===String(productId));
  for(const component of components) {
    const ingredient=products.find(p=>String(p.id)===String(component.ingredient_product_id));
    const base=ingredient?.stock_unit||'each';
    const unit=base==='g'&&component.quantity_per_sale>=1000?'kg':base==='ml'&&component.quantity_per_sale>=1000?'L':base;
    window.addRecipeRow({...component,unit,entered_quantity:Number((component.quantity_per_sale/inventoryFactor(unit)).toFixed(3))});
  }
  if(!components.length)window.addRecipeRow();
  document.getElementById('recipeModal').classList.add('show');
};
window.closeRecipeEditor=function(){document.getElementById('recipeModal').classList.remove('show');};
window.clearRecipe=function(){document.getElementById('recipeRows').innerHTML='';};
window.saveRecipe=async function() {
  if(activeRole!=='Owner'||!recipeProductId)return toast('Owner access required');
  const rows=[...document.querySelectorAll('.recipe-row')];
  const components=rows.map(row=>{
    const ingredient_product_id=row.querySelector('[data-ingredient]').value;
    const amount=Number(row.querySelector('[data-recipe-qty]').value),unit=row.querySelector('[data-recipe-unit]').value;
    return {ingredient_product_id,quantity_per_sale:inventoryAmountToBase(amount,unit),_amount:amount};
  }).filter(c=>c.ingredient_product_id);
  if(rows.some(row=>row.querySelector('[data-ingredient]').value&&(!Number.isFinite(Number(row.querySelector('[data-recipe-qty]').value))||Number(row.querySelector('[data-recipe-qty]').value)<=0)))return toast('Enter a positive amount for each ingredient');
  for(const c of components)delete c._amount;
  const {error}=await window.arrCloud.saveRecipe(recipeProductId,components);
  if(error)return toast(error.message||String(error));
  await window.arrCloud.refresh();
  window.closeRecipeEditor();
  toast(components.length?'Recipe saved; each sale will deduct its ingredients':'Recipe removed');
};

populateCategorySelect();
