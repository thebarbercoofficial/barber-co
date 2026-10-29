const { nav, shopEndcap, initHeader, api } = BarberCo;
document.querySelector("#app").innerHTML = `
  ${nav("contact")}
  <section class="section top">
    <div class="contact-layout">
      <div><p class="eyebrow">Contact Us</p><h2>Questions before your cut?</h2><p class="muted">Reach the shop for service questions, booking concerns, or schedule assistance.</p><div class="panel"><div class="summary-list"><div><span>Phone</span><strong>0915 812 2246</strong></div><div><span>Address</span><strong>1197 JM Loyola St, Carmona, Cavite 4116</strong></div><div><span>Hours</span><strong>Mon-Fri 10:00-20:00<br>Sat-Sun 09:00-20:00</strong></div></div><a class="button primary small" data-facebook-contact href="https://www.facebook.com/TheBarberCo.Carmona/" target="_blank" rel="noreferrer">Message the shop on Facebook</a></div></div>
      <form class="form-card" data-contact><label>Full name<input name="name" required placeholder="Your name"></label><label>Email<input type="email" name="email" required placeholder="you@email.com"></label><label>Message<textarea name="message" required rows="5" placeholder="How can we help?"></textarea></label><button class="button primary full" type="submit">Send message</button></form>
    </div>
  </section>
  ${shopEndcap({ eyebrow: "Find us in Carmona", title: "Come see the space in person.", copy: "Questions about a cut, a booking, or the live queue? Send us a message, then stop by when it is time for your chair.", href: "queue.html", label: "See the walk-in queue" })}
`;
document.querySelector("[data-contact]").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const button = form.querySelector('[type="submit"]');
  if (button.disabled) return;
  button.disabled = true;
  let feedback = form.querySelector('[data-contact-feedback]');
  if (!feedback) {
    feedback = document.createElement('p');
    feedback.dataset.contactFeedback = '';
    feedback.setAttribute('role', 'status');
    form.append(feedback);
  }
  feedback.textContent = 'Sending your message...';
  const data = new FormData(form);
  try {
    const response = await api('/contact', { method: 'POST', body: JSON.stringify({ name: data.get('name'), email: data.get('email'), message: data.get('message') }) });
    feedback.textContent = response.message;
    form.reset();
  } catch (error) {
    feedback.textContent = error.message || 'Your message was not sent. Please use Facebook or call the shop.';
  } finally { button.disabled = false; }
});
initHeader("contact");
