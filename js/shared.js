const BarberCo = (() => {
  const defaults = {
    selectedServiceId: "basic",
    selectedBarberId: "",
    paymentMethod: "GCash",
    user: {
      name: "",
      email: "",
      username: "",
      phone: "",
      location: "",
      bio: "",
      photo: ""
    },
    admin: {
      name: "The Barber Co Admin",
      email: "admin@thebarberco.test",
      address: "Carmona, Cavite",
      contact: "+63 900 111 2222",
      location: "Carmona",
      postal: "4116",
      gcashName: "The Barber Co",
      gcashNumber: "+63 900 000 0000",
      gcashQr: ""
    },
    booking: null,
    reportDate: new Date().toISOString().slice(0, 10),
    queue: [],
    accounts: [
      { id: "admin", name: "The Barber Co Admin", email: "thebarberco.official@gmail.com", password: "BarberAdmin_2026_x7Qm92", role: "admin", phone: "" },
      { id: "moderator", name: "Front Desk Staff", email: "staff@thebarberco.local", password: "Staff_2026_x7Qm92", role: "moderator", phone: "" }
    ],
    services: [
      { id: "basic", name: "Basic Haircut", price: 150, duration: "30 min", detail: "Clean haircut finished with pomade.", icon: "CUT" },
      { id: "shave", name: "Haircut + Shave", price: 200, duration: "45 min", detail: "Haircut paired with a sharp beard shave.", icon: "SHV" },
      { id: "premium", name: "Premium Cut", price: 250, duration: "45 min", detail: "Detailed cut with styling and finishing.", icon: "PRO" },
      { id: "kids", name: "Kids Cut", price: 200, duration: "30 min", detail: "Simple grooming package for younger clients.", icon: "KID" },
      { id: "groom", name: "Premium Groom", price: 350, duration: "60 min", detail: "Haircut, beard shave, and hot towel service.", icon: "VIP" }
    ],
    appointments: [],
    barbers: []
  };

  function loadState() {
    try {
      return { ...defaults, ...JSON.parse(localStorage.getItem("barberCoState") || "{}") };
    } catch {
      return structuredClone(defaults);
    }
  }

  const state = loadState();
  if (!Array.isArray(state.barbers)) state.barbers = [];
  if (!Array.isArray(state.queue)) state.queue = [];
  if (!Array.isArray(state.services)) state.services = structuredClone(defaults.services);
  if (!Array.isArray(state.appointments)) state.appointments = [];
  if (!Array.isArray(state.accounts)) state.accounts = structuredClone(defaults.accounts);
  state.barbers = state.barbers.filter((barber) => !["michael", "james", "daniel"].includes(barber.id));
  state.appointments = (state.appointments || []).filter((item) => ![8, 9, 10, 11].includes(Number(item.id)));
  if (["michael", "james", "daniel"].includes(state.selectedBarberId)) state.selectedBarberId = "";
  const barbers = state.barbers;
  const apiBase = localStorage.getItem("barberCoApiBase") || (location.protocol.startsWith("http") ? location.origin : "");

  function authToken() {
    return localStorage.getItem("barberCoToken") || "";
  }

  function setSession(payload) {
    if (payload?.token) localStorage.setItem("barberCoToken", payload.token);
    if (payload?.user) state.user = { ...state.user, ...payload.user };
    save();
  }

  function currentRole() {
    return state.user?.role || "customer";
  }

  function canAccess(level = "moderator") {
    const role = currentRole();
    if (level === "admin") return role === "admin";
    if (level === "moderator") return role === "admin" || role === "moderator";
    return true;
  }

  function clearSession() {
    localStorage.removeItem("barberCoToken");
  }

  async function api(path, options = {}) {
    const token = authToken();
    const response = await fetch(`${apiBase}/api${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Request failed.");
    return data;
  }

  async function loadCatalog() {
    const data = await api("/catalog");
    state.services = data.services || state.services;
    state.barbers.splice(0, state.barbers.length, ...(data.barbers || state.barbers));
    save();
    return data;
  }

  function save() {
    localStorage.setItem("barberCoState", JSON.stringify(state));
  }

  function peso(value) {
    return `PHP ${Number(value).toLocaleString("en-PH")}`;
  }

  function byId(list, id) {
    return list.find((item) => item.id === id || item.mongoId === id) || list[0] || { id: "", name: "Unassigned", price: 0, duration: "", role: "", status: "" };
  }

  function initials(name) {
    return String(name || "?").split(" ").map((part) => part[0]).join("").slice(0, 3).toUpperCase();
  }

  function avatar(name, photo = "", className = "profile-photo") {
    return photo
      ? `<span class="${className} has-photo"><img src="${photo}" alt="${name || "Profile"} photo"></span>`
      : `<span class="${className}">${initials(name)}</span>`;
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
    const role = currentRole();
    const accountHref = role === "admin" ? "admin-dashboard.html" : role === "moderator" ? "admin-logbook.html" : state.user?.email ? "user-profile.html" : "login.html";
    const accountLabel = role === "admin" ? "Admin" : role === "moderator" ? "Logbook" : state.user?.email ? "Profile" : "Login";
    const links = [
      ["index.html", "home", "Home"],
      ["about.html", "about", "About"],
      ["services.html", "services", "Services"],
      ["barbers.html", "barbers", "Barbers"],
      ["queue.html", "queue", "Queue"],
      ["contact.html", "contact", "Contact"],
      [accountHref, "login", accountLabel]
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
    const adminLinks = [
      ["admin-dashboard.html", "dashboard", "Dashboard"],
      ["admin-logbook.html", "logbook", "Staff Logbook"],
      ["admin-users.html", "users", "Users & Permissions"],
      ["admin-profile.html", "profile", "Admin Profile"],
      ["admin-services.html", "services", "Services"],
      ["admin-barbers.html", "barbers", "Barbers"],
      ["admin-reports.html", "reports", "Reports"],
      ["admin-schedule.html", "schedule", "Appointments"],
      ["index.html", "public", "Public Site"]
    ];
    const moderatorLinks = [
      ["admin-logbook.html", "logbook", "Staff Logbook"],
      ["admin-schedule.html", "schedule", "Appointments"],
      ["index.html", "public", "Public Site"]
    ];
    const links = currentRole() === "moderator" ? moderatorLinks : adminLinks;
    return `<aside class="sidebar">${links.map(([href, key, label]) => `<a class="${active === key ? "active" : ""}" href="${href}">${label}</a>`).join("")}</aside>`;
  }

  function serviceOptions(selectedId = state.selectedServiceId) {
    return state.services.map((service) => `<option value="${service.id}" ${service.id === selectedId ? "selected" : ""}>${service.name} - ${peso(service.price)}</option>`).join("");
  }

  function barberOptions(selectedId = state.selectedBarberId) {
    const available = barbers.filter((barber) => barber.status !== "fired");
    if (!available.length) return `<option value="">Assign later</option>`;
    return available.map((barber) => `<option value="${barber.id}" ${barber.id === selectedId ? "selected" : ""}>${barber.name}</option>`).join("");
  }

  return { state, barbers, save, peso, byId, initials, avatar, toast, initHeader, nav, adminSidebar, serviceOptions, barberOptions, api, loadCatalog, setSession, clearSession, authToken, currentRole, canAccess };
})();
