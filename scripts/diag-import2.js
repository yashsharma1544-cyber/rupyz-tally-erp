require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

// Same setup as the import script. Simulate 100 dedup lookups in a row,
// using DB-confirmed Dec IDs that the import script reports as "not in DB".
const ids = [
  '20251231-38863','20251231-38696','20251223-05372','20251223-05225',
  '20251223-99982','20251223-05764','20251223-04043',
];

(async () => {
  let found = 0, missing = 0, errored = 0;
  for (let i = 0; i < 100; i++) {
    const id = ids[i % ids.length];
    const { data, error } = await supabase
      .from('orders').select('id').eq('rupyz_order_id', id).maybeSingle();
    if (error) { errored++; console.log(`#${i} ERROR for ${id}:`, error.message, error.code || '', error.status || ''); }
    else if (data) found++;
    else missing++;
  }
  console.log('\n=== summary ===');
  console.log('found:', found, 'missing:', missing, 'errored:', errored);
})();
