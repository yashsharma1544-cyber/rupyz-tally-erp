"""
probe_tally.py — Run this on the Tally machine BEFORE the backfill.

What it does:
  1. Asks Tally to list all voucher types defined in the company
  2. Counts how many vouchers of each type exist between 1-Apr-2024 and today
  3. Pulls one sample voucher of the most likely "sales" types and prints
     a JSON-friendly preview so we can verify the structure

This lets us confirm:
  - The voucher type name(s) used for sales (default "Sales", but Sushil may
    have a custom one like "Tax Invoice", "Sales-Mehkar", etc.)
  - That vouchers in 2024-2025 are actually retrievable
  - The fields we need (party, items, qty, amount, date) are populated

Usage:
    python probe_tally.py
        (uses defaults: localhost:9000, queries 1-Apr-2024 to today)

    python probe_tally.py --tally-host 192.168.1.50 --tally-port 9000 \\
        --from-date 20240101 --to-date 20251231

Output: prints a report to stdout, also writes probe_report.json next to
this script.
"""

import argparse
import json
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, date
from pathlib import Path

import requests


def fmt_date(d: date) -> str:
    """Tally wants YYYYMMDD."""
    return d.strftime("%Y%m%d")


def build_request(report_name: str, from_date: str, to_date: str,
                  voucher_type: str | None = None,
                  extra_static_vars: dict | None = None) -> str:
    """Build a Tally XML request envelope."""
    extra_vars = ""
    if voucher_type:
        extra_vars += f"<VOUCHERTYPENAME>{voucher_type}</VOUCHERTYPENAME>\n"
    if extra_static_vars:
        for k, v in extra_static_vars.items():
            extra_vars += f"<{k}>{v}</{k}>\n"

    return f"""<ENVELOPE>
<HEADER>
<VERSION>1</VERSION>
<TALLYREQUEST>Export</TALLYREQUEST>
<TYPE>Data</TYPE>
<ID>{report_name}</ID>
</HEADER>
<BODY>
<DESC>
<STATICVARIABLES>
<SVFROMDATE>{from_date}</SVFROMDATE>
<SVTODATE>{to_date}</SVTODATE>
<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
{extra_vars}
</STATICVARIABLES>
</DESC>
</BODY>
</ENVELOPE>"""


def post_to_tally(tally_url: str, xml_body: str, timeout: int = 120) -> str:
    """POST raw XML to Tally, return raw response text."""
    resp = requests.post(
        tally_url,
        data=xml_body.encode("utf-8"),
        headers={"Content-Type": "application/xml"},
        timeout=timeout,
    )
    resp.raise_for_status()
    return resp.text


def list_voucher_types(tally_url: str) -> list[str]:
    """Ask Tally for the list of voucher type names (parent = 'Sales' or
    user-defined types under it)."""
    body = """<ENVELOPE>
<HEADER>
<VERSION>1</VERSION>
<TALLYREQUEST>Export</TALLYREQUEST>
<TYPE>Collection</TYPE>
<ID>VoucherTypeList</ID>
</HEADER>
<BODY>
<DESC>
<TDL>
<TDLMESSAGE>
<COLLECTION NAME="VoucherTypeList" ISMODIFY="No">
<TYPE>VoucherType</TYPE>
<FETCH>Name, Parent</FETCH>
</COLLECTION>
</TDLMESSAGE>
</TDL>
</DESC>
</BODY>
</ENVELOPE>"""

    response = post_to_tally(tally_url, body)
    types = []
    try:
        root = ET.fromstring(response)
        for vt in root.findall(".//VOUCHERTYPE"):
            name = vt.get("NAME") or ""
            parent_el = vt.find("PARENT")
            parent = (parent_el.text or "") if parent_el is not None else ""
            types.append({"name": name.strip(), "parent": parent.strip()})
    except ET.ParseError as e:
        print(f"WARN: couldn't parse voucher-type list: {e}", file=sys.stderr)
        # Fall back to common candidates
        return [
            {"name": "Sales", "parent": "Sales"},
            {"name": "Tax Invoice", "parent": "Sales"},
            {"name": "Sales Bill", "parent": "Sales"},
        ]
    return types


