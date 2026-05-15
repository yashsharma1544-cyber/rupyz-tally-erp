// Translation dictionary for the Rupyz-Tally ERP.
//
// Structure: flat key → { en, mr } map.
// Naming convention: "namespace.key_in_snake_case"
//   - common.* — buttons, generic words used everywhere
//   - status.* — order status enum values
//   - loading.* — keys specific to the loading page
//   - dispatch.* — dispatch page
//   - driver.* — driver view
//   - van_trip.* — van trip pages
//   - picking.* — picking page
//
// Adding a new key:
//   1. Add the line below with both en and mr values
//   2. Use it in JSX: t("namespace.key_in_snake_case")
//
// If a key is missing from this dictionary, t() returns the key itself —
// so you'll notice immediately when something isn't translated.
//
// Marathi notes:
// - Devanagari script throughout
// - Numbers and units (kg, ₹) left as-is (universal in Indian business)
// - Customer/product/brand names not translated (they're DB values used as-is)
// - Common warehouse terms in Maharashtra wholesale context

export type Lang = "en" | "mr";

type Dict = Record<string, { en: string; mr: string }>;

export const dictionary: Dict = {
  // ========================================================================
  // COMMON — buttons, generic words, page chrome
  // ========================================================================
  "common.save": { en: "Save", mr: "जतन करा" },
  "common.cancel": { en: "Cancel", mr: "रद्द करा" },
  "common.confirm": { en: "Confirm", mr: "पुष्टी करा" },
  "common.delete": { en: "Delete", mr: "हटवा" },
  "common.edit": { en: "Edit", mr: "सुधारणा" },
  "common.add": { en: "Add", mr: "जोडा" },
  "common.remove": { en: "Remove", mr: "काढून टाका" },
  "common.update": { en: "Update", mr: "अपडेट करा" },
  "common.refresh": { en: "Refresh", mr: "रिफ्रेश" },
  "common.search": { en: "Search", mr: "शोधा" },
  "common.filter": { en: "Filter", mr: "फिल्टर" },
  "common.back": { en: "Back", mr: "मागे" },
  "common.next": { en: "Next", mr: "पुढे" },
  "common.done": { en: "Done", mr: "झाले" },
  "common.close": { en: "Close", mr: "बंद करा" },
  "common.print": { en: "Print", mr: "प्रिंट" },
  "common.download": { en: "Download", mr: "डाऊनलोड" },
  "common.loading": { en: "Loading…", mr: "लोड होत आहे…" },
  "common.no_data": { en: "No data", mr: "माहिती नाही" },
  "common.error": { en: "Error", mr: "त्रुटी" },
  "common.try_again": { en: "Try again", mr: "पुन्हा प्रयत्न करा" },
  "common.yes": { en: "Yes", mr: "होय" },
  "common.no": { en: "No", mr: "नाही" },
  "common.all": { en: "All", mr: "सर्व" },
  "common.total": { en: "Total", mr: "एकूण" },
  "common.today": { en: "Today", mr: "आज" },
  "common.yesterday": { en: "Yesterday", mr: "काल" },
  "common.tomorrow": { en: "Tomorrow", mr: "उद्या" },
  "common.date": { en: "Date", mr: "तारीख" },
  "common.time": { en: "Time", mr: "वेळ" },
  "common.qty": { en: "Qty", mr: "नग" },
  "common.weight": { en: "Weight", mr: "वजन" },
  "common.amount": { en: "Amount", mr: "रक्कम" },
  "common.price": { en: "Price", mr: "किंमत" },
  "common.product": { en: "Product", mr: "उत्पादन" },
  "common.products": { en: "Products", mr: "उत्पादने" },
  "common.customer": { en: "Customer", mr: "ग्राहक" },
  "common.customers": { en: "Customers", mr: "ग्राहक" },
  "common.order": { en: "Order", mr: "ऑर्डर" },
  "common.orders": { en: "Orders", mr: "ऑर्डर्स" },
  "common.beat": { en: "Beat", mr: "बीट" },
  "common.vehicle": { en: "Vehicle", mr: "गाडी" },
  "common.vehicle_number": { en: "Vehicle number", mr: "गाडी क्रमांक" },
  "common.driver": { en: "Driver", mr: "ड्रायव्हर" },
  "common.salesman": { en: "Salesman", mr: "विक्रेता" },
  "common.notes": { en: "Notes", mr: "टीप" },
  "common.remarks": { en: "Remarks", mr: "शेरा" },
  "common.required": { en: "Required", mr: "आवश्यक" },
  "common.optional": { en: "Optional", mr: "ऐच्छिक" },

  // Error / validation
  "error.something_wrong": { en: "Something went wrong", mr: "काहीतरी चूक झाली" },
  "error.network": { en: "Network error. Check your connection.", mr: "नेटवर्क त्रुटी. कनेक्शन तपासा." },
  "error.unauthorized": { en: "Not allowed", mr: "परवानगी नाही" },
  "error.not_found": { en: "Not found", mr: "सापडले नाही" },
  "error.required_field": { en: "This field is required", mr: "हे क्षेत्र भरणे आवश्यक आहे" },
  "error.invalid_number": { en: "Enter a valid number", mr: "योग्य संख्या टाका" },
  "error.invalid_phone": { en: "Enter a valid phone number", mr: "योग्य मोबाईल क्रमांक टाका" },
  "error.save_failed": { en: "Save failed", mr: "जतन करता आले नाही" },

  // ========================================================================
  // STATUS — order status enum values
  // ========================================================================
  "status.received": { en: "Received", mr: "प्राप्त" },
  "status.approved": { en: "Approved", mr: "मंजूर" },
  "status.loading": { en: "Loading", mr: "लोडिंग सुरू" },
  "status.partially_dispatched": { en: "Partially dispatched", mr: "अंशत: रवाना" },
  "status.dispatched": { en: "Dispatched", mr: "रवाना" },
  "status.delivered": { en: "Delivered", mr: "पोचवले" },
  "status.rejected": { en: "Rejected", mr: "नाकारले" },
  "status.cancelled": { en: "Cancelled", mr: "रद्द" },
  "status.closed": { en: "Closed", mr: "बंद" },
  "status.on_van_trip": { en: "On van trip", mr: "व्हॅन ट्रिप वर" },
  "status.historical": { en: "Historical", mr: "जुनी ऑर्डर" },

  // ========================================================================
  // LOADING page
  // ========================================================================
  "loading.page_title": { en: "Loading", mr: "लोडिंग" },
  "loading.subtitle": { en: "Approve and load orders into the vehicle", mr: "ऑर्डर मंजूर करा आणि गाडीत भरा" },
  "loading.pending_orders": { en: "Pending orders", mr: "बाकी ऑर्डर्स" },
  "loading.loaded_orders": { en: "Loaded orders", mr: "भरलेल्या ऑर्डर्स" },
  "loading.start_loading": { en: "Start loading", mr: "लोडिंग सुरू करा" },
  "loading.mark_loaded": { en: "Mark as loaded", mr: "भरले म्हणून दाखवा" },
  "loading.scan_or_select": { en: "Scan or select order", mr: "ऑर्डर स्कॅन करा किंवा निवडा" },
  "loading.no_pending": { en: "No pending orders", mr: "बाकी ऑर्डर नाहीत" },
  "loading.total_kg": { en: "Total kg loaded", mr: "एकूण किलो भरले" },
  "loading.total_orders": { en: "Total orders", mr: "एकूण ऑर्डर्स" },
  "loading.assign_vehicle": { en: "Assign vehicle", mr: "गाडी नेमा" },
  "loading.assign_driver": { en: "Assign driver", mr: "ड्रायव्हर नेमा" },

  // ========================================================================
  // DISPATCH page
  // ========================================================================
  "dispatch.page_title": { en: "Dispatch", mr: "वितरण" },
  "dispatch.subtitle": { en: "Mark loaded orders as dispatched", mr: "भरलेल्या ऑर्डर्स रवाना केल्या म्हणून दाखवा" },
  "dispatch.ready_to_dispatch": { en: "Ready to dispatch", mr: "रवाना करण्यासाठी तयार" },
  "dispatch.dispatched_today": { en: "Dispatched today", mr: "आज रवाना केलेल्या" },
  "dispatch.dispatch_button": { en: "Dispatch", mr: "रवाना करा" },
  "dispatch.dispatch_all": { en: "Dispatch all", mr: "सर्व रवाना करा" },
  "dispatch.confirm_dispatch": { en: "Confirm dispatch?", mr: "रवाना करायचे का?" },
  "dispatch.confirm_dispatch_desc": { en: "This will mark all loaded orders as dispatched.", mr: "सर्व भरलेल्या ऑर्डर्स रवाना म्हणून दाखवल्या जातील." },
  "dispatch.dispatch_time": { en: "Dispatch time", mr: "रवाना वेळ" },
  "dispatch.no_ready_orders": { en: "No orders ready to dispatch", mr: "रवाना करण्यासाठी ऑर्डर नाहीत" },
  "dispatch.print_loading_sheet": { en: "Print loading sheet", mr: "लोडिंग शीट प्रिंट करा" },
  "dispatch.print_invoice": { en: "Print invoice", mr: "बिल प्रिंट करा" },

  // ========================================================================
  // DRIVER view
  // ========================================================================
  "driver.page_title": { en: "Driver view", mr: "ड्रायव्हर स्क्रीन" },
  "driver.todays_trips": { en: "Today's trips", mr: "आजच्या ट्रिप्स" },
  "driver.current_trip": { en: "Current trip", mr: "चालू ट्रिप" },
  "driver.next_stop": { en: "Next stop", mr: "पुढील ठिकाण" },
  "driver.stops_remaining": { en: "Stops remaining", mr: "बाकी थांबे" },
  "driver.total_stops": { en: "Total stops", mr: "एकूण थांबे" },
  "driver.mark_delivered": { en: "Mark delivered", mr: "पोचवले म्हणून दाखवा" },
  "driver.mark_undelivered": { en: "Couldn't deliver", mr: "पोचवू शकलो नाही" },
  "driver.reason_undelivered": { en: "Reason for non-delivery", mr: "का पोचवले नाही" },
  "driver.customer_not_available": { en: "Customer not available", mr: "ग्राहक उपलब्ध नाही" },
  "driver.shop_closed": { en: "Shop closed", mr: "दुकान बंद" },
  "driver.payment_issue": { en: "Payment issue", mr: "पेमेंट अडचण" },
  "driver.quality_issue": { en: "Quality complaint", mr: "गुणवत्ता तक्रार" },
  "driver.other_reason": { en: "Other reason", mr: "इतर कारण" },
  "driver.collect_payment": { en: "Collect payment", mr: "पैसे जमा करा" },
  "driver.cash_received": { en: "Cash received", mr: "रोख मिळाले" },
  "driver.no_trips_today": { en: "No trips today", mr: "आज ट्रिप नाही" },
  "driver.start_trip": { en: "Start trip", mr: "ट्रिप सुरू करा" },
  "driver.end_trip": { en: "End trip", mr: "ट्रिप संपवा" },
  "driver.call_customer": { en: "Call customer", mr: "ग्राहकाला कॉल करा" },
  "driver.get_directions": { en: "Get directions", mr: "रस्ता दाखवा" },

  // ========================================================================
  // VAN TRIP
  // ========================================================================
  "van_trip.page_title": { en: "Van trips", mr: "व्हॅन ट्रिप्स" },
  "van_trip.create_trip": { en: "Create trip", mr: "नवीन ट्रिप तयार करा" },
  "van_trip.active_trips": { en: "Active trips", mr: "चालू ट्रिप्स" },
  "van_trip.completed_trips": { en: "Completed trips", mr: "संपलेल्या ट्रिप्स" },
  "van_trip.trip_summary": { en: "Trip summary", mr: "ट्रिप सारांश" },
  "van_trip.delivered_count": { en: "Delivered", mr: "पोचवल्या" },
  "van_trip.undelivered_count": { en: "Couldn't deliver", mr: "पोचवल्या नाहीत" },
  "van_trip.collection_total": { en: "Total collection", mr: "एकूण वसुली" },
  "van_trip.start_time": { en: "Start time", mr: "सुरुवात वेळ" },
  "van_trip.end_time": { en: "End time", mr: "संपण्याची वेळ" },

  // ========================================================================
  // PICKING
  // ========================================================================
  "picking.page_title": { en: "Picking", mr: "पिकिंग" },
  "picking.subtitle": { en: "Pick products from godown for approved orders", mr: "मंजूर ऑर्डरसाठी गोदामातून माल काढा" },
  "picking.pending_pick": { en: "Pending to pick", mr: "पिक करायचे बाकी" },
  "picking.picked": { en: "Picked", mr: "पिक केले" },
  "picking.mark_picked": { en: "Mark picked", mr: "पिक केले म्हणून दाखवा" },
  "picking.scan_product": { en: "Scan product", mr: "उत्पादन स्कॅन करा" },
  "picking.short_pick": { en: "Short pick", mr: "कमी पिक" },
  "picking.short_reason": { en: "Reason for short pick", mr: "कमी पिक का" },
  "picking.out_of_stock": { en: "Out of stock", mr: "स्टॉक संपला" },
  "picking.damaged": { en: "Damaged stock", mr: "खराब माल" },
};

/**
 * Translate a key. If the key doesn't exist in the dictionary, returns the
 * key itself — this makes missing translations visible during development.
 *
 * Optional interpolation: pass an object of values to substitute.
 * Use {name} style placeholders in the dictionary string.
 *
 * Example:
 *   "order.received": { en: "Order {id} received", mr: "ऑर्डर {id} प्राप्त" }
 *   t("order.received", { id: "ABC123" })  // → "ऑर्डर ABC123 प्राप्त"
 */
export function translate(key: string, lang: Lang, vars?: Record<string, string | number>): string {
  const entry = dictionary[key];
  if (!entry) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[i18n] missing key: ${key}`);
    }
    return key;
  }
  let s = entry[lang] ?? entry.en ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replaceAll(`{${k}}`, String(v));
    }
  }
  return s;
}
