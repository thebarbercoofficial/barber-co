const { state, nav, initHeader, toast, api, setSession } = BarberCo;
const requestedNext = new URLSearchParams(location.search).get("next");
const safeNext = requestedNext && /^(booking|index|services|barbers|queue|contact|about|user-profile)\.html(?:[?#].*)?$/.test(requestedNext) ? requestedNext : "";
const loginHref = safeNext ? `login.html?next=${encodeURIComponent(safeNext)}` : "login.html";
document.querySelector("#app").innerHTML = `
  ${nav("login")}
  <section class="section top">
    <div class="auth-layout">
      <div class="auth-art"><div><p class="eyebrow">Account Registration</p><h2>Create your customer account.</h2><p>Your account keeps your booking details connected to the shop and lets staff see your request.</p></div></div>
      <form class="form-card" data-register><p class="eyebrow">Registration Page</p><h2>Register</h2><label>Full name<input name="name" required minlength="2" maxlength="80" autocomplete="name" placeholder="Juan Dela Cruz"></label><label>Mobile number<input type="tel" inputmode="tel" name="phone" required autocomplete="tel" placeholder="09XXXXXXXXX or +639XXXXXXXXX"></label><label>Email<input type="email" name="email" required autocomplete="email" placeholder="customer@email.com"></label><label>Password<input type="password" name="password" required minlength="6" autocomplete="new-password" placeholder="Create password"></label><label><span><input type="checkbox" required> I agree to the terms and conditions</span></label><button class="button primary full" type="submit">Create account and continue</button><p class="muted">Already registered? <a class="inline" href="${loginHref}">Sign in instead</a></p></form>
    </div>
  </section>
`;
document.querySelector("[data-register]").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!event.target.reportValidity()) return;

  const data = new FormData(event.target);
  const name = String(data.get("name") || "").trim();
  const email = String(data.get("email") || "").trim().toLowerCase();
  const phone = String(data.get('phone') || '').trim();
  const password = String(data.get("password") || "");
  if (password !== String(data.get('confirmPassword') || '')) return toast('Passwords do not match.');
  const button = event.submitter || event.target.querySelector('[type="submit"]');
  if (button.disabled) return;
  button.disabled = true;

  try {
    const payload = await api("/auth/register", {
      method: "POST",
      body: JSON.stringify({ name, phone, email, password, confirmPassword: data.get('confirmPassword'), birthDate: data.get('birthDate') })
    });
    if (payload.verificationRequired) { showVerification(email); return; }
    setSession(payload);
    location.href = safeNext || "index.html";
  } catch (error) {
    const offline = error.code === "BACKEND_UNAVAILABLE" || /fetch|network/i.test(error.message || "");
    toast(offline ? "Account registration is temporarily unavailable. Please try again shortly." : error.message || "This account could not be created.");
    button.disabled = false;
  }
});
const passwordLabel = document.querySelector('[name="password"]').closest('label');
passwordLabel.querySelector('input').minLength = 8;
passwordLabel.insertAdjacentHTML('beforebegin', `<label>Date of birth<input type="date" name="birthDate" required max="${new Date().toLocaleDateString('en-CA')}"><small>Online wallet booking is available to adults under shop policy. Younger customers can join the walk-in queue.</small></label>`);
passwordLabel.insertAdjacentHTML('afterend', '<label>Confirm password<input type="password" name="confirmPassword" required minlength="8" autocomplete="new-password" placeholder="Repeat password"></label>');
const terms = document.querySelector('[data-register] input[type="checkbox"]').closest('label');
terms.classList.add('terms-consent');
initHeader("login");

function showVerification(email) {
  document.querySelector('[data-register]').innerHTML = `<h2>Verify your email</h2><p data-verification-message>Enter the six-digit code sent to your email.</p><label>Email<input type="email" name="verifyEmail" required></label><label>Email code<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label><button class="button primary full" type="button" data-verify>Verify and continue</button><button class="button secondary full" type="button" data-resend>Resend code</button>`;
  document.querySelector('[name="verifyEmail"]').value = email;
  document.querySelector('[data-verify]').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const payload = await api('/auth/verify-email', { method: 'POST', body: JSON.stringify({ email: document.querySelector('[name="verifyEmail"]').value, code: document.querySelector('[name="code"]').value }) });
      setSession(payload);
      location.href = safeNext || 'index.html';
    } catch (error) { document.querySelector('[data-verification-message]').textContent = error.message; }
    finally { button.disabled = false; }
  });
  document.querySelector('[data-resend]').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try { const payload = await api('/auth/resend-verification', { method: 'POST', body: JSON.stringify({ email: document.querySelector('[name="verifyEmail"]').value }) }); document.querySelector('[data-verification-message]').textContent = payload.message; }
    catch (error) { document.querySelector('[data-verification-message]').textContent = error.message; }
    finally { button.disabled = false; }
  });
}
const verificationEmail = new URLSearchParams(location.search).get('verify');
if (verificationEmail) showVerification(verificationEmail);
