const { state, nav, initHeader, toast, save, api, setSession } = BarberCo;
document.querySelector("#app").innerHTML = `
  ${nav("login")}
  <section class="section top">
    <div class="auth-layout">
      <div class="auth-art"><div><p class="eyebrow">Account Registration</p><h2>Create your customer account.</h2><p>Registration fields match the manuscript wireframe and are ready for backend validation later.</p></div></div>
      <form class="form-card" data-register><p class="eyebrow">Registration Page</p><h2>Register</h2><label>Full name<input name="name" required placeholder="Juan Dela Cruz"></label><label>Email<input type="email" name="email" required placeholder="customer@email.com"></label><label>Password<input type="password" name="password" required placeholder="Create password"></label><label><span><input type="checkbox" required> I agree to the terms and conditions</span></label><button class="button primary full" type="submit">Create account</button><p class="muted">Already registered? <a class="inline" href="login.html">Login here</a></p></form>
    </div>
  </section>
`;
document.querySelector("[data-register]").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(event.target);
  try {
    const payload = await api("/auth/register", {
      method: "POST",
      body: JSON.stringify({ name: data.get("name"), email: data.get("email"), password: data.get("password") })
    });
    setSession(payload);
    toast("Account created.");
    location.href = "user-profile.html";
  } catch (error) {
    state.user.name = data.get("name");
    state.user.email = data.get("email");
    const email = String(data.get("email")).trim().toLowerCase();
    if (!state.accounts.some((account) => account.email.toLowerCase() === email)) {
      state.accounts.push({ id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()), name: data.get("name"), email, password: data.get("password"), role: "customer", phone: "" });
    }
    save();
    toast(error.message || "Account saved locally until backend is online.");
  }
});
initHeader("login");
