// Run with: node tests/amounts.test.mjs
// Loads the real Code node text out of workflow.json and runs it against small stubs of the
// n8n helpers, so the tests fail if the workflow file itself is wrong.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const wf = JSON.parse(fs.readFileSync(new URL('../workflow.json', import.meta.url), 'utf8'));
const code = name => wf.nodes.find(n => n.name === name).parameters.jsCode;
const defaults = Object.fromEntries(wf.nodes.find(n => n.name === 'Settings').parameters.assignments.assignments
  .map(a => [a.name, a.value]));

const findDuplicates = (rows, settings = {}) => {
  const s = { ...defaults, ...settings };
  const $ = name => (name === 'Settings' ? { first: () => ({ json: s }) } : { all: () => rows.map(json => ({ json })) });
  return new Function('$', code('Find Duplicates'))($).map(o => o.json);
};
const summary = items => {
  const $input = { all: () => items.map(json => ({ json })) };
  return new Function('$input', code('Write One Summary'))($input)[0].json;
};
// Reads one amount by putting it in a one-row sheet next to a copy that matches only on amount.
const read = (value, settings) => {
  const rows = [
    { supplier: 'S', invoice_number: 'A1', issue_date: '2026-01-01', gross: value },
    { supplier: 'S', invoice_number: 'A2', issue_date: '2026-01-02', gross: '1' },
  ];
  const out = findDuplicates(rows, settings);
  const unread = out.find(o => o.verdict === 'AMOUNT NOT READ');
  if (unread) return null;
  // not unread: probe the value through a same-number pair, which reports amount_a
  const probe = findDuplicates([
    { supplier: 'S', invoice_number: 'P', issue_date: '2026-01-01', gross: value },
    { supplier: 'S', invoice_number: 'P', issue_date: '2026-01-01', gross: '0' },
  ], settings)[0];
  return probe.amount_a;
};

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok - ' + name); };

test('settings defaults are present', () => {
  assert.equal(defaults.decimalSeparator, '.');
  assert.equal(defaults.currencyColumn, '');
});

test('500 and "500.00" read as 500', () => {
  assert.equal(read(500), 500);
  assert.equal(read('500.00'), 500);
});

test('"1,234.56" reads as 1234.56 under "."', () => {
  assert.equal(read('1,234.56'), 1234.56);
  assert.equal(read("1 234.56"), 1234.56);
  assert.equal(read("1'234.56"), 1234.56);
});

test('"500,00" and "1.234,56" are unread under "."', () => {
  assert.equal(read('500,00'), null);
  assert.equal(read('1.234,56'), null);
  assert.equal(read('1,23,456.00'), null);
  assert.equal(read('abc'), null);
});

test('"500,00" and "1.234,56" read as 500 and 1234.56 under ","', () => {
  assert.equal(read('500,00', { decimalSeparator: ',' }), 500);
  assert.equal(read('1.234,56', { decimalSeparator: ',' }), 1234.56);
  assert.equal(read('1 234,56', { decimalSeparator: ',' }), 1234.56);
});

test('"500.00" and "1,234.56" are unread under ","', () => {
  assert.equal(read('500.00', { decimalSeparator: ',' }), null);
  assert.equal(read('1,234.56', { decimalSeparator: ',' }), null);
});

test('brackets, trailing minus and leading minus all read as -500', () => {
  assert.equal(read('(500.00)'), -500);
  assert.equal(read('500.00-'), -500);
  assert.equal(read('-500.00'), -500);
  assert.equal(read('(-500.00)'), null);
});

test('currency marks are dropped from the amount', () => {
  assert.equal(read('USD 500'), 500);
  assert.equal(read('£1,234.56'), 1234.56);
  assert.equal(read('500.00 EUR'), 500);
});

test('an invalid decimalSeparator stops the run', () => {
  assert.throws(() => findDuplicates([], { decimalSeparator: ';' }), /decimalSeparator/);
});

const usdEur = [
  { supplier: 'Acme', invoice_number: 'X1', issue_date: '2026-01-01', gross: 'USD 500', cur: 'usd ' },
  { supplier: 'Acme', invoice_number: 'X2', issue_date: '2026-01-02', gross: 'EUR 500', cur: 'EUR' },
];

test('USD 500 against EUR 500 matches without currencyColumn (as before)', () => {
  const out = findDuplicates(usdEur);
  assert.deepEqual(out.map(o => o.verdict), ['SAME AMOUNT, DIFFERENT NUMBER']);
});

test('USD 500 against EUR 500 does not match with currencyColumn', () => {
  assert.deepEqual(findDuplicates(usdEur, { currencyColumn: 'cur' }), []);
});

