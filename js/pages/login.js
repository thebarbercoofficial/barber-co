const { nav, initHeader, api, setSession } = BarberCo;

document.querySelector("#app").innerHTML = `
  ${nav("login")}
  <main class="login-screen">
    <section class="login-card" aria-labelledby="login-title">
      <p class="eyebrow">Customer Access</p>
      <h1 id="login-title">Welcome back.</h1>
      <p class="login-intro">Sign in to manage bookings, queue updates, and your barber preferences.</p>
      <form data-login>
        <div class="login-methods" role="group" aria-label="Sign-in method"><button class="method active" type="button" data-login-method="phone" aria-pressed="true">Mobile number</button><button class="method" type="button" data-login-method="email" aria-pressed="false">Email</button></div>
        <label><span data-identifier-label>Mobile number</span><input type="tel" inputmode="tel" name="identifier" required autocomplete="username" placeholder="09XXXXXXXXX or +639XXXXXXXXX"></label>
        <label>Password<input type="password" name="password" required autocomplete="current-password" placeholder="Password"></label>
        <button class="button primary full" type="submit">Sign In</button>
      </form>
      <div class="login-links">
        <a href="register.html">Don't have an account? click here</a>
        <button type="button" data-open-forgot>Forgot password?</button>
      </div>
      <p class="login-note">Staff access is reserved for authorized accounts.</p>
    </section>

    <aside class="login-alert" data-login-alert role="alert">
      <button type="button" aria-label="Close alert" data-close-alert>x</button>
      <strong>Wrong password</strong>
      <span>Try again!</span>
    </aside>

    <section class="login-modal forgot-modal" data-forgot-modal aria-label="Forgotten password dialog">
      <button class="modal-close" type="button" aria-label="Close" data-close-forgot>x</button>
      <h2>Forgotten password?</h2>
      <label>Email<input type="email" data-forgot-email placeholder="Email"></label>
      <div class="modal-actions">
        <button class="button secondary" type="button" data-close-forgot>Cancel</button>
        <button class="button primary" type="button" data-send-code>Send code</button>
      </div>
    </section>

    <section class="login-modal reset-modal" data-reset-modal aria-label="Reset password dialog">
      <button class="modal-close" type="button" aria-label="Close" data-close-reset>x</button>
      <label>Email<input type="email" data-reset-email placeholder="User"></label>
      <label>Email code<input type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" data-reset-code></label>
      <label>New password<input type="password" minlength="8" autocomplete="new-password" data-reset-password></label>
      <label>Confirm password<input type="password" minlength="8" autocomplete="new-password" data-reset-confirm></label>
      <button class="button primary full" type="button" data-confirm-reset>Confirm</button>
    </section>
  </main>
`;

document.querySelectorAll('[data-login-method]').forEach((button) => button.addEventListener('click', () => {
  const phone = button.dataset.loginMethod === 'phone';
  const input = document.querySelector('[name="identifier"]');
  document.querySelector('[data-identifier-label]').textContent = phone ? 'Mobile number' : 'Email';
  input.type = phone ? 'tel' : 'email';
  input.inputMode = phone ? 'tel' : 'email';
  input.placeholder = phone ? '09XXXXXXXXX or +639XXXXXXXXX' : 'you@example.com';
  input.value = '';
  document.querySelector('[name="password"]').value = '';
  document.querySelector('[data-login-alert]').classList.remove('show');
  window.clearTimeout(showLoginAlert.timer);
  document.querySelectorAll('[data-login-method]').forEach((method) => {
    method.classList.toggle('active', method === button);
    method.setAttribute('aria-pressed', String(method === button));
  });
  input.focus();
}));

function showLoginAlert(title, message, isSuccess = false, duration = 3200) {
  const alert = document.querySelector("[data-login-alert]");
  alert.querySelector("strong").textContent = title;
  alert.querySelector("span").textContent = message;
  alert.classList.toggle("success", isSuccess);
  alert.classList.add("show");
  window.clearTimeout(showLoginAlert.timer);
  if (duration > 0) showLoginAlert.timer = window.setTimeout(() => alert.classList.remove("show"), duration);
}

