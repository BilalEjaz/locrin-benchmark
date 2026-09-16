import {
  names, defaults, fieldsByKind, parameterSpec, descriptions, clone, number,
  percent, date, parameterLabel, configDiff, pathLabel, sweepParameters,
  buildSweep, matchingSamples, normalizedEquity,
} from './research.mjs';
import {plot, colors} from './charts.mjs';
import {readLocal, writeLocal, readRuns, storeRun} from './storage.mjs';

const $ = id => document.getElementById(id);
const form = $('config');
const tabs = ['strategy', 'results', 'execution', 'compare'];
const ruleNames = {any: 'Any agreement', all: 'All must agree', weighted: 'Weighted vote'};
const runHistory = [];
let stack = [{...defaults}], result = null, busy = false, ready = false;
let runNumber = 0, chartType = 'equity', page = 0, orderPage = 0;
let selectedTrade = null, stopQueue = false, previousDraft = null;
let savedStrategies = [], savedId = null, previousRoute = null;
let draftTimer, noticeTimer, token = null, storageFailed = false;
const closedCards = new Set();
const stringFields = ['name', 'pair', 'combination', 'exit_policy'];

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function option(value, text) { const node = el('option', text); node.value = value; return node; }
function message(text, error = false) {
  $('status').textContent = text; $('status').className = error ? 'error' : '';
}
function notice(text) {
  clearTimeout(noticeTimer); $('notice').textContent = text; $('notice').hidden = false;
  noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 6000);
}
function storageError() {
  storageFailed = true;
  $('storage-status').textContent = 'Browser storage unavailable. Export results and settings before closing.';
  $('storage-status').className = 'error';
}
function settings() {
  const config = {};
  form.querySelectorAll('[name]').forEach(input => {
    config[input.name] = stringFields.includes(input.name) ? input.value : input.value === '' ? null : Number(input.value);
  });
  return {...config, indicators: clone(stack)};
}
function persistDraft() {
  clearTimeout(draftTimer);
  try {
    writeLocal('draft', {config: settings(), savedId});
    $('draft-state').textContent = 'Draft saved locally';
  } catch { $('draft-state').textContent = 'Draft not saved'; storageError(); }
}
function dirty() {
  updateDraftSummary();
  $('draft-state').textContent = 'Saving draft…';
  clearTimeout(draftTimer); draftTimer = setTimeout(persistDraft, 250);
  if (result && !busy) message(configDiff(result.config, settings()).length ? 'Draft changed. Run it to calculate new results.' : 'Draft matches the selected run.');
}
function updateDraftSummary() {
  const count = stack.filter(item => item.enabled).length;
  $('draft-summary').textContent = `Draft: ${form.elements.pair.value} / USD · ${count} ${count === 1 ? 'indicator' : 'indicators'} · ${ruleNames[form.elements.combination.value]}`;
  $('result-draft-note').hidden = !result || configDiff(result.config, settings()).length === 0;
}
function applySettings(config, {remember = true, id = null} = {}) {
  if (remember) previousDraft = {config: settings(), savedId};
  savedId = id;
  form.reset();
  Object.entries(config).forEach(([key, value]) => {
    const input = form.elements.namedItem(key);
    if (key !== 'indicators' && input) input.value = value ?? '';
  });
  stack = config.indicators.map(item => ({...defaults, ...item}));
  closedCards.clear();
  stack.forEach((_, index) => { if (index > 0) closedCards.add(index); });
  updateRules(); updateExit();
  $('undo-draft').hidden = !previousDraft;
  persistDraft(); updateDraftSummary();
}
function revealControl(input) {
  navigate('strategy');
  let parent = input.parentElement;
  while (parent && parent !== form) { if (parent.tagName === 'DETAILS') parent.open = true; parent = parent.parentElement; }
  input.scrollIntoView({block: 'center'}); input.focus();
}
function validateDraft() {
  form.querySelectorAll('input').forEach(input => input.setCustomValidity(''));
  for (const [index, item] of stack.entries()) {
    const card = $('indicator-stack').children[index];
    if (['crossing', 'macd'].includes(item.kind) && item.fast >= item.slow) {
      card.querySelector('[data-parameter=fast]').setCustomValidity('Fast window must be shorter than slow window.');
    }
    if (['rsi', 'rmi'].includes(item.kind) && item.oversold >= item.overbought) {
      card.querySelector('[data-parameter=oversold]').setCustomValidity('Oversold must be below overbought.');
    }
  }
  if (Number(form.elements.lot_size.value) > Number(form.elements.capital.value)) {
    form.elements.lot_size.setCustomValidity('Position size must not exceed starting capital.');
  }
  if (!form.checkValidity()) {
    const input = form.querySelector('input:invalid, select:invalid'); revealControl(input); input.reportValidity();
    message(input.validationMessage || 'Check the highlighted parameter.', true); return null;
  }
  if (!stack.some(item => item.enabled)) {
    navigate('strategy'); $('indicator-stack').querySelector('input').focus();
    message('Enable at least one indicator.', true); return null;
  }
  return settings();
}
async function api(path, config) {
  if (!token) {
    const session = await fetch('/api/session');
    if (!session.ok) throw Error('Cannot connect to TradeTide. Check that the local server is running.');
    token = (await session.json()).token;
  }
  const response = await fetch(path, {method: 'POST', headers: {'Content-Type': 'application/json', 'X-TradeTide-Token': token}, body: JSON.stringify(config)});
  if (response.status === 403) { token = null; throw Error('The server session changed. Try again.'); }
  const data = await response.json();
  if (!response.ok) throw Error(data.error || 'The request could not be completed.');
  return data;
}
function cardSummary(item) {
  return fieldsByKind[item.kind].map(key => `${parameterSpec[key][0]} ${item[key] ?? '—'}`).join(' · ');
}
function renderStack(focusIndex = null) {
  $('indicator-stack').replaceChildren(...stack.map((item, index) => {
    const card = el('details', undefined, `indicator-card${item.enabled ? '' : ' disabled'}`);
    card.open = !closedCards.has(index);
    const summary = el('summary', undefined, 'indicator-head');
    const toggle = el('input'); toggle.type = 'checkbox'; toggle.checked = item.enabled;
    toggle.setAttribute('aria-label', `Enable indicator ${index + 1}: ${names[item.kind]}`);
    toggle.addEventListener('click', event => event.stopPropagation());
    toggle.addEventListener('change', () => { item.enabled = toggle.checked; renderStack(); dirty(); });
    const title = el('span', undefined, 'indicator-name'); title.append(el('strong', `${index + 1}. ${names[item.kind]}`), el('small', cardSummary(item)));
    const arrow = el('span', '⌄', 'card-chevron'); arrow.setAttribute('aria-hidden', 'true');
    summary.append(toggle, title, arrow);
    const content = el('div', undefined, 'indicator-content'); content.append(el('p', descriptions[item.kind], 'help'));
    const grid = el('div', undefined, 'two');
    const keys = [...fieldsByKind[item.kind], ...(form.elements.combination.value === 'weighted' ? ['weight'] : [])];
    keys.forEach(key => {
      const label = parameterLabel(item.kind, key), wrap = el('label', label), input = el('input');
      const [, min, max, step] = parameterSpec[key];
      Object.assign(input, {type: 'number', min, max, step, value: item[key] ?? '', required: true});
      input.dataset.parameter = key;
      input.setAttribute('aria-label', `${index + 1}. ${names[item.kind]} · ${label}`);
      input.addEventListener('input', () => {
        item[key] = input.value === '' ? null : Number(input.value);
        input.setCustomValidity(''); title.querySelector('small').textContent = cardSummary(item); dirty();
      });
      wrap.append(input); grid.append(wrap);
    });
    const actions = el('div', undefined, 'card-actions');
    const duplicate = el('button', 'Duplicate', 'text-button'); duplicate.type = 'button'; duplicate.disabled = stack.length >= 8;
    duplicate.addEventListener('click', () => { stack.push(clone(item)); closedCards.delete(stack.length - 1); renderStack(stack.length - 1); dirty(); });
    const remove = el('button', 'Remove', 'text-button'); remove.type = 'button'; remove.disabled = stack.length === 1;
    remove.setAttribute('aria-label', `Remove indicator ${index + 1}`);
    remove.addEventListener('click', () => { previousDraft = {config: settings(), savedId}; stack.splice(index, 1); closedCards.clear(); $('undo-draft').hidden = false; renderStack(); dirty(); });
    actions.append(duplicate, remove); content.append(grid, actions); card.append(summary, content);
    card.addEventListener('toggle', () => { if (card.open) closedCards.delete(index); else closedCards.add(index); });
    return card;
  }));
  $('indicator-count').textContent = `${stack.filter(item => item.enabled).length} active`;
  $('add-indicator').disabled = stack.length >= 8;
  updateDraftSummary(); updateSweepParameters();
  if (focusIndex != null) $('indicator-stack').children[focusIndex].querySelector('summary').focus();
}
function updateRules() {
  const rule = form.elements.combination.value;
  $('threshold-field').hidden = rule !== 'weighted';
  $('rule-help').textContent = {
    any: 'At least one entry event, with no opposing event on the same bar.',
    all: 'Every enabled indicator must emit the same entry event on the same bar.',
    weighted: 'Signed entry events × weights. A trade requires a vote larger than the threshold; ties are neutral.',
  }[rule];
  renderStack();
}
function updateExit() { $('trigger-field').hidden = form.elements.exit_policy.value !== 'break_even'; }
function updateSweepParameters() {
  const previous = $('sweep-parameter').value;
  $('sweep-parameter').replaceChildren(...sweepParameters(settings()).map(item => option(item.key, item.label)));
  if ([...$('sweep-parameter').options].some(item => item.value === previous)) $('sweep-parameter').value = previous;
}
function setBusy(value) {
  busy = value;
  if (value) $('stop-queue').disabled = false;
  $('fields').disabled = value; $('sweep-fields').disabled = value;
  ['run', 'save-strategy', 'import-home', 'export-strategy', 'import-strategy', 'undo-draft'].forEach(id => { $(id).disabled = value || !ready; });
  $('edit-result').disabled = value || !result; $('load-settings').disabled = value || !result;
  $('stop-queue').hidden = !value; $('run-progress').hidden = !value;
  $('run').textContent = value ? 'Running…' : 'Run backtest';
  $('run').setAttribute('aria-busy', String(value));
}
async function executeRuns(entries, sweepPath = null) {
  if (busy || !ready) return;
  persistDraft(); stopQueue = false; setBusy(true);
  $('queue-progress').max = entries.length; $('queue-progress').value = 0;
  const completed = [];
  try {
    // Validate every candidate before starting the first simulation.
    for (const entry of entries) entry.config = await api('/api/config', entry.config);
    for (const [index, entry] of entries.entries()) {
      if (stopQueue) break;
      const variant = sweepPath ? `${pathLabel(sweepPath, entry.config)} = ${entry.value}` : '';
      $('queue-label').textContent = `${index + 1} of ${entries.length}${variant ? ` · ${variant}` : ''}`;
      message(`Running ${index + 1} of ${entries.length}…`);
      const started = performance.now();
      const data = await api('/api/backtest', entry.config);
      Object.assign(data, {id: crypto.randomUUID(), runNumber: ++runNumber, createdAt: Date.now(), elapsedMs: performance.now() - started, variant});
      completed.push(data); runHistory.unshift(data);
      const expired = runHistory.splice(30);
      try { await storeRun(data, expired.map(run => run.id)); writeLocal('runNumber', runNumber); }
      catch { storageError(); }
      $('queue-progress').value = index + 1;
      result = data; renderResults(); renderHome(); renderHistory();
    }
    if (completed.length) {
      selectResult(completed.at(-1), false);
      if (entries.length > 1) {
        refreshComparisonSelectors(completed[0].id, completed.at(-1).id);
        navigate('compare');
      } else navigate('results');
      message(`${completed.length} ${completed.length === 1 ? 'run' : 'runs'} completed${stopQueue ? '; remaining runs stopped' : ''}.`);
    } else message('No runs started.');
  } catch (error) {
    message(`${completed.length ? `${completed.length} runs completed. ` : ''}${error.message}`, true);
    if (sweepPath) $('sweep-error').textContent = error.message;
  } finally { setBusy(false); updateDraftSummary(); }
}
form.addEventListener('submit', event => {
  event.preventDefault(); if (busy) return;
  const config = validateDraft(); if (config) executeRuns([{config}]);
});
$('run-sweep').addEventListener('click', () => {
  $('sweep-error').textContent = ''; const config = validateDraft(); if (!config) return;
  try { executeRuns(buildSweep(config, $('sweep-parameter').value, $('sweep-values').value), $('sweep-parameter').value); }
  catch (error) { $('sweep-error').textContent = error.message; $('sweep-values').focus(); }
});
$('stop-queue').addEventListener('click', () => { stopQueue = true; $('stop-queue').disabled = true; message('Finishing the current run. Remaining runs will not start.'); });
$('run').title = 'Run draft · Ctrl/⌘ + Enter';
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !document.querySelector('dialog[open]')) {
    event.preventDefault(); if (ready && !busy) form.requestSubmit();
  }
});

