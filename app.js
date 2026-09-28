/* 教学演示：所有查验、额度与制证结果均为模拟，不连接外部系统。 */
const STORAGE_KEY = 'expense-audit-demo-v1';
const LIMITS = Object.freeze({ '交通费': 500, '住宿费': 800, '餐饮费': 300, '办公用品': 1000 });
const HISTORICAL_INVOICES = new Set(['FP-HIST-001']);
const SUSPECT_INVOICES = new Set(['FP-FAKE-001']);

function normalizeInvoice(value) { return String(value || '').trim().normalize('NFKC').toUpperCase(); }
function validateExpense(data) {
  const required = ['applicant', 'department', 'category', 'invoice', 'reason'];
  if (required.some(key => !String(data[key] || '').trim())) return '请填写所有必填字段。';
  if (!Object.hasOwn(LIMITS, data.category)) return '请选择有效的费用类型。';
  const amount = Number(data.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 999999.99 || !/^[0-9]+(\.[0-9]{1,2})?$/.test(String(data.amount))) return '金额须为 0.01 至 999999.99 元，最多保留两位小数。';
  if (!normalizeInvoice(data.invoice)) return '请填写发票号码。';
  return null;
}
function evaluateExpense(data, priorRecords = []) {
  const error = validateExpense(data);
  if (error) throw new Error(error);
  const invoice = normalizeInvoice(data.invoice);
  const amount = Number(data.amount);
  const duplicate = HISTORICAL_INVOICES.has(invoice) || priorRecords.some(row => normalizeInvoice(row.invoice) === invoice);
  const overLimit = amount > LIMITS[data.category];
  const suspect = SUSPECT_INVOICES.has(invoice);
  return [
    { name: '发票重复', passed: !duplicate, detail: duplicate ? `发票号码 ${invoice} 已提交过` : '未发现相同发票号码' },
    { name: '费用限额', passed: !overLimit, detail: overLimit ? `${data.category} ${amount.toFixed(2)} 元超过 ${LIMITS[data.category]} 元上限` : `${data.category} ${amount.toFixed(2)} 元，未超过 ${LIMITS[data.category]} 元上限` },
    { name: '模拟真伪', passed: !suspect, detail: suspect ? '模拟查验结果：疑似伪票' : '模拟查验结果：真票' }
  ];
}
if (typeof module !== 'undefined') module.exports = { LIMITS, normalizeInvoice, validateExpense, evaluateExpense };