def count_vouchers(tally_url: str, voucher_type: str,
                   from_date: str, to_date: str) -> tuple[int, str]:
    """Try to count vouchers of a given type. Returns (count, sample_xml_snippet)."""
    body = build_request(
        report_name="Day Book",
        from_date=from_date,
        to_date=to_date,
        extra_static_vars={"VoucherTypeName": voucher_type},
    )
    try:
        response = post_to_tally(tally_url, body, timeout=180)
    except requests.RequestException as e:
        return (-1, f"ERROR: {e}")

    # Count <VOUCHER> elements with VCHTYPE = our type
    try:
        root = ET.fromstring(response)
    except ET.ParseError as e:
        return (-1, f"PARSE ERROR: {e}")

    count = 0
    sample = ""
    for v in root.findall(".//VOUCHER"):
        vt = v.find("VOUCHERTYPENAME")
        vt_text = (vt.text or "").strip() if vt is not None else ""
        if vt_text.lower() == voucher_type.lower():
            count += 1
            if not sample:
                # Capture first matching voucher as XML string
                sample = ET.tostring(v, encoding="unicode")[:2000]
    return (count, sample)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tally-host", default="localhost")
    parser.add_argument("--tally-port", type=int, default=9000)
    parser.add_argument("--from-date", default=fmt_date(date(2024, 4, 1)))
    parser.add_argument("--to-date",   default=fmt_date(date.today()))
    args = parser.parse_args()

    tally_url = f"http://{args.tally_host}:{args.tally_port}"
    out_file = Path(__file__).resolve().parent / "probe_report.json"

    print(f"Probing Tally at {tally_url}")
    print(f"Date range: {args.from_date} to {args.to_date}")
    print()

    # Step 1: list all voucher types
    print("=" * 60)
    print("Step 1: Listing voucher types defined in Tally")
    print("=" * 60)
    types = list_voucher_types(tally_url)
    print(f"Found {len(types)} voucher types:")
    for t in types:
        print(f"  • {t['name']!r:40s}  parent={t['parent']!r}")
    print()

    # Step 2: find candidates that look like sales (parent = 'Sales' or
    # name contains 'sale' or 'tax invoice')
    candidates = []
    for t in types:
        name_lower = t["name"].lower()
        parent_lower = t["parent"].lower()
        if "sale" in name_lower or "invoice" in name_lower or parent_lower == "sales":
            candidates.append(t["name"])
    if not candidates:
        # No match — try the common defaults blindly
        candidates = ["Sales", "Tax Invoice", "Sales Bill"]
        print("(No types matched 'sales/invoice' — trying common defaults)")
    print(f"Sales-like candidates: {candidates}")
    print()

    # Step 3: count vouchers of each candidate
    print("=" * 60)
    print("Step 3: Counting vouchers per candidate type")
    print("=" * 60)
    results = []
    for vt_name in candidates:
        print(f"\nCounting {vt_name!r}...")
        count, sample = count_vouchers(tally_url, vt_name, args.from_date, args.to_date)
        if count < 0:
            print(f"  ERROR: {sample}")
        else:
            print(f"  Found {count} vouchers")
        results.append({
            "voucher_type": vt_name,
            "count": count,
            "sample_xml": sample if count > 0 else "",
        })

    # Step 4: write JSON report
    report = {
        "probed_at": datetime.now().isoformat(),
        "tally_url": tally_url,
        "from_date": args.from_date,
        "to_date": args.to_date,
        "all_voucher_types": types,
        "candidates": candidates,
        "counts": results,
    }
    out_file.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print()
    print("=" * 60)
    print(f"Saved report to {out_file}")
    print("=" * 60)
    print()
    print("NEXT STEP:")
    print("  Find the voucher type with the highest non-zero count above.")
    print("  That's likely your 'sales' voucher type.")
    print("  Tell Claude that name, and we'll configure the backfill agent.")


if __name__ == "__main__":
    main()