function selectResult(data, goToResults = true) {
  result = data; page = 0; orderPage = 0; selectedTrade = null;
  $('search').value = ''; $('order-filter').value = 'all'; $('order-detail').hidden = true;
  $('range-start').value = 0; $('range-end').value = 100;
  renderResults(); renderHistory();
  if (goToResults) navigate('results');
}
function renderResults() {
  const metrics = result?.metrics;
  const cards = metrics ? [
    ['Net return', percent(metrics.total_return), 'After additional costs', metrics.total_return >= 0 ? 'positive' : 'negative'],
    ['Final equity', number(metrics.final_equity), 'USD', ''],
    ['Max drawdown', percent(metrics.max_drawdown), 'Below peak equity', 'negative'],
    ['Win rate', percent(metrics.win_rate), `${metrics.total_trades} completed trades`, ''],
  ] : [['Net return', '—', 'After additional costs', ''], ['Final equity', '—', 'USD', ''], ['Max drawdown', '—', 'Full sample', ''], ['Win rate', '—', 'Completed trades', '']];
  $('metrics').replaceChildren(...cards.map(([label, value, caption, color]) => {
    const article = el('article'); article.append(el('span', label), el('strong', value, color), el('small', caption)); return article;
  }));
  ['export', 'export-trades', 'selected-run', 'diagnostic-select'].forEach(id => { $(id).disabled = !result; });
  $('edit-result').disabled = !result || busy; $('load-settings').disabled = !result || busy;
  if (!result) return;
  $('result-name').textContent = result.config.name;
  $('run-label').textContent = `${result.config.pair} / USD · ${date(result.times[0])} — ${date(result.times.at(-1))}`;
  $('result-badge').textContent = `RUN ${String(result.runNumber).padStart(2, '0')}`;
  $('execution-context').textContent = `Run ${result.runNumber} · ${result.config.name} · ${result.config.pair} / USD`;
  $('selected-run').replaceChildren(...runHistory.map(run => option(run.id, `#${run.runNumber} ${run.config.name}${run.variant ? ` · ${run.variant}` : ''}`)));
  $('selected-run').value = result.id;
  const cost = result.trades.reduce((total, trade) => total + Object.values(trade.costs).reduce((a, b) => a + b, 0), 0);
  const facts = [
    ['Profit factor', number(metrics.profit_factor)], ['Sharpe', number(metrics.sharpe_ratio)],
    ['Additional costs', `${number(cost)} USD`], ['Entry requests', result.orders.length],
    ['Executed', result.orders.filter(order => order.status === 'Executed').length],
    ['Elapsed', `${number((result.elapsedMs || 0) / 1000, 1)} s`],
  ];
  $('result-facts').replaceChildren(...facts.map(([label, value]) => { const item = el('div'); item.append(el('span', label), el('strong', value)); return item; }));
  $('trade-count').textContent = result.trades.length;
  const selectedDiagnostic = $('diagnostic-select').value;
  $('diagnostic-select').replaceChildren(...result.indicators.map((item, index) => option(index, `${item.slot}. ${names[item.kind]}`)));
  if (Number(selectedDiagnostic) < result.indicators.length) $('diagnostic-select').value = selectedDiagnostic || '0';
  updateDraftSummary(); drawCharts(); renderTrades(); renderOrders();
}
function rangeFor(length) {
  const start = Math.floor(Number($('range-start').value) / 100 * Math.max(0, length - 1));
  const end = Math.min(length, Math.max(start + 2, Math.ceil(Number($('range-end').value) / 100 * length)));
  return [start, end];
}
function drawCharts() {
  if (!result) return;
  let values = result.equity, times = result.times;
  if (chartType === 'price') { values = result.market.prices; times = result.market.times; }
  if (chartType === 'drawdown') {
    let peak = -Infinity;
    values = result.equity.map(value => { peak = Math.max(peak, value); return peak ? 100 * (value - peak) / peak : 0; });
  }
  const [start, end] = rangeFor(times.length), shownTimes = times.slice(start, end);
  $('range-label').textContent = `${date(shownTimes[0])} — ${date(shownTimes.at(-1))}`;
  $('chart-title').textContent = {equity: 'Equity · USD', drawdown: 'Drawdown · %', price: `${result.config.pair} / USD · Bid close`}[chartType];
  $('date-range').textContent = `${end - start} of ${times.length} bars`;
  $('chart-caption').textContent = chartType === 'price' ? 'Green: long entry · Red: short entry' : 'Hover or focus chart and use ← → to inspect';
  $('chart-value').textContent = '';
  plot($('chart'), [{name: chartType, values: values.slice(start, end), color: chartType === 'drawdown' ? '#bd5360' : colors[0]}], shownTimes, {
    digits: chartType === 'price' ? 5 : 2, fill: true,
    markers: chartType === 'price' ? result.trades : [], selectedTrade,
    onInspect: text => { $('chart-value').textContent = text; },
  });
  const item = result.indicators[Number($('diagnostic-select').value) || 0];
  const [a, b] = rangeFor(result.market.times.length);
  plot($('diagnostic-chart'), item.series.map(line => ({...line, values: line.values.slice(a, b)})), result.market.times.slice(a, b), {
    digits: ['bollinger', 'crossing', 'macd'].includes(item.kind) ? 5 : 2,
    onInspect: text => { $('diagnostic-caption').textContent = text; },
  });
  legend($('diagnostic-legend'), item.series.map(line => line.name));
  $('diagnostic-caption').textContent = `${item.buy_signals} buy / ${item.sell_signals} sell entry events in the full sample`;
}
function legend(container, labels) {
  container.replaceChildren(...labels.map((label, index) => {
    const span = el('span', undefined, `series-${index % 4}`); span.append(el('i'), document.createTextNode(label)); return span;
  }));
}
function setChartType(type) {
  chartType = type;
  document.querySelectorAll('[data-chart]').forEach(button => {
    const selected = button.dataset.chart === type; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected));
  }); drawCharts();
}
$('range-start').addEventListener('input', () => {
  if (Number($('range-start').value) >= Number($('range-end').value)) $('range-end').value = Number($('range-start').value) + 1;
  drawCharts();
});
$('range-end').addEventListener('input', () => {
  if (Number($('range-end').value) <= Number($('range-start').value)) $('range-start').value = Number($('range-end').value) - 1;
  drawCharts();
});
$('reset-range').addEventListener('click', () => { $('range-start').value = 0; $('range-end').value = 100; selectedTrade = null; drawCharts(); });
$('diagnostic-select').addEventListener('change', drawCharts);
document.querySelectorAll('[data-chart]').forEach(button => button.addEventListener('click', () => setChartType(button.dataset.chart)));
$('selected-run').addEventListener('change', () => selectResult(runHistory.find(run => run.id === $('selected-run').value)));

