// Pure research helpers shared by the UI and its regression tests.
export const names = {
  bollinger: 'Bollinger Bands', crossing: 'MA Crossing',
  rsi: 'RSI', rmi: 'RMI', macd: 'MACD',
};
export const defaults = {
  kind: 'bollinger', enabled: true, weight: 1, window: 30, multiplier: 2,
  fast: 12, slow: 26, smoothing: 14, signal: 9, overbought: 70, oversold: 30,
};
export const fieldsByKind = {
  bollinger: ['window', 'multiplier'], crossing: ['fast', 'slow'],
  rsi: ['window', 'oversold', 'overbought'],
  rmi: ['window', 'smoothing', 'oversold', 'overbought'], macd: ['fast', 'slow', 'signal'],
};
export const parameterSpec = {
  window: ['Window', 2, 240, 1], multiplier: ['Band width', .5, 5, .1],
  fast: ['Fast window', 2, 240, 1], slow: ['Slow window', 3, 480, 1],
  smoothing: ['Smoothing', 2, 240, 1], signal: ['Signal window', 2, 240, 1],
  overbought: ['Overbought', 1, 99, 1], oversold: ['Oversold', 1, 99, 1],
  weight: ['Vote weight', .1, 100, .1],
};
export const labels = {
  name: 'Name', pair: 'Market', days: 'Sample · days', combination: 'Signal rule',
  threshold: 'Vote threshold', capital: 'Starting capital · USD', lot_size: 'Position size · units',
  positions: 'Max positions', max_risk: 'Capital at risk cap · USD', exit_policy: 'Exit policy',
  stop_loss: 'Stop loss · pips', take_profit: 'Take profit · pips',
  break_even_trigger: 'Break-even trigger · pips', commission: 'Commission · USD / unit / side',
  slippage: 'Slippage · pips / side', spread: 'Extra spread · pips', enabled: 'Enabled', kind: 'Indicator',
};
export const descriptions = {
  bollinger: 'Signals when price enters a region outside its volatility bands.',
  crossing: 'Entry events from crossings of the fast and slow moving averages.',
  rsi: 'Oversold and overbought entry events using Wilder smoothing.',
  rmi: 'Momentum over a chosen interval, with separate smoothing and thresholds.',
  macd: 'Entry events when the MACD histogram crosses zero.',
};
export const clone = value => structuredClone(value);
export const number = (v, digits = 2) => v == null ? '—' : Number(v).toLocaleString('en-US', {
  minimumFractionDigits: digits, maximumFractionDigits: digits,
});
export const percent = v => v == null ? '—' : `${number(v * 100)}%`;
export const date = v => v.replace('T', ' ').slice(0, 16);
export function parameterLabel(kind, key) {
  const label = parameterSpec[key][0];
  return ['window', 'fast', 'slow', 'smoothing', 'signal'].includes(key)
    ? `${label} · ${['rsi', 'macd'].includes(kind) ? 'bars' : 'min'}` : label;
}
export function flattenConfig(config) {
  const entries = Object.entries(config).filter(([key]) => key !== 'indicators');
  for (const [index, item] of config.indicators.entries()) {
    const keys = ['kind', 'enabled', ...fieldsByKind[item.kind]];
    if (config.combination === 'weighted') keys.push('weight');
    for (const key of keys) entries.push([`indicators.${index}.${key}`, item[key]]);
  }
  return Object.fromEntries(entries);
}
export function pathLabel(path, config) {
  if (!path.startsWith('indicators.')) return labels[path] || path;
  const [, index, key] = path.split('.');
  const item = config.indicators[Number(index)];
  return `${Number(index) + 1}. ${names[item?.kind] || 'Indicator'} / ${parameterSpec[key]?.[0] || labels[key] || key}`;
}
export function configDiff(before, after) {
  const a = flattenConfig(before), b = flattenConfig(after);
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter(key => a[key] !== b[key])
    .map(key => ({key, label: pathLabel(key, after), before: a[key], after: b[key]}));
}
export function sweepParameters(config) {
  const parameters = ['stop_loss', 'take_profit', 'lot_size', 'positions', 'slippage', 'spread', 'commission']
    .map(key => ({key, label: labels[key]}));
  config.indicators.forEach((item, index) => {
    if (!item.enabled) return;
    for (const key of [...fieldsByKind[item.kind], ...(config.combination === 'weighted' ? ['weight'] : [])]) {
      parameters.push({key: `indicators.${index}.${key}`, label: `${index + 1}. ${names[item.kind]} / ${parameterLabel(item.kind, key)}`});
    }
  });
  return parameters;
}
export function buildSweep(config, path, text) {
  if (!sweepParameters(config).some(parameter => parameter.key === path)) throw Error('Choose a parameter to vary.');
  const tokens = text.split(',').map(token => token.trim());
  if (tokens.length < 2 || tokens.length > 6 || tokens.some(token => !token)) throw Error('Enter 2–6 numbers, separated by commas.');
  const values = tokens.map(Number);
  if (values.some(value => !Number.isFinite(value))) throw Error('Every sweep value must be a finite number.');
  if (new Set(values).size !== values.length) throw Error('Use distinct values so each run tests a different setting.');
  return values.map(value => {
    const candidate = clone(config), parts = path.split('.');
    let target = candidate;
    for (const key of parts.slice(0, -1)) target = target[key];
    target[parts.at(-1)] = value;
    return {config: candidate, value};
  });
}
export function matchingSamples(a, b) {
  return a.config.pair === b.config.pair && a.times.length === b.times.length &&
    a.times.every((time, index) => time === b.times[index]);
}
export function normalizedEquity(run) {
  const initial = run.equity[0];
  return run.equity.map(value => initial ? 100 * (value / initial - 1) : 0);
}
