// mp-webhook: Mercado Pago payment notifications. Nothing in the notification is trusted: its signature is
// checked (x-signature, HMAC-SHA256 with the webhook secret), then the payment is fetched from the Mercado
// Pago API with our token and what the API says is applied to the order (shop_apply_payment), which unlocks
// the cars only for an approved payment of the exact price, and takes them back on refund or chargeback.
// Secrets (Supabase dashboard): MP_ACCESS_TOKEN, MP_WEBHOOK_SECRET.
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MP_TOKEN = Deno.env.get('MP_ACCESS_TOKEN') || '';
const MP_SECRET = (Deno.env.get('MP_WEBHOOK_SECRET') || '').trim();

const enc = new TextEncoder();
async function hmacHex(key: string, msg: string) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
  return [...sig].map(b => b.toString(16).padStart(2, '0')).join('');
}
function sameText(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
// Mercado Pago's scheme: manifest "id:<data.id>;request-id:<x-request-id>;ts:<ts>;" signed with the secret
async function signatureOk(req: Request, dataId: string) {
  const header = req.headers.get('x-signature') || '';
  const requestId = req.headers.get('x-request-id') || '';
  const parts = Object.fromEntries(header.split(',').map(p => p.trim().split('=', 2) as [string, string]));
  if (!parts.ts || !parts.v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(parts.ts) / (parts.ts.length > 11 ? 1000 : 1)) > 3600) return false;
  let manifest = '';
  if (dataId) manifest += `id:${/^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId};`;
  if (requestId) manifest += `request-id:${requestId};`;
  manifest += `ts:${parts.ts};`;
  return sameText(await hmacHex(MP_SECRET, manifest), parts.v1);
}

Deno.serve(async req => {
  if (req.method !== 'POST') return new Response('method_not_allowed', { status: 405 });
  if (!MP_TOKEN || !MP_SECRET) return new Response('shop_not_configured', { status: 503 });
  const url = new URL(req.url);
  let body: Record<string, any> = {};
  try { body = await req.json(); } catch { /* some notifications carry only the query */ }
  const type = body.type || body.topic || url.searchParams.get('type') || url.searchParams.get('topic') || '';
  const dataId = String(url.searchParams.get('data.id') || body?.data?.id || url.searchParams.get('id') || '');

  // only payment notifications matter here; everything else is acknowledged and ignored
  if (type !== 'payment' || !/^\d{1,20}$/.test(dataId)) return new Response('ignored', { status: 200 });
  // the older feed (IPN) notifications carry no signature: acknowledged and not used (the signed webhook
  // for the same payment is)
  if (!req.headers.get('x-signature')) return new Response('ignored_unsigned', { status: 200 });
  if (!(await signatureOk(req, dataId))) {
    const sig = req.headers.get('x-signature') || '';
    console.error('bad signature', JSON.stringify({ dataId, requestId: req.headers.get('x-request-id'), ts: /ts=([^,]+)/.exec(sig)?.[1], secretLength: MP_SECRET.length }));
    return new Response('bad_signature', { status: 401 });
  }

  const res = await fetch(`https://api.mercadopago.com/v1/payments/${dataId}`, { headers: { Authorization: `Bearer ${MP_TOKEN}` } });
  if (res.status === 404) return new Response('unknown_payment', { status: 200 });
  if (!res.ok) return new Response('mp_unavailable', { status: 502 }); // Mercado Pago retries later
  const pay = await res.json();
  const order = String(pay.external_reference || '');
  if (!/^[0-9a-f-]{36}$/i.test(order)) return new Response('not_ours', { status: 200 });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.rpc('shop_apply_payment', {
    p_order: order,
    p_payment_id: String(pay.id),
    p_status: String(pay.status),
    p_status_detail: pay.status_detail ? String(pay.status_detail) : null,
    p_amount_cents: Math.round(Number(pay.transaction_amount) * 100),
    p_currency: String(pay.currency_id),
  });
  if (error) {
    console.error('apply payment', dataId, order, error.message);
    // a payment that can never apply (wrong amount, unknown order) is acknowledged; anything else is retried
    const final = /amount_mismatch|unknown_order|unknown_status/.test(error.message);
    return new Response(final ? 'rejected' : 'retry', { status: final ? 200 : 500 });
  }
  console.log('payment', dataId, 'order', order, '->', data);
  return new Response('ok', { status: 200 });
});
