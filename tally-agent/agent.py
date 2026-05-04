"""
Sushil Agencies — Tally Agent

A small local helper that:
  1. Queries Tally Prime over HTTP/XML for ledger data
  2. Scrubs control characters and parses the response
  3. POSTs the data to the ERP's /api/tally/ingest endpoint
  4. Exposes a tiny local web page (default http://localhost:7531) with a
     "Sync now" button so admin can trigger sync from a browser

Configuration is read from config.ini (see config.example.ini).

Run with:    python agent.py
Stop with:   Ctrl+C

Phase 5 chunk 1: outstanding only.
"""

import configparser
import logging
import re
import sys
import urllib.parse
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Optional
from xml.etree import ElementTree as ET

import requests

# ---------------------------------------------------------------------------
# Logging setup
# ---------------------------------------------------------------------------

LOG_FILE = Path(__file__).parent / "agent.log"
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
    ],
)
log = logging.getLogger("tally-agent")

AGENT_VERSION = "0.1.0"

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

class Config:
    def __init__(self, path: Path):
        if not path.exists():
            raise SystemExit(
                f"Config file not found: {path}\n"
                f"Copy config.example.ini to config.ini and fill in your values."
            )
        cp = configparser.ConfigParser()
        cp.read(path, encoding="utf-8")

        try:
            self.tally_url = cp["tally"]["url"].rstrip("/")
            self.app_url = cp["app"]["url"].rstrip("/")
            self.agent_secret = cp["app"]["agent_secret"]
            self.local_port = int(cp.get("agent", "local_port", fallback="7531"))
        except KeyError as e:
            raise SystemExit(f"Missing config key: {e}")

        if not self.agent_secret or self.agent_secret.startswith("REPLACE"):
            raise SystemExit(
                "agent_secret is not set in config.ini. "
                "Generate one in your ERP's Settings > Tally panel and paste it here."
            )

# ---------------------------------------------------------------------------
# Tally query
# ---------------------------------------------------------------------------

# Tally TDL request to fetch all ledgers with parent, balance, mobile, GSTIN, etc.
LEDGER_REQUEST_XML = """\
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>List of Ledgers</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="List of Ledgers" ISMODIFY="No">
            <TYPE>Ledger</TYPE>
            <FETCH>Name,Parent,ClosingBalance,LedgerMobile,PartyGSTIN,LedgerStateName,Pincode,Guid</FETCH>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>
"""


# Pattern that matches XML-illegal control characters. XML 1.0 allows:
#   #x9, #xA, #xD, #x20-#xD7FF, #xE000-#xFFFD, #x10000-#x10FFFF
# Anything else (e.g. \x00-\x08, \x0B, \x0C, \x0E-\x1F) breaks parsing.
ILLEGAL_XML_RE = re.compile(
    r"[\x00-\x08\x0B\x0C\x0E-\x1F]",
)


def scrub_xml(raw: bytes) -> str:
    """Decode bytes to str and remove XML-illegal control characters.

    Tally occasionally embeds stray control characters (like \\x04) in ledger
    names, addresses, or narration fields, breaking strict XML parsers. We strip
    them silently.
    """
    # Decode as UTF-8 with fallback to latin-1 (Tally is loose about encoding)
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = raw.decode("latin-1", errors="replace")
        log.warning("Tally response was not valid UTF-8; fell back to latin-1.")

    cleaned = ILLEGAL_XML_RE.sub("", text)
    if cleaned != text:
        log.info("Stripped illegal control characters from Tally response.")
    return cleaned


def query_tally(tally_url: str, body_xml: str, timeout: int = 60) -> str:
    """POST an XML query to Tally and return the cleaned response text."""
    log.info("Querying Tally at %s", tally_url)
    try:
        resp = requests.post(tally_url, data=body_xml.encode("utf-8"), timeout=timeout)
    except requests.exceptions.ConnectionError as e:
        raise SystemExit(
            f"Could not connect to Tally at {tally_url}.\n"
            f"Make sure Tally Prime is running with HTTP server enabled.\n"
            f"Underlying error: {e}"
        )
    except requests.exceptions.Timeout:
        raise SystemExit(f"Tally took too long to respond ({timeout}s). Is the company file very large?")

    if resp.status_code != 200:
        raise SystemExit(f"Tally returned HTTP {resp.status_code}: {resp.text[:300]}")

    return scrub_xml(resp.content)


def parse_balance(text: Optional[str]) -> Optional[float]:
    """Parse Tally's CLOSINGBALANCE which can be `1234.56`, `1234.56 Dr`, etc.

    Tally exports closing balances with a trailing 'Dr' or 'Cr' marker, but in
    XML the value is usually the bare signed number. Customer (Sundry Debtor)
    balances are typically negative when they owe us — we don't flip here, the
    caller decides.
    """
    if text is None:
        return None
    s = text.strip()
    if not s:
        return None
    # Strip Dr/Cr suffixes if present
    s = re.sub(r"\s*(Dr|Cr)\s*$", "", s, flags=re.IGNORECASE)
    s = s.replace(",", "").strip()
    try:
        return float(s)
    except ValueError:
        return None


