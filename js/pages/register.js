const { state, nav, initHeader, toast, api, setSession } = BarberCo;
const requestedNext = new URLSearchParams(location.search).get("next");
const safeNext = requestedNext && !requestedNext.includes(":") && !requestedNext.startsWith("//") ? requestedNext : "";
const loginHref = safeNext ? `login.html?next=${encodeURIComponent(safeNext)}` : "login.html";
document.querySelector("#app").innerHTML = `
  ${nav("login")}
  <section class="section top">
    <div class="auth-layout">
      <div class="auth-art"><div><p class="eyebrow">Account Registration</p><h2>Create your customer account.</h2><p>Your account keeps your booking details connected to the shop and lets staff see your request.</p></div></div>
      <form class="form-card" data-register><p class="eyebrow">Registration Page</p><h2>Register</h2><p class="muted">Create an account once and your email will come from your profile whenever you book.</p><label>Full name<input name="name" required minlength="2" maxlength="80" autocomplete="name" placeholder="Juan Dela Cruz"></label><label>Email<input type="email" name="email" required autocomplete="email" placeholder="customer@email.com"></label><label>Password<input type="password" name="password" required minlength="6" autocomplete="new-password" placeholder="Create password"></label><label><span><input type="checkbox" required> I agree to the terms and conditions</span></label><button class="button primary full" type="submit">Create account and continue</button><p class="muted">Already registered? <a class="inline" href="${loginHref}">Sign in instead</a></p></form>
    </div>
  </section>
`;
document.querySelector("[data-register]").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!event.target.reportValidity()) return;

  const data = new FormData(event.target);
  const name = String(data.get("name") || "").trim();
  const email = String(data.get("email") || "").trim().toLowerCase();
  const password = String(data.get("password") || "");

  try {
    const payload = await api("/auth/register", {
      method: "POST",
      body: JSON.stringify({ name, email, password })
    });
    setSession(payload);
    location.href = safeNext || "user-profile.html";
  } catch (error) {
    const offline = error.code === "BACKEND_UNAVAILABLE" || /fetch|network/i.test(error.message || "");
    toast(offline ? "Account registration is temporarily unavailable. Please try again shortly." : error.message || "This account could not be created.");
  }
});
initHeader("login");