function startLoginCooldown(seconds) {
  const form = document.querySelector('[data-login]');
  const controls = [...form.querySelectorAll('input, button'), ...document.querySelectorAll('[data-login-method]')];
  const expiresAt = Date.now() + seconds * 1000;
  controls.forEach((control) => { control.disabled = true; });
  window.clearInterval(startLoginCooldown.timer);
  const update = () => {
    const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
    if (remaining <= 0) {
      window.clearInterval(startLoginCooldown.timer);
      controls.forEach((control) => { control.disabled = false; });
      showLoginAlert('You can try again', 'The temporary sign-in lock has ended.');
      return;
    }
    const minutes = Math.floor(remaining / 60);
    const secondsLeft = String(remaining % 60).padStart(2, '0');
    showLoginAlert('Sign-in temporarily locked', `Too many incorrect attempts. Try again in ${minutes}:${secondsLeft}.`, false, 0);
  };
  update();
  startLoginCooldown.timer = window.setInterval(update, 1000);
}

document.querySelector("[data-login]").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(event.target);
  const identifier = String(data.get("identifier") || '').trim();
  const password = String(data.get("password"));
  const phoneMode = document.querySelector('[data-login-method="phone"]').getAttribute('aria-pressed') === 'true';
  if (phoneMode && !/^(09\d{9}|\+?639\d{9})$/.test(identifier.replace(/[\s()-]/g, ''))) {
    showLoginAlert('Invalid mobile number', 'Use a Philippine mobile number, or switch to Email.');
    return;
  }
  const button = event.submitter || event.target.querySelector('[type="submit"]');
  if (button.disabled) return;
  button.disabled = true;

  try {
    const payload = await api("/auth/login", { method: "POST", body: JSON.stringify({ identifier, password, method: phoneMode ? 'phone' : 'email' }) });
    setSession(payload);
    const next = new URLSearchParams(location.search).get("next");
    const safeNext = next && /^(booking|index|services|barbers|queue|contact|about|user-profile)\.html(?:[?#].*)?$/.test(next) ? next : "";
    location.href = payload.user.role === "admin" ? "admin-dashboard.html" : payload.user.role === "moderator" ? "admin-logbook.html" : safeNext || "index.html";
  } catch (error) {
    if (error.verificationRequired) location.href = `register.html?verify=${encodeURIComponent(identifier)}`;
    const offline = error.code === "BACKEND_UNAVAILABLE" || /fetch|network/i.test(error.message || "");
    if (error.status === 429 && error.retryAfter > 0) {
      startLoginCooldown(error.retryAfter);
    } else {
      showLoginAlert(offline ? "Service unavailable" : "Sign in failed", offline ? "The account service is not connected. Please try again shortly." : error.message || "Check your mobile number or email and password.", false, error.status === 401 ? 0 : 3200);
      button.disabled = false;
    }
  }
});

document.querySelector("[data-open-forgot]").addEventListener("click", () => {
  document.querySelector("[data-forgot-modal]").classList.add("show");
});

document.querySelectorAll("[data-close-forgot]").forEach((button) => {
  button.addEventListener("click", () => document.querySelector("[data-forgot-modal]").classList.remove("show"));
});

