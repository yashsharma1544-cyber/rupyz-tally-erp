// Manual types matching the Supabase schema. Generate with `supabase gen types` later if you want to auto-sync.

export type UserRole = "admin" | "approver" | "accounts" | "dispatch" | "delivery" | "salesman";

export interface Salesman {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Beat {
  id: string;
  rupyz_code: string | null;
  name: string;
  city: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  name: string;
  active: boolean;
  created_at: string;
}

export interface Brand {
  id: string;
  name: string;
  active: boolean;
  created_at: string;
}

export interface Product {
  id: string;
  rupyz_code: string | null;
  name: string;
  category_id: string | null;
  brand_id: string | null;
  mrp: number;
  base_price: number;
  unit: string;
  measurement_type: string | null;
  unit_of_measurement: string | null;
  gst_percent: number;
  hsn_code: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
  // Joined fields when fetched with relations
  category?: Pick<Category, "id" | "name"> | null;
  brand?: Pick<Brand, "id" | "name"> | null;
}

export interface Customer {
  id: string;
  rupyz_code: string | null;
  name: string;
  customer_level: string | null;
  customer_type: string | null;
  mobile: string | null;
  salesman_id: string | null;
  gstin: string | null;
  address: string | null;
  city: string | null;
  pincode: string | null;
  beat_id: string | null;
  map_address: string | null;
  latitude: number | null;
  longitude: number | null;
  active: boolean;
  created_at: string;
  updated_at: string;
  beat?: Pick<Beat, "id" | "name"> | null;
  salesman?: Pick<Salesman, "id" | "name"> | null;
}

export interface AppUser {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: UserRole;
  salesman_id: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export type OrderAppStatus =
  | "received"
  | "approved"
  | "partially_dispatched"
  | "dispatched"
  | "delivered"
  | "rejected"
  | "cancelled"
  | "closed";

export interface Order {
  id: string;
  rupyz_id: number;
  rupyz_order_id: string;
  customer_id: string | null;
  rupyz_customer_id: number | null;
  salesman_id: string | null;
  rupyz_created_by_id: number | null;
  rupyz_created_by_name: string | null;
  amount: number;
  gst_amount: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  discount_amount: number;
  delivery_charges: number;
  round_off_amount: number;
  total_amount: number;
  rupyz_delivery_status: string | null;
  rupyz_tally_status: string | null;
  app_status: OrderAppStatus;
  payment_option_check: string | null;
  remaining_payment_days: number | null;
  payment_status: string | null;
  is_paid: boolean;
  delivery_name: string | null;
  delivery_mobile: string | null;
  delivery_address_line: string | null;
  delivery_city: string | null;
  delivery_state: string | null;
  delivery_pincode: string | null;
  is_rejected: boolean;
  reject_reason: string | null;
  is_closed: boolean;
  is_archived: boolean;
  is_telephonic: boolean;
  source: string | null;
  purchase_order_url: string | null;
  comment: string | null;
  geo_location: string | null;
  rupyz_created_at: string;
  rupyz_updated_at: string;
  expected_delivery_date: string | null;
  first_seen_at: string;
  last_synced_at: string;
  approved_at: string | null;
  approved_by: string | null;
  rejected_at: string | null;
  rejected_by: string | null;
  reject_reason: string | null;
  is_edited: boolean;
  edited_at: string | null;
  edited_by: string | null;
  cgst_amount: number;
  sgst_amount: number;
  round_off_amount: number;
  remaining_payment_days: number | null;
  payment_option_check: string | null;
  delivery_address_line: string | null;
  delivery_pincode: string | null;
  delivery_state: string | null;
  rupyz_delivery_status: string;
  rupyz_created_by_name: string | null;
  delivery_mobile: string | null;
  created_at: string;
  updated_at: string;
  // Joined
  customer?: Pick<Customer, "id" | "name" | "customer_type" | "city" | "mobile"> | null;
  salesman?: Pick<Salesman, "id" | "name"> | null;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string | null;
  rupyz_product_id: number;
  product_name: string;
  product_code: string | null;
  hsn_code: string | null;
  brand: string | null;
  category: string | null;
  unit: string | null;
  qty: number;
  price: number;
  mrp: number | null;
  original_price: number | null;
  gst_percent: number | null;
  gst_amount: number | null;
  total_gst_amount: number | null;
  total_price: number | null;
  total_price_without_gst: number | null;
  discount_value: number;
  packaging_size: number | null;
  packaging_unit: string | null;
  measurement_type: string | null;
  dispatch_qty: number;
  total_dispatched_qty: number;
}

export interface RupyzSyncLog {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: "running" | "success" | "partial" | "failed";
  trigger: string | null;
  pages_fetched: number;
  orders_inserted: number;
  orders_updated: number;
  orders_skipped: number;
  customers_stubbed: number;
  products_stubbed: number;
  token_refreshed: boolean;
  error_message: string | null;
}

export type DispatchStatus = "pending" | "shipped" | "delivered" | "cancelled";

export interface Dispatch {
  id: string;
  order_id: string;
  dispatch_number: string;
  status: DispatchStatus;
  vehicle_number: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  notes: string | null;
  total_qty: number | null;
  total_amount: number | null;
  created_by: string | null;
  created_at: string;
  shipped_at: string | null;
  shipped_by: string | null;
  delivered_at: string | null;
  delivered_by: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  // Joined
  order?: Pick<Order, "id" | "rupyz_order_id" | "customer_id" | "delivery_city" | "delivery_address_line" | "delivery_pincode"> & {
    customer?: Pick<Customer, "id" | "name" | "city" | "mobile"> | null;
  } | null;
  pod?: PointOfDelivery | null;
  items?: DispatchItem[];
}

export interface DispatchItem {
  id: string;
  dispatch_id: string;
  order_item_id: string;
  qty: number;
  price: number;
  total_amount: number;
  // Joined
  order_item?: OrderItem | null;
}

export interface PointOfDelivery {
  id: string;
  dispatch_id: string;
  photo_url: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracy_m: number | null;
  receiver_name: string | null;
  notes: string | null;
  captured_at: string;
  captured_by: string | null;
}

export type OrderAuditEventType =
  | "approved" | "rejected" | "edited"
  | "dispatch_created" | "dispatch_shipped" | "dispatch_delivered" | "dispatch_cancelled"
  | "order_cancelled" | "order_closed";

export interface OrderAuditEvent {
  id: string;
  order_id: string;
  event_type: OrderAuditEventType;
  actor_id: string | null;
  actor_name: string | null;
  comment: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

export interface OrderRevision {
  id: string;
  order_id: string;
  revision_number: number;
  snapshot: {
    order: Partial<Order>;
    items: Partial<OrderItem>[];
  };
  edited_by: string | null;
  edited_by_name: string | null;
  edited_at: string;
  change_summary: string | null;
}