test('same currency still matches with currencyColumn, key carries the currency', () => {
  const rows = usdEur.map(r => ({ ...r, cur: 'USD' }));
  const out = findDuplicates(rows, { currencyColumn: 'cur' });
  assert.equal(out.length, 1);
  assert.ok(out[0].pair_key.includes('|USD'));
});

test('an unreadable amount gives one AMOUNT NOT READ item with the rows and key', () => {
  const rows = [
    { supplier: 'Acme', invoice_number: 'N1', issue_date: '2026-01-01', gross: '500,00' },
    { supplier: 'Acme', invoice_number: 'N2', issue_date: '2026-01-01', gross: '12.00' },
    { supplier: 'Acme', invoice_number: 'N3', issue_date: '2026-01-01', gross: 'TBC' },
    { supplier: 'Acme', invoice_number: 'N4', issue_date: '2026-01-01', gross: '' },
  ];
  const out = findDuplicates(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].verdict, 'AMOUNT NOT READ');
  assert.equal(out[0].sheet_rows, '2, 4');
  assert.equal(out[0].pair_key, 'unread|2,4');
});

test('an unread row still takes part in the invoice-number check, with amount null', () => {
  const rows = [
    { supplier: 'Acme', invoice_number: 'N1', issue_date: '2026-01-01', gross: '500,00' },
    { supplier: 'Acme', invoice_number: 'N1', issue_date: '2026-01-02', gross: '500.00' },
  ];
  const out = findDuplicates(rows);
  assert.deepEqual(out.map(o => o.verdict), ['SAME NUMBER, DIFFERENT AMOUNT', 'AMOUNT NOT READ']);
  assert.equal(out[0].amount_a, null);
});

test('the summary shows the unread line even with no pair', () => {
  const text = summary([{ verdict: 'AMOUNT NOT READ', sheet_rows: '2, 4' }]).text;
  assert.ok(text.includes('Amount not read') && text.includes('2, 4'));
  assert.ok(!text.includes('possible duplicate'));
});

test('a pair with one unread amount prints "unread" in the summary line', () => {
  const rows = [
    { supplier: 'Acme', invoice_number: 'N1', issue_date: '2026-01-01', gross: '500,00' },
    { supplier: 'Acme', invoice_number: 'N1', issue_date: '2026-01-02', gross: '500.00' },
  ];
  const text = summary(findDuplicates(rows)).text;
  assert.ok(text.includes('unread vs 500'));
  assert.ok(!text.includes('null') && !text.includes('undefined'));
});

// Golden output of the ORIGINAL Find Duplicates (workflow.json at commit f851497, run with the
// same rows), with flagged_at left out. Real pairs must keep these verdicts and keys.
test('real pairs match the original code exactly', () => {
  const rows = [
    { supplier: 'Acme Supplies Ltd', invoice_number: 'INV-0001', issue_date: '2026-01-01', gross: '500.00' },
    { supplier: 'ACME Supplies Limited', invoice_number: '1', issue_date: '01/01/2026', gross: 500 },
    { supplier: 'Acme Supplies', invoice_number: 'INV-2', issue_date: '2026-01-10', gross: '500' },
    { supplier: 'Acme Supplies', invoice_number: 'INV-0001', issue_date: '2026-02-01', gross: '750.5' },
    { supplier: 'Beta', invoice_number: 'B1', issue_date: '2026-03-01', gross: '-20' },
    { supplier: 'Beta', invoice_number: 'B2', issue_date: '2026-03-02', gross: '-20' },
    { supplier: 'Beta', invoice_number: 'B3', issue_date: '2026-03-02', gross: '' },
    { supplier: 'Beta', invoice_number: 'B3', issue_date: '2026-03-02', gross: '' },
  ];
  const out = findDuplicates(rows).map(o => [o.verdict, o.pair_key]);
  assert.deepEqual(out, [
    ['EXACT DUPLICATE', 'acme supplies|1|500|2026-01-01 || acme supplies|1|500|2026-01-01'],
    ['SAME AMOUNT, DIFFERENT NUMBER', 'acme supplies|1|500|2026-01-01 || acme supplies|2|500|2026-01-10'],
    ['SAME NUMBER, DIFFERENT AMOUNT', 'acme supplies|1|500|2026-01-01 || acme supplies|1|750.5|2026-02-01'],
    ['SAME NUMBER, DIFFERENT AMOUNT', 'beta|B3||2026-03-02 || beta|B3||2026-03-02'],
  ]);
});

console.log(passed + ' tests passed');
