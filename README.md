# Flag possible duplicate supplier invoices in Google Sheets

This n8n workflow reads a Google Sheet of supplier invoices each weekday morning and looks for pairs that may be the same bill paid twice. New pairs are written to a review tab in the same spreadsheet, and one Slack message lists them before the payment run. It needs Google Sheets and Slack only, with no AI service.

It flags, it does not decide. A person checks each pair before anyone pays.

## What it checks

For every pair of rows from the same supplier, the workflow tidies the supplier name (Ltd, Limited and punctuation stop mattering) and the invoice number (`INV-000123` matches `123`). Then it raises a pair in three cases:

1. Same number and same amount: `EXACT DUPLICATE`.
2. Same number, different amount: `SAME NUMBER, DIFFERENT AMOUNT`, usually a resend or a correction.
3. Same amount, different number, dated within the date window (45 days by default): `SAME AMOUNT, DIFFERENT NUMBER`. Credit notes are left out of this check.

A pair already recorded in the review tab is not raised again the next day.

## What you need

- A Google Sheet with an invoice tab, connected to n8n through a Google Sheets credential.
- A Slack workspace, connected through a Slack credential.
- An n8n instance. The Schedule Trigger node in this file is version 1.3, so update n8n if that node is missing.

## Setup

1. In the spreadsheet that holds your invoices, check the invoice tab has a header row with these four columns, or note your own column names for step 4: `supplier`, `invoice_number`, `issue_date`, `gross`. The file `sample-sheets/invoices-headers.csv` shows them.
2. Add a second tab named `Possible duplicates`. Paste the header line from `sample-sheets/possible-duplicates-headers.csv` into row 1, or import that file.
3. Import `workflow.json` into n8n. Connect your Google Sheets credential on the three Google Sheets nodes and your Slack credential on the Slack node.
4. Open the **Settings** node. Replace the `invoicesSheetUrl` placeholder with the URL of your spreadsheet, and set the column names to match your invoice tab if they differ.
5. Run the workflow once by hand on a copy of your sheet. Read the `Possible duplicates` tab and the Slack message. If legitimate repeating invoices are flagged, lower `dateWindowDays`.
6. Switch the workflow on. It runs at 08:00 on weekdays (cron `0 8 * * 1-5`, in the timezone of your n8n instance).

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
| `amountTolerance` | `0.01` | How close two amounts must be to count as equal |
| `dateWindowDays` | `45` | Days apart for the same-amount check |
| `slackChannel` | `#accounts` | Channel that receives the message |

## How it works

1. **Every Weekday Morning** starts the run.
2. **Settings** holds the values above.
3. **Read The Invoices** reads the invoice tab once.
4. **Find Duplicates** is a Code node that normalises names and numbers and compares every pair from the same supplier.
5. **Read Already Flagged** reads the review tab, and **Keep Only New Pairs** drops pairs whose `pair_key` is already there.
6. **Log The Pairs** appends each new pair to the review tab.
7. **Write One Summary** builds one message, however many pairs there are (the first 15 are listed), and **Warn Accounts In Slack** posts it.

If there are no new pairs, nothing is written and nothing is posted.

## What it does not do

- It does not block a payment. It cannot see your bank or your payment system.
- It compares rows already in the sheet. It does not read PDFs or emails.
- It compares every pair of rows, so a very large sheet will make the Code node slow.
- It matches on supplier name after tidying, so two different spellings of a name that tidy to different text are treated as different suppliers.
- It does not remove or mark the original invoice rows. The review tab is the only thing it writes.

## What was and was not tested

- This workflow has not been run end to end by us.
- A written check on 29 October 2026 compared the workflow file with its public description and found no mismatches in node count, credentials, setup steps, the review tab's 11 headers, the settings defaults or the main feature claims. No workflow run was involved.
- No connected Google Sheets or Slack account has been used with this file by us, so the behaviour described here comes from reading the Code nodes.

## Licence

This project uses the MIT licence. See `LICENSE`.