function emptyRow(target, count, text) {
  const row = el('tr'), cell = el('td', text, 'table-empty'); cell.colSpan = count; row.append(cell); target.append(row);
}
function filteredTrades() {
  if (!result) return [];
  const query = $('search').value.toLowerCase(), side = $('trade-side').value, outcome = $('trade-outcome').value;
  const rows = result.trades.map((trade, index) => ({trade, index})).filter(({trade}) => {
    const matches = `${date(trade.entry_time)} ${date(trade.exit_time)} ${trade.exit_reason.replaceAll('_', ' ')}`.toLowerCase().includes(query);
    return matches && (side === 'all' || trade.is_long === (side === 'long')) &&
      (outcome === 'all' || (outcome === 'profit' ? trade.net_pnl > 0 : trade.net_pnl < 0));
  });
  const sort = $('trade-sort').value;
  return rows.sort((a, b) => sort === 'time' ? a.trade.entry_time.localeCompare(b.trade.entry_time) :
    (sort === 'pnl-desc' ? -1 : 1) * (a.trade.net_pnl - b.trade.net_pnl));
}
function renderTrades() {
  if (!result) return;
  const rows = filteredTrades(), size = 12;
  page = Math.min(page, Math.max(0, Math.ceil(rows.length / size) - 1));
  $('trades').replaceChildren(...rows.slice(page * size, (page + 1) * size).map(({trade, index}) => {
    const row = el('tr'), time = el('td'), link = el('button', `#${index + 1} · ${date(trade.entry_time)}`, 'trade-link');
    link.addEventListener('click', () => inspectTrade(trade, index)); time.append(link, el('small', date(trade.exit_time))); row.append(time);
    const cost = Object.values(trade.costs).reduce((a, b) => a + b, 0);
    [trade.is_long ? 'Long' : 'Short', `${number(trade.entry_price, 5)} → ${number(trade.exit_price, 5)}`, number(trade.lot_size, 0), number(cost), number(trade.net_pnl), trade.exit_reason.replaceAll('_', ' ')].forEach((value, i) => {
      row.append(el('td', value, i === 4 ? (trade.net_pnl >= 0 ? 'positive' : 'negative') : ''));
    }); return row;
  }));
  if (!rows.length) emptyRow($('trades'), 7, result.trades.length ? 'No trades match these filters.' : 'No completed trades. Check the entry rule, sample, and position constraints.');
  $('page-info').textContent = rows.length ? `${page * size + 1}–${Math.min((page + 1) * size, rows.length)} of ${rows.length} trades` : '0 trades';
  $('previous').disabled = page === 0; $('next').disabled = (page + 1) * size >= rows.length;
  $('export-trades').textContent = rows.length === result.trades.length ? 'Export trades CSV' : 'Export filtered CSV';
}
function inspectTrade(trade, index) {
  selectedTrade = trade;
  $('trade-detail-title').textContent = `Trade #${index + 1} · ${trade.is_long ? 'Long' : 'Short'}`;
  const facts = [
    ['Entry', `${date(trade.entry_time)} · ${number(trade.entry_price, 5)}`],
    ['Exit', `${date(trade.exit_time)} · ${number(trade.exit_price, 5)}`],
    ['Size', `${number(trade.lot_size, 0)} units`], ['Net P&L', `${number(trade.net_pnl)} USD`],
    ['Gross P&L', `${number(trade.gross_pnl)} USD`],
    ...Object.entries(trade.costs).map(([key, value]) => [key, `${number(value)} USD`]),
    ['Exit outcome', trade.exit_reason.replaceAll('_', ' ')],
    ['Max adverse excursion', `${number(trade.maximum_adverse_excursion)} USD`],
    ['Max favorable excursion', `${number(trade.maximum_favorable_excursion)} USD`],
  ];
  const list = el('dl', undefined, 'trade-facts');
  facts.forEach(([label, value]) => { list.append(el('dt', label), el('dd', value)); });
  $('trade-detail-body').replaceChildren(list); $('trade-dialog').showModal();
}
$('close-trade').addEventListener('click', () => $('trade-dialog').close());
$('trade-on-chart').addEventListener('click', () => {
  if (!selectedTrade || !result) return;
  const times = result.market.times, start = times.indexOf(selectedTrade.entry_time), end = times.indexOf(selectedTrade.exit_time);
  const padding = Math.max(8, Math.ceil((end - start) * .3));
  $('range-start').value = Math.max(0, Math.floor(100 * (start - padding) / times.length));
  $('range-end').value = Math.min(100, Math.ceil(100 * (end + padding + 1) / times.length));
  $('trade-dialog').close(); setChartType('price'); navigate('results');
});
['search', 'trade-side', 'trade-outcome', 'trade-sort'].forEach(id => $(id).addEventListener('input', () => { page = 0; renderTrades(); }));
$('previous').addEventListener('click', () => { page--; renderTrades(); });
$('next').addEventListener('click', () => { page++; renderTrades(); });
function renderOrders() {
  if (!result) return;
  const all = result.orders, rows = all.filter(order => $('order-filter').value === 'all' || order.status === $('order-filter').value), size = 12;
  orderPage = Math.min(orderPage, Math.max(0, Math.ceil(rows.length / size) - 1));
  $('order-count').textContent = all.length;
  $('order-summary').textContent = `${all.filter(order => order.status === 'Executed').length} executed · ${all.filter(order => order.status === 'Skipped').length} skipped`;
  $('order-list').replaceChildren(...rows.slice(orderPage * size, (orderPage + 1) * size).map(order => {
    const button = el('button', undefined, 'order-card'), top = el('div', undefined, 'order-card-top');
    top.append(el('strong', order.side, order.side === 'Buy' ? 'positive' : 'negative'), el('span', order.status, order.status === 'Executed' ? 'executed' : 'skipped'));
    button.append(top, el('small', date(order.time)), el('span', order.price == null ? order.reason : `${number(order.size, 0)} units @ ${number(order.price, 5)}`));
    button.addEventListener('click', () => {
      $('order-detail').hidden = false;
      $('order-detail').replaceChildren(el('h3', order.id), el('p', order.reason), el('p', `Contributing indicators: ${order.contributors.map(slot => `${slot}. ${names[result.config.indicators[slot - 1].kind]}`).join(', ')}`));
      const index = result.trades.findIndex(trade => trade.entry_time === order.time && trade.is_long === (order.side === 'Buy'));
      if (index >= 0) { const link = el('button', 'Inspect trade →', 'text-button'); link.addEventListener('click', () => inspectTrade(result.trades[index], index)); $('order-detail').append(link); }
    }); return button;
  }));
  if (!rows.length) $('order-list').append(el('p', 'No entry requests match this view.', 'placeholder'));
  $('order-page').textContent = rows.length ? `${orderPage * size + 1}–${Math.min((orderPage + 1) * size, rows.length)} of ${rows.length}` : '0 orders';
  $('order-prev').disabled = orderPage === 0; $('order-next').disabled = (orderPage + 1) * size >= rows.length;
}
$('order-filter').addEventListener('change', () => { orderPage = 0; $('order-detail').hidden = true; renderOrders(); });
$('order-prev').addEventListener('click', () => { orderPage--; renderOrders(); });
$('order-next').addEventListener('click', () => { orderPage++; renderOrders(); });

