const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { OAuth2Client } = require('google-auth-library');

// This Windows-only operator utility never writes plaintext tokens to disk or stdout.
function powershell(command, input) {
  const env = { ...process.env, BARBERCO_CREDENTIAL_INPUT: input || '' };
  // PowerShell 7 module paths can prevent Windows PowerShell loading its security module.
  delete env.PSModulePath;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference = 'Stop'; " + command], { env, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error('Encrypted credential storage could not be accessed.');
  return result.stdout.trim();
}

async function main() {
  if (process.platform !== 'win32') throw new Error('Run this operator utility on the Windows account that saved the OAuth client.');
  const directory = path.join(process.env.LOCALAPPDATA, 'BarberCo', 'Secrets');
  const config = JSON.parse(powershell("$s = Import-Clixml -LiteralPath (Join-Path $env:LOCALAPPDATA 'BarberCo\\Secrets\\gmail-client-senzen.xml'); [System.Net.NetworkCredential]::new('', $s).Password"));
  const settings = config.installed;
  if (!settings?.client_id || !settings.client_secret) throw new Error('A Desktop OAuth client is required.');
  const state = crypto.randomBytes(32).toString('hex');
  const server = http.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const redirect = `http://127.0.0.1:${server.address().port}/oauth/callback`;
  const client = new OAuth2Client(settings.client_id, settings.client_secret, redirect);
  const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
  const timer = setTimeout(() => { console.error('Authorization expired. Run the utility again.'); server.close(); process.exitCode = 1; }, 10 * 60000);
  let exchanging = false;
  server.on('request', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const url = new URL(req.url, redirect);
    if (url.pathname !== '/oauth/callback') return res.writeHead(404).end('Not found.');
    if (url.searchParams.get('state') !== state) return res.writeHead(400).end('Invalid authorization state.');
    if (exchanging) return res.writeHead(409).end('Authorization already processing.');
    exchanging = true;
    try {
      if (url.searchParams.has('error') || !url.searchParams.get('code')) throw new Error('Authorization was not granted.');
      const { tokens } = await client.getToken({ code: url.searchParams.get('code'), codeVerifier });
      const scopes = String(tokens.scope || '').split(' ');
      if (!tokens.refresh_token || !scopes.includes('https://www.googleapis.com/auth/gmail.send') || scopes.some((scope) => scope !== 'https://www.googleapis.com/auth/gmail.send')) throw new Error('Expected a refresh token with send-only permission.');
      const payload = JSON.stringify({ client_id: settings.client_id, client_secret: settings.client_secret, refresh_token: tokens.refresh_token, sender: 'senzen2426@gmail.com', authorizedAt: new Date().toISOString() });
      powershell("$value = $env:BARBERCO_CREDENTIAL_INPUT; $secret = ConvertTo-SecureString -String $value -AsPlainText -Force; $file = Join-Path $env:LOCALAPPDATA 'BarberCo\\Secrets\\gmail-sender-senzen.xml'; Export-Clixml -InputObject $secret -LiteralPath $file; $saved = Import-Clixml -LiteralPath $file; if ([System.Net.NetworkCredential]::new('', $saved).Password -cne $value) { throw 'Credential verification failed' }", payload);
      res.end('BarberCo send-only authorization saved securely. You can close this tab.');
      console.log(`Send-only credential encrypted in ${directory}. No tokens printed.`);
    } catch {
      res.writeHead(400).end('Authorization could not be saved. Return to Codex; no token was displayed.');
      console.error('Authorization failed; no credential details logged.');
      process.exitCode = 1;
    } finally { clearTimeout(timer); server.close(); }
  });
  const url = client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', login_hint: 'senzen2426@gmail.com', scope: ['https://www.googleapis.com/auth/gmail.send'], state, code_challenge: codeChallenge, code_challenge_method: 'S256' });
  console.log(`Authorize the sender in Chrome:\n${url}`);
}

main().catch(() => { console.error('Gmail authorization setup failed; no credential details logged.'); process.exitCode = 1; });
