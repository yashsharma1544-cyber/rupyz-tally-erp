"use server";

import { revalidatePath } from "next/cache";
import {
  setInvoiceNumber as setInvoiceNumberLib,
  clearInvoiceNumber as clearInvoiceNumberLib,
  type InvoiceActionResult,
} from "@/lib/orders/invoice";

export async function setInvoiceNumberAction(
  orderId: string,
  invoiceNumber: string,
): Promise<InvoiceActionResult> {
  const res = await setInvoiceNumberLib(orderId, invoiceNumber);
  if (res.ok) {
    revalidatePath("/billing");
    revalidatePath(`/orders/${orderId}`);
  }
  return res;
}

export async function clearInvoiceNumberAction(
  orderId: string,
): Promise<InvoiceActionResult> {
  const res = await clearInvoiceNumberLib(orderId);
  if (res.ok) {
    revalidatePath("/billing");
    revalidatePath(`/orders/${orderId}`);
  }
  return res;
}
