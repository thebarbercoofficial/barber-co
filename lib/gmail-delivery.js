const { OAuth2Client } = require('google-auth-library');
const MailComposer = require('nodemailer/lib/mail-composer');

const configured = (env = process.env) => Boolean(env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN && env.GMAIL_SENDER);
const unavailable = () => Object.assign(new Error('Gmail delivery failed. Please contact the shop or retry later.'), { status: 503 });

function createSender({ env = process.env, clientFactory = (id, secret) => new OAuth2Client(id, secret) } = {}) {
  let client;
  let identity;
  return async function send(to, subject, text, key) {
    if (!configured(env)) throw unavailable();
    if (!/^[^\s<>@]+@gmail\.com$/i.test(env.GMAIL_SENDER)) throw unavailable();
    if (/[\r\n]/.test(to) || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(to)) throw unavailable();
    try {
      const nextIdentity = JSON.stringify([env.GMAIL_CLIENT_ID, env.GMAIL_CLIENT_SECRET, env.GMAIL_REFRESH_TOKEN]);
      if (identity !== nextIdentity) {
        client = clientFactory(env.GMAIL_CLIENT_ID, env.GMAIL_CLIENT_SECRET);
        client.setCredentials({ refresh_token: env.GMAIL_REFRESH_TOKEN });
        identity = nextIdentity;
      }
      const message = await new MailComposer({
        from: { name: 'The Barber Co', address: env.GMAIL_SENDER }, to, subject, text,
        messageId: `<${require('node:crypto').createHash('sha256').update(String(key)).digest('hex')}@barberco.local>`
      }).compile().build();
      // Do not retry an ambiguous send: Gmail does not provide an idempotency key.
      const result = await client.request({
        url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
        method: 'POST', data: { raw: message.toString('base64url') },
        timeout: 12000, retry: false
      });
      if (!result.data?.id) throw unavailable();
      return result.data.id;
    } catch { throw unavailable(); }
  };
}

module.exports = { configured, createSender, send: createSender() };