if (typeof document !== 'undefined') {
  const $ = selector => document.querySelector(selector);
  const form = $('#expense-form');
  const latest = $('#latest-result');
  let records = loadRecords();
  let checking = false;
  const scenarios = {
    pass: { applicant: '张同学', department: '市场部', category: '交通费', amount: '120.00', invoice: 'FP-PASS-001', reason: '参加虚构客户交流的市内交通费用' },
    duplicate: { applicant: '李同学', department: '研发部', category: '办公用品', amount: '88.00', invoice: 'FP-HIST-001', reason: '购买项目演示所需办公用品' },
    overLimit: { applicant: '王同学', department: '行政部', category: '住宿费', amount: '980.00', invoice: 'FP-OVER-001', reason: '参加虚构培训产生的住宿费用' },
    fake: { applicant: '陈同学', department: '财务部', category: '餐饮费', amount: '150.00', invoice: 'FP-FAKE-001', reason: '虚构业务接待餐饮费用' }
  };

  function loadRecords() {
    try { const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); return Array.isArray(data) ? data.filter(row => row && typeof row === 'object') : []; }
    catch { return []; }
  }
  function saveRecords() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(records)); return true; }
    catch { showError('浏览器无法保存本地数据，请检查存储权限或空间。'); return false; }
  }
  function showError(message) { const box = $('#form-error'); box.textContent = message; box.hidden = false; }
  function clearError() { $('#form-error').hidden = true; }
  function node(tag, className, textValue) { const element = document.createElement(tag); if (className) element.className = className; if (textValue !== undefined) element.textContent = textValue; return element; }
  function formatDate(iso) { return new Date(iso).toLocaleString('zh-CN', { hour12: false }); }
  function statusLabel(status) { return ({ checking: '校验中', auto: '自动通过 · 已提交制证', pending: '待人工复核', approved: '人工通过 · 已提交制证', returned: '已退回申请人' })[status] || status; }
  function statusClass(status) { return status === 'auto' ? 'status-auto' : status === 'approved' ? 'status-approved' : status === 'returned' ? 'status-returned' : 'status-pending'; }
  function switchView(view) {
    document.querySelectorAll('.view').forEach(item => item.classList.toggle('active', item.id === `view-${view}`));
    document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === view));
    const headings = { submit: ['提交报销单', '系统先按标准规则校验，异常单据再交由审核员判断。'], review: ['人工复核工作台', '集中处理存在异常的报销单，并记录审核依据。'], records: ['处理记录', '逐项查看规则结果和最后处理状态。'] };
    $('#page-title').textContent = headings[view][0]; $('#page-subtitle').textContent = headings[view][1];
  }
  function renderMetrics() {
    const total = records.length, auto = records.filter(row => row.status === 'auto').length, anomalies = records.filter(row => row.checks?.some(check => !check.passed)).length, pending = records.filter(row => row.status === 'pending').length;
    $('#metric-total').textContent = total; $('#metric-auto').textContent = total ? `${(auto / total * 100).toFixed(0)}%` : '0%'; $('#metric-exception').textContent = total ? `${(anomalies / total * 100).toFixed(0)}%` : '0%'; $('#metric-pending').textContent = pending; $('#pending-badge').textContent = pending;
  }
  function appendChecks(container, checks) {
    const grid = node('div', 'checks');
    for (const check of checks || []) { const card = node('div', `check ${check.passed ? '' : 'fail'}`); card.append(node('strong', '', `${check.passed ? '✓' : '!'} ${check.name}`), node('p', '', check.detail)); grid.append(card); }
    container.append(grid);
  }
  function makeRecordCard(row, inReview = false) {
    const card = node('article', 'record-card');
    const top = node('div', 'record-top'); const head = node('div');
    head.append(node('h3', '', `${row.applicant} · ${row.category} · ¥${Number(row.amount).toFixed(2)}`), node('p', 'record-meta', `${row.department} · ${row.invoice} · ${formatDate(row.createdAt)}`));
    top.append(head, node('span', `status ${statusClass(row.status)}`, statusLabel(row.status))); card.append(top);
    card.append(node('p', 'record-meta', `报销事由：${row.reason}`));
    if (row.checks?.length) { appendChecks(card, row.checks); const reasons = row.checks.filter(check => !check.passed).map(check => check.detail); if (reasons.length) card.append(node('p', 'record-reason', `异常原因：${reasons.join('；')}`)); }
    if (row.reviewNote) card.append(node('p', 'record-meta', `人工复核：${row.reviewDecision === 'approved' ? '通过' : '退回'} · ${row.reviewNote} · ${formatDate(row.reviewedAt)}`));
    const flow = node('div', 'timeline');
    for (const step of ['提交', '校验中', row.checks?.some(check => !check.passed) ? '待人工复核' : '自动通过', ...(row.reviewDecision ? [row.reviewDecision === 'approved' ? '人工通过' : '退回'] : []), ...(row.status === 'auto' || row.status === 'approved' ? ['已提交制证（模拟）'] : [])]) flow.append(node('span', '', step));
    card.append(flow);
    if (inReview) {
      const actions = node('div', 'review-actions'); const label = node('label', '', '复核说明（必填）'); const input = node('input'); input.type = 'text'; input.maxLength = 200; input.placeholder = '写明人工判断依据'; label.append(input);
      const approve = node('button', 'approve-btn', '人工通过'); approve.type = 'button'; approve.addEventListener('click', () => review(row.id, 'approved', input.value));
      const reject = node('button', 'return-btn', '退回申请人'); reject.type = 'button'; reject.addEventListener('click', () => review(row.id, 'returned', input.value));
      actions.append(label, approve, reject); card.append(actions);
    }
    return card;
  }
  function renderLists() {
    const pendingList = $('#review-list'), recordList = $('#record-list'); pendingList.replaceChildren(); recordList.replaceChildren();
    const pending = records.filter(row => row.status === 'pending');
    if (!pending.length) pendingList.append(node('div', 'empty', '当前没有待人工复核的单据。')); else pending.slice().reverse().forEach(row => pendingList.append(makeRecordCard(row, true)));
    if (!records.length) recordList.append(node('div', 'empty', '还没有提交记录，请先创建一张报销单。')); else records.slice().reverse().forEach(row => recordList.append(makeRecordCard(row)));
  }
  function renderLatest(row) {
    latest.replaceChildren(); latest.hidden = false;
    const top = node('div', 'result-head'), head = node('div'); head.append(node('div', 'section-kicker', 'LATEST RESULT'), node('h2', '', `单据 ${row.id} 的校验结果`), node('p', '', `提交于 ${formatDate(row.createdAt)} · ${row.invoice}`));
    top.append(head, node('span', `status ${statusClass(row.status)}`, statusLabel(row.status))); latest.append(top);
    if (row.checks?.length) { appendChecks(latest, row.checks); const reason = row.checks.filter(check => !check.passed).map(check => check.detail); if (reason.length) latest.append(node('p', 'record-reason', `异常原因：${reason.join('；')}`)); }
    const flow = node('div', 'timeline');
    const steps = ['提交', '校验中', row.checks?.some(check => !check.passed) ? '待人工复核' : (row.status === 'checking' ? '' : '自动通过'), ...(row.reviewDecision ? [row.reviewDecision === 'approved' ? '人工通过' : '退回'] : []), ...(row.status === 'auto' || row.status === 'approved' ? ['已提交制证（模拟）'] : [])].filter(Boolean);
    for (const step of steps) flow.append(node('span', '', step)); latest.append(flow);
  }
  function refresh() { renderMetrics(); renderLists(); }
  function review(id, decision, note) {
    const trimmed = note.trim(); if (!trimmed) { alert('请先填写复核说明，再作出人工判断。'); return; }
    const row = records.find(item => item.id === id); if (!row || row.status !== 'pending') return;
    row.status = decision; row.reviewDecision = decision; row.reviewNote = trimmed; row.reviewedAt = new Date().toISOString(); row.history.push({ status: decision, at: row.reviewedAt, note: trimmed });
    if (!saveRecords()) { row.status = 'pending'; row.history.pop(); delete row.reviewDecision; delete row.reviewNote; delete row.reviewedAt; return; }
    refresh(); if (!latest.hidden && latest.dataset.recordId === id) renderLatest(row);
  }
  form.addEventListener('submit', event => {
    event.preventDefault(); if (checking) return; clearError();
    const data = Object.fromEntries(new FormData(form).entries()); data.invoice = normalizeInvoice(data.invoice); data.applicant = data.applicant.trim(); data.reason = data.reason.trim();
    const error = validateExpense(data); if (error) { showError(error); return; }
    const checks = evaluateExpense(data, records); const now = new Date().toISOString();
    const row = { ...data, amount: Number(data.amount), id: `BX${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`, createdAt: now, status: 'checking', checks: [], history: [{ status: 'submitted', at: now }, { status: 'checking', at: now }] };
    checking = true; $('#submit-btn').disabled = true; renderLatest(row); latest.dataset.recordId = row.id;
    setTimeout(() => {
      row.checks = checks; row.status = checks.every(check => check.passed) ? 'auto' : 'pending'; row.history.push({ status: row.status, at: new Date().toISOString() });
      records.push(row); if (!saveRecords()) records.pop(); else { renderLatest(row); refresh(); form.reset(); }
      checking = false; $('#submit-btn').disabled = false;
    }, 650);
  });
  document.querySelectorAll('.nav-item').forEach(button => button.addEventListener('click', () => switchView(button.dataset.view)));
  document.querySelectorAll('[data-scenario]').forEach(button => button.addEventListener('click', () => { const data = scenarios[button.dataset.scenario]; for (const [key, value] of Object.entries(data)) form.elements[key].value = value; clearError(); form.scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
  const dialog = $('#confirm-dialog'); $('#reset-btn').addEventListener('click', () => dialog.showModal()); dialog.addEventListener('close', () => { if (dialog.returnValue !== 'confirm') return; records = []; if (saveRecords()) { latest.hidden = true; latest.replaceChildren(); form.reset(); refresh(); switchView('submit'); } });
  refresh();
}
