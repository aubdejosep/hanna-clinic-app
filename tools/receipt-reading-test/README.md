# Receipt reading test

Measures how well Claude models read the clinic's receipt photos before the Ledger's automatic reading is built.
Runs on the owner's PC with the `receipt-test` API key; nothing here touches the app or its database.

1. Put each day's photos in a folder named by date, all inside one folder, e.g. `C:\receipts\2026-11-15`,
   `C:\receipts\2026-11-16`, `C:\receipts\2026-11-19` (unzip the days' photo zips there).
2. Put the answer key in the app's `data` folder: `data/receipt-answer-key.json` (git-ignored: it has client names).
3. In PowerShell, from this folder:

```
cd tools\receipt-reading-test
npm install
$env:ANTHROPIC_API_KEY="<your receipt-test key>"
node read.mjs --photos C:\receipts
```

It reads every photo with Claude Sonnet 5.5 and Claude Haiku 5.5 (about $1.50 in all), prints a scorecard and saves
`results/<time>/report.md` plus each model's readings. `results/` has client names: it's git-ignored, don't share it
outside the clinic. Options: `--models claude-haiku-5-5` (one model), `--days 2026-11-16` (one day).
