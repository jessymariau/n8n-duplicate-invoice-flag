# Flag possible duplicate supplier invoices in Google Sheets

This n8n workflow reads a Google Sheet of supplier invoices each weekday morning and looks for pairs that may be the same bill paid twice. New pairs are written to a review tab in the same spreadsheet, and one Slack message lists them before the payment run. It needs Google Sheets and Slack only, with no AI service.

It flags, it does not decide. A person checks each pair before anyone pays.

## What it checks

For every pair of rows from the same supplier, the workflow tidies the supplier name (Ltd, Limited and punctuation stop mattering) and the invoice number (`INV-000123` matches `123`). Then it raises a pair in three cases:

1. Same number and same amount: `EXACT DUPLICATE`.
2. Same number, different amount: `SAME NUMBER, DIFFERENT AMOUNT`, usually a resend or a correction.
3. Same amount, different number, dated within the date window (45 days by default): `SAME AMOUNT, DIFFERENT NUMBER`. Credit notes are left out of this check.

A pair already recorded in the review tab is not raised again the next day.

## Supplier aliases (optional)

If one supplier is written two ways that do not tidy to the same text, list them on a third tab. It has two columns: `spelling` (the name as it appears on an invoice) and `treat_as` (the name to use instead). Header case and spaces around the header text do not matter. If the tab has rows but no `spelling` or `treat_as` header, the run stops with an error. A tab with headers only means no aliases. The file `sample-sheets/supplier-aliases-headers.csv` shows the headers and two example rows.

- The tab is read once per run, before anything is compared. Each invoice's supplier is swapped for its `treat_as` name, then the usual checks run.
- Matching is as forgiving as the supplier tidying: case, punctuation and Ltd or Limited do not matter. `ACME Supplies` on the alias tab matches `Acme Supplies Ltd.` on an invoice.
- A row with either column blank, or one that tidies to nothing, is ignored.
- Aliases are applied one step only. If the tab says A to B and B to C, an invoice from A is treated as B, not C, so a supplier that should reach C needs its own row pointing at C.
- If a spelling is listed twice, the first row from the top wins.
- A pair that exists only because of an alias is raised like any other. The `supplier` column shows the spelling from the first row of the pair.
- The pair key uses the alias name. Turning aliases on changes the key of any pair whose supplier has an alias row, so such a pair already in the review tab is raised once more. Other pairs keep their keys.

## What you need

- A Google Sheet with an invoice tab, connected to n8n through a Google Sheets credential.
- A Slack workspace, connected through a Slack credential.
- An n8n instance. The Schedule Trigger node in this file is version 1.3, so update n8n if that node is missing.

## Setup

1. In the spreadsheet that holds your invoices, check the invoice tab has a header row with these four columns, or note your own column names for step 4: `supplier`, `invoice_number`, `issue_date`, `gross`. The file `sample-sheets/invoices-headers.csv` shows them.
2. Add a second tab named `Possible duplicates`. Paste the header line from `sample-sheets/possible-duplicates-headers.csv` into row 1, or import that file.
3. Optional: to merge supplier spellings, add a tab with the headers from `sample-sheets/supplier-aliases-headers.csv` and fill it in. Skip this step if you do not need it.
4. Import `workflow.json` into n8n. Connect your Google Sheets credential on the Google Sheets nodes (three, or four with aliases) and your Slack credential on the Slack node.
5. Open the **Settings** node. Replace the `invoicesSheetUrl` placeholder with the URL of your spreadsheet, set the column names to match your invoice tab if they differ, set `decimalSeparator` to `,` if your amounts use comma decimals, and type the alias tab's name into `aliasesTab` if you made one.
6. Run the workflow once by hand on a copy of your sheet. Read the `Possible duplicates` tab and the Slack message. If legitimate repeating invoices are flagged, lower `dateWindowDays`.
7. Switch the workflow on. It runs at 08:00 on weekdays (cron `0 8 * * 1-5`, in the timezone of your n8n instance).

## Settings

All in the **Settings** node:

| Setting | Default | Meaning |
|---|---|---|
| `invoicesSheetUrl` | placeholder | URL of the spreadsheet |
| `invoicesTab` | `Invoices` | Tab holding the invoices |
| `flagsTab` | `Possible duplicates` | Tab where new pairs are logged |
| `supplierColumn` | `supplier` | Column with the supplier name |
| `numberColumn` | `invoice_number` | Column with the invoice number |
| `dateColumn` | `issue_date` | Column with the invoice date |
| `amountColumn` | `gross` | Column with the amount |
| `currencyColumn` | empty | Optional column with the currency. Empty means one currency, as before |
| `aliasesTab` | empty | Name of the optional alias tab. Empty means no alias tab is read. If you set a name, the tab must exist |
| `decimalSeparator` | `.` | `.` or `,`. How amounts are written in your sheet. Any other value stops the run |
| `amountTolerance` | `0.01` | How close two amounts must be to count as equal |
| `dateWindowDays` | `45` | Days apart for the same-amount check |
| `slackChannel` | `#accounts` | Channel that receives the message |

