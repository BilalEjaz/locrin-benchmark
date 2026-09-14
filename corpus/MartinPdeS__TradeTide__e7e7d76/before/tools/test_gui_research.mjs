import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  defaults, buildSweep, configDiff, matchingSamples, normalizedEquity,
} from '../TradeTide/gui/research.mjs';
const config = () => ({name: 'Research', pair: 'EUR', days: 3, combination: 'any', stop_loss: 4, indicators: [{...defaults}]});

test('sweep creates independent snapshots without modifying the draft', () => {
  const source = config(), original = structuredClone(source);
  const runs = buildSweep(source, 'indicators.0.multiplier', '1.5, 2, 2.5');
  assert.deepEqual(runs.map(run => run.config.indicators[0].multiplier), [1.5, 2, 2.5]);
  runs[0].config.indicators[0].window = 80;
  assert.equal(runs[1].config.indicators[0].window, 30);
  assert.deepEqual(source, original);
});
test('sweep rejects malformed values and paths outside research parameters', () => {
  for (const values of ['2', '2,', '2, 2', '2, Infinity', '1,2,3,4,5,6,7', '2, nope']) {
    assert.throws(() => buildSweep(config(), 'stop_loss', values));
  }
  for (const path of ['__proto__.polluted', 'name', 'indicators.5.window']) {
    assert.throws(() => buildSweep(config(), path, '2, 3'));
  }
});
test('comparison reports the changed indicator parameter, not irrelevant defaults', () => {
  const before = config(), after = config();
  after.indicators[0].multiplier = 3;
  after.indicators[0].signal = 15; // MACD-only setting has no effect on Bollinger Bands.
  const changes = configDiff(before, after);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].key, 'indicators.0.multiplier');
  assert.equal(changes[0].before, 2);
  assert.equal(changes[0].after, 3);
});
test('overlays require all sample timestamps and the currency pair to match', () => {
  const a = {config: config(), times: ['a', 'b', 'c']};
  assert.equal(matchingSamples(a, structuredClone(a)), true);
  assert.equal(matchingSamples(a, {...a, times: ['a', 'x', 'c']}), false);
  assert.equal(matchingSamples(a, {...a, config: {...config(), pair: 'GBP'}}), false);
});
test('equity comparison is normalized for different starting capital', () => {
  assert.deepEqual(normalizedEquity({equity: [100, 110, 90]}), normalizedEquity({equity: [1000, 1100, 900]}));
});
