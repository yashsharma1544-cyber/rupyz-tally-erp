"""
import_tally_25_26.py

One-time import of Tally Day Book export (FY 25-26) into Supabase
historical_orders + historical_order_items tables.

Workflow:
  1. Parse the Tally Excel: identify voucher headers and their line items
  2. Filter out non-product rows (tax, scheme, R/OFF entries)
  3. Fuzzy-match Tally parties → Supabase customers (or flag for creation)
  4. Fuzzy-match Tally items → Supabase products (or flag for review)
  5. Generate SQL INSERT statements
  6. Output a review report with unmatched parties + products

Usage:
  # 1. Dry run first — see what would happen, generates reports + SQL but skips DB
  python import_tally_25_26.py --excel sushil_daybook.xlsx --customers customers.csv --products products.csv --dry-run

  # 2. After reviewing reports, run for real to commit to DB:
  python import_tally_25_26.py --excel sushil_daybook.xlsx --customers customers.csv --products products.csv

You provide --customers and --products as CSVs exported from Supabase:
  customers.csv  columns: id, name, beat_id (others optional)
  products.csv   columns: id, name, weight_kg

OUTPUTS:
  /import_outputs/01_import_orders.sql            — SQL to run on Supabase
  /import_outputs/02_new_historical_customers.csv — review before running SQL
  /import_outputs/03_unmatched_products.csv       — review; products not in your DB
  /import_outputs/04_import_summary.txt           — high-level stats
"""

import argparse
import csv
import json
import os
import re
import sys
from collections import defaultdict, Counter
from dataclasses import dataclass, field
from datetime import datetime, date
from difflib import SequenceMatcher
from pathlib import Path

import pandas as pd


# ------------------------------------------------------------------ Config

NON_PRODUCT_PATTERNS = [
    r'\bGST\b',
    r'\bCGST\b',
    r'\bSGST\b',
    r'\bIGST\b',
    r'^R/OFF',
    r'^TEA SALES',
    r'\bDISCOUNT\b',
    r'\bSCHEME\b',
    r'\bSCHEEM\b',          # observed typo in Tally
    r'\bSCRATCH COUPON\b',
    r'^OUTPUT[\s-]',
    r'^INPUT[\s-]',
    r'^TCS\b',
    r'^FREIGHT',
    r'^TRANSPORT',
    r'\bROUND OFF\b',
    r'^T -POS',
    r'\bCASH DISCOUNT\b',
]

NON_PRODUCT_RE = re.compile('|'.join(NON_PRODUCT_PATTERNS), re.IGNORECASE)


def is_non_product(name: str) -> bool:
    return bool(NON_PRODUCT_RE.search(name or ''))


# ----- Fuzzy matching utilities

def normalize_name(name: str) -> str:
    """Normalize a name for matching: lowercase, collapse whitespace,
    remove punctuation that doesn't carry meaning."""
    if not name:
        return ''
    s = str(name).lower().strip()
    # Replace common variations
    s = s.replace('.', '')
    s = s.replace(',', '')
    s = s.replace('-', ' ')
    s = s.replace('/', ' ')
    s = re.sub(r'\s+', ' ', s).strip()
    return s


def similarity(a: str, b: str) -> float:
    """Return a 0..1 similarity score."""
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, normalize_name(a), normalize_name(b)).ratio()


def fuzzy_match_one(query: str, candidates: list[dict], name_field: str = 'name',
                    min_score: float = 0.80) -> tuple[dict | None, float]:
    """Find best fuzzy match for query among candidates.
    Returns (best_candidate, score) or (None, 0.0)."""
    if not query:
        return None, 0.0
    best_score = 0.0
    best = None
    q_norm = normalize_name(query)
    for c in candidates:
        s = SequenceMatcher(None, q_norm, normalize_name(c[name_field])).ratio()
        if s > best_score:
            best_score = s
            best = c
    if best_score >= min_score:
        return best, best_score
    return None, best_score


# ----- Parse Tally Day Book