## How amounts are read

The workflow does not guess. Set `decimalSeparator` to match how your sheet writes numbers.

- A cell that is already a number is used as it is.
- Currency symbols and three-letter capital codes (`USD 500`, `£500`, `500 EUR`) are dropped.
- Brackets, a leading minus or a trailing minus make the amount negative: `(500.00)`, `500.00-` and `-500.00` all read as -500.
- With `.`: the dot is the decimal point, and commas, spaces and apostrophes are thousands marks. A thousands mark must sit between groups of exactly three digits, so `1,234.56` reads as 1234.56, while `500,00` and `1.234,56` are unread.
- With `,`: the comma is the decimal point, and dots, spaces and apostrophes are thousands marks, again in groups of exactly three digits. `500,00` reads as 500 and `1.234,56` as 1234.56, while `500.00` and `1,234.56` are unread.
- After that, only digits and at most one decimal point may remain. Anything else is unread.

When an amount is filled in but cannot be read, the workflow reports it and does not guess. The row still takes part in the invoice-number checks with no amount, and one extra row with the verdict `AMOUNT NOT READ` is written to the review tab, using the existing headers: the sheet row numbers go in `sheet_rows` and `pair_key` is `unread|` followed by those numbers. It is raised once for each distinct set of rows, so if a new unread row appears the whole list is raised again. Slack shows it as its own line, even on a day with no new pair. A blank amount cell is not treated as unread.

If you set `currencyColumn`, each row's currency is that cell trimmed and in capitals, and two amounts only count as equal when their currencies are equal. The currency is not written to the review tab or to Slack, because that would need a new column and the review tab keeps its 11 headers. Leave the setting empty and currencies are ignored, so `USD 500` and `EUR 500` count as the same amount. Turning `currencyColumn` on changes the pair key, so pairs already in the review tab are raised once more. A `currencyColumn` name that matches no column header leaves every currency blank, so the workflow behaves as if the setting were empty.

## How it works

1. **Every Weekday Morning** starts the run.
2. **Settings** holds the values above.
3. **Read The Invoices** reads the invoice tab once.
4. **Aliases Switched On?** checks `aliasesTab`. If it is empty, the run goes straight on and no alias tab is read. If it has a name, **Read Supplier Aliases** reads that tab once first.
5. **Find Duplicates** is a Code node that normalises names and numbers, applies the aliases if there are any, and compares every pair from the same supplier.
6. **Read Already Flagged** reads the review tab, and **Keep Only New Pairs** drops pairs whose `pair_key` is already there.
7. **Log The Pairs** appends each new pair to the review tab.
8. **Write One Summary** builds one message, however many pairs there are (the first 15 are listed), and **Warn Accounts In Slack** posts it.

If there are no new pairs, nothing is written and nothing is posted.

## What it does not do

- It does not block a payment. It cannot see your bank or your payment system.
- It does not convert currencies, and it cannot read a number written in another style, such as 12,34,567.00 with lakh grouping.
- It compares rows already in the sheet. It does not read PDFs or emails.
- It compares every pair of rows, so a very large sheet will make the Code node slow.
- It matches on supplier name after tidying, so two different spellings of a name that tidy to different text are treated as different suppliers, unless your alias tab lists them.
- It does not remove or mark the original invoice rows. The review tab is the only thing it writes.

## What was and was not tested

- The amount reading and pairing logic is tested offline. Run `node tests/amounts.test.mjs`: it loads the Code nodes out of `workflow.json` and runs them against stubs, covering both decimal settings, brackets and minus signs, currency codes with and without `currencyColumn`, and the `AMOUNT NOT READ` row. It also checks that real pairs keep the same verdicts and keys as the version before this change.
- The alias logic is tested offline only. Run `node tests/aliases.test.mjs`: it covers no alias data giving the same output as before, an alias pairing two spellings, forgiving matching, blank rows, chains, a spelling listed twice and the pair key change. The If node and the alias read node have not been run in n8n.
- This workflow has not been run end to end by us, against a real sheet or Slack.
- A written check on 29 October 2026 compared the workflow file with its public description. It predates the amount, currency, unread-row and alias changes, so it does not cover this version. No workflow run was involved.
- No connected Google Sheets or Slack account has been used with this file by us, so how the sheet and Slack nodes behave comes only from reading them.

## Licence

This project uses the MIT licence. See `LICENSE`.
