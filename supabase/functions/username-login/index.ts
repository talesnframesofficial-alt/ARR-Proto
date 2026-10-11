import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, 'Content-Type': 'application/json' },
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  try {
    const { username, password } = await req.json();
    const normalized = String(username || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{2,23}$/.test(normalized) || typeof password !== 'string' || !password) {
      return json({ error: 'Enter a valid username and password.' }, 400);
    }
    const url = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const publicKey = req.headers.get('apikey');
    if (!publicKey) return json({ error: 'Missing project API key.' }, 401);

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: mapping } = await admin.from('arr_login_names')
      .select('user_id').eq('username_normalized', normalized).maybeSingle();
    if (!mapping) return json({ error: 'Invalid username or password.' }, 401);
    const { data: account, error: accountError } = await admin.auth.admin.getUserById(mapping.user_id);
    if (accountError || !account.user?.email) return json({ error: 'Invalid username or password.' }, 401);

    const authClient = createClient(url, publicKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await authClient.auth.signInWithPassword({ email: account.user.email, password });
    if (error || !data.session) return json({ error: 'Invalid username or password.' }, 401);
    return json({ session: data.session });
  } catch {
    return json({ error: 'Could not sign in. Try again.' }, 400);
  }
});