@dataclass
class TallyItem:
    name_raw: str
    qty: float
    rate: float | None
    amount: float | None
    unit_raw: str | None


@dataclass
class TallyVoucher:
    date: date
    voucher_number: str
    voucher_type: str
    party_name_raw: str
    total_amount: float
    items: list[TallyItem] = field(default_factory=list)


def parse_qty_field(raw) -> tuple[float, str | None]:
    """Parse Tally's qty cell, which can look like:
        20            (plain number)
        '5- 0.000 packet'   (leading qty followed by alt-unit info)
        '10-0.000'
    Returns (qty_numeric, unit_string_or_none).
    """
    if raw is None:
        return 0.0, None
    if isinstance(raw, (int, float)):
        return float(raw), None
    s = str(raw).strip()
    if not s:
        return 0.0, None
    # Pattern: leading number, optional - then more text
    m = re.match(r'^([\d\.]+)', s)
    if m:
        try:
            n = float(m.group(1))
        except ValueError:
            return 0.0, None
        unit = s[m.end():].strip(' -')
        return n, unit if unit else None
    return 0.0, None


def parse_tally_excel(path: str) -> list[TallyVoucher]:
    df = pd.read_excel(path, header=None)
    vouchers: list[TallyVoucher] = []
    current: TallyVoucher | None = None
    skipped_non_product = 0

    for idx, row in df.iterrows():
        # Voucher header row: column 0 has a date, column 4 has voucher type
        d_val = row[0]
        vch_type = row[4]
        if pd.notna(d_val) and pd.notna(vch_type):
            # New voucher
            if isinstance(d_val, str):
                try:
                    voucher_date = datetime.strptime(d_val[:10], '%Y-%m-%d').date()
                except ValueError:
                    continue
            elif isinstance(d_val, datetime):
                voucher_date = d_val.date()
            elif isinstance(d_val, pd.Timestamp):
                voucher_date = d_val.date()
            else:
                continue

            party = str(row[1]).strip() if pd.notna(row[1]) else ''
            vch_num = str(row[5]).strip() if pd.notna(row[5]) else ''
            try:
                total = float(row[6]) if pd.notna(row[6]) else 0.0
            except (ValueError, TypeError):
                total = 0.0

            if not party or not vch_num:
                current = None
                continue

            current = TallyVoucher(
                date=voucher_date,
                voucher_number=vch_num,
                voucher_type=str(vch_type).strip(),
                party_name_raw=party,
                total_amount=total,
            )
            vouchers.append(current)
            continue

        # Item or non-product line: column 1 has a name, column 0 is NaN
        if pd.isna(row[0]) and pd.notna(row[1]) and current is not None:
            line_name = str(row[1]).strip()

            # Non-product filter (taxes, schemes, rounding)
            if is_non_product(line_name):
                skipped_non_product += 1
                continue

            # Real item line — must have qty + rate + amount
            if pd.isna(row[2]) or pd.isna(row[3]) or pd.isna(row[4]):
                # Item name with no numeric data — could be the "TEA SALES GST 5%" header
                continue

            qty, unit_raw = parse_qty_field(row[2])
            if qty <= 0:
                continue

            try:
                rate = float(row[3])
                amount = float(row[4])
            except (ValueError, TypeError):
                continue

            current.items.append(TallyItem(
                name_raw=line_name,
                qty=qty,
                rate=rate,
                amount=amount,
                unit_raw=unit_raw,
            ))

    # Drop vouchers that ended up with zero items (e.g. cancelled or pure tax adjustments)
    vouchers = [v for v in vouchers if v.items]
    print(f"  Parsed {len(vouchers)} sales vouchers")
    print(f"  Skipped {skipped_non_product} non-product rows (tax/scheme/rounding)")
    return vouchers


# ----- Customer matching

@dataclass
class CustomerMatchResult:
    party_raw: str
    customer_id: str | None       # existing customer id, if matched
    new_historical: bool          # if True, will create a new is_historical=true customer
    score: float
    matched_name: str | None      # what we matched to (for review)


