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
  transactions: [],
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
  await loadTransactions();
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
  if (name === "finance") renderFinance();
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

async function loadTransactions() {
  const { data, error } = await sb
    .from("transactions")
    .select("*")
    .eq("user_id", state.user.id)
    .order("occurred_on", { ascending: false });
  if (error) { toast("Could not load finance data"); return; }
  state.transactions = data || [];
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
  if (!r.length) tbody.innerHTML = `<tr><td colspan="6" class="mono" style="color:var(--slate);padding:1.2em">No receipts yet — create your first one.</td></tr>`;
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
  if (!filtered.length) tbody.innerHTML = `<tr><td colspan="7" class="mono" style="color:var(--slate);padding:1.2em">No matching records.</td></tr>`;
}
document.getElementById("receipts-search").addEventListener("input", renderReceiptsTable);

function receiptRow(x, compact) {
  const tr = document.createElement("tr");
  const pillClass = x.status === "paid" ? "pill-paid" : x.status === "partial" ? "pill-partial" : "pill-unpaid";
  const balance = Math.max(0, Number(x.total || 0) - Number(x.amount_paid || 0));
  const displayDate = x.doc_date ? new Date(x.doc_date + "T00:00:00") : new Date(x.created_at);
  tr.innerHTML = `
    <td class="mono truncate" style="max-width:90px">${short(x.doc_number, 12)}</td>
    <td class="truncate" style="max-width:140px">${short(x.customer_name || "Walk-in", 18)}</td>
    <td class="col-hide-mobile">${displayDate.toLocaleDateString()}</td>
    <td class="mono">${fmt(x.total)}</td>
    <td class="mono col-hide-mobile" style="${balance > 0 ? "color:var(--red);font-weight:700" : "color:var(--slate)"}">${balance > 0 ? fmt(balance) : "—"}</td>
    <td><span class="pill ${pillClass}">${x.status}</span></td>
    ${compact ? "" : `<td class="row-actions">
        <button class="btn btn-ghost btn-sm" data-view="${x.id}">View</button>
        <button class="btn btn-ghost btn-sm" data-pdf="${x.id}">PDF</button>
        <button class="btn btn-danger btn-sm" data-del="${x.id}">Delete</button>
      </td>`}
  `;
  tr.querySelector("[data-view]")?.addEventListener("click", () => openReceiptForPrint(x));
  tr.querySelector("[data-pdf]")?.addEventListener("click", (e) => { e.stopPropagation(); downloadReceiptPDF(receiptToDocData(x)); });
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
  document.getElementById("b-amount-paid").value = "";
  document.getElementById("b-signature-box").checked = true;
  document.getElementById("b-notes").value = "";
  document.getElementById("b-doc-number").value = nextDocNumber();
  document.getElementById("b-doc-date").value = new Date().toISOString().slice(0, 10);
  renderItemsEditor();
  renderPreview();
}

