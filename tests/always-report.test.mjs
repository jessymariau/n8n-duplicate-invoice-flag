// Run with: node tests/always-report.test.mjs
// Loads the real Code nodes and the If node out of workflow.json and chains them the way n8n does:
// a node that returns no items stops everything after it. Slack and the sheet are stubs that record
// what they would receive, so "posted" and "logged" below are what the nodes hand on, not a real run.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const wf = JSON.parse(fs.readFileSync(new URL('../workflow.json', import.meta.url), 'utf8'));
const node = name => wf.nodes.find(n => n.name === name);
const code = name => node(name).parameters.jsCode;
const defaults = Object.fromEntries(node('Settings').parameters.assignments.assignments.map(a => [a.name, a.value]));
const guard = node('Nothing New To Log?').parameters.conditions.conditions[0].leftValue.replace(/^=\{\{|\}\}$/g, '');
const now = { toFormat: f => (f === 'HH:mm' ? '08:00' : '20 Nov 2026') };

const run = (invoices, flagged, settings = {}) => {
  const s = { ...defaults, ...settings };
  const settingsStub = { first: () => ({ json: s }) };
  const found = new Function('$', code('Find Duplicates'))(name =>
    name === 'Settings' ? settingsStub : { all: () => invoices.map(json => ({ json })) });
  const result = { logged: [], messages: [] };
  if (!found.length) return result; // n8n runs nothing after an empty result
  const fresh = new Function('$', code('Keep Only New Pairs'))(name =>
    name === 'Settings' ? settingsStub
      : name === 'Read Already Flagged' ? { all: () => flagged.map(json => ({ json })) }
      : { all: () => found });
  if (!fresh.length) return result;
  // The If node: true goes straight to the summary, false goes to the sheet and then the summary.
  const isMarker = i => new Function('$json', 'return ' + guard)(i.json);
  const toSheet = fresh.filter(i => !isMarker(i));
  const toSummary = fresh.filter(isMarker).concat(toSheet);
  result.logged = toSheet.map(i => i.json);
  const sum = new Function('$input', '$now', code('Write One Summary'))({ all: () => toSummary }, now);
  result.messages = sum.map(o => o.json);
  return result;
};

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok - ' + name); };
const inv = (supplier, n, date, gross) => ({ supplier, invoice_number: n, issue_date: date, gross });
const quiet = [inv('Acme', 'A1', '2026-01-01', '100'), inv('Beta', 'B1', '2026-01-01', '200')];
const dupes = [inv('Acme', 'A1', '2026-01-01', '100'), inv('Acme', 'A1', '2026-01-02', '100')];
const unread = [inv('Acme', 'A1', '2026-01-01', 'abc'), inv('Beta', 'B1', '2026-01-01', '200')];
const strip = o => o.map(({ flagged_at, ...rest }) => rest);

test('the setting exists and is false by default', () => {
  const a = node('Settings').parameters.assignments.assignments.find(x => x.name === 'alwaysReport');
  assert.equal(a.type, 'boolean');
  assert.equal(a.value, false);
});

test('off: a quiet run posts nothing and logs nothing, as before', () => {
  const r = run(quiet, []);
  assert.deepEqual(r.messages, []);
  assert.deepEqual(r.logged, []);
});

test('off: a run where every pair was raised before posts nothing', () => {
  const first = run(dupes, []);
  assert.equal(first.logged.length, 1);
  const r = run(dupes, first.logged);
  assert.deepEqual(r.messages, []);
  assert.deepEqual(r.logged, []);
});

test('on: a quiet run posts exactly one message saying 0 new pairs, and logs nothing', () => {
  const r = run(quiet, [], { alwaysReport: true });
  assert.equal(r.messages.length, 1);
  assert.equal(r.messages[0].count, 0);
  assert.match(r.messages[0].text, /0 new possible duplicate pairs/);
  assert.match(r.messages[0].text, /20 Nov 2026 at 08:00/);
  assert.deepEqual(r.logged, []);
});

