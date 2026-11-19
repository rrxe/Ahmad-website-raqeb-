import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });
  try {
    const authorization = req.headers.get('Authorization');
    if (!authorization?.startsWith('Bearer ')) return new Response(JSON.stringify({ error: 'يلزم تسجيل الدخول' }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } });
    const token = authorization.slice('Bearer '.length);
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    if (!url || !anon || !service) throw new Error('Supabase function secrets are missing');

    const caller = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await caller.auth.getUser(token);
    if (authError || !authData.user) return new Response(JSON.stringify({ error: 'جلسة الدخول غير صالحة' }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } });
    const { data: profile, error: profileError } = await caller.from('profiles').select('role,status').eq('id', authData.user.id).single();
    if (profileError || profile?.role !== 'admin' || profile?.status !== 'active') return new Response(JSON.stringify({ error: 'هذه العملية للمدير العام فقط' }), { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } });

    const body = await req.json();
    const email = String(body.email ?? '').trim().toLowerCase();
    const full_name = String(body.full_name ?? '').trim();
    const phone = String(body.phone ?? '').trim();
    const role = String(body.role ?? 'student');
    if (!email || !full_name) throw new Error('الاسم والبريد الإلكتروني مطلوبان');
    if (!['student', 'parent', 'teacher', 'supervisor'].includes(role)) throw new Error('الدور المطلوب غير مسموح');

    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name, phone: phone || null, role },
      redirectTo: body.redirectTo || undefined,
    });
    if (error) throw error;
    return new Response(JSON.stringify({ user_id: data.user?.id, role, status: role === 'teacher' || role === 'supervisor' ? 'pending' : 'active' }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
});
