const { state, nav, initHeader, toast, api, setSession } = BarberCo;
document.querySelector("#app").innerHTML = `
  ${nav("login")}
  <section class="section top">
    <div class="auth-layout">
      <div class="auth-art"><div><p class="eyebrow">Account Registration</p><h2>Create your customer account.</h2><p>Registration fields match the manuscript wireframe and are ready for backend validation later.</p></div></div>
      <form class="form-card" data-register><p class="eyebrow">Registration Page</p><h2>Register</h2><label>Full name<input name="name" required minlength="2" maxlength="80" autocomplete="name" placeholder="Juan Dela Cruz"></label><label>Email<input type="email" name="email" required autocomplete="email" placeholder="customer@email.com"></label><label>Password<input type="password" name="password" required minlength="6" autocomplete="new-password" placeholder="Create password"></label><label><span><input type="checkbox" required> I agree to the terms and conditions</span></label><button class="button primary full" type="submit">Create account</button><p class="muted">Already registered? <a class="inline" href="login.html">Login here</a></p></form>
    </div>
  </section>
`;
function createLocalAccount({ name, email, password }) {
  const existing = state.accounts.find((account) => String(account.email || "").toLowerCase() === email);
  if (existing) throw new Error("An account with this email already exists. Try logging in.");

  const id = crypto.randomUUID ? crypto.randomUUID() : `local-${Date.now()}`;
  const account = { id, name, email, password, role: "customer", phone: "" };
  state.accounts.push(account);
  setSession({
    token: `local-${id}`,
    user: { name, email, role: "customer", phone: "" }
  });
}

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
    location.href = "user-profile.html";
  } catch (error) {
    if (error.status === 400 || error.status === 409) {
      toast(error.message || "Please check your registration details.");
      return;
    }

    try {
      createLocalAccount({ name, email, password });
      location.href = "user-profile.html";
    } catch (localError) {
      toast(localError.message || "This account could not be created.");
    }
  }
});
initHeader("login");
