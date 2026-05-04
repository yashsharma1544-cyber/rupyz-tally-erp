# Sushil Agencies — Tally Agent

A small local helper that pulls customer outstanding balances from Tally Prime
and pushes them to the Sushil Agencies ERP.

Phase 5 **chunk 1** — outstanding balances only. Receipts and stock are coming
in chunks 2 and 3.

## What it does

1. Queries Tally Prime over HTTP/XML for the list of ledgers
2. Filters to customers (Sundry Debtors) with outstanding amounts
3. POSTs them to your ERP's `/api/tally/ingest` endpoint
4. Provides a small local web page (default <http://localhost:7531>) with a
   "Sync now" button so admin can trigger a sync manually

## Prerequisites

1. **Tally Prime** running on this machine, with HTTP server enabled.
   - In Tally Prime: `F1: Help > Settings > Connectivity` (path varies by version)
   - Confirm by visiting <http://localhost:9000> in a browser — should show
     `<RESPONSE>TallyPrime Server is Running</RESPONSE>`
2. **Python 3.10 or later** installed. Download from
   <https://www.python.org/downloads/>.
   - During install on Windows: check "Add Python to PATH"
3. **The agent secret** generated in your ERP. Go to **Settings → Tally bridge**
   in the web app, click **Generate**, and copy the long hex string.

## Install

Open Command Prompt (or PowerShell) in this folder and run:

```cmd
pip install -r requirements.txt
```

This installs `requests` (the only dependency).

## Configure

1. Copy `config.example.ini` to `config.ini`:

   ```cmd
   copy config.example.ini config.ini
   ```

2. Open `config.ini` in Notepad and edit:

   ```ini
   [tally]
   url = http://localhost:9000

   [app]
   url = https://your-erp.example.com
   agent_secret = <paste the hex string from ERP settings>

   [agent]
   local_port = 7531
   ```

## Run

```cmd
python agent.py
```

You should see:

```
[INFO] Agent ready on http://localhost:7531
[INFO] Open that URL in a browser on this machine to trigger a sync.
```

Open <http://localhost:7531> in any browser on this machine. You'll see a
small page with a **Sync now** button. Click it.

After ~5 seconds you'll see a status message: how many ledgers were synced,
how many were matched to customers in your ERP, and how many were unmatched.

## Verify in the ERP

Go to your ERP's **Settings** page. The "Tally bridge" panel should show:

- "Connected" badge
- Last successful sync time
- Synced/matched/unmatched counts

If you see "failed", check `agent.log` in this folder for details.

## Run as a Windows service (optional)

For now, just leave the Command Prompt window open while you want the agent
available. To stop the agent, press `Ctrl+C` or close the window.

In a later chunk we'll provide a Windows scheduled task / service installer
so the agent runs automatically on boot.

## Troubleshooting

### `Could not connect to Tally at http://localhost:9000`

- Tally Prime is not running, or
- HTTP server is not enabled in Tally settings, or
- Tally is running but no company file is open

Open Tally Prime, load your company, then visit <http://localhost:9000> in
a browser to confirm.

### `ERP ingestion failed (HTTP 401): Invalid token`

The `agent_secret` in `config.ini` doesn't match what's in the ERP. Go to
the ERP's Settings > Tally bridge, click **Show** next to the secret, and
copy the full string back into `config.ini`. Restart the agent.

### `Tally returned malformed XML`

Some ledger has weird control characters that broke parsing. The agent
saves the raw response to `tally_response_debug.xml` for inspection.
Open it in a text editor, find the line near the error, and clean up the
ledger name in Tally (usually a stray invisible character pasted long ago).

### Agent shows "synced 0"

No customers under "Sundry Debtors" have outstanding amounts, OR the
parent ledger group is named differently in your Tally. Check Tally's
chart of accounts — customer ledgers must be under "Sundry Debtors"
exactly (case-sensitive comparison after lowercasing).

### Logs

Every action is logged to `agent.log` (next to `agent.py`). It's safe to
delete or rotate; the agent recreates it on next run.

## What's next (chunks 2 and 3)

- **Chunk 2:** receipts/payments + stock balances
- **Chunk 3:** auto-startup as Windows service, manual trigger from ERP UI
  (no need to open <http://localhost:7531> manually), staleness warnings
