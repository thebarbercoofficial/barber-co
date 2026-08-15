const { nav, initHeader, toast } = BarberCo;
document.querySelector("#app").innerHTML = `
  ${nav("contact")}
  <section class="section top">
    <div class="contact-layout">
      <div><p class="eyebrow">Contact Us</p><h2>Questions before your cut?</h2><p class="muted">Reach the shop for service questions, booking concerns, or schedule assistance.</p><div class="panel"><div class="summary-list"><div><span>Email</span><strong>thebarberco@example.com</strong></div><div><span>Phone</span><strong>+63 900 000 0000</strong></div><div><span>Address</span><strong>Carmona, Cavite</strong></div></div></div></div>
      <form class="form-card" data-contact><label>Full name<input name="name" required placeholder="Your name"></label><label>Email<input type="email" name="email" required placeholder="you@email.com"></label><label>Message<textarea name="message" required rows="5" placeholder="How can we help?"></textarea></label><button class="button primary full" type="submit">Send message</button></form>
    </div>
  </section>
`;
document.querySelector("[data-contact]").addEventListener("submit", (event) => {
  event.preventDefault();
  event.target.reset();
  toast("Message drafted. Backend email delivery comes later.");
});
initHeader("contact");