function renderHistory() {
  $('history-rows').replaceChildren(...runHistory.map(run => {
    const row = el('tr'); if (run === result) row.className = 'current-run';
    const first = el('td'), link = el('button', `#${run.runNumber} ${run.config.name}`, 'run-link');
    link.addEventListener('click', () => selectResult(run)); first.append(link);
    if (run.variant) first.append(el('small', run.variant)); row.append(first);
    [`${run.config.pair}/USD · ${run.config.days}d`, `${run.indicators.length} / ${ruleNames[run.config.combination]}`, percent(run.metrics.total_return), percent(run.metrics.max_drawdown), run.metrics.total_trades].forEach(value => row.append(el('td', value)));
    return row;
  }));
  if (!runHistory.length) emptyRow($('history-rows'), 6, 'No completed runs. Run a strategy or parameter sweep.');
  refreshComparisonSelectors();
}
function refreshComparisonSelectors(baseline = $('compare-baseline').value, candidate = $('compare-candidate').value) {
  ['compare-baseline', 'compare-candidate'].forEach(id => {
    $(id).replaceChildren(...runHistory.map(run => option(run.id, `#${run.runNumber} ${run.config.name}${run.variant ? ` · ${run.variant}` : ''}`)));
    $(id).disabled = runHistory.length < 2;
  });
  $('compare-baseline').value = runHistory.some(run => run.id === baseline) ? baseline : runHistory[1]?.id || runHistory[0]?.id || '';
  $('compare-candidate').value = runHistory.some(run => run.id === candidate) ? candidate : runHistory[0]?.id || '';
  renderComparison();
}
function renderComparison() {
  if (runHistory.length < 2) return;
  const a = runHistory.find(run => run.id === $('compare-baseline').value), b = runHistory.find(run => run.id === $('compare-candidate').value);
  if (!a || !b) return;
  const matches = matchingSamples(a, b);
  $('comparison-note').textContent = a === b ? 'Choose two different runs to see what changed.' : matches ? `Same market and ${a.times.length} observation times. Candidate changes are shown below.` : 'Different markets or sample times. Metrics cover each full run; equity curves are not overlaid.';
  const metrics = [
    ['Net return', percent(a.metrics.total_return), percent(b.metrics.total_return), `${number(100 * (b.metrics.total_return - a.metrics.total_return))} pp`],
    ['Max drawdown', percent(a.metrics.max_drawdown), percent(b.metrics.max_drawdown), `${number(100 * (b.metrics.max_drawdown - a.metrics.max_drawdown))} pp`],
    ['Trades', a.metrics.total_trades, b.metrics.total_trades, b.metrics.total_trades - a.metrics.total_trades],
  ];
  $('comparison-metrics').replaceChildren(...metrics.map(([label, before, after, delta]) => {
    const item = el('div'); item.append(el('span', label), el('strong', `${before} → ${after}`), el('small', `Change: ${delta}`)); return item;
  }));
  $('comparison-diff').replaceChildren(...configDiff(a.config, b.config).map(change => {
    const row = el('tr'); row.append(el('td', change.label), el('td', String(change.before ?? '—')), el('td', String(change.after ?? '—'))); return row;
  }));
  if (!$('comparison-diff').children.length) emptyRow($('comparison-diff'), 3, 'Identical settings.');
  legend($('comparison-legend'), [`Baseline #${a.runNumber}`, `Candidate #${b.runNumber}`]);
  $('comparison-chart-value').textContent = '';
  if (matches) plot($('comparison-chart'), [{name: `#${a.runNumber}`, values: normalizedEquity(a)}, {name: `#${b.runNumber}`, values: normalizedEquity(b)}], a.times, {onInspect: text => { $('comparison-chart-value').textContent = text; }});
  else $('comparison-chart').replaceChildren(el('p', 'Curve overlay requires the same market and observation times.', 'placeholder'));
}
['compare-baseline', 'compare-candidate'].forEach(id => $(id).addEventListener('change', renderComparison));
function useResultSettings() {
  if (!result || busy) return;
  applySettings(result.config); navigate('strategy'); message(`Loaded run #${result.runNumber}. Edit the draft or run a variation.`);
}
$('load-settings').addEventListener('click', useResultSettings);
$('edit-result').addEventListener('click', useResultSettings);

