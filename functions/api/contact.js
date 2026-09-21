// Cloudflare Pages Function — POST /api/contact
// Receives the help-form submission, verifies the Turnstile token
// server-side, then sends the message via the Brevo transactional API.
//
// Secrets (set with: wrangler pages secret put <NAME> --project-name=foldervideoplayer-site):
//   BREVO_API_KEY          — xkeysib-... from Brevo SMTP & API -> API Keys
//   TURNSTILE_SECRET_KEY   — 0x... secret for the contact-form Turnstile widget

export async function onRequestPost(context) {
  const { request, env } = context;

  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  // CORS preflight (in case someone calls cross-origin)
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  try {
    const body = await request.json().catch(() => null);
    if (!body) return json(cors, { ok: false, error: 'bad-json' }, 400);

    const name = String(body.name || '').trim();
    const email = String(body.email || '').trim();
    const version = String(body.version || 'not stated').trim();
    const server = String(body.server || 'not stated').trim();
    const message = String(body.message || '').trim();
    const token = String(body['cf-turnstile-response'] || '').trim();

    // -- basic field validation (mirror the client-side rules) --
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json(cors, { ok: false, error: 'bad-email' }, 400);
    }
    if (message.length < 10) {
      return json(cors, { ok: false, error: 'short-message' }, 400);
    }

    // -- server-side Turnstile verification (authoritative; never trust client) --
    const expectedAction = 'contact';
    const expectedHostnames = new Set(
      (env.TURNSTILE_HOSTNAMES || '').split(',').map((s) => s.trim()).filter(Boolean)
    );
    if (expectedHostnames.size === 0) {
      return json(cors, { ok: false, error: 'captcha-failed' }, 403);
    }
    if (typeof token !== 'string' || token.length === 0 || token.length > 2048) {
      return json(cors, { ok: false, error: 'captcha-failed' }, 403);
    }
    let tsJson;
    try {
      const tsForm = new FormData();
      tsForm.append('secret', env.TURNSTILE_SECRET_KEY || '');
      tsForm.append('response', token);
      const clientIp = request.headers.get('CF-Connecting-IP');
      if (clientIp) tsForm.append('remoteip', clientIp);
      const tsResp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        body: tsForm,
        signal: AbortSignal.timeout(10_000),
      });
      if (!tsResp.ok) throw new Error('siteverify ' + tsResp.status);
      tsJson = await tsResp.json();
    } catch (err) {
      // Network error, non-2xx, or non-JSON body from siteverify. Fail closed.
      console.error('siteverify error', err);
      return json(cors, { ok: false, error: 'captcha-failed' }, 403);
    }
    if (!tsJson.success || tsJson.action !== expectedAction || !expectedHostnames.has(tsJson.hostname)) {
      return json(cors, { ok: false, error: 'captcha-failed' }, 403);
    }

    const attachment = sanitizeAttachments(body.attachments);

    // -- send via Brevo transactional email --
    const subject = 'FolderVideoPlayer support — ' + (name || 'customer');
    const text =
      'Name: ' + (name || '—') + '\n' +
      'Email: ' + email + '\n' +
      'App version: ' + version + '\n' +
      'Share server: ' + server + '\n' +
      'Page: ' + String(body.page || '') + '\n' +
      'Screenshots: ' + (attachment.length ? attachment.map((a) => a.name).join(', ') : 'none') + '\n\n' +
      message;

    const brevoResp = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': env.BREVO_API_KEY || '',
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        sender: { name: 'FolderVideoPlayer Support', email: 'support@tangrick.com' },
        to: [{ email: 'richardtang@me.com', name: 'Richard Tang' }],
        replyTo: { email, name: name || 'Customer' },
        subject,
        textContent: text,
        ...(attachment.length ? { attachment } : {}),
      }),
    });

    if (!brevoResp.ok) {
      const errText = await brevoResp.text().catch(() => '');
      console.error('Brevo send failed', brevoResp.status, errText.slice(0, 500));
      return json(cors, { ok: false, error: 'send-failed' }, 502);
    }

    return json(cors, { ok: true });
  } catch (err) {
    console.error('contact handler error', err);
    return json(cors, { ok: false, error: 'server-error' }, 500);
  }
}

// OPTIONS handled above; GET just tells callers the endpoint exists
export async function onRequestGet() {
  return new Response('contact endpoint', { status: 200 });
}

// Screenshots are re-checked here, never trusting what the browser sent: the
// client downscales to JPEG, so anything that is not a small, real image is
// dropped rather than mailed on. Brevo's own attachment ceiling is 10 MB per
// message; 6 MB of decoded image leaves room for the rest.
export function sanitizeAttachments(list) {
  const MAX_ATTACHMENTS = 3;
  const MAX_ATTACHMENT_BYTES = 6 * 1024 * 1024;
  const MAGIC = [
    { prefix: '/9j/', ext: 'jpg' },          // JPEG
    { prefix: 'iVBORw0KGgo', ext: 'png' },   // PNG
    { prefix: 'UklGR', ext: 'webp' },        // WebP (RIFF)
  ];
  const out = [];
  let bytes = 0;
  const sent = Array.isArray(list) ? list.slice(0, MAX_ATTACHMENTS) : [];
  for (const item of sent) {
    const content = String((item && item.content) || '');
    if (!content || !/^[A-Za-z0-9+/]+={0,2}$/.test(content)) continue;
    const kind = MAGIC.find((m) => content.startsWith(m.prefix));
    if (!kind) continue;
    const size = Math.floor(content.length * 0.75);
    if (bytes + size > MAX_ATTACHMENT_BYTES) break;
    bytes += size;
    const base = String((item && item.name) || 'screenshot')
      .replace(/\.[^.]+$/, '')
      .replace(/[^A-Za-z0-9 _-]/g, '')
      .trim()
      .slice(0, 40) || 'screenshot';
    out.push({ name: base + '.' + kind.ext, content });
  }
  return out;
}

function json(cors, obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...cors,
    },
  });
}
