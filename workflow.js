/* Owner workflows for products, categories, and catalogue import. */
let manageCategory='All categories';
let manageStatus='all';

function parseProductsCSV(source) {
  const rows=[]; let row=[],cell='',quoted=false; const text=source.replace(/^\uFEFF/,'');
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quoted){if(ch==='"'&&text[i+1]==='"'){cell+='"';i++;}else if(ch==='"')quoted=false;else cell+=ch;}
    else if(ch==='"'&&cell==='')quoted=true;
    else if(ch===','){row.push(cell.trim());cell='';}
    else if(ch==='\n'||ch==='\r'){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell.trim());if(row.some(x=>x!==''))rows.push(row);row=[];cell='';}
    else cell+=ch;
  }
  row.push(cell.trim());if(row.some(x=>x!==''))rows.push(row);
  if(quoted)throw new Error('The CSV has an opening quote without a closing quote.');
  if(rows.length<2)throw new Error('Add at least one product row beneath the header.');
  const headers=rows.shift().map(x=>x.toLowerCase()),col=name=>headers.indexOf(name);
  const required=['category','name','selling_price'],missing=required.filter(name=>!headers.includes(name));
  if(missing.length)throw new Error(`CSV is missing required columns: ${missing.join(', ')}.`);
  const productsToImport=[],issues=[];
  rows.forEach((r,index)=>{
    const name=(r[col('name')]||'').trim(),category=(r[col('category')]||'Other').trim()||'Other';
    const priceRaw=(r[col('selling_price')]||'').trim();
    const costIndex=col('cost_per_item')>=0?col('cost_per_item'):col('purchase_cost');
    const costRaw=costIndex<0?'':(r[costIndex]||'').trim();
    const price=Number(priceRaw),cost=costRaw===''?0:Number(costRaw),line=index+2;
    if(!name)issues.push(`Line ${line}: item name is required.`);
    else if(name.length>160)issues.push(`Line ${line}: item name must be 160 characters or fewer.`);
    else if(!priceRaw||!Number.isFinite(price)||price<0)issues.push(`Line ${line}: selling_price must be a valid non-negative number.`);
    else if(!Number.isFinite(cost)||cost<0)issues.push(`Line ${line}: cost_per_item must be blank or a non-negative number.`);
    else if(category.length>80||category.toLowerCase()==='all items')issues.push(`Line ${line}: choose a category name up to 80 characters.`);
    else productsToImport.push({name,category,price,cost,emoji:(r[col('emoji')]||'').trim()||'📦',active:true});
  });
  if(issues.length)throw new Error(`Please fix these CSV rows and try again:\n${issues.slice(0,8).join('\n')}${issues.length>8?`\n…and ${issues.length-8} more issue(s).`:''}`);
  return productsToImport;
}

window.importProductsCSV=async function(input){
  if(activeRole!=='Owner'){input.value='';return toast('Owner access required');}
  const file=input.files?.[0];if(!file)return;
  try{
    const rows=parseProductsCSV(await file.text());
    if(!confirm(`Import ${rows.length} products? Existing products will stay as they are.`))return;
    const existing=new Set(cats.filter(x=>x!=='All items').map(x=>x.toLowerCase()));
    for(const name of [...new Set(rows.map(x=>x.category))]){if(existing.has(name.toLowerCase()))continue;const {error}=await window.arrCloud.createCategory(name);if(error)throw error;existing.add(name.toLowerCase());}
    const {error}=await window.arrCloud.importProducts(rows);if(error)throw error;
    await window.arrCloud.refresh();toast(`${rows.length} products imported`);
  }catch(error){toast(error.message||'Could not import this CSV');}
  finally{input.value='';}
};

