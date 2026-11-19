// Run with: node tests/aliases.test.mjs
// Loads the real Find Duplicates node out of workflow.json and runs it against stubs.
// The alias tab is read by its own node, so the stub hands those rows over by node name.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const wf = JSON.parse(fs.readFileSync(new URL('../workflow.json', import.meta.url), 'utf8'));
const node = name => wf.nodes.find(n => n.name === name);
const defaults = Object.fromEntries(node('Settings').parameters.assignments.assignments.map(a => [a.name, a.value]));

// aliasRows undefined = the read node never ran; asking for it then throws, as in n8n.
const run = (rows, aliasRows, settings = {}) => {
  const s = { ...defaults, ...settings };
  const $ = name => {
    if (name === 'Settings') return { first: () => ({ json: s }) };
    if (name === 'Read Supplier Aliases') {
      if (!aliasRows) throw new Error('alias read did not run');
      return { all: () => aliasRows.map(json => ({ json })) };
    }
    return { all: () => rows.map(json => ({ json })) };
  };
  return new Function('$', node('Find Duplicates').parameters.jsCode)($).map(o => o.json);
};
const strip = out => out.map(({ flagged_at, ...rest }) => rest);
const on = { aliasesTab: 'Supplier aliases' };

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok - ' + name); };

const inv = (supplier, n, date, gross) => ({ supplier, invoice_number: n, issue_date: date, gross });
const split = [
  inv('Northwind Trading', 'A1', '2026-01-01', '500'),
  inv('N. Wind Supplies Ltd', 'B9', '2026-01-05', '500'),
];

test('the feature is off by default and the alias node is never touched', () => {
  assert.equal(defaults.aliasesTab, '');
  assert.deepEqual(run(split, undefined), []);
});

test('no alias data gives identical output to feature off', () => {
  const rows = [
    inv('Acme Ltd', 'INV-1', '2026-01-01', '10'), inv('ACME Limited', '1', '2026-01-02', '10'),
    inv('Beta', 'X', '2026-01-01', '20'), inv('Beta', 'Y', '2026-01-03', '20'),
  ];
  const off = strip(run(rows, undefined));
  assert.ok(off.length === 2);
  assert.deepEqual(strip(run(rows, [], on)), off);
  assert.deepEqual(strip(run(rows, [{}], on)), off); // an empty tab read as one blank item
});

test('an alias makes two spellings pair', () => {
  const out = run(split, [{ spelling: 'N. Wind Supplies Ltd', treat_as: 'Northwind Trading' }], on);
  assert.equal(out.length, 1);
  assert.equal(out[0].verdict, 'SAME AMOUNT, DIFFERENT NUMBER');
  assert.equal(out[0].sheet_rows, '2 and 3');
  assert.ok(out[0].pair_key.startsWith('northwind trading|'));
});

test('the match is forgiving: case, punctuation, Ltd and Limited', () => {
  const out = run(split, [{ spelling: 'n wind SUPPLIES limited', treat_as: ' NORTHWIND  trading, Ltd. ' }], on);
  assert.equal(out.length, 1);
});

test('blank and half-filled alias rows are ignored', () => {
  const junk = [{}, { spelling: '', treat_as: '' }, { spelling: 'N. Wind Supplies Ltd' },
    { treat_as: 'Northwind Trading' }, { spelling: 'N. Wind Supplies Ltd', treat_as: ' Ltd ' }, { spelling: 'Ltd', treat_as: 'Zed' }];
  assert.deepEqual(run(split, junk, on), []);
});

test('chains are not followed: A to B and B to C stops after one step', () => {
  const rows = [inv('Aaa', '1', '2026-01-01', '5'), inv('Bbb', '2', '2026-01-02', '5'), inv('Ccc', '3', '2026-01-03', '5')];
  const chain = [{ spelling: 'Aaa', treat_as: 'Bbb' }, { spelling: 'Bbb', treat_as: 'Ccc' }];
  const out = run(rows, chain, on);
  // Aaa becomes Bbb (not Ccc), Bbb becomes Ccc, Ccc stays: only the Bbb and Ccc rows pair.
  assert.equal(out.length, 1);
  assert.equal(out[0].sheet_rows, '3 and 4');
  const direct = run(rows, [{ spelling: 'Aaa', treat_as: 'Ccc' }, { spelling: 'Bbb', treat_as: 'Ccc' }], on);
  assert.equal(direct.length, 3);
});

test('a spelling listed twice: the first row wins', () => {
  const rows = [inv('Aaa', '1', '2026-01-01', '5'), inv('Bbb', '2', '2026-01-02', '5'), inv('Ccc', '3', '2026-01-03', '9')];
  const first = run(rows, [{ spelling: 'Aaa', treat_as: 'Bbb' }, { spelling: 'AAA', treat_as: 'Ccc' }], on);
  assert.equal(first.length, 1);
  assert.equal(first[0].sheet_rows, '2 and 3');
  const other = run(rows, [{ spelling: 'AAA', treat_as: 'Ccc' }, { spelling: 'Aaa', treat_as: 'Bbb' }], on);
  assert.deepEqual(other, []);
});

test('an alias pair is logged under the first row\'s own spelling', () => {
  const out = run(split, [{ spelling: 'N. Wind Supplies Ltd', treat_as: 'Northwind Trading' }], on);
  assert.equal(out[0].supplier, 'Northwind Trading');
});

test('an alias only changes keys of pairs whose supplier is aliased', () => {
  const rows = [inv('Acme', 'E1', '2026-01-01', '9'), inv('Acme', 'E1', '2026-01-01', '9'),
    inv('Beta', 'F1', '2026-01-01', '8'), inv('Beta', 'F1', '2026-01-01', '8')];
  const off = run(rows, undefined);
  const withAlias = run(rows, [{ spelling: 'Acme', treat_as: 'Acme Group' }], on);
  assert.equal(off[0].pair_key.startsWith('acme|'), true);
  assert.equal(withAlias[0].pair_key.startsWith('acme group|'), true);
  assert.equal(withAlias[1].pair_key, off[1].pair_key);
});

test('headers are found ignoring case and surrounding spaces', () => {
  const row = { ' Spelling ': 'N. Wind Supplies Ltd', 'Treat_As': 'Northwind Trading' };
  assert.equal(run(split, [row], on).length, 1);
});

test('a named tab with rows but wrong headers stops the run', () => {
  assert.throws(() => run(split, [{ from: 'N. Wind Supplies Ltd', to: 'Northwind Trading' }], on), /spelling and treat_as/);
  assert.throws(() => run(split, [{ spelling: 'N. Wind Supplies Ltd' }], on), /spelling and treat_as/);
});

console.log(passed + ' tests passed');