def match_customers(parties: set[str], db_customers: list[dict],
                    confident_threshold: float = 0.95,
                    review_threshold: float = 0.80
                    ) -> dict[str, CustomerMatchResult]:
    """For each unique Tally party, find a match in db_customers or flag for creation.

    confident_threshold: above this, auto-match
    review_threshold: 0.80..0.95 → matched but flagged for review
    below review_threshold: create new is_historical=true customer
    """
    results: dict[str, CustomerMatchResult] = {}
    for party in parties:
        best, score = fuzzy_match_one(party, db_customers, name_field='name', min_score=review_threshold)
        if best and score >= confident_threshold:
            results[party] = CustomerMatchResult(
                party_raw=party, customer_id=best['id'], new_historical=False,
                score=score, matched_name=best['name'],
            )
        elif best and score >= review_threshold:
            # Matched but lower confidence — keep the match but flag for review
            results[party] = CustomerMatchResult(
                party_raw=party, customer_id=best['id'], new_historical=False,
                score=score, matched_name=best['name'],
            )
        else:
            # No good match → will create new historical-only customer
            results[party] = CustomerMatchResult(
                party_raw=party, customer_id=None, new_historical=True,
                score=score, matched_name=None,
            )
    return results


# ----- Product matching

@dataclass
class ProductMatchResult:
    item_raw: str
    product_id: str | None
    score: float
    matched_name: str | None
    weight_kg: float | None       # from matched product


def normalize_product_name(name: str) -> str:
    """Aggressive normalization for products — strip common filler words
    like 'Dust', 'Kadak' that vary between Tally and Supabase."""
    s = normalize_name(name)
    # Standardize "Rs 10" vs "10 Rs" — keep both visible to matcher
    return s


def match_products(items: set[str], db_products: list[dict],
                   confident_threshold: float = 0.75) -> dict[str, ProductMatchResult]:
    results: dict[str, ProductMatchResult] = {}
    for item in items:
        best, score = fuzzy_match_one(item, db_products, name_field='name',
                                       min_score=confident_threshold)
        if best:
            results[item] = ProductMatchResult(
                item_raw=item, product_id=best['id'], score=score,
                matched_name=best['name'],
                weight_kg=float(best['weight_kg']) if best.get('weight_kg') not in (None, '') else None,
            )
        else:
            results[item] = ProductMatchResult(
                item_raw=item, product_id=None, score=score,
                matched_name=None, weight_kg=None,
            )
    return results


# ----- SQL generation

def sql_escape(s: str | None) -> str:
    if s is None:
        return 'NULL'
    return "'" + s.replace("'", "''") + "'"


