// ==========================================================
// ReceiptPro — app.js
// Supabase-backed receipt/invoice/billing app.
// Producer: Gitgroup Group Home of Technologies — Frank Ssemakula
// ==========================================================

const SUPABASE_URL = "https://xmiqevnvjzjdhmolyrom.supabase.co";
const SUPABASE_KEY = "sb_publishable_4tWXdfYGe26srTf_8R9Ecg_RG7qUcP5";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const CURRENCY = "UGX";
const fmt = (n) => `${CURRENCY} ${Number(n || 0).toLocaleString("en-UG", { maximumFractionDigits: 0 })}`;
const short = (s, n = 18) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s || "");
const uid = () => Math.random().toString(36).slice(2, 9);

let state = {
  user: null,
  profile: null,
  receipts: [],
  currentItems: [],
  template: "marshalls",
  docType: "receipt",
  editingId: null,
  paperSize: "80mm",
};

// ---------- Toast ----------
let toastTimer;
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2400);
}

// ---------- Auth screen wiring ----------
const authTabs = document.querySelectorAll(".auth-tab");
authTabs.forEach((tab) =>
  tab.addEventListener("click", () => {
    authTabs.forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById("login-form").classList.toggle("hidden", tab.dataset.tab !== "login");
    document.getElementById("signup-form").classList.toggle("hidden", tab.dataset.tab !== "signup");
    document.getElementById("auth-error").classList.add("hidden");
  })
);

function showAuthError(msg) {
  const el = document.getElementById("auth-error");
  el.textContent = msg;
  el.classList.remove("hidden");
}

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  const btn = e.target.querySelector("button[type=submit]");
  btn.disabled = true; btn.textContent = "Signing in…";
  const { error } = await sb.auth.signInWithPassword({ email, password });
  btn.disabled = false; btn.textContent = "Sign in";
  if (error) return showAuthError(error.message);
  await afterAuth();
});

document.getElementById("signup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("su-email").value.trim();
  const password = document.getElementById("su-password").value;
  const business_name = document.getElementById("su-business").value.trim();
  const phone = document.getElementById("su-phone").value.trim();
  const address = document.getElementById("su-address").value.trim();
  const logoFile = document.getElementById("su-logo").files[0];

  const btn = e.target.querySelector("button[type=submit]");
  btn.disabled = true; btn.textContent = "Creating account…";

  // business_name / phone / address travel as user metadata so the
  // database trigger (handle_new_user) can create the profile row —
  // this works even when email confirmation is required and no
  // session exists yet on the client.
  const { data, error } = await sb.auth.signUp({
    email, password,
    options: { data: { business_name, phone, address } },
  });
  if (error) { btn.disabled = false; btn.textContent = "Create account"; return showAuthError(error.message); }

  const userId = data.user ? data.user.id : null;
  const hasSession = !!data.session;

  if (!hasSession) {
    // Email confirmation is required — the trigger already created the
    // profile row; the user just needs to confirm before signing in.
    btn.disabled = false; btn.textContent = "Create account";
    toast("Account created — check your email to confirm, then sign in.");
    authTabs[0].click();
    e.target.reset();
    return;
  }

  // We have a live session already (confirmation disabled) — safe to
  // upload the logo now and attach it to the profile the trigger made.
  if (logoFile && userId) {
    const path = `${userId}/logo-${Date.now()}-${logoFile.name}`;
    const { error: upErr } = await sb.storage.from("logos").upload(path, logoFile, { upsert: true });
    if (!upErr) {
      const { data: pub } = sb.storage.from("logos").getPublicUrl(path);
      await sb.from("profiles").update({ logo_url: pub.publicUrl }).eq("id", userId);
    }
  }

  btn.disabled = false; btn.textContent = "Create account";
  toast("Account created.");
  await afterAuth();
});

document.querySelectorAll(".logout-link").forEach((b) =>
  b.addEventListener("click", async () => {
    await sb.auth.signOut();
    location.reload();
  })
);

