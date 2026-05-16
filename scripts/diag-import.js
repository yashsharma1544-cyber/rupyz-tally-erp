require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

async function check(id) {
  const { data, error } = await supabase
    .from('orders')
    .select('id, rupyz_order_id, app_status, rupyz_created_at')
    .eq('rupyz_order_id', id)
    .maybeSingle();
  return { data, error };
}

(async () => {
  console.log('--- static known IDs ---');
  for (const id of ['20251231-38863', '20251231-38696', '20251223-05372']) {
    const r = await check(id);
    console.log(JSON.stringify(id), 'len=' + id.length, '->',
      r.data ? 'FOUND (' + r.data.app_status + ', ' + r.data.rupyz_created_at + ')' : 'NOT FOUND',
      r.error ? ' ERR: ' + r.error.message : '');
  }

  const csvDir = process.env.CSV_DIR || '.';
  const csvPath = path.join(csvDir, 'orders_2025_12.csv');
  const text = fs.readFileSync(csvPath, 'utf8');

  console.log('\n--- first 3 lines of', csvPath, '(JSON-stringified) ---');
  for (const line of text.split('\n').slice(0, 3)) console.log(JSON.stringify(line));

  console.log('\n--- first 2 data row ids as parsed ---');
  for (const line of text.split('\n').slice(1, 3)) {
    const firstId = line.split(',')[0];
    console.log('raw:', JSON.stringify(firstId), 'len:', firstId.length,
      'hex:', Buffer.from(firstId).toString('hex'));
    const r = await check(firstId);
    console.log('  -> lookup:', r.data ? 'FOUND' : 'NOT FOUND');
    if (firstId.trim() !== firstId) {
      const r2 = await check(firstId.trim());
      console.log('  -> after trim:', r2.data ? 'FOUND' : 'NOT FOUND');
    }
  }
})();