function persistLibrary() {
  try { writeLocal('strategies', savedStrategies); } catch { storageError(); throw Error('Strategy could not be saved. Export its JSON instead.'); }
}
function renderHome() {
  $('saved-count').textContent = savedStrategies.length; $('home-run-count').textContent = runHistory.length;
  $('saved-strategies').replaceChildren(...savedStrategies.map(saved => {
    const card = el('article', undefined, 'saved-card'), main = el('button', undefined, 'saved-open');
    main.append(el('strong', saved.config.name), el('small', `${saved.config.pair} / USD · ${saved.config.indicators.filter(item => item.enabled).map(item => names[item.kind]).join(' + ')}`));
    main.addEventListener('click', async () => {
      if (busy) { notice('Wait for the current run to finish.'); return; }
      try { applySettings(await api('/api/config', saved.config), {id: saved.id}); navigate('strategy'); message('Saved strategy loaded.'); }
      catch (error) { notice(error.message); }
    });
    const remove = el('button', 'Remove', 'text-button');
    remove.setAttribute('aria-label', `Remove saved strategy ${saved.config.name}`);
    remove.addEventListener('click', () => {
      const previous = savedStrategies;
      savedStrategies = savedStrategies.filter(item => item.id !== saved.id);
      try { persistLibrary(); if (savedId === saved.id) { savedId = null; persistDraft(); } renderHome(); notice('Removed from the library. Any loaded draft and completed runs remain available.'); }
      catch (error) { savedStrategies = previous; notice(error.message); }
    });
    card.append(main, remove); return card;
  }));
  if (!savedStrategies.length) $('saved-strategies').append(el('p', 'No saved strategies. Use “Save strategy” in the workspace to keep a reusable configuration.', 'placeholder'));
  $('home-recent').replaceChildren(...runHistory.slice(0, 6).map(run => {
    const button = el('button', undefined, 'recent-run'), label = el('span', `#${run.runNumber} · ${run.config.name}`);
    label.append(el('small', run.variant || `${run.config.pair} / USD · ${run.indicators.length} indicators · ${run.config.days}d`));
    button.append(label, el('span', `${percent(run.metrics.total_return)} →`, run.metrics.total_return >= 0 ? 'positive' : 'negative'));
    button.addEventListener('click', () => selectResult(run)); return button;
  }));
  if (!runHistory.length) $('home-recent').append(el('p', 'No completed backtests. Start with a template or run your current draft.', 'placeholder'));
}
$('save-strategy').addEventListener('click', async () => {
  if (busy) return; const config = validateDraft(); if (!config) return;
  try {
    const normalized = await api('/api/config', config);
    const existing = savedStrategies.find(item => item.id === savedId && item.config.name === normalized.name);
    if (!existing && savedStrategies.length >= 20) throw Error('The library holds 20 strategies. Remove one or export this draft as JSON.');
    const previous = clone(savedStrategies), previousId = savedId;
    savedId = existing?.id || crypto.randomUUID();
    const saved = {id: savedId, config: normalized, updatedAt: Date.now()};
    savedStrategies = [saved, ...savedStrategies.filter(item => item.id !== saved.id)];
    try { persistLibrary(); } catch (error) { savedStrategies = previous; savedId = previousId; throw error; }
    persistDraft(); renderHome(); message(existing ? 'Saved strategy updated.' : 'Strategy saved to the library.');
  } catch (error) { message(error.message, true); }
});
function download(content, filename, type) {
  const url = URL.createObjectURL(new Blob([content], {type})), link = el('a');
  link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('export').addEventListener('click', () => { if (result) download(JSON.stringify(result, null, 2), `tradetide-run-${result.runNumber}.json`, 'application/json'); });
$('export-strategy').addEventListener('click', () => {
  const config = validateDraft(); if (config) download(JSON.stringify(config, null, 2), 'tradetide-strategy.json', 'application/json');
});
$('export-trades').addEventListener('click', () => {
  const quote = value => `"${String(value).replaceAll('"', '""')}"`;
  const rows = [['trade', 'entry_time', 'exit_time', 'side', 'entry_price', 'exit_price', 'units', 'gross_pnl', 'additional_costs', 'net_pnl', 'exit_outcome']];
  filteredTrades().forEach(({trade, index}) => rows.push([index + 1, trade.entry_time, trade.exit_time, trade.is_long ? 'Long' : 'Short', trade.entry_price, trade.exit_price, trade.lot_size, trade.gross_pnl, Object.values(trade.costs).reduce((a, b) => a + b, 0), trade.net_pnl, trade.exit_reason]));
  download(rows.map(row => row.map(quote).join(',')).join('\r\n'), `tradetide-trades-${result.runNumber}.csv`, 'text/csv');
});
['import-home', 'import-strategy'].forEach(id => $(id).addEventListener('click', () => { if (!busy) $('import-file').click(); }));
$('import-file').addEventListener('change', async () => {
  const file = $('import-file').files[0]; if (!file) return;
  try {
    if (file.size > 50_000_000) throw Error('Choose a TradeTide JSON file smaller than 50 MB.');
    const data = JSON.parse(await file.text()), config = await api('/api/config', data.config || data);
    if (busy) throw Error('Wait for the current run to finish before loading settings.');
    applySettings(config); navigate('strategy'); message('Imported strategy settings. Previous draft is available through Undo replacement.');
  } catch (error) { notice(`Import failed: ${error.message}`); }
  finally { $('import-file').value = ''; }
});
$('undo-draft').addEventListener('click', () => {
  if (!previousDraft || busy) return;
  const previous = previousDraft; previousDraft = null; applySettings(previous.config, {remember: false, id: previous.savedId});
  message('Previous draft restored.');
});
function openPreset(kind) {
  if (busy) { notice('Wait for the current run to finish.'); return; }
  const config = clone(initialConfig);
  const presets = {
    reversion: {name: 'Bollinger mean reversion', indicators: [{...defaults}]},
    trend: {name: 'MA + MACD', indicators: [{...defaults, kind: 'crossing'}, {...defaults, kind: 'macd'}]},
    momentum: {name: 'RSI + RMI', indicators: [{...defaults, kind: 'rsi', window: 14}, {...defaults, kind: 'rmi', window: 14}]},
  };
  Object.assign(config, presets[kind]); applySettings(config); navigate('strategy'); message('Template loaded. Undo replacement restores the previous draft.');
}
document.querySelectorAll('[data-preset]').forEach(button => button.addEventListener('click', () => openPreset(button.dataset.preset)));
$('add-indicator').addEventListener('click', () => {
  if (stack.length >= 8) return; const kind = $('add-kind').value;
  stack.push({...defaults, kind, window: ['rsi', 'rmi'].includes(kind) ? 14 : 30});
  closedCards.delete(stack.length - 1); renderStack(stack.length - 1); dirty();
});
$('expand-indicators').addEventListener('click', () => { closedCards.clear(); renderStack(); });
$('collapse-indicators').addEventListener('click', () => { stack.forEach((_, index) => closedCards.add(index)); renderStack(); });
form.elements.combination.addEventListener('change', updateRules);
form.elements.exit_policy.addEventListener('change', updateExit);
form.addEventListener('input', dirty);
window.addEventListener('pagehide', () => { if (ready) persistDraft(); });

const tabDescriptions = {
  strategy: 'Configure indicators, execution, and a sample.', results: 'Selected run: performance, market prices, and indicator values.',
  execution: 'Inspect executed trades and skipped entry requests.', compare: 'Compare results and the settings that produced them.',
};
function navigate(tab) {
  const target = tab === 'home' ? '#home' : `#workspace/${tab}`;
  if (location.hash !== target) location.hash = target;
  route();
}
function route() {
  const home = !location.hash || location.hash === '#home';
  let tab = location.hash.split('/')[1] || 'strategy'; if (!tabs.includes(tab)) tab = 'strategy';
  $('home-page').hidden = !home; $('workspace-page').hidden = home;
  document.querySelectorAll('[data-page]').forEach(link => {
    const active = link.dataset.page === (home ? 'home' : 'workspace'); link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  });
  tabs.forEach(name => {
    const selected = name === tab; $(`tab-${name}`).setAttribute('aria-selected', String(selected));
    $(`tab-${name}`).tabIndex = selected ? 0 : -1; $(`panel-${name}`).hidden = !selected;
  });
  const current = home ? 'home' : tab;
  if (current !== previousRoute) { window.scrollTo(0, 0); previousRoute = current; }
  $('workspace-description').textContent = tabDescriptions[tab];
  document.title = `TradeTide · ${home ? 'Research library' : tab === 'execution' ? 'Orders & trades' : tab[0].toUpperCase() + tab.slice(1)}`;
  requestAnimationFrame(() => { if (!home && tab === 'results') drawCharts(); if (!home && tab === 'compare') renderComparison(); });
}
window.addEventListener('hashchange', route);
document.querySelectorAll('[data-workspace-tab]').forEach(button => {
  button.addEventListener('click', () => navigate(button.dataset.workspaceTab));
  button.addEventListener('keydown', event => {
    const index = tabs.indexOf(button.dataset.workspaceTab); let next;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
    if (event.key === 'Home') next = 0; if (event.key === 'End') next = tabs.length - 1;
    if (next !== undefined) { event.preventDefault(); navigate(tabs[next]); $(`tab-${tabs[next]}`).focus(); }
  });
});
const resize = new ResizeObserver(() => { drawCharts(); renderComparison(); });
resize.observe($('chart')); resize.observe($('comparison-chart'));
const initialConfig = settings();
async function initialize() {
  $('run').disabled = true; message('Loading workspace…');
  const draft = readLocal('draft', null);
  if (draft?.config && Array.isArray(draft.config.indicators) && draft.config.indicators.length > 0 && draft.config.indicators.length <= 8 && draft.config.indicators.every(item => names[item.kind])) {
    applySettings({...initialConfig, ...draft.config}, {remember: false, id: draft.savedId});
  } else updateRules();
  const library = readLocal('strategies', []);
  savedStrategies = Array.isArray(library) ? library.filter(item => item.id && item.config && Array.isArray(item.config.indicators)).slice(0, 20) : [];
  try {
    const runs = await readRuns();
    runHistory.push(...runs.filter(run => run.id && run.config && run.metrics && run.times?.length && run.indicators?.length && run.orders).slice(0, 30));
    runNumber = Math.max(Number(readLocal('runNumber', 0)) || 0, ...runHistory.map(run => run.runNumber), 0);
    result = runHistory[0] || null;
  } catch { storageError(); }
  ready = true; setBusy(false); renderResults(); renderHome(); renderHistory(); route();
  message(draft ? 'Draft restored.' : 'Ready. Ctrl/⌘ + Enter runs the draft.');
  if (!storageFailed) persistDraft();
}
route(); initialize().catch(error => { ready = true; setBusy(false); message(`Workspace could not be restored: ${error.message}`, true); });