// ---------- Boot ----------
async function afterAuth() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return;
  state.user = user;

  let { data: profile } = await sb.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (!profile) {
    await sb.from("profiles").insert({ id: user.id, business_name: "My Business", email: user.email });
    ({ data: profile } = await sb.from("profiles").select("*").eq("id", user.id).maybeSingle());
  }
  state.profile = profile;

  document.getElementById("auth-screen").classList.add("hidden");
  document.getElementById("app-shell").classList.remove("hidden");
  document.getElementById("bottom-nav").classList.remove("hidden");

  populateBizUI();
  await loadReceipts();
  goView("dashboard");
}

function populateBizUI() {
  const p = state.profile;
  document.querySelectorAll(".biz-name-slot").forEach((el) => (el.textContent = short(p.business_name, 20)));
  document.querySelectorAll(".biz-email-slot").forEach((el) => (el.textContent = short(p.email, 22)));
  document.getElementById("settings-business").value = p.business_name || "";
  document.getElementById("settings-phone").value = p.phone || "";
  document.getElementById("settings-address").value = p.address || "";
  document.getElementById("settings-email").value = p.email || "";
  document.getElementById("settings-tax").value = p.tax_rate || 0;
  const logoImg = document.getElementById("settings-logo-preview");
  if (p.logo_url) logoImg.src = p.logo_url; else logoImg.removeAttribute("src");
}

// ---------- Navigation ----------
document.querySelectorAll("[data-nav]").forEach((el) =>
  el.addEventListener("click", () => goView(el.dataset.nav))
);
function goView(name) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.getElementById(`view-${name}`).classList.add("active");
  document.querySelectorAll("[data-nav]").forEach((el) =>
    el.classList.toggle("active", el.dataset.nav === name)
  );
  if (name === "dashboard") renderDashboard();
  if (name === "receipts") renderReceiptsTable();
  if (name === "analytics") renderAnalytics();
  if (name === "new") { resetBuilder(); }
  window.scrollTo(0, 0);
}

// ---------- Load data ----------
async function loadReceipts() {
  const { data, error } = await sb
    .from("receipts")
    .select("*")
    .eq("user_id", state.user.id)
    .order("created_at", { ascending: false });
  if (error) { toast("Could not load receipts"); return; }
  state.receipts = data || [];
}

// ---------- Dashboard ----------
function renderDashboard() {
  const r = state.receipts;
  const total = r.reduce((s, x) => s + Number(x.total || 0), 0);
  const paid = r.filter((x) => x.status === "paid").reduce((s, x) => s + Number(x.total || 0), 0);
  const outstanding = r.filter((x) => x.status !== "paid").reduce((s, x) => s + (Number(x.total || 0) - Number(x.amount_paid || 0)), 0);
  const count = r.length;

  document.getElementById("stat-total").textContent = fmt(total);
  document.getElementById("stat-paid").textContent = fmt(paid);
  document.getElementById("stat-outstanding").textContent = fmt(outstanding);
  document.getElementById("stat-count").textContent = count;

  const tbody = document.getElementById("recent-table-body");
  tbody.innerHTML = "";
  r.slice(0, 6).forEach((x) => tbody.appendChild(receiptRow(x, true)));
  if (!r.length) tbody.innerHTML = `<tr><td colspan="5" class="mono" style="color:var(--slate);padding:1.2em">No receipts yet — create your first one.</td></tr>`;
}

// ---------- Receipts list ----------
function renderReceiptsTable() {
  const tbody = document.getElementById("receipts-table-body");
  tbody.innerHTML = "";
  const q = (document.getElementById("receipts-search").value || "").toLowerCase();
  const filtered = state.receipts.filter((x) =>
    !q || (x.customer_name || "").toLowerCase().includes(q) || (x.doc_number || "").toLowerCase().includes(q)
  );
  filtered.forEach((x) => tbody.appendChild(receiptRow(x, false)));
  if (!filtered.length) tbody.innerHTML = `<tr><td colspan="6" class="mono" style="color:var(--slate);padding:1.2em">No matching records.</td></tr>`;
}
document.getElementById("receipts-search").addEventListener("input", renderReceiptsTable);

