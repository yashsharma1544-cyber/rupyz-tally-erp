// Translation dictionary for the Rupyz-Tally ERP.

export type Lang = "en" | "mr";

type Dict = Record<string, { en: string; mr: string }>;

export const dictionary: Dict = {
  // ========================================================================
  // COMMON
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
  "common.saving": { en: "Saving…", mr: "जतन करत आहे…" },
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
  "common.optional_paren": { en: "(optional)", mr: "(ऐच्छिक)" },
  "common.item": { en: "item", mr: "वस्तू" },
  "common.items": { en: "items", mr: "वस्तू" },
  "common.not_authorized": { en: "Not authorized", mr: "अधिकार नाही" },
  "common.go_to_dashboard": { en: "Go to dashboard", mr: "डॅशबोर्डवर जा" },
  "common.back_to_main": { en: "Main app", mr: "मुख्य ॲप" },
  "common.units": { en: "units", mr: "नग" },

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
  // STATUS
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
  // Inline short labels
  "status.partly_sent_inline": { en: "partly sent", mr: "अंशत: पाठवले" },
  "status.loaded_inline": { en: "loaded", mr: "भरलेले" },

  // ========================================================================
  // LOADING workflow
  // ========================================================================
  "loading.page_title": { en: "Loading", mr: "लोडिंग" },
  "loading.subtitle": { en: "Approve and load orders into the vehicle", mr: "ऑर्डर मंजूर करा आणि गाडीत भरा" },
  "loading.jalna_only": { en: "Jalna only", mr: "फक्त जालना" },
  "loading.queue": { en: "Loading queue", mr: "लोडिंग रांग" },
  "loading.to_start": { en: "To start", mr: "सुरू करायचे" },
  "loading.in_progress": { en: "In progress", mr: "सुरू आहे" },
  "loading.in_progress_inline": { en: "in progress", mr: "सुरू आहे" },
  "loading.total_value": { en: "Total value", mr: "एकूण किंमत" },
  "loading.nothing_to_load": { en: "Nothing to load right now", mr: "आता लोड करायचे काही नाही" },
  "loading.empty_state_desc": {
    en: "Only Jalna orders show here. When admin approves Jalna orders, they'll appear.",
    mr: "इथे फक्त जालन्याच्या ऑर्डर्स दिसतात. ॲडमिनने जालन्याच्या ऑर्डर्स मंजूर केल्यावर त्या इथे येतील.",
  },
  "loading.no_beat_assigned": { en: "No beat assigned", mr: "बीट नेमलेले नाही" },
  "loading.role_required": {
    en: "Loading app requires the 'dispatch' or 'admin' role.",
    mr: "लोडिंग ॲपसाठी 'डिस्पॅच' किंवा 'ॲडमिन' भूमिका लागते.",
  },
  "loading.back_to_queue": { en: "Back to queue", mr: "रांगेकडे परत" },
  "loading.back_to_queue_full": { en: "Back to loading queue", mr: "लोडिंग रांगेकडे परत" },
  "loading.already_handled": { en: "Already handled", mr: "आधीच हाताळले" },
  "loading.already_handled_desc": {
    en: "This order is \"{status}\" — not in the loading queue anymore.",
    mr: "ही ऑर्डर \"{status}\" आहे — आता लोडिंग रांगेत नाही.",
  },
  "loading.all_loaded_as_ordered": { en: "All loaded as ordered", mr: "ऑर्डरप्रमाणे सगळे भरले" },
  "loading.all_loaded_help": {
    en: "Fills every line with ordered quantity and marks loaded",
    mr: "प्रत्येक ओळीत ऑर्डरचे प्रमाण भरते आणि लोड म्हणून दाखवते",
  },
  "loading.or_adjust_each_line": { en: "Or adjust each line", mr: "किंवा प्रत्येक ओळ बदला" },
  "loading.no_line_items": { en: "This order has no line items.", mr: "या ऑर्डरमध्ये कोणत्याही वस्तू नाहीत." },
  "loading.ordered": { en: "Ordered", mr: "ऑर्डर केलेले" },
  "loading.loaded": { en: "Loaded", mr: "भरलेले" },
  "loading.loaded_qty_aria": { en: "Loaded quantity for {productName}", mr: "{productName} साठी भरलेले प्रमाण" },
  "loading.short_by": { en: "Short by {amount}", mr: "{amount} कमी" },
  "loading.nothing_loaded": { en: "Nothing loaded for this line", mr: "या ओळीसाठी काहीच भरले नाही" },
  "loading.some_lines_short_warn": { en: "Some lines are short — you'll be asked to confirm", mr: "काही ओळी कमी आहेत — पुष्टी करावी लागेल" },
  "loading.at_least_one_qty": { en: "At least one line must have quantity > 0", mr: "किमान एका ओळीत प्रमाण > 0 असावे" },
  "loading.mark_loaded_btn": { en: "Mark loaded", mr: "भरलेले दाखवा" },
  "loading.mark_loaded_adjustments": { en: "Mark loaded with adjustments", mr: "बदलांसह भरलेले दाखवा" },
  "loading.lines_were_short": { en: "Some lines were short", mr: "काही ओळी कमी होत्या" },
  "loading.lines_short_desc": { en: "Lines below have less loaded than ordered:", mr: "खालील ओळींमध्ये ऑर्डरपेक्षा कमी भरले आहे:" },
  "loading.partial_confirm_desc": {
    en: "Mark this order as partially dispatched? You can dispatch the remaining items in a separate run later.",
    mr: "ही ऑर्डर अंशत: रवाना केली म्हणून दाखवायची का? बाकीच्या वस्तू नंतर वेगळ्या ट्रिपमध्ये पाठवू शकता.",
  },
  "loading.confirm_partial": { en: "Confirm partial", mr: "अंशत: पुष्टी करा" },
  "loading.toast_partial_loaded": { en: "Marked as partially loaded", mr: "अंशत: भरले म्हणून दाखवले" },
  "loading.toast_loaded_ready": { en: "Order loaded — ready for dispatch", mr: "ऑर्डर भरली — रवाना करायला तयार" },

  // ========================================================================
  // DISPATCH — home page
  // ========================================================================
  "dispatch.page_title": { en: "Dispatch", mr: "वितरण" },
  "dispatch.role_required": {
    en: "Dispatch app requires the 'dispatch' or 'admin' role.",
    mr: "डिस्पॅच ॲपसाठी 'डिस्पॅच' किंवा 'ॲडमिन' भूमिका लागते.",
  },
  "dispatch.approved_ready": { en: "Approved & ready to dispatch", mr: "मंजूर आणि रवाना करायला तयार" },
  "dispatch.kpi_orders": { en: "Orders", mr: "ऑर्डर्स" },
  "dispatch.kpi_total": { en: "Total", mr: "एकूण" },
  "dispatch.kpi_value": { en: "Value", mr: "किंमत" },
  "dispatch.across_n_beats_one": { en: "across {n} beat", mr: "{n} बीटमध्ये" },
  "dispatch.across_n_beats": { en: "across {n} beats", mr: "{n} बीटांमध्ये" },
  "dispatch.load_a_truck": { en: "Load a truck", mr: "गाडी भरा" },
  "dispatch.approved_ready_to_load": { en: "Approved — ready to load", mr: "मंजूर — भरायला तयार" },
  "dispatch.nothing_to_dispatch": { en: "Nothing to dispatch right now", mr: "आता रवाना करायचे काही नाही" },
  "dispatch.empty_desc": {
    en: "When admin approves orders, the beats will appear here.",
    mr: "ॲडमिनने ऑर्डर्स मंजूर केल्यावर बीट इथे दिसतील.",
  },
  "dispatch.orders_word": { en: "orders", mr: "ऑर्डर्स" },

  // ========================================================================
  // TRUCKS LOADING panel (shown on /dispatch home)
  // ========================================================================
  "trucks.trucks_loading": { en: "Trucks loading", mr: "गाड्या भरत आहेत" },
  "trucks.just_now": { en: "just now", mr: "आत्ताच" },
  "trucks.m_ago": { en: "{n}m ago", mr: "{n} मिनिटांपूर्वी" },
  "trucks.h_ago": { en: "{n}h ago", mr: "{n} तासांपूर्वी" },
  "trucks.d_ago": { en: "{n}d ago", mr: "{n} दिवसांपूर्वी" },
  "trucks.no_vehicle": { en: "(no vehicle)", mr: "(गाडी नाही)" },
  "trucks.no_driver": { en: "(no driver)", mr: "(ड्रायव्हर नाही)" },
  "trucks.driver_label": { en: "Driver:", mr: "ड्रायव्हर:" },
  "trucks.mark_dispatched": { en: "Mark dispatched (truck left)", mr: "रवाना केले म्हणून दाखवा (गाडी निघाली)" },
  "trucks.marking": { en: "Marking…", mr: "दाखवत आहे…" },
  "trucks.confirm_ship": {
    en: "Mark {vehicle} (driver {driver}) as dispatched?\n\n{count} {orderWord} will move to \"dispatched\" status.",
    mr: "{vehicle} (ड्रायव्हर {driver}) रवाना केले म्हणून दाखवायचे का?\n\n{count} {orderWord} \"रवाना\" स्थितीत जाईल.",
  },
  "trucks.toast_marked_one": { en: "{n} dispatch marked as truck-dispatched", mr: "{n} रवाना दाखवली" },
  "trucks.toast_marked_many": { en: "{n} dispatches marked as truck-dispatched", mr: "{n} रवाना दाखवल्या" },

  // ========================================================================
  // LOAD TRUCK wizard (/dispatch/load-truck)
  // ========================================================================
  "truck_wizard.couldnt_load": { en: "Couldn't load orders", mr: "ऑर्डर्स लोड करता आल्या नाहीत" },
  "truck_wizard.back": { en: "Back", mr: "मागे" },
  "truck_wizard.cancel": { en: "Cancel", mr: "रद्द करा" },
  "truck_wizard.step_1_of_2": { en: "Step 1 of 2", mr: "पायरी 1 पैकी 2" },
  "truck_wizard.step_2_of_2": { en: "Step 2 of 2", mr: "पायरी 2 पैकी 2" },
  "truck_wizard.which_orders": { en: "Which orders go on this truck?", mr: "कोणत्या ऑर्डर्स या गाडीत जातील?" },
  "truck_wizard.pick_help": { en: "Pick from any beat. Orders can be combined across beats.", mr: "कोणत्याही बीटमधून निवडा. वेगवेगळ्या बीटांच्या ऑर्डर्स एकत्र पाठवू शकता." },
  "truck_wizard.clear_all_selections": { en: "Clear all selections", mr: "सर्व निवडी रद्द करा" },
  "truck_wizard.nothing_to_load": { en: "Nothing to load", mr: "भरायचे काही नाही" },
  "truck_wizard.no_approved_now": { en: "No approved orders right now.", mr: "आता मंजूर ऑर्डर्स नाहीत." },
  "truck_wizard.n_of_m_selected": { en: "{n} of {m} selected", mr: "{m} पैकी {n} निवडल्या" },
  "truck_wizard.n_orders_available_one": { en: "{n} order available", mr: "{n} ऑर्डर उपलब्ध" },
  "truck_wizard.n_orders_available_many": { en: "{n} orders available", mr: "{n} ऑर्डर्स उपलब्ध" },
  "truck_wizard.clear_this_beat": { en: "Clear this beat", mr: "हा बीट रिकामा करा" },
  "truck_wizard.select_all_in_beat": { en: "Select all in this beat", mr: "या बीटमधल्या सर्व निवडा" },
  "truck_wizard.tap_to_select_truck": { en: "Tap orders to add them to the truck", mr: "ऑर्डर्स गाडीत टाकण्यासाठी टॅप करा" },
  "truck_wizard.next_truck_details": { en: "Next: Truck details", mr: "पुढे: गाडीची माहिती" },
  "truck_wizard.back_to_selection": { en: "Back to selection", mr: "निवडीकडे परत" },
  "truck_wizard.truck_details": { en: "Truck details", mr: "गाडीची माहिती" },
  "truck_wizard.loading_n_orders_one": { en: "Loading {n} order", mr: "{n} ऑर्डर भरत आहे" },
  "truck_wizard.loading_n_orders_many": { en: "Loading {n} orders", mr: "{n} ऑर्डर्स भरत आहे" },
  "truck_wizard.across_n_beats": { en: "across {n} beats", mr: "{n} बीटांमध्ये" },
  "truck_wizard.orders_on_truck": { en: "Orders on this truck", mr: "या गाडीतल्या ऑर्डर्स" },
  "truck_wizard.vehicle_and_driver": { en: "Vehicle & driver", mr: "गाडी आणि ड्रायव्हर" },
  "truck_wizard.vehicle_label": { en: "Vehicle #", mr: "गाडी क्रमांक" },
  "truck_wizard.driver_label": { en: "Driver", mr: "ड्रायव्हर" },
  "truck_wizard.pick_driver": { en: "Pick driver", mr: "ड्रायव्हर निवडा" },
  "truck_wizard.other_driver": { en: "Other driver", mr: "दुसरा ड्रायव्हर" },
  "truck_wizard.select_driver_placeholder": { en: "— Select a driver —", mr: "— ड्रायव्हर निवडा —" },
  "truck_wizard.driver_eg": { en: "e.g. Ramesh", mr: "उदा. रमेश" },
  "truck_wizard.driver_phone_label": { en: "Driver phone", mr: "ड्रायव्हर मोबाईल" },
  "truck_wizard.driver_phone_placeholder": { en: "9876543210 (optional)", mr: "9876543210 (ऐच्छिक)" },
  "truck_wizard.helper_label": { en: "Helper", mr: "मदतनीस" },
  "truck_wizard.no_helper_placeholder": { en: "— No helper —", mr: "— मदतनीस नाही —" },
  "truck_wizard.helper_will_see": { en: "{name} will see all {n} dispatches on the Driver app.", mr: "{name} ला सर्व {n} रवाने ड्रायव्हर ॲपवर दिसतील." },
  "truck_wizard.no_helpers_configured": {
    en: "No helpers configured. Admin can add helpers in Users with role 'van_helper'.",
    mr: "मदतनीस नाही. ॲडमिन Users मधून 'van_helper' भूमिका असलेले मदतनीस जोडू शकतो.",
  },
  "truck_wizard.notes_label": { en: "Notes", mr: "टीप" },
  "truck_wizard.notes_placeholder": { en: "Any extra info (optional)", mr: "अधिक माहिती (ऐच्छिक)" },
  "truck_wizard.dispatching": { en: "Dispatching…", mr: "रवाना करत आहे…" },
  "truck_wizard.dispatch_n_orders_one": { en: "Dispatch {n} order", mr: "{n} ऑर्डर रवाना करा" },
  "truck_wizard.dispatch_n_orders_many": { en: "Dispatch {n} orders", mr: "{n} ऑर्डर्स रवाना करा" },
  "truck_wizard.toast_vehicle_required": { en: "Vehicle # is required", mr: "गाडी क्रमांक आवश्यक आहे" },
  "truck_wizard.toast_pick_driver_or_other": { en: "Pick a driver from the list, or use 'Other driver'", mr: "यादीतून ड्रायव्हर निवडा, किंवा 'दुसरा ड्रायव्हर' वापरा" },
  "truck_wizard.toast_driver_required": { en: "Driver name is required", mr: "ड्रायव्हरचे नाव आवश्यक आहे" },
  "truck_wizard.toast_all_failed": { en: "All {total} dispatches failed", mr: "सर्व {total} रवाने अयशस्वी" },
  "truck_wizard.toast_n_of_m_failed": { en: "{failed} of {total} orders failed", mr: "{total} पैकी {failed} ऑर्डर्स अयशस्वी" },
  "truck_wizard.toast_n_of_m_dispatched": { en: "{succeeded} of {total} dispatched · {failed} failed", mr: "{total} पैकी {succeeded} रवाना · {failed} अयशस्वी" },
  "truck_wizard.toast_succeeded_one": { en: "{n} order dispatched", mr: "{n} ऑर्डर रवाना केली" },
  "truck_wizard.toast_succeeded_many": { en: "{n} orders dispatched", mr: "{n} ऑर्डर्स रवाना केल्या" },

  // ========================================================================
  // BEAT DETAIL (/dispatch/[beatId]) + bulk-dispatch modal
  // ========================================================================
  "beat.all_beats": { en: "All beats", mr: "सर्व बीट" },
  "beat.back_to_beats": { en: "Back to beats", mr: "बीटांकडे परत" },
  "beat.no_beat_warn_title": { en: "Customers without beat assignment", mr: "बीट न नेमलेले ग्राहक" },
  "beat.no_beat_warn_body": {
    en: "These customers don't belong to any beat yet. Dispatch them one at a time below, in bulk, or use \"Load a truck\". Fix beat assignment in {customersLink}.",
    mr: "या ग्राहकांना अजून बीट नेमलेले नाही. खाली एक-एक करून, सर्व मिळून, किंवा \"गाडी भरा\" वापरून रवाना करा. {customersLink} मधून बीट नेमणूक नीट करा.",
  },
  "beat.customers_link": { en: "Customers", mr: "ग्राहक" },
  "beat.dispatch_all_n_one": { en: "Dispatch all {n} order", mr: "सर्व {n} ऑर्डर रवाना करा" },
  "beat.dispatch_all_n_many": { en: "Dispatch all {n} orders", mr: "सर्व {n} ऑर्डर्स रवाना करा" },
  "beat.load_truck_pick": { en: "Load a truck (pick orders)", mr: "गाडी भरा (ऑर्डर्स निवडा)" },
  "beat.nothing_in_beat": { en: "Nothing to dispatch in this beat", mr: "या बीटमध्ये रवाना करायचे काही नाही" },
  "beat.empty_desc": { en: "When admin approves orders, they'll show here.", mr: "ॲडमिनने ऑर्डर्स मंजूर केल्यावर इथे दिसतील." },
  "beat.or_dispatch_one": { en: "Or dispatch one at a time", mr: "किंवा एक-एक करून रवाना करा" },
  "beat.bulk_title": { en: "Dispatch all orders", mr: "सर्व ऑर्डर्स रवाना करा" },
  "beat.bulk_desc_with_helper_one": {
    en: "Creates {n} dispatch with full quantities, all with the same vehicle, driver, and helper.",
    mr: "{n} रवाना तयार होईल, संपूर्ण प्रमाणासह, एकाच गाडी, ड्रायव्हर आणि मदतनीसासह.",
  },
  "beat.bulk_desc_with_helper_many": {
    en: "Creates {n} dispatches with full quantities, all with the same vehicle, driver, and helper.",
    mr: "{n} रवाने तयार होतील, संपूर्ण प्रमाणासह, एकाच गाडी, ड्रायव्हर आणि मदतनीसासह.",
  },
  "beat.bulk_desc_one": {
    en: "Creates {n} dispatch with full quantities, all with the same vehicle and driver.",
    mr: "{n} रवाना तयार होईल, संपूर्ण प्रमाणासह, एकाच गाडी आणि ड्रायव्हरसह.",
  },
  "beat.bulk_desc_many": {
    en: "Creates {n} dispatches with full quantities, all with the same vehicle and driver.",
    mr: "{n} रवाने तयार होतील, संपूर्ण प्रमाणासह, एकाच गाडी आणि ड्रायव्हरसह.",
  },
  "beat.bulk_confirm_with_helper": {
    en: "Dispatch all {n} orders for {beat}? This creates {n} dispatch records, all with the same vehicle/driver/helper.",
    mr: "{beat} साठी सर्व {n} ऑर्डर्स रवाना करायच्या का? {n} रवाना नोंदी तयार होतील, सर्वांना एकच गाडी/ड्रायव्हर/मदतनीस.",
  },
  "beat.bulk_confirm": {
    en: "Dispatch all {n} orders for {beat}? This creates {n} dispatch records, all with the same vehicle/driver.",
    mr: "{beat} साठी सर्व {n} ऑर्डर्स रवाना करायच्या का? {n} रवाना नोंदी तयार होतील, सर्वांना एकच गाडी/ड्रायव्हर.",
  },
  "beat.helper_will_see_n": { en: "{name} will see all {n} dispatches.", mr: "{name} ला सर्व {n} रवाने दिसतील." },
  "beat.no_helpers_add": { en: "No helpers configured. Add helpers in Users with role 'van_helper'.", mr: "मदतनीस नाही. Users मधून 'van_helper' भूमिकेसह मदतनीस जोडा." },
  "beat.dispatch_n": { en: "Dispatch {n}", mr: "{n} रवाना करा" },
  "beat.toast_vehicle_driver_required": { en: "Vehicle # and driver are required", mr: "गाडी क्रमांक आणि ड्रायव्हर आवश्यक आहेत" },

  // ========================================================================
  // ORDER DISPATCH (/dispatch/[beatId]/[orderId])
  // ========================================================================
  "order_dispatch.already_handled": { en: "Already handled", mr: "आधीच हाताळले" },
  "order_dispatch.already_handled_desc": {
    en: "This order is \"{status}\" — nothing to dispatch.",
    mr: "ही ऑर्डर \"{status}\" आहे — रवाना करायचे काही नाही.",
  },
  "order_dispatch.back_to_beat": { en: "Back to beat", mr: "बीटकडे परत" },
  "order_dispatch.partly_sent_already": { en: "partly sent already", mr: "अंशत: पाठवले आहे" },
  "order_dispatch.loaded_by_warehouse": { en: "loaded by warehouse", mr: "गोदामाने भरले" },
  "order_dispatch.items_in_order": { en: "Items in this order", mr: "या ऑर्डरमधल्या वस्तू" },
  "order_dispatch.edit_quantities": { en: "Edit quantities", mr: "प्रमाण बदला" },
  "order_dispatch.reset_all": { en: "Reset all", mr: "सर्व रिसेट करा" },
  "order_dispatch.fully_sent_earlier": { en: "Fully sent earlier", mr: "पूर्वी पूर्ण पाठवले" },
  "order_dispatch.no_line_items": { en: "This order has no line items.", mr: "या ऑर्डरमध्ये कोणत्याही वस्तू नाहीत." },
  "order_dispatch.decrease_aria": { en: "Decrease", mr: "कमी करा" },
  "order_dispatch.increase_aria": { en: "Increase", mr: "वाढवा" },
  "order_dispatch.n_max": { en: "/ {max} max", mr: "/ {max} पर्यंत" },
  "order_dispatch.some_reduced_warn": {
    en: "⚠ Some lines reduced — order will be marked \"partly sent\"",
    mr: "⚠ काही ओळी कमी केल्या — ऑर्डर \"अंशत: पाठवले\" म्हणून दाखवली जाईल",
  },
  "order_dispatch.confirm_partial_amt": { en: "Confirm partial dispatch · {amount}", mr: "अंशत: रवाना पुष्टी करा · {amount}" },
  "order_dispatch.dispatch_full_amt": { en: "Dispatch full order · {amount}", mr: "पूर्ण ऑर्डर रवाना करा · {amount}" },
  "order_dispatch.no_helpers_users_invite": {
    en: "No helpers configured. Admin can add helpers in Users → Invite User with role 'van_helper'.",
    mr: "मदतनीस नाही. ॲडमिन Users → Invite User मधून 'van_helper' भूमिकेसह जोडू शकतो.",
  },
  "order_dispatch.helper_will_see_delivery": {
    en: "{name} will see this delivery on the Driver app and can mark it delivered.",
    mr: "{name} ला ही डिलिव्हरी ड्रायव्हर ॲपवर दिसेल आणि पोचवली म्हणून दाखवू शकेल.",
  },
  "order_dispatch.toast_dispatched": { en: "Dispatched · {dispatchNumber}", mr: "रवाना · {dispatchNumber}" },

  // ========================================================================
  // DRIVER
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
 * Translate a key. Missing keys return the key itself (visible in dev).
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