def extract_ledgers(xml_text: str) -> list[dict]:
    """Walk the parsed XML and return a list of ledger dicts.

    Filters to only ledgers under 'Sundry Debtors' (i.e. customers who owe us).
    """
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as e:
        # Save the malformed response for debugging
        debug_path = Path(__file__).parent / "tally_response_debug.xml"
        debug_path.write_text(xml_text, encoding="utf-8")
        raise SystemExit(
            f"Tally returned malformed XML: {e}\n"
            f"Response saved to {debug_path} for inspection. "
            f"Sometimes a ledger has special chars that need cleaning."
        )

    ledgers = []
    for ledger in root.iter("LEDGER"):
        # The NAME attribute is on the LEDGER tag itself
        name = ledger.attrib.get("NAME", "").strip()
        if not name:
            continue

        parent = (ledger.findtext("PARENT") or "").strip()
        if parent.lower() != "sundry debtors":
            continue   # only customers

        raw_balance_text = ledger.findtext("CLOSINGBALANCE")
        raw_balance = parse_balance(raw_balance_text)
        if raw_balance is None:
            log.debug("Skipping ledger %s — no parseable closing balance", name)
            continue

        # Customer outstanding: Tally stores customer balances as negative
        # (credit balance from our books = customer owes us). Flip to positive.
        amount = -raw_balance if raw_balance < 0 else 0.0

        # Skip customers with no outstanding (zero or positive — they don't owe)
        if amount <= 0:
            continue

        guid = (ledger.findtext("GUID") or "").strip() or None
        mobile = (ledger.findtext("LEDGERMOBILE") or "").strip() or None
        gstin = (ledger.findtext("PARTYGSTIN") or "").strip() or None
        state = (ledger.findtext("LEDGERSTATENAME") or "").strip() or None
        pincode = (ledger.findtext("PINCODE") or "").strip() or None

        ledgers.append({
            "name": name,
            "guid": guid,
            "parent": parent,
            "state": state,
            "pincode": pincode,
            "mobile": mobile,
            "gstin": gstin,
            "raw_balance": raw_balance,
            "amount": round(amount, 2),
        })

    return ledgers


# ---------------------------------------------------------------------------
# Push to ERP
# ---------------------------------------------------------------------------

def push_to_erp(cfg: Config, ledgers: list[dict]) -> dict:
    url = f"{cfg.app_url}/api/tally/ingest"
    payload = {
        "type": "outstanding",
        "ledgers": ledgers,
        "agent_version": AGENT_VERSION,
        "started_at": datetime.now(timezone.utc).isoformat(),
    }
    headers = {
        "Authorization": f"Bearer {cfg.agent_secret}",
        "Content-Type": "application/json",
    }
    log.info("Pushing %d ledgers to %s", len(ledgers), url)
    try:
        resp = requests.post(url, json=payload, headers=headers, timeout=60)
    except requests.exceptions.RequestException as e:
        raise SystemExit(f"Could not reach ERP at {url}: {e}")

    try:
        body = resp.json()
    except ValueError:
        body = {"error": resp.text[:300]}

    if resp.status_code != 200 or not body.get("ok"):
        raise SystemExit(
            f"ERP ingestion failed (HTTP {resp.status_code}): "
            f"{body.get('error', body)}"
        )

    return body


# ---------------------------------------------------------------------------
# Sync orchestration
# ---------------------------------------------------------------------------

class SyncResult:
    def __init__(self):
        self.success: bool = False
        self.synced: int = 0
        self.matched: int = 0
        self.unmatched: int = 0
        self.error: Optional[str] = None
        self.finished_at: Optional[datetime] = None


def run_sync(cfg: Config) -> SyncResult:
    result = SyncResult()
    try:
        xml_text = query_tally(cfg.tally_url, LEDGER_REQUEST_XML)
        ledgers = extract_ledgers(xml_text)
        log.info("Extracted %d Sundry-Debtor ledgers with positive outstanding", len(ledgers))

        if not ledgers:
            log.warning("No customer ledgers with outstanding found. Is the company file open?")

        body = push_to_erp(cfg, ledgers)
        result.success = True
        result.synced = body.get("synced", 0)
        result.matched = body.get("matched", 0)
        result.unmatched = body.get("unmatched", 0)
        log.info(
            "Sync complete: synced=%d matched=%d unmatched=%d",
            result.synced, result.matched, result.unmatched,
        )
    except SystemExit as e:
        # Caught for graceful UI display; log full
        log.error(str(e))
        result.error = str(e)
    except Exception as e:
        log.exception("Unexpected error during sync")
        result.error = f"{type(e).__name__}: {e}"
    finally:
        result.finished_at = datetime.now()
    return result


