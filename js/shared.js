const BarberCo = (() => {
  const defaults = {
    selectedServiceId: "basic",
    selectedBarberId: "michael",
    paymentMethod: "GCash",
    user: {
      name: "Juan Dela Cruz",
      email: "customer@email.com",
      username: "juandelacruz",
      phone: "+63 900 000 0000",
      location: "Carmona, Cavite",
      bio: "Prefers clean fades and afternoon appointments."
    },
    admin: {
      name: "The Barber Co Admin",
      email: "admin@thebarberco.test",
      address: "Carmona, Cavite",
      contact: "+63 900 111 2222",
      location: "Carmona",
      postal: "4116"
    },
    booking: null,
    reportDate: new Date().toISOString().slice(0, 10),
    services: [
      { id: "basic", name: "Basic Haircut", price: 150, duration: "30 min", detail: "Clean haircut finished with pomade.", icon: "CUT" },
      { id: "shave", name: "Haircut + Shave", price: 200, duration: "45 min", detail: "Haircut paired with a sharp beard shave.", icon: "SHV" },
      { id: "premium", name: "Premium Cut", price: 250, duration: "45 min", detail: "Detailed cut with styling and finishing.", icon: "PRO" },
      { id: "kids", name: "Kids Cut", price: 200, duration: "30 min", detail: "Simple grooming package for younger clients.", icon: "KID" },
      { id: "groom", name: "Premium Groom", price: 350, duration: "60 min", detail: "Haircut, beard shave, and hot towel service.", icon: "VIP" }
    ],
    appointments: [
      { id: 8, customer: "James Cortez", barberId: "james", serviceId: "basic", time: "10:30", status: "Ongoing", paid: true },
      { id: 9, customer: "Daniel Reyes", barberId: "daniel", serviceId: "groom", time: "11:00", status: "Next", paid: true },
      { id: 10, customer: "Maria Santos", barberId: "michael", serviceId: "basic", time: "11:30", status: "Pending", paid: false },
      { id: 11, customer: "Paolo Garcia", barberId: "james", serviceId: "shave", time: "12:00", status: "Pending", paid: false }
    ]
  };

  const barbers = [
    { id: "michael", name: "Michael Angelo", role: "Fade specialist", status: "Available", rate: 150, bio: "Precise fades, clean tapers, and polished everyday cuts." },
    { id: "james", name: "James Cortez", role: "Classic barber", status: "Serving", rate: 200, bio: "Reliable classic cuts, beard work, and neat styling." },
    { id: "daniel", name: "Daniel Reyes", role: "Premium grooming", status: "Available", rate: 250, bio: "Detailed finishing, hot towel service, and premium grooming." }
  ];

  function loadState() {
    try {
      return { ...defaults, ...JSON.parse(localStorage.getItem("barberCoState") || "{}") };
    } catch {
      return structuredClone(defaults);
    }
  }

  const state = loadState();

  function save() {
    localStorage.setItem("barberCoState", JSON.stringify(state));
  }

  function peso(value) {
    return `PHP ${Number(value).toLocaleString("en-PH")}`;
  }

  function byId(list, id) {
    return list.find((item) => item.id === id) || list[0];
  }

  function initials(name) {
    return name.split(" ").map((part) => part[0]).join("").slice(0, 3).toUpperCase();
  }

  function toast(message) {
    const el = document.querySelector("[data-toast]");
    if (!el) return alert(message);
    el.textContent = message;
    el.classList.add("show");
    window.clearTimeout(toast.timer);
    toast.timer = window.setTimeout(() => el.classList.remove("show"), 2600);
  }

  function initHeader(activePage) {
    const header = document.querySelector("[data-header]");
    const nav = document.querySelector("[data-nav]");
    const toggle = document.querySelector("[data-nav-toggle]");
    document.body.classList.remove("is-loaded");
    document.querySelectorAll(`[data-active="${activePage}"]`).forEach((link) => link.classList.add("active"));
    if (toggle && nav) {
      toggle.addEventListener("click", () => {
        const isOpen = nav.classList.toggle("open");
        header?.classList.toggle("menu-open", isOpen);
        toggle.setAttribute("aria-expanded", String(isOpen));
      });
    }
    window.addEventListener("scroll", () => {
      header?.classList.toggle("scrolled", window.scrollY > 18);
    }, { passive: true });
    initMotion();
    requestAnimationFrame(() => document.body.classList.add("is-loaded"));
  }

  function initMotion() {
    const revealTargets = document.querySelectorAll(
      ".section-heading, .feature-layout, .card, .service-card, .barber-card, .form-card, .panel, .metric, .queue-row, .appointment-row, .now-next article"
    );
    revealTargets.forEach((node) => node.classList.add("reveal"));
    if (!("IntersectionObserver" in window)) {
      revealTargets.forEach((node) => node.classList.add("revealed"));
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("revealed");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.16, rootMargin: "0px 0px -8% 0px" });
    revealTargets.forEach((node) => observer.observe(node));
  }

  function nav(active = "") {
    const links = [
      ["index.html", "home", "Home"],
      ["about.html", "about", "About"],
      ["services.html", "services", "Services"],
      ["barbers.html", "barbers", "Barbers"],
      ["queue.html", "queue", "Queue"],
      ["contact.html", "contact", "Contact"],
      ["login.html", "login", "Login"]
    ];
    return `
      <header class="site-header" data-header>
        <a class="brand" href="index.html" aria-label="Go to The Barber Co home">
          <span class="brand-mark">BC</span>
          <span>The Barber Co</span>
        </a>
        <button class="nav-toggle" type="button" aria-label="Open navigation" aria-expanded="false" data-nav-toggle><span></span><span></span><span></span></button>
        <nav class="site-nav" data-nav>
          ${links.map(([href, key, label]) => `<a href="${href}" data-active="${key}" class="${active === key ? "active" : ""}">${label}</a>`).join("")}
          <a class="nav-cta ${active === "booking" ? "active" : ""}" href="booking.html" data-active="booking">Book now</a>
        </nav>
      </header>
    `;
  }

  function adminSidebar(active) {
    const links = [
      ["admin-dashboard.html", "dashboard", "Dashboard"],
      ["admin-profile.html", "profile", "Admin Profile"],
      ["admin-services.html", "services", "Services"],
      ["admin-reports.html", "reports", "Reports"],
      ["admin-schedule.html", "schedule", "Appointments"],
      ["index.html", "public", "Public Site"]
    ];
    return `<aside class="sidebar">${links.map(([href, key, label]) => `<a class="${active === key ? "active" : ""}" href="${href}">${label}</a>`).join("")}</aside>`;
  }

  function serviceOptions(selectedId = state.selectedServiceId) {
    return state.services.map((service) => `<option value="${service.id}" ${service.id === selectedId ? "selected" : ""}>${service.name} - ${peso(service.price)}</option>`).join("");
  }

  function barberOptions(selectedId = state.selectedBarberId) {
    return barbers.map((barber) => `<option value="${barber.id}" ${barber.id === selectedId ? "selected" : ""}>${barber.name}</option>`).join("");
  }

  return { state, barbers, save, peso, byId, initials, toast, initHeader, nav, adminSidebar, serviceOptions, barberOptions };
})();