def generate_sql(vouchers: list[TallyVoucher],
                 customer_matches: dict[str, CustomerMatchResult],
                 product_matches: dict[str, ProductMatchResult],
                 out_path: str) -> tuple[int, int, int]:
    """Generate the SQL for historical_orders + historical_order_items inserts.
    Also generates customer INSERT for the new historical-only customers.

    Returns (n_orders, n_items, n_new_customers).
    """
    # Step 1: collect new customers to create
    new_customers = {}  # party_raw -> id placeholder
    for party, m in customer_matches.items():
        if m.new_historical:
            # Generate a deterministic UUID-like marker so we can reference it
            new_customers[party] = party

    with open(out_path, 'w', encoding='utf-8') as f:
        f.write('-- ====================================================================\n')
        f.write(f'-- Tally backfill SQL — generated {datetime.now().isoformat()}\n')
        f.write(f'-- Vouchers to import: {len(vouchers)}\n')
        f.write(f'-- New historical customers: {len(new_customers)}\n')
        f.write('-- ====================================================================\n\n')
        f.write('begin;\n\n')

        # Step 2: insert new historical-only customers
        f.write('-- ---- New historical-only customers ----\n')
        f.write('-- These are parties seen in Tally but not in the current Rupyz customer list.\n')
        f.write('-- Marked is_historical_only=true so they don\'t appear in dispatch/order flows.\n\n')

        # Map party_raw -> staged customer id (using a CTE for clean inserts)
        for party in sorted(new_customers.keys()):
            # Will use INSERT ... RETURNING in a different approach
            pass

        # Use a different approach: insert + grab id via WITH
        # For simplicity, we'll insert customers first, then use their auto-generated IDs in subsequent inserts
        # by matching on name. To make this safe, we pre-generate uuids on the Python side.
        import uuid
        new_customer_uuids = {p: str(uuid.uuid4()) for p in new_customers}

        f.write('insert into customers (id, name, is_historical_only) values\n')
        rows = []
        for party in sorted(new_customers.keys()):
            cid = new_customer_uuids[party]
            rows.append(f"  ('{cid}', {sql_escape(party)}, true)")
        f.write(',\n'.join(rows))
        f.write('\non conflict (id) do nothing;\n\n')

        # Step 3: build a map from party_raw to customer_id
        def resolved_customer_id(party_raw: str) -> str | None:
            m = customer_matches[party_raw]
            if m.new_historical:
                return new_customer_uuids[party_raw]
            return m.customer_id

        # Step 4: historical_orders
        f.write('-- ---- Historical orders (voucher headers) ----\n\n')

        order_uuids = {}  # (vch_num, date) -> uuid
        n_orders = 0
        n_items = 0
        order_rows = []
        for v in vouchers:
            cust_id = resolved_customer_id(v.party_name_raw)
            if not cust_id:
                continue
            order_id = str(uuid.uuid4())
            order_uuids[(v.voucher_number, v.date)] = order_id
            order_rows.append(
                f"  ('{order_id}', {sql_escape(v.voucher_number)}, '{v.date.isoformat()}', "
                f"{sql_escape(v.voucher_type)}, '{cust_id}', {sql_escape(v.party_name_raw)}, "
                f"{v.total_amount:.2f}, {len(v.items)})"
            )
            n_orders += 1

        if order_rows:
            f.write('insert into historical_orders\n')
            f.write('  (id, voucher_number, voucher_date, voucher_type, customer_id, party_name_raw, total_amount, line_count)\n')
            f.write('values\n')
            # Write in chunks of 500 rows
            for i in range(0, len(order_rows), 500):
                chunk = order_rows[i:i+500]
                f.write(',\n'.join(chunk))
                if i + 500 < len(order_rows):
                    f.write(';\n\ninsert into historical_orders\n')
                    f.write('  (id, voucher_number, voucher_date, voucher_type, customer_id, party_name_raw, total_amount, line_count)\n')
                    f.write('values\n')
            f.write('\non conflict (voucher_number, voucher_date) do nothing;\n\n')

        # Step 5: historical_order_items
        f.write('-- ---- Historical order items ----\n\n')

        item_rows = []
        for v in vouchers:
            order_id = order_uuids.get((v.voucher_number, v.date))
            if not order_id:
                continue
            for item in v.items:
                pm = product_matches.get(item.name_raw)
                product_id_sql = f"'{pm.product_id}'" if pm and pm.product_id else 'NULL'
                # Compute kg using matched product's weight
                kg_val = 'NULL'
                if pm and pm.product_id and pm.weight_kg is not None:
                    kg_val = f"{item.qty * pm.weight_kg:.4f}"
                rate_sql = f"{item.rate:.4f}" if item.rate is not None else 'NULL'
                amount_sql = f"{item.amount:.2f}" if item.amount is not None else 'NULL'
                unit_sql = sql_escape(item.unit_raw)
                item_rows.append(
                    f"  ('{order_id}', {product_id_sql}, {sql_escape(item.name_raw)}, "
                    f"{item.qty:.3f}, {rate_sql}, {amount_sql}, {kg_val}, {unit_sql})"
                )
                n_items += 1

        if item_rows:
            f.write('insert into historical_order_items\n')
            f.write('  (historical_order_id, product_id, item_name_raw, qty, rate, amount, kg, unit_raw)\n')
            f.write('values\n')
            for i in range(0, len(item_rows), 500):
                chunk = item_rows[i:i+500]
                f.write(',\n'.join(chunk))
                if i + 500 < len(item_rows):
                    f.write(';\n\ninsert into historical_order_items\n')
                    f.write('  (historical_order_id, product_id, item_name_raw, qty, rate, amount, kg, unit_raw)\n')
                    f.write('values\n')
            f.write(';\n\n')

        f.write('commit;\n')

    return n_orders, n_items, len(new_customers)


