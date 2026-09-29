// create-checkout: opens an order for the signed-in player and a Mercado Pago Checkout Pro preference for it.
// The browser sends only which product it wants; the price, the order and the checkout are made here.
// Secrets (set in the Supabase dashboard, never in the repository): MP_ACCESS_TOKEN.
// Optional: SITE_ORIGINS (comma-separated extra origins allowed to call this and to be returned to).
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MP_TOKEN = Deno.env.get('MP_ACCESS_TOKEN') || '';
const ORIGINS = [
  'https://www.nightcruisegame.com',
  'https://nightcruisegame.com',
  'https://night-cruise.contatoadoniasjunior.workers.dev',
  'http://localhost:8765',
  ...(Deno.env.get('SITE_ORIGINS') || '').split(',').map(s => s.trim()).filter(Boolean),
];
const DEFAULT_SITE = 'https://www.nightcruisegame.com';

const cors = (origin: string | null) => ({
  'Access-Control-Allow-Origin': origin && ORIGINS.includes(origin) ? origin : DEFAULT_SITE,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
});

Deno.serve(async req => {
  const origin = req.headers.get('Origin');
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors(origin), 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(origin) });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!MP_TOKEN) return json({ error: 'shop_not_configured' }, 503);

  // who is asking: the player's own access token, checked by Supabase Auth
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: who, error: authError } = await admin.auth.getUser(token);
  if (authError || !who?.user) return json({ error: 'not_authenticated' }, 401);
  const user = who.user;

  let product = '';
  try { product = String((await req.json()).product || ''); } catch { /* empty body */ }
  if (!/^[a-z0-9_]{1,32}$/.test(product)) return json({ error: 'unknown_product' }, 400);

  const { data: rows, error: orderError } = await admin.rpc('shop_create_order', { p_user: user.id, p_product: product });
  if (orderError) {
    const code = /already_owned|unknown_product|too_frequent|unknown_user/.exec(orderError.message)?.[0] || 'order_failed';
    return json({ error: code }, code === 'already_owned' ? 409 : code === 'too_frequent' ? 429 : 400);
  }
  const order = rows[0];

  // back to the page the player came from (only known sites)
  const site = origin && ORIGINS.includes(origin) ? origin : DEFAULT_SITE;
  const back = (s: string) => `${site}/?pagamento=${s}`;
  const pref: Record<string, unknown> = {
    items: [{ id: product, title: order.title, quantity: 1, unit_price: order.amount_cents / 100, currency_id: order.currency }],
    external_reference: order.order_id,
    metadata: { order_id: order.order_id },
    back_urls: { success: back('aprovado'), pending: back('pendente'), failure: back('falhou') },
    notification_url: `${SUPABASE_URL}/functions/v1/mp-webhook`,
    statement_descriptor: 'NIGHTCRUISE',
    expires: true,
    expiration_date_to: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
  };
  if (site.startsWith('https://')) pref.auto_return = 'approved';

  const res = await fetch('https://api.mercadopago.com/checkout/preferences', {
    method: 'POST',
    headers: { Authorization: `Bearer ${MP_TOKEN}`, 'Content-Type': 'application/json', 'X-Idempotency-Key': order.order_id },
    body: JSON.stringify(pref),
  });
  if (!res.ok) {
    console.error('mercadopago preference', res.status, await res.text());
    return json({ error: 'checkout_failed' }, 502);
  }
  const mp = await res.json();
  await admin.rpc('shop_set_preference', { p_order: order.order_id, p_preference: mp.id });
  return json({ url: mp.init_point, order: order.order_id });
});