# ---------------------------------------------------------------------------
# Tiny local web UI
# ---------------------------------------------------------------------------

class AgentHandler(BaseHTTPRequestHandler):
    """Serves a one-page UI on http://localhost:<port> with a Sync button."""
    cfg: Config = None  # type: ignore  # set by main()
    last_result: Optional[SyncResult] = None

    def log_message(self, format, *args):
        # Quiet the per-request stderr logging; we have our own
        return

    def do_GET(self):  # noqa: N802
        if self.path == "/" or self.path.startswith("/?"):
            self._render()
        elif self.path == "/health":
            self._send(200, "ok", "text/plain")
        else:
            self._send(404, "Not found", "text/plain")

    def do_POST(self):  # noqa: N802
        if self.path == "/sync":
            log.info("Sync triggered from local web UI")
            type(self).last_result = run_sync(type(self).cfg)
            # Redirect back to GET so refreshing doesn't re-sync
            self.send_response(303)
            self.send_header("Location", "/")
            self.end_headers()
        else:
            self._send(404, "Not found", "text/plain")

    def _send(self, status: int, body: str, content_type: str = "text/html; charset=utf-8"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        body_bytes = body.encode("utf-8")
        self.send_header("Content-Length", str(len(body_bytes)))
        self.end_headers()
        self.wfile.write(body_bytes)

    def _render(self):
        last = type(self).last_result
        if last is None:
            status_html = '<p class="muted">No sync run yet — click <strong>Sync now</strong>.</p>'
        elif last.success:
            status_html = (
                '<div class="ok">'
                f'<strong>✓ Last sync succeeded</strong> at {last.finished_at:%H:%M:%S} — '
                f'synced {last.synced}, matched {last.matched}, unmatched {last.unmatched}.'
                '</div>'
            )
        else:
            err_text = (last.error or "unknown")
            err_safe = err_text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            status_html = (
                '<div class="err">'
                f'<strong>✗ Last sync failed</strong> at {last.finished_at:%H:%M:%S}<br>'
                f'<pre>{err_safe}</pre>'
                '</div>'
            )

        cfg = type(self).cfg
        app_url_safe = urllib.parse.quote(cfg.app_url, safe=":/?&=")

        html = f"""<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>Sushil Agencies — Tally Agent</title>
<style>
  body {{ font-family: system-ui, -apple-system, sans-serif; max-width: 640px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }}
  h1 {{ font-size: 1.4rem; margin-bottom: 0.25rem; }}
  .meta {{ color: #666; font-size: 0.85rem; margin-bottom: 1.5rem; }}
  button {{ background: #0d5b58; color: white; border: 0; padding: 0.7rem 1.2rem; border-radius: 4px; font-size: 1rem; cursor: pointer; }}
  button:hover {{ background: #094543; }}
  .ok {{ background: #f0f9f0; border: 1px solid #c8e6c9; padding: 0.75rem 1rem; border-radius: 4px; color: #2e7d32; margin: 1rem 0; }}
  .err {{ background: #fff3f3; border: 1px solid #ffcdd2; padding: 0.75rem 1rem; border-radius: 4px; color: #c62828; margin: 1rem 0; }}
  .muted {{ color: #888; }}
  pre {{ white-space: pre-wrap; font-family: ui-monospace, monospace; font-size: 0.8rem; margin: 0.5rem 0 0; }}
  .footer {{ margin-top: 2rem; color: #888; font-size: 0.8rem; line-height: 1.6; }}
</style>
</head><body>

<h1>Sushil Agencies — Tally Agent</h1>
<div class="meta">v{AGENT_VERSION} · pulling from {cfg.tally_url} → pushing to {cfg.app_url}</div>

{status_html}

<form method="POST" action="/sync">
  <button type="submit">Sync now</button>
</form>

<div class="footer">
  <strong>What this does:</strong><br>
  Queries every Sundry-Debtor ledger from Tally, parses balances, and uploads the customer outstanding to your ERP at <a href="{app_url_safe}" target="_blank">{cfg.app_url}</a>.<br><br>
  Phase 5 chunk 1 — outstanding only. Receipts and stock will come in chunk 2.<br>
  Logs: <code>agent.log</code> in this folder.
</div>

</body></html>
"""
        self._send(200, html)


# ---------------------------------------------------------------------------
# main()
# ---------------------------------------------------------------------------

def main():
    config_path = Path(__file__).parent / "config.ini"
    cfg = Config(config_path)

    AgentHandler.cfg = cfg
    server = HTTPServer(("127.0.0.1", cfg.local_port), AgentHandler)
    log.info("Agent ready on http://localhost:%d", cfg.local_port)
    log.info("Open that URL in a browser on this machine to trigger a sync.")
    log.info("Press Ctrl+C to stop the agent.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info("Shutting down.")
        server.shutdown()


if __name__ == "__main__":
    main()
