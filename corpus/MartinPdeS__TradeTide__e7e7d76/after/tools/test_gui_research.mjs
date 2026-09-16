import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaults, configDiff, matchingSamples, normalizedEquity} from '../TradeTide/gui/research.mjs';
const config = () => ({name: 'Research', pair: 'EUR', days: 3, combination: 'any', stop_loss: 4, indicators: [{...defaults}]});

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
