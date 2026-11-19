import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-raqeeb-webhook-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });
  const expected = Deno.env.get('RAQEEB_WEBHOOK_SECRET');
  if (!expected || req.headers.get('x-raqeeb-webhook-secret') !== expected) {
    return new Response('Unauthorized', { status: 401, headers: cors });
  }

  try {
    const payload = await req.json();
    const record = payload.record ?? payload;
    const recipientId = record.recipient_id;
    if (!recipientId || !record.title) throw new Error('Invalid notification record');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const publicKey = Deno.env.get('VAPID_PUBLIC_KEY')!;
    const privateKey = Deno.env.get('VAPID_PRIVATE_KEY')!;
    const subject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com';
    if (!supabaseUrl || !serviceRoleKey || !publicKey || !privateKey) throw new Error('Push secrets are incomplete');

    webpush.setVapidDetails(subject, publicKey, privateKey);
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: schoolSettings, error: settingsError } = await admin.from('school_settings').select('push_enabled').limit(1).maybeSingle();
    if (settingsError) throw settingsError;
    if (schoolSettings && !schoolSettings.push_enabled) {
      return new Response(JSON.stringify({ sent: 0, attempted: 0, skipped: 'push-disabled' }), { headers: { ...cors, 'Content-Type': 'application/json' } });
    }
    const { data: subscriptions, error } = await admin.from('push_subscriptions').select('id,subscription').eq('user_id', recipientId);
    if (error) throw error;

    const body = JSON.stringify({ title: record.title, body: record.body ?? '', url: record.target_url ?? '/' });
    const outcomes = await Promise.all((subscriptions ?? []).map(async (row) => {
      try {
        await webpush.sendNotification(row.subscription, body);
        return { ok: true };
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) await admin.from('push_subscriptions').delete().eq('id', row.id);
        return { ok: false, status };
      }
    }));
    return new Response(JSON.stringify({ sent: outcomes.filter(x => x.ok).length, attempted: outcomes.length }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
});
