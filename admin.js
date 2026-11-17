/* DZ Auto Flow — admin panel. Plain JS + Supabase REST (no libraries). */
'use strict';
(() => {
  const CFG = window.DZ_ADMIN_CONFIG;
  const BASE = CFG.supabaseUrl.replace(/\/+$/, '');
  const KEY = 'dzaf.admin.session';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = d => (d ? new Date(d).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
  const ago = d => {
    if (!d) return 'never';
    const s = (Date.now() - new Date(d)) / 1000;
    if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`; return `${Math.floor(s / 86400)} d ago`;
  };
  let session = null, users = [], filter = 'all', creating = false;

  /* ---------------- toast + modal ---------------- */
  let tt;
  function toast(t) { const e = $('toast'); e.textContent = t; e.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => e.classList.remove('show'), 2600); }
  function modal({ title, html, ok = 'OK', danger = false, onOk }) {
    $('mTitle').textContent = title; $('mBody').innerHTML = html; $('mErr').textContent = '';
    $('mOk').textContent = ok; $('mOk').className = 'btn ' + (danger ? 'danger' : 'primary');
    $('modal').hidden = false;
    const first = $('mBody').querySelector('input,select,textarea'); if (first) setTimeout(() => first.focus(), 30);
    return new Promise(resolve => {
      const close = v => { $('modal').hidden = true; $('mOk').onclick = $('mCancel').onclick = null; resolve(v); };
      $('mCancel').onclick = () => close(false);
      $('mOk').onclick = async () => {
        $('mOk').disabled = true;
        try { const r = onOk ? await onOk() : true; if (r !== false) close(true); }
        catch (e) { $('mErr').textContent = e.message; }
        finally { $('mOk').disabled = false; }
      };
    });
  }

  /* ---------------- auth + API ---------------- */
  const hdr = tok => ({ apikey: CFG.supabaseAnonKey, 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) });
  async function json(res) {
    const b = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(b.msg || b.message || b.error_description || b.error || `Error ${res.status}`); e.status = res.status; throw e; }
    return b;
  }
  async function token() {
    if (!session) throw new Error('Not signed in');
    if (Date.now() < session.expires_at - 60000) return session.access_token;
    const r = await json(await fetch(`${BASE}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: hdr(), body: JSON.stringify({ refresh_token: session.refresh_token }) }));
    setSession(r); return session.access_token;
  }
  function setSession(r) {
    session = { access_token: r.access_token, refresh_token: r.refresh_token, expires_at: Date.now() + (r.expires_in || 3600) * 1000, email: (r.user && r.user.email) || (session && session.email) };
    localStorage.setItem(KEY, JSON.stringify(session));
  }
  async function rpc(fn, args = {}) {
    const res = await fetch(`${BASE}/rest/v1/rpc/${fn}`, { method: 'POST', headers: hdr(await token()), body: JSON.stringify(args) });
    if (res.status === 204) return null;
    return json(res);
  }

  /* ---------------- sign in / create admin ---------------- */
  function showLogin(msg) {
    $('appView').hidden = true; $('loginView').hidden = false;
    $('lgErr').textContent = msg || '';
  }
  $('lgToggle').onclick = e => {
    e.preventDefault(); creating = !creating;
    $('lgPass2Wrap').hidden = !creating;
    $('lgCodeWrap').hidden = !creating;
    $('lgBtn').textContent = creating ? 'Create admin account' : 'Sign in';
    $('loginSub').textContent = creating ? 'Choose your email and a password (8+ characters), and enter the one-time Admin setup code.' : 'Sign in with your admin account.';
    $('lgToggle').textContent = creating ? 'I already have an account — sign in' : 'First time? Create your admin account';
    $('lgErr').textContent = '';
  };
  $('loginForm').onsubmit = async e => {
    e.preventDefault();
    const email = $('lgEmail').value.trim().toLowerCase(), pass = $('lgPass').value;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return ($('lgErr').textContent = 'Enter a valid email.');
    if (pass.length < 8) return ($('lgErr').textContent = 'Password must be at least 8 characters.');
    if (creating && pass !== $('lgPass2').value) return ($('lgErr').textContent = 'Passwords do not match.');
    const code = $('lgCode').value.trim().toUpperCase();
    if (creating && !code) return ($('lgErr').textContent = 'Enter the Admin setup code.');
    $('lgBtn').disabled = true; $('lgErr').textContent = '';
    try {
      if (creating) {
        const s = await fetch(`${BASE}/auth/v1/signup`, { method: 'POST', headers: hdr(), body: JSON.stringify({ email, password: pass, data: { username: email } }) });
        const b = await s.json().catch(() => ({}));
        if (!s.ok && !/already/i.test(b.msg || b.message || '')) throw new Error(b.msg || b.message || 'Could not create account');
      }
      const r = await json(await fetch(`${BASE}/auth/v1/token?grant_type=password`, { method: 'POST', headers: hdr(), body: JSON.stringify({ email, password: pass }) }));
      setSession(r);
      if (creating) {
        const ok = await rpc('claim_admin', { p_code: code });
        if (ok !== true) { session = null; localStorage.removeItem(KEY); throw new Error('That Admin setup code is wrong or already used.'); }
      }
      await enter();
    } catch (x) {
      $('lgErr').textContent = /invalid login/i.test(x.message) ? 'Wrong email or password.' : /banned/i.test(x.message) ? 'This account is blocked.' : x.message;
    } finally { $('lgBtn').disabled = false; }
  };
  $('logoutBtn').onclick = async () => {
    try { await fetch(`${BASE}/auth/v1/logout`, { method: 'POST', headers: hdr(await token()) }); } catch (e) { /* ignore */ }
    session = null; localStorage.removeItem(KEY); showLogin('Signed out.');
  };

  async function enter() {
    const ok = await rpc('is_admin');
    if (ok !== true) { session = null; localStorage.removeItem(KEY); return showLogin('This account is not an admin.'); }
    $('loginView').hidden = true; $('appView').hidden = false;
    $('meEmail').textContent = session.email || '';
    await loadAll();
  }

  /* ---------------- data ---------------- */
  async function loadAll() {
    try {
      const [st, us] = await Promise.all([rpc('admin_stats'), rpc('admin_list_users')]);
      renderStats(st); users = us || []; renderUsers();
      loadRequests(); loadFeedback();
    } catch (e) {
      if (e.status === 401) return showLogin('Session expired — sign in again.');
      toast(e.message);
    }
  }
  function renderStats(s) {
    const items = [['Total users', s.users], ['Active (7 days)', s.active_7d], ['New (7 days)', s.new_7d], ['Pro users', s.pro],
      ['Blocked', s.blocked], ['Pending Pro requests', s.pending], ['Feedback', s.feedback], ['Prompts generated', s.prompts]];
    $('stats').innerHTML = items.map(([k, v]) => `<div class="stat"><span>${k}</span><b>${Number(v || 0).toLocaleString()}</b></div>`).join('');
    $('reqBadge').hidden = !s.pending; $('reqBadge').textContent = s.pending;
  }

  /* ---------------- users ---------------- */
  function renderUsers() {
    const q = $('search').value.trim().toLowerCase();
    const list = users.filter(u => (!q || (u.email || '').toLowerCase().includes(q)) &&
      (filter === 'all' || (filter === 'blocked' ? u.status === 'blocked' : u.plan === filter)));
    $('usersBody').innerHTML = list.length ? list.map(u => `
      <tr data-id="${esc(u.id)}">
        <td class="u"><b>${esc(u.email)}${u.is_admin ? '<span class="pill admin">ADMIN</span>' : ''}</b><small>username: ${esc(u.username)} · ${esc(u.signup_method || 'email')}${u.ext_version ? ' · v' + esc(u.ext_version) : ''}</small>${u.admin_note ? `<div class="note">📝 ${esc(u.admin_note)}</div>` : ''}</td>
        <td><span class="pill ${esc(u.plan)}">${esc(u.plan).toUpperCase()}</span>${u.plan === 'pro' ? `<div class="small muted">${u.pro_until ? 'until ' + fmt(u.pro_until) : 'no end date'}</div>` : ''}</td>
        <td><span class="pill ${esc(u.status)}">${esc(u.status)}</span></td>
        <td class="num">${u.prompts_total}</td><td class="num">${u.batches_total}</td>
        <td title="${esc(fmt(u.created_at))}">${esc(ago(u.created_at))}</td>
        <td title="${esc(fmt(u.last_seen_at))}">${esc(ago(u.last_seen_at || u.last_sign_in_at))}</td>
        <td><div class="actions">
          <button class="btn sm" data-act="plan">Plan</button>
          <button class="btn sm" data-act="status">${u.status === 'blocked' ? 'Unblock' : 'Block'}</button>
          <button class="btn sm" data-act="password">Reset password</button>
          <button class="btn sm" data-act="note">Note</button>
          <button class="btn sm danger" data-act="delete">Delete</button>
        </div></td>
      </tr>`).join('') : '<tr><td colspan="8" class="empty">No users found</td></tr>';
  }
  $('search').addEventListener('input', renderUsers);
  document.querySelectorAll('#filter button').forEach(b => (b.onclick = () => {
    filter = b.dataset.f; document.querySelectorAll('#filter button').forEach(x => x.classList.toggle('on', x === b)); renderUsers();
  }));

  const randomPass = () => {
    const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    const r = crypto.getRandomValues(new Uint32Array(12));
    return 'Dz-' + Array.from(r, n => a[n % a.length]).join('');
  };

  $('usersBody').addEventListener('click', async e => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const u = users.find(x => x.id === b.closest('tr').dataset.id); if (!u) return;
    const act = b.dataset.act;
    if (act === 'plan') {
      await modal({
        title: `Plan for ${u.email}`, ok: 'Save plan',
        html: `<label>Plan<select id="mPlan"><option value="free"${u.plan === 'free' ? ' selected' : ''}>Free</option><option value="pro"${u.plan === 'pro' ? ' selected' : ''}>Pro</option></select></label>
               <label>Pro duration<select id="mMonths"><option value="1">1 month</option><option value="3">3 months</option><option value="6">6 months</option><option value="12">12 months</option><option value="">No end date (lifetime)</option></select></label>`,
        onOk: async () => {
          const plan = $('mPlan').value, m = $('mMonths').value;
          await rpc('admin_set_plan', { p_user: u.id, p_plan: plan, p_months: plan === 'pro' && m ? +m : null });
          toast(`${u.email} is now ${plan.toUpperCase()}`); await loadAll();
        }
      });
    }
    if (act === 'status') {
      const next = u.status === 'blocked' ? 'active' : 'blocked';
      await modal({
        title: next === 'blocked' ? `Block ${u.email}?` : `Unblock ${u.email}?`, ok: next === 'blocked' ? 'Block user' : 'Unblock user', danger: next === 'blocked',
        html: `<p class="muted">${next === 'blocked' ? 'They will be signed out and cannot sign in or use the extension until you unblock them.' : 'They will be able to sign in again.'}</p>`,
        onOk: async () => { await rpc('admin_set_status', { p_user: u.id, p_status: next }); toast(next === 'blocked' ? 'User blocked' : 'User unblocked'); await loadAll(); }
      });
    }
    if (act === 'password') {
      const p = randomPass();
      await modal({
        title: `Reset password — ${u.email}`, ok: 'Set new password',
        html: `<p class="muted small">Type a new password or use the generated one, then send it to the user.</p>
               <div class="copyrow"><input id="mPass" value="${esc(p)}" autocomplete="off"><button class="btn sm" id="mCopy" type="button">Copy</button></div>`,
        onOk: async () => {
          const np = $('mPass').value.trim();
          if (np.length < 8) throw new Error('Password must be at least 8 characters.');
          await rpc('admin_reset_password', { p_user: u.id, p_password: np });
          toast('Password changed');
        }
      });
    }
    if (act === 'note') {
      await modal({
        title: `Note for ${u.email}`, ok: 'Save note',
        html: `<textarea id="mNote" rows="3" placeholder="Only admins see this">${esc(u.admin_note || '')}</textarea>`,
        onOk: async () => { await rpc('admin_set_note', { p_user: u.id, p_note: $('mNote').value.trim() || null }); toast('Note saved'); await loadAll(); }
      });
    }
    if (act === 'delete') {
      await modal({
        title: `Delete ${u.email}?`, ok: 'Delete forever', danger: true,
        html: `<p class="muted">This permanently deletes the account, its profile, Pro requests and feedback. It cannot be undone.</p>
               <label>Type the email to confirm<input id="mConfirm" placeholder="${esc(u.email)}"></label>`,
        onOk: async () => {
          if ($('mConfirm').value.trim().toLowerCase() !== (u.email || '').toLowerCase()) throw new Error('The email does not match.');
          await rpc('admin_delete_user', { p_user: u.id }); toast('User deleted'); await loadAll();
        }
      });
    }
  });
  document.addEventListener('click', e => {
    if (e.target.id === 'mCopy') { navigator.clipboard.writeText($('mPass').value).then(() => toast('Copied'), () => toast('Select and copy it manually')); }
  });

  $('csvBtn').onclick = () => {
    const cols = ['email', 'username', 'signup_method', 'plan', 'pro_until', 'status', 'prompts_total', 'batches_total', 'ext_version', 'locale', 'created_at', 'last_seen_at', 'admin_note'];
    const rows = [cols.join(',')].concat(users.map(u => cols.map(c => `"${String(u[c] == null ? '' : u[c]).replace(/"/g, '""')}"`).join(',')));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv' }));
    a.download = `dz-auto-flow-users-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  };

  /* ---------------- pro requests ---------------- */
  let requests = [];
  async function loadRequests() {
    requests = (await rpc('admin_list_requests')) || [];
    $('reqBody').innerHTML = requests.length ? requests.map(r => `
      <tr data-id="${r.id}">
        <td>${esc(r.email)}</td><td><span class="pill pro">${esc(r.requested_plan).toUpperCase()}</span></td>
        <td>${esc(r.message || '—')}</td><td title="${esc(fmt(r.created_at))}">${esc(ago(r.created_at))}</td>
        <td><span class="pill ${esc(r.status)}">${esc(r.status)}</span></td>
        <td><div class="actions">${r.status === 'pending' ? '<button class="btn sm primary" data-act="approve">Approve</button><button class="btn sm danger" data-act="reject">Reject</button>' : `<span class="small muted">${esc(fmt(r.decided_at))}</span>`}</div></td>
      </tr>`).join('') : '<tr><td colspan="6" class="empty">No Pro requests yet</td></tr>';
  }
  $('reqBody').addEventListener('click', async e => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const r = requests.find(x => String(x.id) === b.closest('tr').dataset.id); if (!r) return;
    if (b.dataset.act === 'approve') {
      await modal({
        title: `Approve Pro for ${r.email}`, ok: 'Approve',
        html: `<label>Pro duration<select id="mMonths"><option value="1">1 month</option><option value="3">3 months</option><option value="6">6 months</option><option value="12">12 months</option><option value="">No end date (lifetime)</option></select></label>`,
        onOk: async () => { const m = $('mMonths').value; await rpc('admin_decide_request', { p_id: r.id, p_approve: true, p_months: m ? +m : null }); toast('Approved — user is now Pro'); await loadAll(); }
      });
    } else {
      await modal({
        title: `Reject request from ${r.email}?`, ok: 'Reject', danger: true, html: '<p class="muted">The user stays on the Free plan.</p>',
        onOk: async () => { await rpc('admin_decide_request', { p_id: r.id, p_approve: false, p_months: null }); toast('Request rejected'); await loadAll(); }
      });
    }
  });

  /* ---------------- feedback ---------------- */
  async function loadFeedback() {
    const list = (await rpc('admin_list_feedback')) || [];
    $('fbList').innerHTML = list.length ? list.map(f => `
      <div class="fb"><div class="h"><span>${esc(f.email)} · v${esc(f.ext_version || '?')}</span><span>${f.rating ? '<span class="stars">' + '★'.repeat(f.rating) + '</span> · ' : ''}${esc(fmt(f.created_at))}</span></div>${esc(f.message)}</div>`).join('')
      : '<div class="empty">No feedback yet</div>';
  }

  /* ---------------- settings (support contact) ---------------- */
  const waLink = (n, m) => `https://wa.me/${n}?text=${encodeURIComponent(m || '')}`;
  function showWaTest() {
    const n = $('setWa').value.replace(/\D/g, '');
    $('setTest').hidden = !n; if (n) $('setTest').href = waLink(n, $('setMsg').value);
  }
  async function loadSettings() {
    const rows = await json(await fetch(`${BASE}/rest/v1/app_settings?select=key,value`, { headers: hdr(await token()) }));
    const m = Object.fromEntries(rows.map(r => [r.key, r.value || '']));
    $('setWa').value = m.support_whatsapp || ''; $('setMsg').value = m.support_message || ''; $('setMail').value = m.support_email || '';
    showWaTest();
  }
  $('setWa').addEventListener('input', showWaTest); $('setMsg').addEventListener('input', showWaTest);
  $('setForm').onsubmit = async e => {
    e.preventDefault();
    const wa = $('setWa').value.replace(/\D/g, ''), mail = $('setMail').value.trim();
    if (wa && (wa.length < 8 || wa.length > 15)) return toast('WhatsApp number: country code + number, 8–15 digits.');
    if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mail)) return toast('Enter a valid email or leave it empty.');
    $('setSave').disabled = true;
    try {
      await rpc('admin_set_setting', { p_key: 'support_whatsapp', p_value: wa });
      await rpc('admin_set_setting', { p_key: 'support_message', p_value: $('setMsg').value.trim() });
      await rpc('admin_set_setting', { p_key: 'support_email', p_value: mail });
      $('setWa').value = wa; showWaTest(); toast('Saved — users see it next time they open Help');
    } catch (x) { toast(x.message); }
    finally { $('setSave').disabled = false; }
  };

  /* ---------------- tabs + boot ---------------- */
  document.querySelectorAll('#tabs button').forEach(b => (b.onclick = () => {
    document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x === b));
    ['users', 'requests', 'feedback', 'settings'].forEach(t => ($('tab-' + t).hidden = t !== b.dataset.tab));
    if (b.dataset.tab === 'settings') loadSettings().catch(x => toast(x.message));
  }));
  $('refreshBtn').onclick = () => loadAll().then(() => toast('Updated'));

  try { session = JSON.parse(localStorage.getItem(KEY)); } catch (e) { session = null; }
  if (session) enter().catch(() => showLogin()); else showLogin();
})();
