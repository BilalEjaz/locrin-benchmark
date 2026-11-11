import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planScripts, hashCode, freeName, stateDirection, type LocalScript, type RemoteScript } from './sync.ts';

const L = (name: string, code: string, modified = 100, pub = false): LocalScript => ({ name, code, modified, public: pub });
const R = (name: string, code: string, updatedAt = 100000, pub = false): RemoteScript => ({ name, code, public: pub, updatedAt });
const seenOf = (code: string, pub = false) => ({ hash: hashCode(code), public: pub });

test('new scripts travel to the other side', () => {
  assert.deepEqual(planScripts([L('a', 'x')], [], {}).map((a) => a.op), ['push']);
  assert.deepEqual(planScripts([], [R('a', 'x')], {}).map((a) => a.op), ['pull']);
});

test('identical scripts are only marked as synced', () => {
  assert.deepEqual(planScripts([L('a', 'x')], [R('a', 'x')], {}), [{ op: 'mark', name: 'a', hash: hashCode('x'), public: false }]);
  assert.deepEqual(planScripts([L('a', 'x')], [R('a', 'x')], { a: seenOf('x') }), []);
});

test('the side that did not change takes the other side', () => {
  const seen = { a: seenOf('v1') };
  assert.equal(planScripts([L('a', 'v1')], [R('a', 'v2')], seen)[0].op, 'pull');
  assert.equal(planScripts([L('a', 'v2')], [R('a', 'v1')], seen)[0].op, 'push');
});

test('publishing alone is a change', () => {
  const seen = { a: seenOf('v1', false) };
  assert.deepEqual(planScripts([L('a', 'v1', 100, true)], [R('a', 'v1', 1, false)], seen), [{ op: 'push', name: 'a', code: 'v1', public: true }]);
});

test('both changed: the newer edit wins', () => {
  const seen = { a: seenOf('v0') };
  assert.equal(planScripts([L('a', 'v1', 200)], [R('a', 'v2', 100000)], seen)[0].op, 'push');
  assert.equal(planScripts([L('a', 'v1', 50)], [R('a', 'v2', 100000)], seen)[0].op, 'pull');
});

test('deletions follow, unless the script was edited on the other side', () => {
  const seen = { a: seenOf('v1') };
  assert.equal(planScripts([L('a', 'v1')], [], seen)[0].op, 'delLocal', 'deleted remotely');
  assert.equal(planScripts([], [R('a', 'v1')], seen)[0].op, 'delRemote', 'deleted locally');
  assert.equal(planScripts([L('a', 'v2')], [], seen)[0].op, 'push', 'edited locally after the remote delete: keep it');
  assert.equal(planScripts([], [R('a', 'v2')], seen)[0].op, 'pull', 'edited remotely after the local delete: keep it');
});

test('free names, newest side', () => {
  assert.equal(freeName('RSI', ['MACD']), 'RSI');
  assert.equal(freeName('RSI', ['RSI'], 'Ann'), 'RSI (Ann)');
  assert.equal(freeName('RSI', ['RSI', 'RSI (Ann)'], 'Ann'), 'RSI (Ann) 2');
  assert.equal(stateDirection(5, null), 'push'); assert.equal(stateDirection(5, 9), 'pull'); assert.equal(stateDirection(9, 5), 'push'); assert.equal(stateDirection(5, 5), 'none');
});