// Not tested: a completely empty invoice tab. Read The Invoices then returns zero items, n8n never
// reaches Find Duplicates, and no message goes out even with alwaysReport on. The offline chain
// cannot show that, so no test pretends to.

test('on: pairs that were all raised before give the quiet message and no row', () => {
  const first = run(dupes, [], { alwaysReport: true });
  const r = run(dupes, first.logged, { alwaysReport: true });
  assert.equal(r.messages.length, 1);
  assert.match(r.messages[0].text, /0 new possible duplicate pairs/);
  assert.deepEqual(r.logged, []);
});

test('the placeholder never reaches the sheet: every logged row has a pair_key', () => {
  const flaggedDupes = run(dupes, []).logged;
  for (const [rows, flagged] of [[quiet, []], [[], []], [dupes, flaggedDupes], [dupes, []], [unread, []]]) {
    for (const r of [run(rows, flagged, { alwaysReport: true }), run(rows, flagged)]) {
      assert.ok(r.logged.every(row => typeof row.pair_key === 'string' && row.pair_key !== ''));
    }
  }
});

test('on, with new pairs: rows and message equal the off run', () => {
  const off = run(dupes, []);
  const on = run(dupes, [], { alwaysReport: true });
  assert.deepEqual(strip(on.logged), strip(off.logged));
  assert.deepEqual(on.messages, off.messages);
  assert.equal(on.messages.length, 1);
  assert.match(on.messages[0].text, /1 possible duplicate invoice pair/);
});

test('an unread amount on an otherwise quiet run is logged and posted as before, on or off', () => {
  const off = run(unread, []);
  const on = run(unread, [], { alwaysReport: true });
  assert.equal(off.logged.length, 1);
  assert.equal(off.logged[0].verdict, 'AMOUNT NOT READ');
  assert.match(off.messages[0].text, /Amount not read/);
  assert.doesNotMatch(on.messages[0].text, /0 new possible duplicate pairs/);
  assert.deepEqual(on.messages, off.messages);
  assert.deepEqual(on.logged.map(r => r.pair_key), off.logged.map(r => r.pair_key));
});

test('an unread amount already raised leaves a quiet run, which reports when on', () => {
  const first = run(unread, []);
  assert.deepEqual(run(unread, first.logged).messages, []);
  const r = run(unread, first.logged, { alwaysReport: true });
  assert.equal(r.messages.length, 1);
  assert.match(r.messages[0].text, /0 new possible duplicate pairs/);
  assert.deepEqual(r.logged, []);
});

test('the string "true" turns it on, "false" and a missing setting leave it off', () => {
  assert.equal(run(quiet, [], { alwaysReport: 'true' }).messages.length, 1);
  assert.equal(run(quiet, [], { alwaysReport: 'false' }).messages.length, 0);
  const s = { ...defaults };
  delete s.alwaysReport;
  const found = new Function('$', code('Find Duplicates'))(n =>
    n === 'Settings' ? { first: () => ({ json: s }) } : { all: () => quiet.map(json => ({ json })) });
  assert.deepEqual(found, []);
});

test('wiring: the guard sits between Keep Only New Pairs and Log The Pairs', () => {
  const c = wf.connections;
  assert.equal(c['Keep Only New Pairs'].main[0][0].node, 'Nothing New To Log?');
  assert.equal(c['Nothing New To Log?'].main[0][0].node, 'Write One Summary'); // true: placeholder
  assert.equal(c['Nothing New To Log?'].main[1][0].node, 'Log The Pairs');     // false: real rows
  assert.equal(c['Log The Pairs'].main[0][0].node, 'Write One Summary');
  const into = Object.entries(c).filter(([, v]) => v.main.flat().some(t => t.node === 'Log The Pairs')).map(([k]) => k);
  assert.deepEqual(into, ['Nothing New To Log?']);
});

console.log(passed + ' tests passed');
