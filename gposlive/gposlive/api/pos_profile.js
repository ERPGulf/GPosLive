// Copyright (c) 20201 Youssef Restom and contributors
// For license information, please see license.txt

frappe.ui.form.on('POS Profile', {

    setup: function(frm) {
        frm.set_query("posa_cash_mode_of_payment", function() {
            return {
                filters: { type: "Cash" }
            };
        });
    },

    refresh: function(frm) {
        frm.fields_dict.print_format.get_query = function() {
            return {
                filters: {
                    doc_type: ["in", ["POS Invoice", "Sales Invoice"]]
                }
            };
        };
    }

});