// Keep "Amount paid" sensible as status changes — full amount when
// marked Paid, zero when Unpaid, and left editable for Partial.
document.getElementById("b-status").addEventListener("change", () => {
  const status = document.getElementById("b-status").value;
  const { total } = computeTotals();
  const paidInput = document.getElementById("b-amount-paid");
  if (status === "paid") paidInput.value = total || "";
  if (status === "unpaid") paidInput.value = 0;
  renderPreview();
});
document.getElementById("b-amount-paid").addEventListener("input", renderPreview);
document.getElementById("b-signature-box").addEventListener("change", renderPreview);

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
      <td style="width:36%"><input type="text" placeholder="Item description" value="${escapeHtml(item.description)}" data-field="description" maxlength="60" /></td>
      <td style="width:12%"><input type="number" min="0" step="1" value="${item.qty}" data-field="qty" /></td>
      <td style="width:22%"><input type="number" min="0" step="1" value="${item.unit_price}" data-field="unit_price" /></td>
      <td style="width:20%" class="mono item-line-total" style="white-space:nowrap">${fmt(item.qty * item.unit_price)}</td>
      <td style="width:8%; text-align:right"><button class="item-remove" title="Remove">✕</button></td>
    `;
    tr.querySelectorAll("input").forEach((inp) =>
      inp.addEventListener("input", () => {
        item[inp.dataset.field] = inp.dataset.field === "description" ? inp.value : Number(inp.value || 0);
        tr.querySelector(".item-line-total").textContent = fmt(item.qty * item.unit_price);
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
["b-customer-name", "b-customer-phone", "b-status", "b-payment-method", "b-notes", "b-doc-number", "b-doc-date"].forEach((id) => {
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
  const docDateVal = document.getElementById("b-doc-date").value;
  // Parsed as local time (not UTC) so the displayed date never shifts a
  // day off from what was actually picked, including backdated dates.
  const dateStr = docDateVal
    ? new Date(docDateVal + "T00:00:00").toLocaleDateString()
    : new Date().toLocaleDateString();

  const amountPaidRaw = document.getElementById("b-amount-paid").value;
  const amountPaid = amountPaidRaw === "" ? (status === "paid" ? total : 0) : Number(amountPaidRaw);
  const balance = Math.max(0, total - amountPaid);
  const showBalance = status !== "paid" && balance > 0;
  const includeSignature = document.getElementById("b-signature-box").checked;

  // Shared fragments reused across every template so balance-due and
  // signature/stamp behave identically regardless of which layout is picked.
  const balanceHtml = showBalance
    ? `<div class="rc-row rc-paid-row"><span>Amount paid</span><span>${fmt(amountPaid)}</span></div>
       <div class="rc-row rc-balance-row"><span>BALANCE DUE</span><span>${fmt(balance)}</span></div>`
    : "";
  const signatureHtml = includeSignature
    ? `<div class="rc-sign-box">
         <div class="box"><span>Signature</span></div>
         <div class="box"><span>Stamp</span></div>
       </div>`
    : "";

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
      <div class="rc-divider"></div>
      <table class="rc-line-table">
        <thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead>
        <tbody>
          ${items.map((i) => `<tr><td>${escapeHtml(short(i.description, 22))}</td><td>${i.qty}</td><td>${fmt(i.unit_price)}</td><td>${fmt(i.qty * i.unit_price)}</td></tr>`).join("")}
        </tbody>
      </table>
      <div class="rc-divider"></div>
      <div class="rc-row"><span>Subtotal</span><span>${fmt(subtotal)}</span></div>
      ${taxRate ? `<div class="rc-row"><span>Tax (${taxRate}%)</span><span>${fmt(taxAmount)}</span></div>` : ""}
      <div class="rc-row rc-total-row"><span>TOTAL</span><span>${fmt(total)}</span></div>
      ${balanceHtml}
      <div class="rc-center"><span class="rc-badge">${status}</span></div>
      ${signatureHtml}
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
        <thead><tr><th>Item</th><th>Qty</th><th>Unit price</th><th>Amount</th></tr></thead>
        <tbody>
          ${items.map((i) => `<tr><td>${escapeHtml(short(i.description, 22))}</td><td>${i.qty}</td><td>${fmt(i.unit_price)}</td><td>${fmt(i.qty * i.unit_price)}</td></tr>`).join("")}
        </tbody>
      </table>
      <div class="totals-row"><span>Subtotal</span><span>${fmt(subtotal)}</span></div>
      ${taxRate ? `<div class="totals-row"><span>Tax</span><span>${fmt(taxAmount)}</span></div>` : ""}
      <div class="totals-row grand"><span>Total</span><span>${fmt(total)}</span></div>
      ${showBalance ? `<div class="totals-row rc-paid-row"><span>Amount paid</span><span>${fmt(amountPaid)}</span></div>
        <div class="totals-row rc-balance-row"><span>Balance due</span><span>${fmt(balance)}</span></div>` : ""}
      ${signatureHtml}
      <div class="rc-thanks">We deliver for a fee — Thank you!</div>
    `;
  } else if (state.template === "brentford") {
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
      <table class="rc-line-table">
        <thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead>
        <tbody>
          ${items.map((i) => `<tr><td>${escapeHtml(short(i.description, 22))}</td><td>${i.qty}</td><td>${fmt(i.unit_price)}</td><td>${fmt(i.qty * i.unit_price)}</td></tr>`).join("")}
        </tbody>
      </table>
      <div class="rc-divider"></div>
      <div class="rc-row rc-total-row"><span>TOTAL</span><span>${fmt(total)}</span></div>
      ${balanceHtml}
      <div class="rc-center" style="margin-top:.6em">
        <span class="rc-badge">${status}</span>
      </div>
      ${signatureHtml}
      <div class="rc-thanks">Signature: ______________</div>
    `;
  } else if (state.template === "bankslip") {
    html = `
      <div class="rc-slip-title">${escapeHtml(short(p.business_name, 26))}<br/><span style="font-size:.68rem;letter-spacing:.1em;color:#5B6472">DEPOSIT SLIP</span></div>
      <div class="rc-slip-field"><span>Slip No.</span><b>${docNo}</b></div>
      <div class="rc-slip-field"><span>Date</span><b>${dateStr}</b></div>
      <div class="rc-slip-field"><span>Depositor</span><b>${escapeHtml(short(customer || "________________", 24))}</b></div>
      <div class="rc-slip-field"><span>Contact</span><b>${escapeHtml(document.getElementById("b-customer-phone").value || "—")}</b></div>
      <div class="rc-slip-field"><span>Payment method</span><b>${escapeHtml(document.getElementById("b-payment-method").value)}</b></div>
      <table class="rc-line-table" style="margin-top:.5em">
        <thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead>
        <tbody>
          ${items.map((i) => `<tr><td>${escapeHtml(short(i.description, 20))}</td><td>${i.qty}</td><td>${fmt(i.unit_price)}</td><td>${fmt(i.qty * i.unit_price)}</td></tr>`).join("")}
        </tbody>
      </table>
      <div class="rc-slip-amount-box">
        <div style="font-size:.65rem;color:#5B6472;letter-spacing:.05em">TOTAL DEPOSIT</div>
        <div class="amt">${fmt(total)}</div>
        ${showBalance ? `<div style="font-size:.7rem;margin-top:.3em;color:#B23A2E;font-weight:700">Balance due: ${fmt(balance)}</div>` : ""}
        <div style="font-size:.65rem;margin-top:.3em"><span class="rc-badge" style="border-color:#2F6F4E;color:#1F4A34">${status}</span></div>
      </div>
      <div class="rc-slip-stamp">
        <div>Depositor sign</div>
        <div>Teller / Stamp</div>
      </div>
    `;
  } else if (state.template === "statement") {
    let running = 0;
    const rows = items.map((i) => {
      const amt = i.qty * i.unit_price;
      running += amt;
      return `<tr><td>${escapeHtml(short(i.description, 24))}</td><td>${i.qty}</td><td>${fmt(i.unit_price)}</td><td>${fmt(amt)}</td><td>${fmt(running)}</td></tr>`;
    }).join("");
    html = `
      <div class="rc-stmt-head">
        <div class="biz">${escapeHtml(short(p.business_name, 28))}</div>
        <div class="meta">${escapeHtml(short(p.address, 44))} · ${escapeHtml(p.phone || "")}</div>
      </div>
      <div class="rc-row" style="margin-bottom:.6em"><span>Statement No: ${docNo}</span><span>${dateStr}</span></div>
      <div class="rc-biz-meta" style="margin-bottom:.6em">Account holder: ${escapeHtml(short(customer || "—", 30))}</div>
      <table class="rc-stmt-table">
        <thead><tr><th>Description</th><th>Qty</th><th>Unit price</th><th>Amount</th><th>Balance</th></tr></thead>
        <tbody>${rows}</tbody>
        <tr class="rc-stmt-balance-row"><td colspan="3">Closing balance</td><td></td><td>${fmt(running)}</td></tr>
      </table>
      <div class="rc-stmt-summary">
        <span>${items.length} entr${items.length === 1 ? "y" : "ies"}</span>
        <span><span class="rc-badge">${status}</span></span>
      </div>
      ${signatureHtml}
      <div class="rc-thanks">This statement is system-generated</div>
    `;
  } else {
    html = "";
  }
  document.getElementById("receipt-print-area").innerHTML = html;
}

// ---------- Save receipt ----------
document.getElementById("save-receipt-btn").addEventListener("click", async () => {
  const items = state.currentItems.filter((i) => i.description || i.qty || i.unit_price);
  if (!items.length) return toast("Add at least one item");
  const { subtotal, taxRate, taxAmount, total } = computeTotals();
  const status = document.getElementById("b-status").value;
  const amountPaidRaw = document.getElementById("b-amount-paid").value;
  const amountPaid = amountPaidRaw === "" ? (status === "paid" ? total : 0) : Number(amountPaidRaw);
  const payload = {
    user_id: state.user.id,
    doc_type: state.docType,
    doc_number: document.getElementById("b-doc-number").value || nextDocNumber(),
    doc_date: document.getElementById("b-doc-date").value || new Date().toISOString().slice(0, 10),
    template: state.template,
    customer_name: document.getElementById("b-customer-name").value.trim(),
    customer_phone: document.getElementById("b-customer-phone").value.trim(),
    items,
    subtotal, tax_rate: taxRate, tax_amount: taxAmount, total,
    amount_paid: amountPaid,
    status,
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
  document.body.dataset.printTarget = "receipt";
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
  document.getElementById("b-amount-paid").value = x.amount_paid ?? "";
  document.getElementById("b-signature-box").checked = true;
  document.getElementById("b-notes").value = x.notes || "";
  document.getElementById("b-doc-number").value = x.doc_number;
  document.getElementById("b-doc-date").value = x.doc_date || (x.created_at ? x.created_at.slice(0, 10) : new Date().toISOString().slice(0, 10));
  renderItemsEditor();
  renderPreview();
  toast("Loaded — edit and re-save to update, or just print.");
}

// ---------- Share as image (mobile-friendly alt to print) ----------
// ---------- Single-document downloads: PDF / Excel / Word ----------
// Works from two sources: a saved record straight from the Records list
// (receiptToDocData), or whatever's currently in the builder, saved or not
// (currentBuilderDocData) — same shape either way, same export functions.
function receiptToDocData(x) {
  const balance = Math.max(0, Number(x.total || 0) - Number(x.amount_paid || 0));
  return {
    business: state.profile || {},
    docNo: x.doc_number,
    docDate: x.doc_date ? new Date(x.doc_date + "T00:00:00") : new Date(x.created_at),
    docType: x.doc_type,
    customer: x.customer_name,
    phone: x.customer_phone,
    items: x.items || [],
    subtotal: x.subtotal, taxRate: x.tax_rate, taxAmount: x.tax_amount, total: x.total,
    amountPaid: x.amount_paid, balance, status: x.status,
    paymentMethod: x.payment_method, notes: x.notes,
  };
}

function currentBuilderDocData() {
  const items = state.currentItems.filter((i) => i.description || i.qty || i.unit_price);
  const { subtotal, taxRate, taxAmount, total } = computeTotals();
  const status = document.getElementById("b-status").value;
  const amountPaidRaw = document.getElementById("b-amount-paid").value;
  const amountPaid = amountPaidRaw === "" ? (status === "paid" ? total : 0) : Number(amountPaidRaw);
  const docDateVal = document.getElementById("b-doc-date").value;
  return {
    business: state.profile || {},
    docNo: document.getElementById("b-doc-number").value || nextDocNumber(),
    docDate: docDateVal ? new Date(docDateVal + "T00:00:00") : new Date(),
    docType: state.docType,
    customer: document.getElementById("b-customer-name").value,
    phone: document.getElementById("b-customer-phone").value,
    items,
    subtotal, taxRate, taxAmount, total,
    amountPaid, balance: Math.max(0, total - amountPaid), status,
    paymentMethod: document.getElementById("b-payment-method").value,
    notes: document.getElementById("b-notes").value,
  };
}

function downloadReceiptPDF(doc) {
  if (!doc.items.length) return toast("No items to export");
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF();
  pdf.setFontSize(15);
  pdf.text(doc.business.business_name || "Receipt", 14, 18);
  pdf.setFontSize(9);
  pdf.text(`${doc.business.address || ""}   ${doc.business.phone || ""}`, 14, 24);
  pdf.setFontSize(11);
  pdf.text(`${doc.docType === "invoice" ? "Invoice" : "Receipt"} No: ${doc.docNo}`, 14, 34);
  pdf.text(`Date: ${doc.docDate.toLocaleDateString()}`, 14, 40);
  pdf.text(`Customer: ${doc.customer || "Walk-in"}`, 14, 46);
  pdf.autoTable({
    startY: 54,
    head: [["Item", "Qty", "Unit price", "Total"]],
    body: doc.items.map((i) => [i.description, i.qty, fmt(i.unit_price), fmt(i.qty * i.unit_price)]),
    styles: { fontSize: 9 },
    headStyles: { fillColor: [18, 33, 61] },
  });
  let y = pdf.lastAutoTable.finalY + 8;
  pdf.setFontSize(10);
  pdf.text(`Subtotal: ${fmt(doc.subtotal)}`, 140, y); y += 6;
  if (doc.taxRate) { pdf.text(`Tax (${doc.taxRate}%): ${fmt(doc.taxAmount)}`, 140, y); y += 6; }
  pdf.setFontSize(12);
  pdf.text(`Total: ${fmt(doc.total)}`, 140, y); y += 7;
  if (doc.status !== "paid" && doc.balance > 0) {
    pdf.setFontSize(10);
    pdf.text(`Amount paid: ${fmt(doc.amountPaid)}`, 140, y); y += 6;
    pdf.setFontSize(11);
    pdf.text(`Balance due: ${fmt(doc.balance)}`, 140, y); y += 7;
  }
  pdf.setFontSize(9);
  pdf.text(`Status: ${doc.status.toUpperCase()}   Payment: ${doc.paymentMethod || ""}`, 14, y + 4);
  pdf.save(`${doc.docNo || "receipt"}.pdf`);
}

function downloadReceiptExcel(doc) {
  if (!doc.items.length) return toast("No items to export");
  const rows = doc.items.map((i) => ({
    Description: i.description, Qty: i.qty, "Unit price": i.unit_price, Total: i.qty * i.unit_price,
  }));
  rows.push({});
  rows.push({ Description: "Subtotal", Total: doc.subtotal });
  if (doc.taxRate) rows.push({ Description: `Tax (${doc.taxRate}%)`, Total: doc.taxAmount });
  rows.push({ Description: "TOTAL", Total: doc.total });
  if (doc.status !== "paid" && doc.balance > 0) {
    rows.push({ Description: "Amount paid", Total: doc.amountPaid });
    rows.push({ Description: "Balance due", Total: doc.balance });
  }
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, doc.docNo || "Receipt");
  XLSX.writeFile(wb, `${doc.docNo || "receipt"}.xlsx`);
}

async function downloadReceiptWord(doc) {
  if (!doc.items.length) return toast("No items to export");
  const { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, HeadingLevel } = window.docx;
  const headerCells = ["Item", "Qty", "Unit price", "Total"];
  const table = new Table({
    rows: [
      new TableRow({ children: headerCells.map((h) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })] })) }),
      ...doc.items.map((i) => new TableRow({
        children: [i.description, String(i.qty), fmt(i.unit_price), fmt(i.qty * i.unit_price)].map(
          (v) => new TableCell({ children: [new Paragraph(String(v))] })
        ),
      })),
    ],
  });
  const summaryLines = [
    `Subtotal: ${fmt(doc.subtotal)}`,
    ...(doc.taxRate ? [`Tax (${doc.taxRate}%): ${fmt(doc.taxAmount)}`] : []),
    `Total: ${fmt(doc.total)}`,
    ...(doc.status !== "paid" && doc.balance > 0 ? [`Amount paid: ${fmt(doc.amountPaid)}`, `Balance due: ${fmt(doc.balance)}`] : []),
    `Status: ${doc.status.toUpperCase()}`,
  ];
  const wdoc = new Document({
    sections: [{
      children: [
        new Paragraph({ text: doc.business.business_name || "Receipt", heading: HeadingLevel.HEADING_1 }),
        new Paragraph({ text: `${doc.docType === "invoice" ? "Invoice" : "Receipt"} No: ${doc.docNo}  ·  Date: ${doc.docDate.toLocaleDateString()}` }),
        new Paragraph({ text: `Customer: ${doc.customer || "Walk-in"}` }),
        new Paragraph({ text: "" }),
        table,
        new Paragraph({ text: "" }),
        ...summaryLines.map((l) => new Paragraph({ text: l })),
      ],
    }],
  });
  const blob = await Packer.toBlob(wdoc);
  downloadBlob(blob, `${doc.docNo || "receipt"}.docx`);
}

document.getElementById("download-pdf-btn").addEventListener("click", () => downloadReceiptPDF(currentBuilderDocData()));
document.getElementById("download-excel-btn").addEventListener("click", () => downloadReceiptExcel(currentBuilderDocData()));
document.getElementById("download-word-btn").addEventListener("click", () => downloadReceiptWord(currentBuilderDocData()));

// ---------- Share (WhatsApp, Email, Bluetooth, Nearby Share, etc.) ----------
// A website can't push a file straight into WhatsApp/Bluetooth/Email itself —
// only the operating system's own Share sheet can do that. These helpers hand
// the receipt image to that native sheet wherever it's supported (most modern
// mobile and desktop browsers), and fall back to a sensible manual flow
// (download + pre-filled chat/email) wherever it isn't.
async function getReceiptImageBlob() {
  const node = document.getElementById("receipt-print-area");
  const canvas = await html2canvas(node, { scale: 3, backgroundColor: "#ffffff" });
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

function receiptShareSummary() {
  const p = state.profile || {};
  const docNo = document.getElementById("b-doc-number").value || "";
  const { total } = computeTotals();
  const customer = document.getElementById("b-customer-name").value;
  return `${p.business_name || "Receipt"} — ${docNo}${customer ? ` for ${customer}` : ""} — Total ${fmt(total)}`;
}

function downloadBlob(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

document.getElementById("share-btn").addEventListener("click", async () => {
  const blob = await getReceiptImageBlob();
  const file = new File([blob], "receipt.png", { type: "image/png" });
  if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "Receipt", text: receiptShareSummary() });
      return;
    } catch (e) { /* user cancelled — fall through to manual save */ }
  }
  downloadBlob(blob, "receipt.png");
  toast("Your device doesn't support direct sharing — image saved, attach it manually.");
});

document.getElementById("whatsapp-btn").addEventListener("click", async () => {
  const blob = await getReceiptImageBlob();
  const file = new File([blob], "receipt.png", { type: "image/png" });
  const text = receiptShareSummary();
  // Best path: native share sheet with WhatsApp pre-listed as a target and
  // the image already attached — this is how it works on phones.
  if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "Receipt", text });
      return;
    } catch (e) { return; }
  }
  // Desktop / unsupported fallback: open a WhatsApp chat with the summary
  // pre-filled, and save the image so it can be attached in that chat.
  downloadBlob(blob, "receipt.png");
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  toast("Receipt image saved — attach it in the WhatsApp chat that just opened.");
});

document.getElementById("email-btn").addEventListener("click", async () => {
  const blob = await getReceiptImageBlob();
  const file = new File([blob], "receipt.png", { type: "image/png" });
  const p = state.profile || {};
  const docNo = document.getElementById("b-doc-number").value || "";
  const subject = `${p.business_name || "Receipt"} — ${docNo}`;
  const body = receiptShareSummary();
  // Native share sheet: most phone mail apps (Gmail, Outlook, Mail) accept
  // a shared file directly and open a real draft with it attached.
  if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: subject, text: body });
      return;
    } catch (e) { return; }
  }
  // Desktop fallback: mailto can't carry an attachment, so open a
  // pre-filled draft and save the image for the user to attach.
  downloadBlob(blob, "receipt.png");
  window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  toast("Receipt image saved — attach it to the email draft that just opened.");
});

// ---------- Personal Finance Tracker (sub-app) ----------
document.getElementById("fin-date").value = new Date().toISOString().slice(0, 10);

document.getElementById("finance-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const amount = Number(document.getElementById("fin-amount").value || 0);
  if (!amount) return toast("Enter an amount");
  const payload = {
    user_id: state.user.id,
    kind: document.querySelector('input[name="fin-kind"]:checked').value,
    amount,
    category: document.getElementById("fin-category").value,
    note: document.getElementById("fin-note").value.trim(),
    occurred_on: document.getElementById("fin-date").value || new Date().toISOString().slice(0, 10),
  };
  const btn = e.target.querySelector("button[type=submit]");
  btn.disabled = true; btn.textContent = "Adding…";
  const { data, error } = await sb.from("transactions").insert(payload).select().single();
  btn.disabled = false; btn.textContent = "Add transaction";
  if (error) return toast("Could not save: " + error.message);
  state.transactions.unshift(data);
  document.getElementById("fin-amount").value = "";
  document.getElementById("fin-note").value = "";
  toast("Added");
  renderFinance();
});

async function deleteTransaction(id) {
  if (!confirm("Delete this entry?")) return;
  const { error } = await sb.from("transactions").delete().eq("id", id).eq("user_id", state.user.id);
  if (error) return toast("Delete failed");
  state.transactions = state.transactions.filter((t) => t.id !== id);
  renderFinance();
  toast("Deleted");
}

let financeChart;
function renderFinance() {
  const t = state.transactions;
  const totalIn = t.filter((x) => x.kind === "income").reduce((s, x) => s + Number(x.amount), 0);
  const totalOut = t.filter((x) => x.kind === "expense").reduce((s, x) => s + Number(x.amount), 0);
  document.getElementById("fin-total-in").textContent = fmt(totalIn);
  document.getElementById("fin-total-out").textContent = fmt(totalOut);
  document.getElementById("fin-balance").textContent = fmt(totalIn - totalOut);

  const tbody = document.getElementById("finance-table-body");
  tbody.innerHTML = "";
  t.slice(0, 60).forEach((x) => {
    const tr = document.createElement("tr");
    const sign = x.kind === "income" ? "+" : "−";
    const color = x.kind === "income" ? "var(--green)" : "var(--red)";
    tr.innerHTML = `
      <td class="col-hide-mobile">${new Date(x.occurred_on).toLocaleDateString()}</td>
      <td class="truncate" style="max-width:100px">${short(x.category, 14)}</td>
      <td class="truncate" style="max-width:100px">${short(x.note || "—", 16)}</td>
      <td class="mono" style="color:${color};font-weight:700">${sign}${fmt(x.amount)}</td>
      <td><button class="btn btn-danger btn-sm" data-fdel="${x.id}">✕</button></td>
    `;
    tr.querySelector("[data-fdel]").addEventListener("click", () => deleteTransaction(x.id));
    tbody.appendChild(tr);
  });
  if (!t.length) tbody.innerHTML = `<tr><td colspan="5" class="mono" style="color:var(--slate);padding:1.2em">No transactions yet — add your first one.</td></tr>`;

  const byDay = {};
  t.forEach((x) => {
    const d = new Date(x.occurred_on).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
    byDay[d] = byDay[d] || { income: 0, expense: 0 };
    byDay[d][x.kind] += Number(x.amount);
  });
  const labels = Object.keys(byDay).slice(-14);
  const ctx = document.getElementById("finance-chart").getContext("2d");
  if (financeChart) financeChart.destroy();
  financeChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "In", data: labels.map((l) => byDay[l].income), backgroundColor: "#2F6F4E" },
        { label: "Out", data: labels.map((l) => byDay[l].expense), backgroundColor: "#B23A2E" },
      ],
    },
    options: { plugins: { legend: { position: "bottom" } }, scales: { y: { ticks: { callback: (v) => v.toLocaleString() } } } },
  });

  if (typeof renderMonthlyReport === "function") renderMonthlyReport();
}

document.getElementById("finance-export-btn").addEventListener("click", () => {
  if (!state.transactions.length) return toast("Nothing to export yet");
  const rows = state.transactions.map((x) => ({
    Date: new Date(x.occurred_on).toLocaleDateString(),
    Type: x.kind === "income" ? "Money In" : "Money Out",
    Category: x.category,
    Note: x.note || "",
    Amount: x.amount,
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Finance");
  XLSX.writeFile(wb, `finance-export-${Date.now()}.xlsx`);
});

// ---------- Monthly finance report: analysis, print, export ----------
const monthInput = document.getElementById("report-month");
monthInput.value = new Date().toISOString().slice(0, 7);
monthInput.addEventListener("change", renderMonthlyReport);

function monthTransactions() {
  const ym = monthInput.value || new Date().toISOString().slice(0, 7);
  return { ym, rows: state.transactions.filter((x) => (x.occurred_on || "").slice(0, 7) === ym) };
}

function monthReportData() {
  const { ym, rows } = monthTransactions();
  const totalIn = rows.filter((x) => x.kind === "income").reduce((s, x) => s + Number(x.amount), 0);
  const totalOut = rows.filter((x) => x.kind === "expense").reduce((s, x) => s + Number(x.amount), 0);
  const byCat = {};
  rows.forEach((x) => {
    byCat[x.category] = byCat[x.category] || { income: 0, expense: 0 };
    byCat[x.category][x.kind] += Number(x.amount);
  });
  const monthLabel = new Date(ym + "-01").toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  return { ym, monthLabel, rows, totalIn, totalOut, net: totalIn - totalOut, byCat };
}

function renderMonthlyReport() {
  const { rows, totalIn, totalOut, net, byCat } = monthReportData();

  document.getElementById("report-summary-cards").innerHTML = `
    <div class="stat-card"><div class="label">Money in</div><div class="value green">${fmt(totalIn)}</div></div>
    <div class="stat-card"><div class="label">Money out</div><div class="value" style="color:var(--red)">${fmt(totalOut)}</div></div>
    <div class="stat-card"><div class="label">Net</div><div class="value amber">${fmt(net)}</div></div>
  `;

  const catBody = document.getElementById("report-category-body");
  const cats = Object.keys(byCat);
  catBody.innerHTML = cats.length
    ? cats.map((c) => `<tr><td>${escapeHtml(c)}</td><td class="mono" style="color:var(--green)">${byCat[c].income ? fmt(byCat[c].income) : "—"}</td><td class="mono" style="color:var(--red)">${byCat[c].expense ? fmt(byCat[c].expense) : "—"}</td></tr>`).join("")
    : `<tr><td colspan="3" class="mono" style="color:var(--slate);padding:1em">No transactions in this month yet.</td></tr>`;
}
renderMonthlyReport();

function buildReportPrintHtml() {
  const { monthLabel, rows, totalIn, totalOut, net, byCat } = monthReportData();
  const p = state.profile || {};
  const catRows = Object.keys(byCat).map((c) =>
    `<tr><td>${escapeHtml(c)}</td><td>${byCat[c].income ? fmt(byCat[c].income) : "—"}</td><td>${byCat[c].expense ? fmt(byCat[c].expense) : "—"}</td></tr>`
  ).join("");
  const txRows = rows.map((x) =>
    `<tr><td>${new Date(x.occurred_on).toLocaleDateString()}</td><td>${escapeHtml(x.category)}</td><td>${escapeHtml(x.note || "")}</td><td>${x.kind === "income" ? fmt(x.amount) : "—"}</td><td>${x.kind === "expense" ? fmt(x.amount) : "—"}</td></tr>`
  ).join("");

  return `
    <div class="fr-head">
      <div>
        <div class="biz">${escapeHtml(p.business_name || "")}</div>
        <div class="period">Personal finance report</div>
      </div>
      <div class="period">${monthLabel}</div>
    </div>
    <div class="fr-summary">
      <div class="box"><div class="l">Money in</div><div class="v" style="color:#2F6F4E">${fmt(totalIn)}</div></div>
      <div class="box"><div class="l">Money out</div><div class="v" style="color:#B23A2E">${fmt(totalOut)}</div></div>
      <div class="box"><div class="l">Net</div><div class="v">${fmt(net)}</div></div>
    </div>
    <div style="padding:0 1.4em 1.4em">
      <table class="fr-table">
        <thead><tr><th>Category</th><th>In</th><th>Out</th></tr></thead>
        <tbody>${catRows || `<tr><td colspan="3">No transactions this month.</td></tr>`}</tbody>
      </table>
    </div>
    <div style="padding:0 1.4em 1.4em">
      <table class="fr-table">
        <thead><tr><th>Date</th><th>Category</th><th>Note</th><th>In</th><th>Out</th></tr></thead>
        <tbody>${txRows || `<tr><td colspan="5">No transactions this month.</td></tr>`}</tbody>
      </table>
    </div>
    <div class="fr-foot">Generated by ReceiptPro — Gitgroup Group Home of Technologies</div>
  `;
}

document.getElementById("report-print-btn").addEventListener("click", () => {
  document.getElementById("finance-report-print-area").innerHTML = buildReportPrintHtml();
  document.body.dataset.printTarget = "report";
  applyPageSizeStyle("a4");
  window.print();
});

document.getElementById("report-export-excel-btn").addEventListener("click", () => {
  const { rows, monthLabel } = monthReportData();
  if (!rows.length) return toast("No transactions in this month");
  const data = rows.map((x) => ({
    Date: new Date(x.occurred_on).toLocaleDateString(),
    Type: x.kind === "income" ? "Money In" : "Money Out",
    Category: x.category,
    Note: x.note || "",
    Amount: x.amount,
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Report");
  XLSX.writeFile(wb, `finance-report-${monthLabel.replace(/\s+/g, "-")}.xlsx`);
});

document.getElementById("report-export-pdf-btn").addEventListener("click", () => {
  const { rows, monthLabel, totalIn, totalOut, net } = monthReportData();
  if (!rows.length) return toast("No transactions in this month");
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(14);
  doc.text(`${state.profile.business_name} — Finance Report`, 14, 16);
  doc.setFontSize(10);
  doc.text(monthLabel, 14, 23);
  doc.text(`In: ${fmt(totalIn)}   Out: ${fmt(totalOut)}   Net: ${fmt(net)}`, 14, 29);
  doc.autoTable({
    startY: 36,
    head: [["Date", "Category", "Note", "In", "Out"]],
    body: rows.map((x) => [
      new Date(x.occurred_on).toLocaleDateString(), x.category, x.note || "",
      x.kind === "income" ? fmt(x.amount) : "—",
      x.kind === "expense" ? fmt(x.amount) : "—",
    ]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [18, 33, 61] },
  });
  doc.save(`finance-report-${monthLabel.replace(/\s+/g, "-")}.pdf`);
});

document.getElementById("report-export-word-btn").addEventListener("click", async () => {
  const { rows, monthLabel, totalIn, totalOut, net } = monthReportData();
  if (!rows.length) return toast("No transactions in this month");
  const { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, HeadingLevel } = window.docx;
  const headerCells = ["Date", "Category", "Note", "In", "Out"];
  const table = new Table({
    rows: [
      new TableRow({ children: headerCells.map((h) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })] })) }),
      ...rows.map((x) => new TableRow({
        children: [
          new Date(x.occurred_on).toLocaleDateString(), x.category, x.note || "",
          x.kind === "income" ? fmt(x.amount) : "—",
          x.kind === "expense" ? fmt(x.amount) : "—",
        ].map((v) => new TableCell({ children: [new Paragraph(String(v))] })),
      })),
    ],
  });
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ text: `${state.profile.business_name} — Finance Report`, heading: HeadingLevel.HEADING_1 }),
        new Paragraph({ text: monthLabel }),
        new Paragraph({ text: `In: ${fmt(totalIn)}   Out: ${fmt(totalOut)}   Net: ${fmt(net)}` }),
        new Paragraph({ text: "" }),
        table,
      ],
    }],
  });
  const blob = await Packer.toBlob(doc);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `finance-report-${monthLabel.replace(/\s+/g, "-")}.docx`;
  a.click();
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
