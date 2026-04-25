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