document.querySelector("[data-send-code]").addEventListener("click", async (event) => {
  const email = document.querySelector("[data-forgot-email]").value;
  event.currentTarget.disabled = true;
  try {
    const payload = await api('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
    document.querySelector('[data-forgot-modal]').classList.remove('show');
    document.querySelector('[data-reset-email]').value = email;
    document.querySelector('[data-reset-modal]').classList.add('show');
    showLoginAlert('Check your email', payload.message, true);
  } catch (error) { showLoginAlert('Code not sent', error.message); }
  finally { document.querySelector('[data-send-code]').disabled = false; }
});

document.querySelector("[data-close-reset]").addEventListener("click", () => {
  document.querySelector("[data-reset-modal]").classList.remove("show");
});

document.querySelector("[data-confirm-reset]").addEventListener("click", async (event) => {
  event.currentTarget.disabled = true;
  try {
    const payload = await api('/auth/reset-password', { method: 'POST', body: JSON.stringify({ email: document.querySelector('[data-reset-email]').value, code: document.querySelector('[data-reset-code]').value, password: document.querySelector('[data-reset-password]').value, confirmPassword: document.querySelector('[data-reset-confirm]').value }) });
    document.querySelector('[data-reset-modal]').classList.remove('show');
    document.querySelector('[data-login]').reset();
    showLoginAlert('Password changed', payload.message, true);
  } catch (error) { showLoginAlert('Password not changed', error.message); }
  finally { document.querySelector('[data-confirm-reset]').disabled = false; }
});

document.querySelector("[data-close-alert]").addEventListener("click", () => {
  document.querySelector("[data-login-alert]").classList.remove("show");
});

document.querySelector('.login-links').insertAdjacentHTML('beforeend', '<button type="button" data-open-sms-recovery>Lost email access? Recover by SMS</button>');
document.querySelector('main').insertAdjacentHTML('beforeend', `<section class="login-modal" data-sms-recovery aria-label="SMS account recovery"><button class="modal-close" type="button" aria-label="Close SMS recovery" data-close-sms>x</button><h2>Account recovery</h2><p>Use a previously verified number. Globe/DITO supported; Smart/TNT/Sun unavailable with the current sender. Maximum 3 codes per number daily.</p><label>Recover<select data-recovery-purpose><option value="password">Password</option><option value="email">Email reminder</option></select></label><label>Mobile number<input type="tel" autocomplete="tel" data-recovery-phone></label><button class="button secondary" type="button" data-recovery-send>Send SMS code</button><label>SMS code<input inputmode="numeric" autocomplete="one-time-code" maxlength="6" data-recovery-code></label><div data-recovery-passwords><label>New password<input type="password" minlength="8" autocomplete="new-password" data-recovery-password></label><label>Confirm password<input type="password" minlength="8" autocomplete="new-password" data-recovery-confirm></label></div><p role="status" data-recovery-message></p><button class="button primary" type="button" data-recovery-complete>Confirm recovery</button></section>`);
const recoveryModal = document.querySelector('[data-sms-recovery]');
document.querySelector('[data-open-sms-recovery]').onclick = () => recoveryModal.classList.add('show');
document.querySelector('[data-close-sms]').onclick = () => recoveryModal.classList.remove('show');
document.querySelector('[data-recovery-purpose]').onchange = (event) => { document.querySelector('[data-recovery-passwords]').hidden = event.target.value === 'email'; };
for (const [selector, endpoint] of [['[data-recovery-send]', '/auth/sms-recovery'], ['[data-recovery-complete]', '/auth/sms-recovery/complete']]) {
  document.querySelector(selector).onclick = async (event) => {
    const button = event.currentTarget;
    if (button.disabled) return;
    button.disabled = true;
    try {
      const payload = await api(endpoint, { method: 'POST', body: JSON.stringify({ phone: document.querySelector('[data-recovery-phone]').value, purpose: document.querySelector('[data-recovery-purpose]').value, code: document.querySelector('[data-recovery-code]').value, password: document.querySelector('[data-recovery-password]').value, confirmPassword: document.querySelector('[data-recovery-confirm]').value }) });
      document.querySelector('[data-recovery-message]').textContent = payload.message;
      if (selector === '[data-recovery-send]') { window.setTimeout(() => { button.disabled = false; }, 60000); return; }
      document.querySelector('[data-recovery-code]').value = '';
      document.querySelector('[data-recovery-password]').value = '';
      document.querySelector('[data-recovery-confirm]').value = '';
    } catch (error) { document.querySelector('[data-recovery-message]').textContent = error.message; }
    button.disabled = false;
  };
}
initHeader("login");
