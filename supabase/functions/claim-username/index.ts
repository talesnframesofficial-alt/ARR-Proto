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
    const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    const publicKey = req.headers.get('apikey');
    if (!token || !publicKey) return json({ error: 'Sign in before setting a username.' }, 401);
    const { username } = await req.json();
    const display = String(username || '').trim();
    const normalized = display.toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{2,23}$/.test(normalized)) {
      return json({ error: 'Use 3–24 letters or numbers. Dots, underscores, and hyphens are allowed.' }, 400);
    }

    const url = Deno.env.get('SUPABASE_URL')!;
    const userClient = createClient(url, publicKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await userClient.auth.getUser(token);
    if (authError || !authData.user) return json({ error: 'Your sign-in expired. Sign in again.' }, 401);

    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: existing } = await admin.from('arr_login_names').select('username_normalized')
      .eq('user_id', authData.user.id).maybeSingle();
    if (existing) {
      if (existing.username_normalized !== normalized) return json({ error: 'This account already has a username. Contact the owner to change it.' }, 409);
      return json({ username: existing.username_normalized });
    }
    const { error: insertError } = await admin.from('arr_login_names').insert({
      username_normalized: normalized,
      username: display,
      user_id: authData.user.id,
    });
    if (insertError) {
      if (insertError.code === '23505') return json({ error: 'That username is already taken. Choose another.' }, 409);
      throw insertError;
    }
    const metadata = { ...(authData.user.user_metadata || {}), login_username: display };
    const { error: updateError } = await admin.auth.admin.updateUserById(authData.user.id, { user_metadata: metadata });
    if (updateError) throw updateError;
    return json({ username: display });
  } catch (error) {
    console.error(error);
    return json({ error: 'Could not save that username. Try again.' }, 400);
  }
});
