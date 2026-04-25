// Rupyz API client — typed wrapper around the four endpoints we use.
// Runs in Deno (Supabase Edge Functions), so uses native fetch.

const BASE = "https://newest.rupyz.com";

export interface RupyzCredentials {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface RupyzLoggedInResponse {
  data: {
    user_id: string;
    credentials: RupyzCredentials;
    org_ids: { id: number; legal_name: string }[];
    username: string;
  };
  message: string;
  error: boolean;
}

export interface RupyzOrderListItem {
  id: number;
  order_id: string;
  customer_id: number;
  customer_name: string;
  customer_level: string;
  created_by_id: number;
  created_by_name: string;
  total_amount: number;
  delivery_status: string;
  tally_status: string;
  payment_option_check: string;
  is_closed: boolean;
  source: string;
  created_at: string;
  updated_at: string;
}

export interface RupyzOrderItem {
  id: number;
  name: string;
  code: string;
  hsn_code: string;
  brand: string;
  brand_id: number;
  category: string;
  category_id: number;
  unit: string;
  qty: number;
  price: number;
  mrp_price: number;
  original_price: number;
  gst: number;
  gst_amount: number;
  total_gst_amount: number;
  total_price: number;
  total_price_without_gst: number;
  discount_value: number;
  packaging_size: number;
  packaging_unit: string;
  measurement_type: string;
  dispatch_qty: number;
  total_dispatched_qty: number;
}

export interface RupyzOrderDetail {
  id: number;
  order_id: string;
  customer_id: number;
  customer: { id: number; name: string; mobile: string; gstin: string; customer_type: string; customer_level: string };
  created_by: { id: number; first_name: string; last_name: string; email: string };
  address: {
    name: string; mobile: string; address_line_1: string;
    city: string; state: string; pincode: string;
  };
  items: RupyzOrderItem[];
  amount: number;
  gst_amount: number;
  taxes_info: { cgst_amount: number; sgst_amount: number; igst_amount: number };
  total_amount: number;
  discount_amount: number;
  delivery_charges: number;
  round_off_amount: number;
  delivery_status: string;
  tally_status: string;
  payment_status: string;
  is_paid: boolean;
  is_rejected: boolean;
  reject_reason: string | null;
  is_closed: boolean;
  is_archived: boolean;
  is_telephonic: boolean;
  payment_option_check: string;
  remaining_payment_days: number;
  source: string;
  comment: string | null;
  geo_location: string;
  purchase_order_url: string;
  created_at: string;
  updated_at: string;
  expected_delivery_date: string | null;
}

interface FetchOpts {
  accessToken: string;
}

class RupyzAuthError extends Error {
  constructor(message: string) { super(message); this.name = "RupyzAuthError"; }
}

async function rupyzFetch(path: string, opts: FetchOpts & RequestInit = { accessToken: "" }) {
  const { accessToken, ...init } = opts;
  const headers: Record<string, string> = {
    "accept": "application/json",
    "content-type": "application/json",
    "os": "WEB",
    "source": "WEB",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (accessToken) headers["authorization"] = `Bearer ${accessToken}`;

  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (res.status === 401 || res.status === 403) {
    throw new RupyzAuthError(`Rupyz auth failed (${res.status}) on ${path}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Rupyz ${res.status} ${path}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

// ---- Endpoint wrappers -----------------------------------------------------

export async function refreshAccessToken(refreshToken: string): Promise<RupyzCredentials> {
  // Try the standard OAuth2-style refresh first.
  // If Rupyz uses a different path, this throws and the caller falls back to re-OTP.
  const res = await fetch(`${BASE}/v1/user/refresh_token/`, {
    method: "POST",
    headers: { "content-type": "application/json", "os": "WEB", "source": "WEB" },
    body: JSON.stringify({ refresh_token: refreshToken, grant_type: "refresh_token" }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Refresh failed ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  // Rupyz wraps response in { data: { credentials: {...} } } based on observed patterns
  const creds = json?.data?.credentials ?? json?.credentials ?? json;
  if (!creds.access_token) {
    throw new Error(`Refresh response had no access_token: ${JSON.stringify(json).slice(0, 200)}`);
  }
  return creds as RupyzCredentials;
}

export async function fetchOrderList(
  orgId: number,
  page: number,
  accessToken: string,
): Promise<{ data: RupyzOrderListItem[] }> {
  return await rupyzFetch(`/v2/organization/${orgId}/order/?page_no=${page}&user_id=`, {
    accessToken,
  });
}

export async function fetchOrderDetail(
  orgId: number,
  rupyzOrderId: number,
  accessToken: string,
): Promise<{ data: RupyzOrderDetail }> {
  return await rupyzFetch(`/v2/organization/${orgId}/order/${rupyzOrderId}/`, { accessToken });
}

export { RupyzAuthError };