function receiptRow(x, compact) {
  const tr = document.createElement("tr");
  const pillClass = x.status === "paid" ? "pill-paid" : x.status === "partial" ? "pill-partial" : "pill-unpaid";
  tr.innerHTML = `
    <td class="mono truncate" style="max-width:90px">${short(x.doc_number, 12)}</td>
    <td class="truncate" style="max-width:140px">${short(x.customer_name || "Walk-in", 18)}</td>
    <td class="col-hide-mobile">${new Date(x.created_at).toLocaleDateString()}</td>
    <td class="mono">${fmt(x.total)}</td>
    <td><span class="pill ${pillClass}">${x.status}</span></td>
    ${compact ? "" : `<td class="row-actions">
        <button class="btn btn-ghost btn-sm" data-view="${x.id}">View</button>
        <button class="btn btn-danger btn-sm" data-del="${x.id}">Delete</button>
      </td>`}
  `;
  tr.querySelector("[data-view]")?.addEventListener("click", () => openReceiptForPrint(x));
  tr.querySelector("[data-del]")?.addEventListener("click", () => deleteReceipt(x.id));
  if (compact) tr.addEventListener("click", () => openReceiptForPrint(x));
  return tr;
}

async function deleteReceipt(id) {
  if (!confirm("Delete this record? This cannot be undone.")) return;
  const { error } = await sb.from("receipts").delete().eq("id", id).eq("user_id", state.user.id);
  if (error) return toast("Delete failed");
  state.receipts = state.receipts.filter((r) => r.id !== id);
  renderReceiptsTable();
  renderDashboard();
  toast("Deleted");
}

// ---------- Builder (new receipt/invoice) ----------
document.querySelectorAll(".template-opt").forEach((el) =>
  el.addEventListener("click", () => {
    document.querySelectorAll(".template-opt").forEach((t) => t.classList.remove("selected"));
    el.classList.add("selected");
    state.template = el.dataset.template;
    renderPreview();
  })
);

document.querySelectorAll("input[name=doctype]").forEach((r) =>
  r.addEventListener("change", (e) => { state.docType = e.target.value; renderPreview(); })
);

function resetBuilder() {
  state.currentItems = [{ id: uid(), description: "", qty: 1, unit_price: 0 }];
  state.editingId = null;
  document.getElementById("b-customer-name").value = "";
  document.getElementById("b-customer-phone").value = "";
  document.getElementById("b-status").value = "paid";
  document.getElementById("b-payment-method").value = "Cash";
  document.getElementById("b-notes").value = "";
  document.getElementById("b-doc-number").value = nextDocNumber();
  renderItemsEditor();
  renderPreview();
}

function nextDocNumber() {
  const n = state.receipts.length + 1;
  const prefix = state.docType === "invoice" ? "INV" : "RCT";
  return `${prefix}-${String(n).padStart(4, "0")}`;
}

document.getElementById("add-item-btn").addEventListener("click", () => {
  state.currentItems.push({ id: uid(), description: "", qty: 1, unit_price: 0 });
  renderItemsEditor();
  renderPreview();
});

