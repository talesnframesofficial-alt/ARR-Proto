/* ARR-Proto Supabase integration. Public keys are safe in the browser only with RLS. */
(() => {
  const configKey = 'arrProtoCloudConfig';
  const gate = document.getElementById('cloudGate');
  const message = document.getElementById('gateMessage');
  const errorBox = document.getElementById('cloudError');
  let sb = null;
  let session = null;
  let myProfile = null;
  let shop = null;
  let busy = false;
  let recoveringPassword = false;
  let usernameClaimedFor = null;
  let usernameClaimPromise = null;
  function isRecoveryReturn() {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const search = new URLSearchParams(window.location.search);
    return search.get('arr_recovery') === '1' || search.get('type') === 'recovery' || hash.get('type') === 'recovery' || sessionStorage.getItem('arrProtoPasswordRecoveryPending') === '1';
  }

  const authActions = document.querySelector('#authSection .formrow');
  const forgotButton = document.createElement('button');
  forgotButton.className = 'close';
  forgotButton.type = 'button';
  forgotButton.textContent = 'Forgot password?';
  forgotButton.onclick = () => openGate('passwordResetRequestSection', 'Reset your password', 'Enter the recovery email saved on your account.');
  authActions.append(forgotButton);

  const authEmailInput = document.getElementById('authEmail');
  authEmailInput.type = 'text';
  authEmailInput.autocapitalize = 'none';
  authEmailInput.autocorrect = 'off';
  authEmailInput.spellcheck = false;
  authEmailInput.placeholder = 'username or name@example.com';
  authEmailInput.parentElement.childNodes[0].textContent = 'Username or recovery email';
  const authHint = document.createElement('small');
  authHint.textContent = 'Use your username to sign in. Use your real email when creating an account or resetting a password.';
  authEmailInput.parentElement.append(authHint);
  const usernameLabel = document.createElement('label');
  usernameLabel.textContent = 'Username for this account';
  const usernameInput = document.createElement('input');
  usernameInput.id = 'authUsername';
  usernameInput.autocomplete = 'username';
  usernameInput.minLength = 3;
  usernameInput.maxLength = 24;
  usernameInput.placeholder = 'e.g. owner or counter1';
  usernameLabel.append(usernameInput);
  document.getElementById('authName').parentElement.after(usernameLabel);

  const resetRequestSection = document.createElement('section');
  resetRequestSection.id = 'passwordResetRequestSection';
  resetRequestSection.style.display = 'none';
  resetRequestSection.innerHTML = '<label>Account recovery email<input id="recoveryEmail" type="email" autocomplete="email"></label><div class="formrow"><button class="save" id="sendRecoveryEmail">Send reset link</button><button class="close" id="backToLogin">Back to sign in</button></div>';
  gate.querySelector('.cloud-gate-box').insertBefore(resetRequestSection, errorBox);
  resetRequestSection.querySelector('#sendRecoveryEmail').onclick = () => window.requestPasswordReset();
  resetRequestSection.querySelector('#backToLogin').onclick = () => openGate('authSection', 'Sign in or create an account', 'Use your username and password to sign in.');

  const claimSection = document.createElement('section');
  claimSection.id = 'claimUsernameSection';
  claimSection.style.display = 'none';
  claimSection.innerHTML = '<label>Choose a username<input id="claimUsernameInput" autocomplete="username" minlength="3" maxlength="24" placeholder="e.g. owner or counter1"></label><small>Use 3–24 letters or numbers. Dots, underscores, and hyphens are allowed.</small><div class="formrow"><button class="save" id="saveLoginUsername">Save username</button><button class="close" onclick="signOutCloud()">Sign out</button></div>';
  gate.querySelector('.cloud-gate-box').insertBefore(claimSection, errorBox);
  claimSection.querySelector('#saveLoginUsername').onclick = () => window.saveLoginUsername();

  const recoverySection = document.createElement('section');
  recoverySection.id = 'passwordRecoverySection';
  recoverySection.style.display = 'none';
  recoverySection.innerHTML = '<label>New password<input id="recoveryPassword" type="password" autocomplete="new-password" minlength="8"></label><label>Confirm new password<input id="recoveryPasswordConfirm" type="password" autocomplete="new-password" minlength="8"></label><div class="formrow"><button class="save" id="saveRecoveryPassword">Save new password</button></div>';
  gate.querySelector('.cloud-gate-box').insertBefore(recoverySection, errorBox);
  recoverySection.querySelector('#saveRecoveryPassword').onclick = () => window.saveRecoveredPassword();

  // All shop data is read from Supabase. Keep only the in-progress cart in memory.
  persist = function () {};
  cart = {};
  salesLog = [];
  stockLog = [];
  products = [];

  function setMessage(value) { message.textContent = value || ''; }
  function setError(value) { errorBox.textContent = value || ''; }
  function openGate(section, title, description) {
    gate.classList.add('show');
    document.querySelectorAll('#cloudGate section').forEach(node => node.style.display = node.id === section ? '' : 'none');
    document.getElementById('gateTitle').textContent = title;
    setMessage(description);
  }
  function closeGate() { gate.classList.remove('show'); setError(''); }
  function configValues() {
    const injected = window.ARR_CONFIG || {};
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(configKey) || 'null'); } catch {}
    // The project configuration shipped with ARR-Proto is authoritative. Browser-saved
    // values are only a fallback for older deployments without an embedded config.
    return {
      url: injected.url || saved?.url || '',
      key: injected.publishableKey || injected.anonKey || saved?.key || '',
    };
  }
  async function callUsernameFunction(name, payload, accessToken) {
    const cfg = configValues();
    const response = await fetch(`${cfg.url}/functions/v1/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: cfg.key, Authorization: `Bearer ${accessToken || cfg.key}` },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Could not complete username sign-in.');
    return result;
  }
  async function claimUsername(username) {
    const { data, error } = await sb.auth.getSession();
    if (error || !data.session) throw new Error('Sign in again before saving your username.');
    const userId = data.session.user.id;
    if (usernameClaimedFor === userId) return { username: data.session.user.user_metadata?.login_username || username };
    if (usernameClaimPromise) await usernameClaimPromise;
    if (usernameClaimedFor === userId) return { username: data.session.user.user_metadata?.login_username || username };
    usernameClaimPromise = (async () => {
      const result = await callUsernameFunction('claim-username', { username }, data.session.access_token);
      const { data: updated, error: metadataError } = await sb.auth.updateUser({ data: { login_username: result.username } });
      if (metadataError) throw metadataError;
      session = { ...data.session, user: updated.user };
      usernameClaimedFor = userId;
      return result;
    })();
    try { return await usernameClaimPromise; }
    finally { usernameClaimPromise = null; }
  }
  async function connect(url, key) {
    if (!window.supabase?.createClient) throw new Error('Cloud library did not load. Check your internet connection and reload.');
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) throw new Error('Enter the project URL shown in your Supabase project settings.');
    if (!key || /service[_-]?role|secret/i.test(key)) throw new Error('Use the publishable/anon key only. A secret key cannot be used here.');
    localStorage.setItem(configKey, JSON.stringify({ url, key }));
    sb = window.supabase.createClient(url, key);
    const result = await sb.auth.getSession();
    if (result.error) throw result.error;
    session = result.data.session;
    sb.auth.onAuthStateChange((_event, nextSession) => {
      session = nextSession;
      if (_event === 'PASSWORD_RECOVERY' || isRecoveryReturn()) {
        recoveringPassword = true;
        sessionStorage.setItem('arrProtoPasswordRecoveryPending', '1');
        window.setTimeout(() => openGate('passwordRecoverySection', 'Choose a new password', 'Create a new password for your ARR-Proto account.'), 0);
        return;
      }
      window.setTimeout(() => { if (!recoveringPassword) routeSession().catch(showCloudError); }, 0);
    });
    if (isRecoveryReturn()) {
      recoveringPassword = true;
      sessionStorage.setItem('arrProtoPasswordRecoveryPending', '1');
      openGate('passwordRecoverySection', 'Choose a new password', 'Create a new password for your ARR-Proto account.');
      if (!session) setError('Open the reset link from your email in this browser again to verify it.');
    } else if (session) await routeSession();
    else openGate('authSection', 'Sign in or create an account', 'Your shop data is stored in this Supabase cloud project.');
    if (!recoveringPassword) setError('');
  }
  window.connectCloud = async function () {
    setError('');
    try {
      const url = document.getElementById('cloudUrl').value.trim().replace(/\/$/, '');
      const key = document.getElementById('cloudKey').value.trim();
      await connect(url, key);
    } catch (e) { setError(e.message || String(e)); }
  };
  window.disconnectCloud = async function () {
    localStorage.removeItem(configKey);
    if (sb) await sb.auth.signOut();
    sb = null; session = null; myProfile = null; shop = null;
    openGate('connectSection', 'Connect your cloud database', 'Use your project URL and publishable/anon key. Never paste a service_role or secret key.');
  };
  window.signInCloud = async function () {
    setError('');
    try {
      if (!sb) throw new Error('Connect the cloud project first.');
      const identity = document.getElementById('authEmail').value.trim();
      const password = document.getElementById('authPassword').value;
      if (identity.includes('@')) {
        const { data, error } = await sb.auth.signInWithPassword({ email: identity, password });
        if (error) throw error;
        session = data.session;
        const username = document.getElementById('authUsername').value.trim() || data.user.user_metadata?.login_username;
        if (username) await claimUsername(username);
      } else {
        const result = await callUsernameFunction('username-login', { username: identity, password });
        const { data, error } = await sb.auth.setSession({ access_token: result.session.access_token, refresh_token: result.session.refresh_token });
        if (error) throw error;
        session = data.session;
        usernameClaimedFor = session.user.id;
      }
      await routeSession();
    } catch (e) { setError(e.message || String(e)); }
  };
  window.requestPasswordReset = async function () {
    setError('');
    try {
      if (!sb) throw new Error('Connect the cloud project first.');
      const email = document.getElementById('recoveryEmail').value.trim();
      if (!email) throw new Error('Enter your account email first.');
      const redirect = new URL(window.location.origin + window.location.pathname);
      redirect.searchParams.set('arr_recovery', '1');
      const redirectTo = redirect.toString();
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;
      sessionStorage.setItem('arrProtoPasswordRecoveryPending', '1');
      setError('If an account exists for that email, Supabase has sent a password reset link. Check your inbox and spam folder.');
    } catch (e) { setError(e.message || String(e)); }
  };
  window.saveRecoveredPassword = async function () {
    setError('');
    try {
      if (!sb?.auth) throw new Error('Open the password reset link from your email again.');
      const password = document.getElementById('recoveryPassword').value;
      const confirm = document.getElementById('recoveryPasswordConfirm').value;
      if (password.length < 8) throw new Error('Use a password with at least 8 characters.');
      if (password !== confirm) throw new Error('The passwords do not match.');
      const { error } = await sb.auth.updateUser({ password });
      if (error) throw error;
      recoveringPassword = false;
      sessionStorage.removeItem('arrProtoPasswordRecoveryPending');
      history.replaceState(null, '', window.location.pathname);
      session = (await sb.auth.getSession()).data.session;
      await routeSession();
      toast('Password updated successfully');
    } catch (e) { setError(e.message || String(e)); }
  };
  window.saveLoginUsername = async function () {
    setError('');
    try {
      const username = document.getElementById('claimUsernameInput').value.trim();
      await claimUsername(username);
      await routeSession();
    } catch (e) { setError(e.message || String(e)); }
  };
  window.signUpCloud = async function () {
    setError('');
    try {
      if (!sb) throw new Error('Connect the cloud project first.');
      const email = document.getElementById('authEmail').value.trim();
      const password = document.getElementById('authPassword').value;
      const name = document.getElementById('authName').value.trim();
      const username = document.getElementById('authUsername').value.trim();
      if (!email.includes('@') || !name || password.length < 8) throw new Error('Enter your recovery email, your name, and a password with at least 8 characters.');
      if (!/^[a-z0-9][a-z0-9._-]{2,23}$/i.test(username)) throw new Error('Choose a username with 3–24 letters or numbers. Dots, underscores, and hyphens are allowed.');
      const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin + window.location.pathname, data: { display_name: name, login_username: username } } });
      if (error) throw error;
      if (data.session) { session = data.session; await claimUsername(username); await routeSession(); }
      else setError('Check your email for the confirmation link, then return here and sign in.');
    } catch (e) { setError(e.message || String(e)); }
  };
  window.signOutCloud = async function () {
    if (sb) await sb.auth.signOut();
    session = null; myProfile = null; shop = null; products = []; salesLog = []; stockLog = []; cart = {}; usernameClaimedFor = null;
    renderProducts(); renderCart();
    openGate('authSection', 'Sign in or create an account', 'Your shop data is stored in this Supabase cloud project.');
  };
  window.createCloudShop = async function () {
    setError('');
    try {
      const { data, error } = await sb.rpc('arr_create_shop', { p_name: document.getElementById('shopName').value.trim(), p_display_name: document.getElementById('authName').value.trim() });
      if (error) throw error;
      await routeSession();
      if (data?.invite_code) toast('Staff join code: ' + data.invite_code);
    } catch (e) { setError(e.message || String(e)); }
  };
  window.joinCloudShop = async function () {
    setError('');
    try {
      const { error } = await sb.rpc('arr_join_shop', { p_invite_code: document.getElementById('inviteCode').value.trim(), p_display_name: document.getElementById('authName').value.trim() });
      if (error) throw error;
      await routeSession();
    } catch (e) { setError(e.message || String(e)); }
  };
  function showCloudError(error) {
    console.error(error);
    setError(error?.message || String(error));
    gate.classList.add('show');
  }
  async function routeSession() {
    setError('');
    if (!session?.user) {
      products = []; salesLog = []; stockLog = []; cart = {};
      renderProducts(); renderCart();
      openGate('authSection', 'Sign in or create an account', 'Your shop data is stored in this Supabase cloud project.');
      return;
    }
    const loginUsername = session.user.user_metadata?.login_username;
    if (loginUsername && usernameClaimedFor !== session.user.id) await claimUsername(loginUsername);
    if (!loginUsername) {
      openGate('claimUsernameSection', 'Choose your sign-in username', 'Your account is signed in. Set a unique username now; use it with your password on future visits.');
      return;
    }
    const { data: profile, error: profileError } = await sb.from('arr_profiles').select('user_id,shop_id,role,display_name').eq('user_id', session.user.id).maybeSingle();
    if (profileError) throw profileError;
    if (!profile) {
      openGate('shopSection', 'Set up your shop', 'Create the owner shop or join an existing shop with its staff invite code.');
      return;
    }
    myProfile = profile;
    activeRole = profile.role === 'owner' ? 'Owner' : 'Staff';
    const settingsResult = await sb.rpc('arr_get_shop_settings');
    if (settingsResult.error) throw settingsResult.error;
    shop = settingsResult.data;
    taxRate = Number(shop.tax_rate || 0);
    document.getElementById('roleLabel').textContent = `${shop.name} · ${activeRole}`;
    const rolePick = document.getElementById('rolePick');
    rolePick.value = activeRole; rolePick.disabled = true; rolePick.title = 'Role is controlled by your signed-in account';
    setRole(activeRole);
    await refreshCloudData();
    closeGate();
    window.clearInterval(window.arrCloudRefresh);
    window.arrCloudRefresh = window.setInterval(() => refreshCloudData().catch(showCloudError), 45000);
  }
  async function fetchAllSales() {
    let rows = [], start = 0, pageSize = 500;
    while (true) {
      const { data, error } = await sb.from('arr_sales')
        .select('id,receipt_no,created_by,customer,payment_method,subtotal,discount,tax_rate,tax,total,gross_profit,created_at,arr_sale_items(id,product_id,item_name,quantity,unit_price,unit_cost,line_total,line_profit)')
        .order('created_at', { ascending: false }).range(start, start + pageSize - 1);
      if (error) throw error;
      rows = rows.concat(data || []);
      if (!data || data.length < pageSize) break;
      start += pageSize;
    }
    return rows;
  }
  async function refreshCloudData() {
    if (!sb || !myProfile) return;
    const categoryResult = await sb.rpc('arr_list_categories');
    if (categoryResult.error) throw categoryResult.error;
    cats = ['All items', ...(categoryResult.data || [])];
    if (!cats.includes(category)) category = 'All items';
    const productResult = await sb.rpc('arr_list_products');
    if (productResult.error) throw productResult.error;
    const productsData = productResult.data || [];
    let s = [], m = { data:[] }, members = { data:[] }, purchases = { data:[] };
    if (myProfile.role === 'owner') {
      [s,m,members,purchases] = await Promise.all([fetchAllSales(), sb.from('arr_stock_movements').select('*').order('created_at',{ascending:false}).limit(200), sb.from('arr_profiles').select('user_id,display_name,role'), sb.from('arr_purchases').select('id,receipt_no,supplier,invoice_no,payment_method,subtotal,total,created_at,arr_purchase_items(id,item_name,quantity,unit_cost,line_total)').order('created_at',{ascending:false}).limit(500)]);
      if (m.error) throw m.error; if (members.error) throw members.error; if (purchases.error) throw purchases.error;
    }
    const memberNames = Object.fromEntries((members.data || []).map(x => [x.user_id, x.display_name || x.role]));
    products = productsData.map(x => ({ id:x.id, name:x.name, cat:x.category, price:Number(x.price), cost:Number(x.cost), emoji:x.emoji, stock:x.stock, active:x.active, color:'#edf4ef' }));
    salesLog = s.map(x => ({ id:x.receipt_no, saleId:x.id, date:x.created_at, staff:memberNames[x.created_by] || 'Staff', customer:x.customer, method:x.payment_method, subtotal:Number(x.subtotal), discount:Number(x.discount), tax:Number(x.tax), total:Number(x.total), profit:Number(x.gross_profit), items:(x.arr_sale_items || []).map(i => ({ id:i.product_id, name:i.item_name, quantity:i.quantity, price:Number(i.unit_price), cost:Number(i.unit_cost), lineProfit:Number(i.line_profit) })) }));
    stockLog = (m.data || []).map(x => ({ item:x.item_name, quantity:x.quantity_change, date:x.created_at, reason:x.reason }));
    purchaseLog = purchases.data || [];
    renderCats(); renderProducts(); renderCart(); updateTodayStats();
    if (typeof renderProductManager === 'function' && document.getElementById('manage')?.classList.contains('show')) renderProductManager();
    if (typeof renderPurchaseHistory === 'function') renderPurchaseHistory();
  }
  window.syncCloudData = async function () { try { await refreshCloudData(); toast('Cloud data is up to date'); } catch (e) { showCloudError(e); } };
  window.arrCloud = {
    refresh: refreshCloudData,
    createCategory: name => sb.rpc('arr_create_category', { p_name:name }),
    renameCategory: (oldName, newName) => sb.rpc('arr_rename_category', { p_old_name:oldName, p_new_name:newName }),
    archiveCategory: name => sb.rpc('arr_archive_category', { p_name:name }),
    recordPurchase: payload => sb.rpc('arr_record_purchase', payload),
    importProducts: rows => sb.from('arr_products').insert(rows.map(row => ({ ...row, shop_id:shop.shop_id })))
  };
  window.signInCloud = window.signInCloud;

  // Product writes are owner-only in both the interface and database policies.
  saveItem = async function () {
    const name = document.getElementById('newName').value.trim();
    const price = Number(document.getElementById('newPrice').value);
    const cost = Number(document.getElementById('newCost').value || 0);
    const stockRaw = document.getElementById('newStock').value;
    if (!name || !Number.isFinite(price) || price < 0 || !Number.isFinite(cost) || cost < 0) return toast('Enter a name and valid selling and purchase prices');
    const row = { shop_id:shop.shop_id, name, category:document.getElementById('newCat').value, price, cost, emoji:document.getElementById('newEmoji').value || '📦', active:true };
    if (stockRaw !== '') row.stock = Number(stockRaw);
    const result = editingItemId ? await sb.from('arr_products').update(row).eq('id', editingItemId) : await sb.from('arr_products').insert(row);
    if (result.error) return toast(result.error.message);
    editingItemId = null;
    ['newName','newPrice','newCost','newEmoji','newStock'].forEach(id => document.getElementById(id).value='');
    document.getElementById('manageTitle').textContent = 'Add an item';
    await refreshCloudData(); renderProductManager(); toast('Item saved to cloud');
  };
  toggleArchive = async function (id) {
    const p = products.find(x => x.id === id); if (!p) return;
    const { error } = await sb.from('arr_products').update({ active:!p.active, updated_at:new Date().toISOString() }).eq('id',id);
    if (error) return toast(error.message);
    await refreshCloudData(); renderProductManager(); toast(p.active ? 'Item archived' : 'Item restored');
  };
  saveStock = async function () {
    for (const p of products) {
      const field = document.getElementById('stock-'+p.id), costField = document.getElementById('cost-'+p.id);
      const delta = field?.value === '' ? 0 : Number(field?.value);
      const cost = costField?.value === '' ? null : Number(costField?.value);
      if (cost !== null && (!Number.isFinite(cost) || cost < 0)) return toast('Enter a valid purchase cost');
      if (!Number.isInteger(delta)) return toast('Stock changes must use whole units');
      if (delta !== 0) {
        const { error } = await sb.rpc('arr_adjust_stock', { p_product_id:p.id, p_delta:delta, p_unit_cost:cost });
        if (error) return toast(error.message);
      } else if (cost !== null && cost !== Number(p.cost)) {
        const { error } = await sb.from('arr_products').update({ cost, updated_at:new Date().toISOString() }).eq('id',p.id);
        if (error) return toast(error.message);
      }
    }
    await refreshCloudData(); closeStock(); toast('Stock and costs saved to cloud');
  };
  completeSale = async function () {
    if (busy || !Object.keys(cart).length) return;
    busy = true;
    const chargeButton = document.getElementById('checkout'); chargeButton.disabled = true;
    try {
      const shownTotal = Number(document.getElementById('total').textContent.replace(/[₹,]/g,''));
      await refreshCloudData();
      const refreshedTotal = subtotalVal() - discountAmt(subtotalVal()) + (subtotalVal()-discountAmt(subtotalVal()))*taxRate/100;
      renderCart();
      if (Math.abs(refreshedTotal-shownTotal) > 0.01) return toast('Cloud prices or tax changed. Review the updated bill and charge again.');
      if (method === 'Cash' && Number(document.getElementById('cashReceived').value || 0) < refreshedTotal) return toast('Cash received is less than the amount due');
      const items = Object.entries(cart).map(([id,quantity]) => ({ product_id:id, quantity, expected_price:Number(products.find(p=>p.id===id).price) }));
      const { data, error } = await sb.rpc('arr_record_sale', { p_customer:document.getElementById('customer').value.trim(), p_payment_method:method, p_discount:discountAmt(subtotalVal()), p_tax_rate:taxRate, p_items:items });
      if (error) throw error;
      const saleItems = Object.entries(cart).map(([id,quantity]) => { const p=products.find(x=>x.id===id); return { id, name:p.name, quantity, price:Number(p.price), cost:Number(p.cost||0), lineProfit:(Number(p.price)-Number(p.cost||0))*quantity }; });
      const subtotal = subtotalVal(), ratio = subtotal ? Math.max(0,(subtotal-discountAmt(subtotal))/subtotal) : 1;
      saleItems.forEach(i=>i.lineProfit*=ratio);
      const sale = { id:data.receipt_no, saleId:data.id, date:data.created_at, customer:document.getElementById('customer').value.trim(), method, subtotal:Number(data.subtotal), discount:Number(data.discount), tax:Number(data.tax), total:Number(data.total), profit:Number(data.profit), items:saleItems, staff:myProfile.display_name || activeRole };
      cart={}; discountValue=0; document.getElementById('customer').value='';
      await refreshCloudData(); renderCart(); closeCheckout(); renderReceipt(sale); document.getElementById('receipt').classList.add('show'); toast('Bill saved to cloud');
    } catch (e) { toast(e.message || String(e)); }
    finally { busy=false; chargeButton.disabled=!Object.keys(cart).length; }
  };
  const oldCheckout = openCheckout;
  openCheckout = async function () { try { await refreshCloudData(); renderCart(); if (subtotalVal()) oldCheckout(); } catch(e) { toast(e.message || String(e)); } };
  configureSettings = async function () {
    if (activeRole !== 'Owner') return toast('Owner access required');
    const name = prompt('Shop name:', shop.name); if (name === null) return;
    const tax = prompt('Tax rate percent (enter 0 if not applicable):', String(taxRate)); if (tax === null) return;
    const n=Number(tax); if (!Number.isFinite(n)||n<0||n>100) return toast('Enter a tax rate from 0 to 100');
    const {error}=await sb.rpc('arr_update_shop_settings',{p_name:name.trim(),p_tax_rate:n});
    if(error)return toast(error.message);
    await routeSession(); toast('Shop settings saved to cloud');
  };
  const baseApplyDiscount = applyDiscount;
  applyDiscount = function () { if(activeRole!=='Owner') return toast('Only the owner can apply a discount'); baseApplyDiscount(); };
  window.migrateLocalCatalogue = async function () {
    if(activeRole!=='Owner')return toast('Owner access required');
    try { const legacy=JSON.parse(localStorage.getItem('counterProducts')||'[]'); if(!Array.isArray(legacy)||!legacy.length)return toast('No previous catalogue found in this browser'); for(const p of legacy){const {error}=await sb.from('arr_products').insert({shop_id:shop.shop_id,name:p.name,category:p.category||p.cat||'Other',price:Number(p.price),cost:Number(p.cost||0),emoji:p.emoji||'📦',stock:p.stock===''?null:(p.stock==null?null:Number(p.stock)),active:p.active!==false});if(error)throw error;} await refreshCloudData();toast('This browser’s catalogue is now in the cloud');} catch(e){toast(e.message||String(e));}
  };
  window.copyStaffCode = async function () {
    if (activeRole !== 'Owner') return toast('Owner access required');
    const code=shop?.invite_code; if(!code)return toast('Invite code unavailable');
    try { await navigator.clipboard.writeText(code); toast('Staff invite code copied: '+code); }
    catch (_) { prompt('Share this one-time shop code with staff:',code); }
  };
  const baseOpenReports = openReports;
  openReports = function () {
    if (activeRole !== 'Owner') return toast('Reports are available to the owner');
    baseOpenReports();
    const from = document.getElementById('reportFrom').value;
    const to = document.getElementById('reportTo').value;
    const rows = salesLog.filter(x => !x.voided).filter(x => {
      const day = new Date(x.date).toLocaleDateString('en-CA');
      return (!from || day >= from) && (!to || day <= to);
    });
    const totals = new Map();
    rows.forEach(sale => sale.items.forEach(item => {
      const current = totals.get(item.name) || { quantity: 0, sales: 0, profit: 0 };
      current.quantity += Number(item.quantity || 0);
      current.sales += Number(item.price || 0) * Number(item.quantity || 0);
      current.profit += Number(item.lineProfit || 0);
      totals.set(item.name, current);
    }));
    const body = document.getElementById('productReportRows');
    body.innerHTML = totals.size ? [...totals.entries()].sort((a,b) => b[1].sales-a[1].sales).map(([name, t]) =>
      `<tr><td>${esc(name)}</td><td>${t.quantity}</td><td>${money(t.sales)}</td><td>${money(t.profit)}</td></tr>`
    ).join('') : '<tr><td colspan="4">No product sales in this date range.</td></tr>';
  };
  window.downloadBackup = async function () {
    if(activeRole!=='Owner')return toast('Owner access required');
    const payload={app:'ARR-Proto',version:2,exportedAt:new Date().toISOString(),shop:shop.name,categories:cats.filter(x=>x!=='All items'),products,sales:salesLog,purchases:purchaseLog,stockMovements:stockLog};
    const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));a.download='ARR-Proto-cloud-export-'+new Date().toISOString().slice(0,10)+'.json';a.click();URL.revokeObjectURL(a.href);
  };
  window.restoreBackup = function (input) {
    if(activeRole!=='Owner')return toast('Owner access required');
    const file=input.files?.[0];if(!file)return;
    const reader=new FileReader();reader.onload=async()=>{try{const d=JSON.parse(reader.result);if(d.app!=='ARR-Proto'||!Array.isArray(d.products))throw new Error('Choose an ARR-Proto catalogue or backup JSON file.');if(!confirm('Import these catalogue items into the cloud shop? Existing sales will not be replaced.'))return;const rows=d.products.map(p=>({shop_id:shop.shop_id,name:p.name,category:p.category||p.cat||'Other',price:Number(p.price),cost:Number(p.cost||0),emoji:p.emoji||'📦',stock:p.stock===''?null:(p.stock==null?null:Number(p.stock)),active:p.active!==false}));for(const row of rows){const {error}=await sb.from('arr_products').insert(row);if(error)throw error;}await refreshCloudData();toast('Catalogue imported to cloud');}catch(e){toast(e.message||String(e));}finally{input.value='';}};reader.readAsText(file);
  };
  window.addEventListener('online',()=>{if(myProfile)refreshCloudData().catch(showCloudError)});
  const values=configValues();document.getElementById('cloudUrl').value=values.url||'';document.getElementById('cloudKey').value=values.key||'';
  if(values.url&&values.key){connect(values.url,values.key).catch(e=>{openGate('connectSection','Connect your cloud database','Enter the project URL and public key from Supabase.');setError(e.message||String(e));});}
  else openGate('connectSection','Connect your cloud database','Create a Supabase project, run the ARR-Proto schema, then enter its project URL and publishable key.');
})();