function populateCategorySelect(selected){const select=document.getElementById('newCat');if(!select)return;const options=cats.filter(x=>x!=='All items');select.innerHTML=options.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('');if(selected&&options.includes(selected))select.value=selected;else if(options.length&&!options.includes(select.value))select.value=options[0];}
function renderCategoryAdmin(){
  const node=document.getElementById('categoryAdminList');if(!node)return;
  const names=cats.filter(name=>name!=='All items');
  const entries=[{name:'All categories',index:-1,count:products.length},...names.map((name,index)=>({name,index,count:products.filter(p=>p.cat===name).length}))];
  node.innerHTML=entries.map(entry=>`<div class="category-nav-row ${manageCategory===entry.name?'selected':''}"><button class="category-nav-choice" onclick="${entry.index<0?"setManageCategory('All categories')":`setManageCategoryByIndex(${entry.index})`}"><span>${esc(entry.name)}</span><span>${entry.count}</span></button>${entry.index<0?'':`<div class="category-nav-actions"><button aria-label="Rename ${esc(entry.name)}" title="Rename category" onclick="renameCategory(${entry.index})">✎</button>${entry.name.toLowerCase()==='other'?'':`<button aria-label="Archive ${esc(entry.name)}" title="Archive category" onclick="archiveCategory(${entry.index})">×</button>`}</div>`}</div>`).join('');
}
function setManageCategory(name){manageCategory=name;renderProductManager();}
function setManageCategoryByIndex(index){setManageCategory(cats.filter(x=>x!=='All items')[index]);}
function setManageStatus(status){manageStatus=status;document.querySelectorAll('.product-status-tabs button').forEach(button=>button.classList.toggle('active',button.dataset.status===status));renderProductManager();}
function renderProductManager(){
  populateCategorySelect();renderCategoryAdmin();
  const list=document.getElementById('productManageList');if(!list)return;
  const query=(document.getElementById('productManageSearch')?.value||'').trim().toLowerCase();
  const active=products.filter(p=>p.active!==false).length;
  const summary=document.getElementById('productSummary');
  if(summary)summary.innerHTML=`<div class="product-overview-card"><small>Total products</small><strong>${products.length}</strong></div><div class="product-overview-card"><small>Active in billing</small><strong>${active}</strong></div><div class="product-overview-card"><small>Categories</small><strong>${cats.filter(name=>name!=='All items').length}</strong></div>`;
  const filtered=products.filter(p=>{
    const matchesCategory=manageCategory==='All categories'||p.cat===manageCategory;
    const isActive=p.active!==false;
    const matchesStatus=manageStatus==='all'||(manageStatus==='active'&&isActive)||(manageStatus==='archived'&&!isActive);
    const matchesSearch=!query||`${p.name} ${p.cat||''}`.toLowerCase().includes(query);
    return matchesCategory&&matchesStatus&&matchesSearch;
  });
  const count=document.getElementById('productCountLabel');
  if(count)count.textContent=`${filtered.length} ${filtered.length===1?'product':'products'}${manageCategory==='All categories'?'':` in ${manageCategory}`}`;
  list.innerHTML=filtered.length?`<div class="product-admin-heading"><span>Product</span><span>Selling price</span><span>Item cost</span><span>Status</span><span></span></div>`+filtered.map(p=>`<article class="product-admin-row"><div class="product-primary"><span class="product-admin-emoji">${esc(p.emoji||'📦')}</span><span class="product-primary-copy"><strong>${esc(p.name)}</strong><small>${esc(p.cat||'Other')}</small></span></div><strong class="product-price-value">${money(p.price)}</strong><span class="product-cost-value">${money(p.cost||0)}</span><span class="product-status ${p.active===false?'archived':''}">${p.active===false?'Archived':'Active'}</span><div class="product-row-actions"><button onclick="editItemById('${esc(p.id)}')">Edit</button><button class="archive-action" onclick="toggleArchiveById('${esc(p.id)}')">${p.active===false?'Restore':'Archive'}</button></div></article>`).join(''):`<div class="product-list-empty"><strong>${products.length?'No products match these filters':'Your catalogue is empty'}</strong><span>${products.length?'Try a different category, status, or search.':'Add products here or import your list from Reports.'}</span>${products.length?'':'<br><button class="save" onclick="openProductEditor()">＋ Add first product</button>'}</div>`;
}
window.openManage=function(){
  if(activeRole!=='Owner')return toast('Product management is available to the owner');
  manageCategory='All categories';manageStatus='all';editingItemId=null;
  document.getElementById('manageTitle').textContent='Products';
  document.getElementById('productManageSearch').value='';
  document.querySelectorAll('.product-status-tabs button').forEach(button=>button.classList.toggle('active',button.dataset.status==='all'));
  renderProductManager();document.getElementById('manage').classList.add('show');
};
window.openProductEditor=function(){
  if(activeRole!=='Owner')return toast('Product management is available to the owner');
  if(!document.getElementById('manage').classList.contains('show'))window.openManage();
  editingItemId=null;document.getElementById('productEditorTitle').textContent='Add product';
  document.getElementById('productSaveButton').textContent='Save product';
  ['newName','newPrice','newCost','newEmoji'].forEach(id=>document.getElementById(id).value='');
  populateCategorySelect(manageCategory!=='All categories'?manageCategory:'');
  document.getElementById('productEditor').classList.add('show');
  document.getElementById('newName').focus();
};
window.closeProductEditor=function(){document.getElementById('productEditor').classList.remove('show');};
window.closeManage=function(){window.closeProductEditor();document.getElementById('manage').classList.remove('show');};
window.editItemById=function(id){
  if(activeRole!=='Owner')return toast('Owner access required');
  const product=products.find(item=>String(item.id)===String(id));if(!product)return;
  editingItemId=product.id;document.getElementById('productEditorTitle').textContent='Edit product';
  document.getElementById('productSaveButton').textContent='Save changes';
  populateCategorySelect(product.cat);document.getElementById('newName').value=product.name;
  document.getElementById('newPrice').value=product.price;document.getElementById('newCost').value=product.cost||0;
  document.getElementById('newEmoji').value=product.emoji||'';document.getElementById('productEditor').classList.add('show');
  document.getElementById('newName').focus();
};
window.toggleArchiveById=id=>toggleArchive(id);
window.addCategory=async function(){if(activeRole!=='Owner')return toast('Owner access required');const input=document.getElementById('newCategoryName'),name=input.value.trim();if(!name)return toast('Enter a category name');const {error}=await window.arrCloud.createCategory(name);if(error)return toast(error.message);input.value='';await window.arrCloud.refresh();toast('Category added');};
window.renameCategory=async function(index){if(activeRole!=='Owner')return toast('Owner access required');const oldName=cats.filter(x=>x!=='All items')[index];if(!oldName)return;const next=prompt(`Rename “${oldName}” to:`,oldName);if(next===null)return;const clean=next.trim();if(!clean)return toast('Enter a category name');const {error}=await window.arrCloud.renameCategory(oldName,clean);if(error)return toast(error.message);await window.arrCloud.refresh();if(category===oldName){category=clean;renderCats();renderProducts();}if(manageCategory===oldName)manageCategory=clean;renderProductManager();toast('Category renamed');};
window.archiveCategory=async function(index){if(activeRole!=='Owner')return toast('Owner access required');const name=cats.filter(x=>x!=='All items')[index];if(!name||!confirm(`Archive “${name}”? Active items must be moved or archived first.`))return;const {error}=await window.arrCloud.archiveCategory(name);if(error)return toast(error.message);if(category===name)category='All items';if(manageCategory===name)manageCategory='All categories';await window.arrCloud.refresh();toast('Category archived');};
