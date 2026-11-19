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
    const { identity, password } = await req.json();
    const login = String(identity || '').trim().toLowerCase();
    if (!login || login.length > 254 || typeof password !== 'string' || !password) {
      return json({ error: 'Enter your Owner username or email and password.' }, 400);
    }
    const url = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const publicKey = req.headers.get('apikey');
    if (!publicKey) return json({ error: 'Missing project API key.' }, 401);

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: owners, error: ownerError } = await admin.from('arr_profiles')
      .select('user_id').eq('role', 'owner').limit(2);
    if (ownerError) throw ownerError;
    if (!owners || owners.length !== 1) return json({ error: 'There must be exactly one Owner account for username sign-in. Check Owner accounts in Supabase.' }, 409);
    const { data: account, error: accountError } = await admin.auth.admin.getUserById(owners[0].user_id);
    if (accountError || !account.user?.email) return json({ error: 'Invalid username or password.' }, 401);

    const knownUsername = String(account.user.user_metadata?.login_username || '').trim().toLowerCase();
    const usernameMatch = login === 'owner' || login === 'tribe' || (knownUsername && login === knownUsername);
    if (login !== account.user.email.toLowerCase() && !usernameMatch) return json({ error: 'Invalid username or password.' }, 401);

    const authClient = createClient(url, publicKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await authClient.auth.signInWithPassword({ email: account.user.email, password });
    if (error || !data.session) return json({ error: 'Invalid username or password.' }, 401);
    return json({ session: data.session });
  } catch {
    return json({ error: 'Could not sign in. Try again.' }, 400);
  }
});