function renderItemsEditor() {
  const body = document.getElementById("items-editor-body");
  body.innerHTML = "";
  state.currentItems.forEach((item) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td style="width:44%"><input type="text" placeholder="Item description" value="${escapeHtml(item.description)}" data-field="description" maxlength="60" /></td>
      <td style="width:16%"><input type="number" min="0" step="1" value="${item.qty}" data-field="qty" /></td>
      <td style="width:26%"><input type="number" min="0" step="1" value="${item.unit_price}" data-field="unit_price" /></td>
      <td style="width:8%; text-align:right"><button class="item-remove" title="Remove">✕</button></td>
    `;
    tr.querySelectorAll("input").forEach((inp) =>
      inp.addEventListener("input", () => {
        item[inp.dataset.field] = inp.dataset.field === "description" ? inp.value : Number(inp.value || 0);
        renderPreview();
      })
    );
    tr.querySelector(".item-remove").addEventListener("click", () => {
      state.currentItems = state.currentItems.filter((i) => i.id !== item.id);
      if (!state.currentItems.length) state.currentItems.push({ id: uid(), description: "", qty: 1, unit_price: 0 });
      renderItemsEditor();
      renderPreview();
    });
    body.appendChild(tr);
  });
}

function computeTotals() {
  const subtotal = state.currentItems.reduce((s, i) => s + Number(i.qty || 0) * Number(i.unit_price || 0), 0);
  const taxRate = Number(state.profile?.tax_rate || 0);
  const taxAmount = subtotal * (taxRate / 100);
  const total = subtotal + taxAmount;
  return { subtotal, taxRate, taxAmount, total };
}

function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- Preview render (template-aware) ----------
["b-customer-name", "b-customer-phone", "b-status", "b-payment-method", "b-notes", "b-doc-number"].forEach((id) => {
  document.getElementById(id).addEventListener("input", renderPreview);
  document.getElementById(id).addEventListener("change", renderPreview);
});

function renderPreview() {
  const stage = document.getElementById("receipt-stage");
  stage.className = `receipt-stage tpl-${state.template}`;
  const p = state.profile || {};
  const { subtotal, taxRate, taxAmount, total } = computeTotals();
  const items = state.currentItems.filter((i) => i.description || i.qty || i.unit_price);
  const docNo = document.getElementById("b-doc-number").value || nextDocNumber();
  const customer = document.getElementById("b-customer-name").value;
  const status = document.getElementById("b-status").value;
  const dateStr = new Date().toLocaleDateString();

  let html = "";
  if (state.template === "marshalls") {
    html = `
      <div class="rc-center">
        ${p.logo_url ? `<img src="${p.logo_url}" class="rc-logo"/>` : ""}
        <div class="rc-biz-name">${escapeHtml(short(p.business_name, 26))}</div>
        <div class="rc-biz-meta">${escapeHtml(short(p.address, 40))}</div>
        <div class="rc-biz-meta">${escapeHtml(p.phone || "")}</div>
      </div>
      <div class="rc-divider"></div>
      <div class="rc-row"><span>${docNo}</span><span>${dateStr}</span></div>
      ${customer ? `<div class="rc-row"><span>Customer</span><span>${escapeHtml(short(customer,20))}</span></div>` : ""}
      <div class="rc-divider"></div>
      <div class="rc-items">
        ${items.map((i) => `
          <div class="rc-row"><span>${escapeHtml(short(i.description, 20))} x${i.qty}</span><span>${fmt(i.qty * i.unit_price)}</span></div>
        `).join("")}
      </div>
      <div class="rc-divider"></div>
      <div class="rc-row"><span>Subtotal</span><span>${fmt(subtotal)}</span></div>
      ${taxRate ? `<div class="rc-row"><span>Tax (${taxRate}%)</span><span>${fmt(taxAmount)}</span></div>` : ""}
      <div class="rc-row rc-total-row"><span>TOTAL</span><span>${fmt(total)}</span></div>
      <div class="rc-center"><span class="rc-badge">${status}</span></div>
      <div class="rc-thanks">Thank you for your business</div>
    `;
  } else if (state.template === "culinary") {
    html = `
      <div class="rc-row" style="align-items:flex-start">
        <div>
          ${p.logo_url ? `<img src="${p.logo_url}" style="max-width:56px;max-height:56px;object-fit:contain"/>` : ""}
          <div class="rc-biz-name">${escapeHtml(short(p.business_name, 26))}</div>
          <div class="rc-biz-meta">${escapeHtml(p.phone || "")}</div>
          <div class="rc-biz-meta">${escapeHtml(p.email || "")}</div>
        </div>
        <div style="text-align:right">
          <div style="font-weight:700;letter-spacing:.05em;color:var(--amber)">${state.docType.toUpperCase()}</div>
          <div class="rc-biz-meta">No: ${docNo}</div>
          <div class="rc-biz-meta">${dateStr}</div>
        </div>
      </div>
      <div class="rc-divider"></div>
      <div class="rc-biz-meta">Bill to: ${escapeHtml(short(customer || "Walk-in customer", 30))}</div>
      <table class="rc-invoice-table">
        <thead><tr><th>Item</th><th>Qty</th><th>Amount</th></tr></thead>
        <tbody>
          ${items.map((i) => `<tr><td>${escapeHtml(short(i.description, 22))}</td><td>${i.qty}</td><td>${fmt(i.qty * i.unit_price)}</td></tr>`).join("")}
        </tbody>
      </table>
      <div class="totals-row"><span>Subtotal</span><span>${fmt(subtotal)}</span></div>
      ${taxRate ? `<div class="totals-row"><span>Tax</span><span>${fmt(taxAmount)}</span></div>` : ""}
      <div class="totals-row grand"><span>Total</span><span>${fmt(total)}</span></div>
      <div class="rc-thanks">We deliver for a fee — Thank you!</div>
    `;
  } else {
    html = `
      <div class="rc-center">
        <div class="rc-biz-name">${escapeHtml(short(p.business_name, 24))}</div>
        <div class="rc-biz-meta">${escapeHtml(short(p.address, 40))}</div>
        <div class="rc-biz-meta">Tel: ${escapeHtml(p.phone || "")}</div>
      </div>
      <div class="rc-divider"></div>
      <div class="rc-row"><span>No: ${docNo}</span><span>${dateStr}</span></div>
      <div class="rc-row"><span>Received from</span></div>
      <div style="font-weight:700;margin:.2em 0">${escapeHtml(short(customer || "________________", 26))}</div>
      <div class="rc-items">
        ${items.map((i) => `<div class="rc-row"><span>${escapeHtml(short(i.description, 22))}</span><span>${fmt(i.qty * i.unit_price)}</span></div>`).join("")}
      </div>
      <div class="rc-divider"></div>
      <div class="rc-row rc-total-row"><span>TOTAL</span><span>${fmt(total)}</span></div>
      <div class="rc-center" style="margin-top:.6em">
        <span class="rc-badge">${status}</span>
      </div>
      <div class="rc-thanks">Signature: ______________</div>
    `;
  }
  document.getElementById("receipt-print-area").innerHTML = html;
}

// ---------- Save receipt ----------
document.getElementById("save-receipt-btn").addEventListener("click", async () => {
  const items = state.currentItems.filter((i) => i.description || i.qty || i.unit_price);
  if (!items.length) return toast("Add at least one item");
  const { subtotal, taxRate, taxAmount, total } = computeTotals();
  const payload = {
    user_id: state.user.id,
    doc_type: state.docType,
    doc_number: document.getElementById("b-doc-number").value || nextDocNumber(),
    template: state.template,
    customer_name: document.getElementById("b-customer-name").value.trim(),
    customer_phone: document.getElementById("b-customer-phone").value.trim(),
    items,
    subtotal, tax_rate: taxRate, tax_amount: taxAmount, total,
    amount_paid: document.getElementById("b-status").value === "paid" ? total : 0,
    status: document.getElementById("b-status").value,
    payment_method: document.getElementById("b-payment-method").value,
    notes: document.getElementById("b-notes").value.trim(),
  };

  const btn = document.getElementById("save-receipt-btn");
  btn.disabled = true; btn.textContent = "Saving…";
  const { data, error } = await sb.from("receipts").insert(payload).select().single();
  btn.disabled = false; btn.textContent = "Save & Print";
  if (error) return toast("Save failed: " + error.message);

  state.receipts.unshift(data);
  toast("Saved");
  printCurrent();
});

// ---------- Print / share current preview ----------
// The printed page size is injected as a live <style> tag right
// before printing, so the receipt/invoice is sized correctly for
// whatever paper is selected — including "Auto", which lets the
// printer's own loaded paper decide the page while keeping the
// receipt itself centered and readable rather than stretched.
const PAGE_SIZE_RULES = {
  auto: "@page{ size:auto; margin:8mm; }",
  "80mm": "@page{ size:80mm auto; margin:3mm; }",
  "58mm": "@page{ size:58mm auto; margin:3mm; }",
  a4: "@page{ size:A4; margin:15mm; }",
};

function applyPageSizeStyle(paper) {
  let styleEl = document.getElementById("dynamic-page-size");
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = "dynamic-page-size";
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = PAGE_SIZE_RULES[paper] || PAGE_SIZE_RULES.auto;
}

document.getElementById("print-btn").addEventListener("click", printCurrent);
function printCurrent() {
  applyPageSizeStyle(state.paperSize);
  window.print();
}

document.querySelectorAll("[data-paper]").forEach((el) =>
  el.addEventListener("click", () => {
    document.querySelectorAll("[data-paper]").forEach((b) => b.classList.remove("btn-amber"));
    el.classList.add("btn-amber");
    state.paperSize = el.dataset.paper;
    document.body.classList.remove("paper-auto", "paper-80mm", "paper-58mm", "paper-a4");
    document.body.classList.add(`paper-${el.dataset.paper}`);
    applyPageSizeStyle(el.dataset.paper);
  })
);
state.paperSize = "auto";
document.body.classList.add("paper-auto");
applyPageSizeStyle("auto");

function openReceiptForPrint(x) {
  goView("new");
  state.docType = x.doc_type;
  state.template = x.template;
  document.querySelectorAll(".template-opt").forEach((t) => t.classList.toggle("selected", t.dataset.template === x.template));
  document.querySelector(`input[name=doctype][value="${x.doc_type}"]`).checked = true;
  state.currentItems = (x.items || []).map((i) => ({ ...i, id: uid() }));
  document.getElementById("b-customer-name").value = x.customer_name || "";
  document.getElementById("b-customer-phone").value = x.customer_phone || "";
  document.getElementById("b-status").value = x.status;
  document.getElementById("b-payment-method").value = x.payment_method || "Cash";
  document.getElementById("b-notes").value = x.notes || "";
  document.getElementById("b-doc-number").value = x.doc_number;
  renderItemsEditor();
  renderPreview();
  toast("Loaded — edit and re-save to update, or just print.");
}

// ---------- Share as image (mobile-friendly alt to print) ----------
document.getElementById("share-btn").addEventListener("click", async () => {
  const node = document.getElementById("receipt-print-area");
  const canvas = await html2canvas(node, { scale: 3, backgroundColor: "#ffffff" });
  canvas.toBlob(async (blob) => {
    const file = new File([blob], "receipt.png", { type: "image/png" });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: "Receipt" }); return; } catch (e) {}
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "receipt.png";
    a.click();
  }, "image/png");
});

// ---------- Analytics ----------
let salesChart, statusChart;
function renderAnalytics() {
  const r = state.receipts;
  const byDay = {};
  r.forEach((x) => {
    const d = new Date(x.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
    byDay[d] = (byDay[d] || 0) + Number(x.total || 0);
  });
  const labels = Object.keys(byDay).slice(-14);
  const values = labels.map((l) => byDay[l]);

  const ctx1 = document.getElementById("sales-chart").getContext("2d");
  if (salesChart) salesChart.destroy();
  salesChart = new Chart(ctx1, {
    type: "line",
    data: { labels, datasets: [{ label: "Sales", data: values, borderColor: "#C8952E", backgroundColor: "rgba(200,149,46,.15)", fill: true, tension: .3 }] },
    options: { plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: (v) => v.toLocaleString() } } } },
  });

  const statusCounts = { paid: 0, unpaid: 0, partial: 0 };
  r.forEach((x) => (statusCounts[x.status] = (statusCounts[x.status] || 0) + 1));
  const ctx2 = document.getElementById("status-chart").getContext("2d");
  if (statusChart) statusChart.destroy();
  statusChart = new Chart(ctx2, {
    type: "doughnut",
    data: {
      labels: ["Paid", "Unpaid", "Partial"],
      datasets: [{ data: [statusCounts.paid, statusCounts.unpaid, statusCounts.partial], backgroundColor: ["#2F6F4E", "#B23A2E", "#C8952E"] }],
    },
    options: { plugins: { legend: { position: "bottom" } } },
  });

  document.getElementById("an-total-count").textContent = r.length;
  document.getElementById("an-total-value").textContent = fmt(r.reduce((s, x) => s + Number(x.total || 0), 0));
  const avg = r.length ? r.reduce((s, x) => s + Number(x.total || 0), 0) / r.length : 0;
  document.getElementById("an-avg-value").textContent = fmt(avg);
}

// ---------- Exports ----------
function exportRows() {
  return state.receipts.map((x) => ({
    "Doc No": x.doc_number,
    "Type": x.doc_type,
    "Customer": x.customer_name || "Walk-in",
    "Date": new Date(x.created_at).toLocaleDateString(),
    "Subtotal": x.subtotal,
    "Tax": x.tax_amount,
    "Total": x.total,
    "Status": x.status,
    "Payment Method": x.payment_method || "",
  }));
}

document.getElementById("export-excel-btn").addEventListener("click", () => {
  const rows = exportRows();
  if (!rows.length) return toast("Nothing to export yet");
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Receipts");
  XLSX.writeFile(wb, `receiptpro-export-${Date.now()}.xlsx`);
});

document.getElementById("export-pdf-btn").addEventListener("click", () => {
  const rows = exportRows();
  if (!rows.length) return toast("Nothing to export yet");
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(14);
  doc.text(`${state.profile.business_name} — Sales Report`, 14, 16);
  doc.setFontSize(9);
  doc.text(new Date().toLocaleString(), 14, 22);
  doc.autoTable({
    startY: 28,
    head: [["Doc No", "Type", "Customer", "Date", "Total", "Status"]],
    body: rows.map((r) => [r["Doc No"], r["Type"], r["Customer"], r["Date"], fmt(r["Total"]), r["Status"]]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [18, 33, 61] },
  });
  doc.save(`receiptpro-export-${Date.now()}.pdf`);
});

document.getElementById("export-word-btn").addEventListener("click", async () => {
  const rows = exportRows();
  if (!rows.length) return toast("Nothing to export yet");
  const { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, HeadingLevel } = window.docx;
  const headerCells = ["Doc No", "Type", "Customer", "Date", "Total", "Status"];
  const table = new Table({
    rows: [
      new TableRow({ children: headerCells.map((h) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })] })) }),
      ...rows.map((r) => new TableRow({
        children: [r["Doc No"], r["Type"], r["Customer"], r["Date"], fmt(r["Total"]), r["Status"]].map(
          (v) => new TableCell({ children: [new Paragraph(String(v))] })
        ),
      })),
    ],
  });
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ text: `${state.profile.business_name} — Sales Report`, heading: HeadingLevel.HEADING_1 }),
        new Paragraph({ text: new Date().toLocaleString() }),
        new Paragraph({ text: "" }),
        table,
      ],
    }],
  });
  const blob = await Packer.toBlob(doc);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `receiptpro-export-${Date.now()}.docx`;
  a.click();
});

// ---------- Settings ----------
document.getElementById("settings-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const payload = {
    business_name: document.getElementById("settings-business").value.trim(),
    phone: document.getElementById("settings-phone").value.trim(),
    address: document.getElementById("settings-address").value.trim(),
    tax_rate: Number(document.getElementById("settings-tax").value || 0),
  };
  const { error } = await sb.from("profiles").update(payload).eq("id", state.user.id);
  if (error) return toast("Update failed");
  state.profile = { ...state.profile, ...payload };
  populateBizUI();
  toast("Settings saved");
});

document.getElementById("settings-logo-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const path = `${state.user.id}/logo-${Date.now()}-${file.name}`;
  const { error: upErr } = await sb.storage.from("logos").upload(path, file, { upsert: true });
  if (upErr) return toast("Upload failed");
  const { data: pub } = sb.storage.from("logos").getPublicUrl(path);
  const { error } = await sb.from("profiles").update({ logo_url: pub.publicUrl }).eq("id", state.user.id);
  if (error) return toast("Could not save logo");
  state.profile.logo_url = pub.publicUrl;
  populateBizUI();
  toast("Logo updated");
});

// ---------- Install prompt (downloadable PWA) ----------
let deferredInstall = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstall = e;
  document.getElementById("install-btn").classList.remove("hidden");
});
document.getElementById("install-btn")?.addEventListener("click", async () => {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  await deferredInstall.userChoice;
  deferredInstall = null;
  document.getElementById("install-btn").classList.add("hidden");
});
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}

// ---------- Boot check ----------
(async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) await afterAuth();
})();