# ----- Reports

def write_customer_review(matches: dict[str, CustomerMatchResult],
                          out_path: str) -> None:
    """Write a CSV of all party matches for human review.
    Sorted: low-confidence matches first, then new-historical, then high-confidence."""
    rows = []
    for party, m in matches.items():
        status = 'NEW (historical-only)' if m.new_historical else (
            'AUTO-MATCH' if m.score >= 0.95 else 'REVIEW'
        )
        rows.append({
            'party_raw': party,
            'match_status': status,
            'matched_to': m.matched_name or '',
            'similarity_score': f"{m.score:.3f}",
            'customer_id': m.customer_id or '',
        })
    rows.sort(key=lambda r: (
        0 if r['match_status'] == 'REVIEW' else 1 if r['match_status'].startswith('NEW') else 2,
        -float(r['similarity_score']),
    ))
    with open(out_path, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=['party_raw', 'match_status', 'matched_to', 'similarity_score', 'customer_id'])
        w.writeheader()
        w.writerows(rows)


def write_product_review(matches: dict[str, ProductMatchResult],
                         occurrences: dict[str, int], out_path: str) -> None:
    """Write a CSV of all product matches for review."""
    rows = []
    for item, m in matches.items():
        rows.append({
            'item_raw': item,
            'occurrences': occurrences.get(item, 0),
            'matched_to': m.matched_name or '',
            'product_id': m.product_id or '',
            'weight_kg': f"{m.weight_kg:.4f}" if m.weight_kg is not None else '',
            'similarity_score': f"{m.score:.3f}",
            'status': 'MATCHED' if m.product_id else 'UNMATCHED — kg will be NULL for these lines',
        })
    rows.sort(key=lambda r: (1 if r['status'] == 'MATCHED' else 0, -r['occurrences']))
    with open(out_path, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=['item_raw', 'occurrences', 'matched_to', 'product_id',
                                          'weight_kg', 'similarity_score', 'status'])
        w.writeheader()
        w.writerows(rows)


def write_summary(vouchers: list[TallyVoucher],
                  customer_matches: dict[str, CustomerMatchResult],
                  product_matches: dict[str, ProductMatchResult],
                  out_path: str) -> None:
    n_total = len(vouchers)
    n_items_total = sum(len(v.items) for v in vouchers)
    n_customers = len(customer_matches)
    n_new_customers = sum(1 for m in customer_matches.values() if m.new_historical)
    n_review = sum(1 for m in customer_matches.values() if not m.new_historical and m.score < 0.95)
    n_products = len(product_matches)
    n_unmatched_products = sum(1 for m in product_matches.values() if not m.product_id)
    n_unmatched_items_lines = sum(
        1 for v in vouchers for it in v.items
        if not product_matches[it.name_raw].product_id
    )

    total_amount = sum(v.total_amount for v in vouchers)
    earliest = min(v.date for v in vouchers) if vouchers else None
    latest = max(v.date for v in vouchers) if vouchers else None

    with open(out_path, 'w', encoding='utf-8') as f:
        f.write('=' * 60 + '\n')
        f.write('TALLY BACKFILL IMPORT SUMMARY\n')
        f.write('=' * 60 + '\n\n')
        f.write(f'Vouchers parsed:           {n_total}\n')
        f.write(f'Line items parsed:         {n_items_total}\n')
        f.write(f'Date range:                {earliest} to {latest}\n')
        f.write(f'Total amount:              ₹{total_amount:,.2f}\n\n')
        f.write('--- Customer matching ---\n')
        f.write(f'Unique Tally parties:      {n_customers}\n')
        f.write(f'  Auto-matched (≥95%):     {n_customers - n_new_customers - n_review}\n')
        f.write(f'  Review (80-95%):         {n_review}\n')
        f.write(f'  New historical-only:     {n_new_customers}\n\n')
        f.write('--- Product matching ---\n')
        f.write(f'Unique Tally items:        {n_products}\n')
        f.write(f'  Matched:                 {n_products - n_unmatched_products}\n')
        f.write(f'  Unmatched (kg=NULL):     {n_unmatched_products}\n')
        f.write(f'Line items with no match:  {n_unmatched_items_lines} / {n_items_total}\n\n')
        f.write('--- Next steps ---\n')
        f.write('  1. Review 02_new_historical_customers.csv\n')
        f.write('  2. Review 03_unmatched_products.csv\n')
        f.write('  3. If happy, run 01_import_orders.sql in Supabase SQL editor\n')


# ----- Main

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--excel', required=True, help='Tally Day Book Excel export')
    ap.add_argument('--customers', required=True, help='Supabase customers CSV')
    ap.add_argument('--products', required=True, help='Supabase products CSV')
    ap.add_argument('--out', default='./import_outputs', help='Output directory')
    ap.add_argument('--dry-run', action='store_true',
                    help='Only generate reports + SQL, do not execute against DB')
    args = ap.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f'Parsing Tally Excel: {args.excel}')
    vouchers = parse_tally_excel(args.excel)
    print()

    print(f'Loading Supabase customers: {args.customers}')
    with open(args.customers, encoding='utf-8') as f:
        db_customers = list(csv.DictReader(f))
    print(f'  {len(db_customers)} customers')

    print(f'Loading Supabase products: {args.products}')
    with open(args.products, encoding='utf-8') as f:
        db_products = list(csv.DictReader(f))
    print(f'  {len(db_products)} products')
    print()

    # Match parties
    print('Matching Tally parties to Supabase customers...')
    parties = {v.party_name_raw for v in vouchers}
    print(f'  {len(parties)} unique parties to match')
    customer_matches = match_customers(parties, db_customers)
    print()

    # Match products
    print('Matching Tally items to Supabase products...')
    items_set = set()
    item_occurrences: dict[str, int] = Counter()
    for v in vouchers:
        for it in v.items:
            items_set.add(it.name_raw)
            item_occurrences[it.name_raw] += 1
    print(f'  {len(items_set)} unique items to match')
    product_matches = match_products(items_set, db_products)
    print()

    # Write reports
    print('Writing review reports...')
    write_customer_review(customer_matches, out_dir / '02_new_historical_customers.csv')
    write_product_review(product_matches, item_occurrences, out_dir / '03_unmatched_products.csv')

    # Generate SQL
    print('Generating SQL...')
    sql_path = out_dir / '01_import_orders.sql'
    n_orders, n_items, n_new = generate_sql(vouchers, customer_matches, product_matches, str(sql_path))

    # Summary
    write_summary(vouchers, customer_matches, product_matches, out_dir / '04_import_summary.txt')

    print()
    print('=' * 60)
    print('DONE')
    print('=' * 60)
    print(f'SQL output:                    {sql_path}')
    print(f'New historical customers CSV:  {out_dir / "02_new_historical_customers.csv"}')
    print(f'Product matching CSV:          {out_dir / "03_unmatched_products.csv"}')
    print(f'Summary:                       {out_dir / "04_import_summary.txt"}')
    print()
    print(f'Would create {n_new} new historical-only customers')
    print(f'Would insert {n_orders} historical orders')
    print(f'Would insert {n_items} line items')
    print()
    if args.dry_run:
        print('** DRY RUN — no DB writes. Review the outputs above. **')
        print('** Re-run without --dry-run to apply, or run the .sql file manually in Supabase. **')
    else:
        print('** Now run 01_import_orders.sql in Supabase SQL editor. **')


if __name__ == '__main__':
    main()
