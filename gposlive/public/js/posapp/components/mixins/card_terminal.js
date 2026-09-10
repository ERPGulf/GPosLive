/**
 * Card terminal mixin for POSAwesome — handles both Geidea and Alhamrani.
 *
 * A till user is one or the other, never both (enforced in Alhamrani Device Map
 * validate). Which one is resolved once, on POS open, by get_card_provider().
 *
 * THE TWO FLOWS ARE STRUCTURALLY DIFFERENT.
 *
 *   Geidea    server-initiated. One blocking frappe.call: the server POSTs to
 *             the geidea app, which publishes over MQTT and polls Redis until
 *             the terminal answers. The browser just waits.
 *
 *   Alhamrani browser-initiated. AlhamraniServicev2 runs on the till PC and is
 *             reachable only from that PC's browser (http://localhost:9000).
 *             The Frappe server can never reach it, so the round trip is
 *             begin (server) -> SignalR (browser) -> finish (server).
 *
 * Everything the cashier sees stays inside the POS. No routing to desk forms.
 *
 * USAGE
 *   import CardTerminal from "./mixins/card_terminal";
 *   export default { mixins: [CardTerminal], ... }
 *
 *   on POS open      await this.setup_card_terminal()
 *   before submit    const res = await this.take_card_payment(card_amount)
 *                    if (!res.ok) return;              // do not submit
 *                    data.credit_card_transaction_id = res.transaction_id;
 */

const CARD_MOP = "credit card";

export default {
	data() {
		return {
			resettingSession: false,
			card_provider: null,      // "geidea" | "alhamrani" | null
			card_terminal_ready: false,
			card_terminal_error: null,
		};
	},

	computed: {
		card_payments_allowed() {
			// No provider configured means card modes behave as before.
			return !this.card_provider || this.card_terminal_ready;
		},
	},

	methods: {
		/**
		 * Force-recover from a hung or disconnected Alhamrani session without
		 * restarting the Windows service. Clears any stuck Pending transactions
		 * for this shift, cancels any in-flight terminal transaction (best
		 * effort), tears down the existing SignalR connection, and negotiates a
		 * fresh one via alhamrani_payment.reset_session().
		 */
		async reset_alhamrani_session() {
			console.log("reset_alhamrani_session");
			if (this.card_provider !== "alhamrani" || !window.alhamrani_payment) {
				return;
			}

			this.resettingSession = true;
			try {
				const pending = await frappe.call({
					method: "geidea_erpgulf.alhamrani.get_unconfirmed",
					args: { pos_opening_shift: this.pos_opening_shift?.name },
				});
				for (const txn of (pending.message || []).filter((t) => t.status === "Pending")) {
					await frappe.call({
						method: "geidea_erpgulf.alhamrani.mark_unconfirmed",
						args: { txn: txn.name, reason: "Cleared via manual session reset." },
					});
				}

				// await alhamrani_payment.is_ready();
				await alhamrani_payment.reset_session();				
				this.card_terminal_ready = true;
				this.card_terminal_error = null;
				this.eventBus.emit("show_message", {
					text: __("Payment session reset. Terminal reconnected."),
					color: "success",
				});
			} catch (e) {
				this.card_terminal_ready = false;
				this.card_terminal_error = e.message;
				this.eventBus.emit("show_message", {
					text: __("Could not reset the payment session: {0}", [e.message]),
					color: "error",
				});
			} finally {
				this.resettingSession = false;
			}
		},
		// ---------------------------------------------------------------
		// setup
		// ---------------------------------------------------------------

		/** Call once when the POS Profile is loaded. */
		async setup_card_terminal() {
			this.card_provider = null;
			this.card_terminal_ready = false;
			this.card_terminal_error = null;

			// try {
			// 	const r = await frappe.call({
			// 		method: "geidea_erpgulf.alhamrani.get_card_provider",
			// 	});
			// 	this.card_provider = r.message || null;
			try {
				const r = await frappe.call({
					method: "geidea_erpgulf.alhamrani.get_card_provider",
					args: { pos_opening_shift: this.pos_opening_shift?.name },
				});
				this.card_provider = r.message || null;
			} catch (e) {
				// Alhamrani app not installed: fall back to the Geidea check
				// so existing tills are unaffected.
				try {
					const g = await frappe.call({
						method: "gposlive.gposlive.api.posapp.is_device_enabled",
					});
					this.card_provider = g.message ? "geidea" : null;
				} catch (e2) {
					this.card_provider = null;
				}
			}

			if (this.card_provider === "geidea") {
				// Nothing to connect. The server owns the terminal link.
				this.card_terminal_ready = true;
				return;
			}

			if (this.card_provider === "alhamrani") {
				await this.setup_alhamrani();
			}
		},

		async setup_alhamrani() {
			if (!window.alhamrani_payment) {
				this.card_terminal_error = __("Card payment app is not loaded. Run bench build.");
				return;
			}

			// try {
			// 	const cfg = await alhamrani_payment.init();
			// 	await alhamrani_payment.check_device();
			try {
				const cfg = await alhamrani_payment.init(
					this.pos_profile?.name,
					this.pos_opening_shift?.name
				);
				await alhamrani_payment.check_device();

				this.card_terminal_ready = true;

				// No longer blocks POS open on leftover Unconfirmed rows. They're
				// still sitting in Alhamrani Transaction with status Unconfirmed --
				// just not surfaced here anymore. Someone needs to check
				// /app/alhamrani-transaction periodically, since nothing in the POS
				// will prompt for it now.
			} catch (e) {
				this.card_terminal_ready = false;
				this.card_terminal_error = e.message;
				frappe.msgprint({
					title: __("Card machine unavailable"),
					message: e.message,
					indicator: "red",
				});
			}
		},

		// ---------------------------------------------------------------
		// unified entry point
		// ---------------------------------------------------------------

		/**
		 * Take a card payment. Resolves { ok, transaction_id, reason }.
		 *
		 * ok === false means DO NOT SUBMIT the invoice. The reason distinguishes
		 * a decline (retry is safe) from an unknown outcome (retry may double
		 * charge), which the caller normally does not need to act on because
		 * this method has already handled both.
		 */
		async take_card_payment(amount) {
			if (!this.card_provider) {
				return { ok: true, transaction_id: null };   // no terminal configured
			}
			if (this.invoice_doc.is_return && !this.pos_profile?.custom_enable_card_payment_for_return) {
				frappe.msgprint({
					title: __("Card returns disabled"),
					message: __("Card payment is not enabled for returns on this POS Profile. Use a different payment method."),
					indicator: "orange",
				});
				return { ok: false, reason: "return_disabled" };
			}
			if (!this.card_terminal_ready) {
				frappe.msgprint({
					title: __("Card machine unavailable"),
					message: this.card_terminal_error || __("The card machine is not connected."),
					indicator: "red",
				});
				return { ok: false, reason: "not_ready" };
			}

			if (this.card_provider === "geidea") {
				return this.take_card_payment_geidea(amount);
			}
			return this.take_card_payment_alhamrani(amount);
		},

		// ---------------------------------------------------------------
		// Geidea — unchanged behaviour, wrapped for a common return shape
		// ---------------------------------------------------------------

		async take_card_payment_geidea(amount) {
			try {
				const r = await frappe.call({
					method: "gposlive.gposlive.api.posapp.credit_card_payment",
					args: {
						invoice_name: this.invoice_doc.name,
						customer: this.invoice_doc.customer,
						amount: amount,
					},
					freeze: true,
					freeze_message: __("Waiting for the card machine..."),
				});

				const res = r.message || {};

				if (res.final_Status === 1 || res.status === "success") {
					return {
						ok: true,
						transaction_id: res.transaction_id || res.rrn || null,
					};
				}

				if (res.status === "cancelled") {
					return { ok: false, reason: "cancelled" };
				}

				frappe.msgprint({
					title: __("Card payment failed"),
					message: res.message || res.error || __("The card machine declined the payment."),
					indicator: "red",
				});
				return { ok: false, reason: "declined" };
			} catch (e) {
				frappe.msgprint({
					title: __("Card payment failed"),
					message: e.message || __("Could not reach the card machine."),
					indicator: "red",
				});
				return { ok: false, reason: "error" };
			}
		},

		/** Geidea only. Clears the Redis flag and sends an MQTT cancel. */
		async cancel_card_payment() {
			if (this.card_provider === "geidea") {
				return frappe.call({
					method: "posawesome.posawesome.api.posapp.cancel_credit_card_payment",
					args: { invoice_name: this.invoice_doc.name },
				});
			}
			if (this.card_provider === "alhamrani" && window.alhamrani_payment) {
				return alhamrani_payment.cancel();
			}
		},

		// ---------------------------------------------------------------
		// Alhamrani
		// ---------------------------------------------------------------

		async take_card_payment_alhamrani(amount) {
			const magnitude = Math.abs(parseFloat(amount));
			const isReturn = this.invoice_doc.is_return;
			let attempt = 1;

			while (true) {
				let result;

				try {
					result = isReturn
						? await alhamrani_payment.refund({
							amount: magnitude,
							pos_invoice: this.invoice_doc.name,
							pos_opening_shift: this.pos_opening_shift?.name,
						})
						: await alhamrani_payment.purchase({
							amount: magnitude,
							pos_invoice: this.invoice_doc.name,
							pos_opening_shift: this.pos_opening_shift?.name,
							attempt: attempt,
						});
					// result = isReturn
					// 	? await alhamrani_payment.refund({
					// 		amount: magnitude,
					// 		pos_invoice: this.invoice_doc.name,
					// 	})
					// 	: await alhamrani_payment.purchase({
					// 		amount: magnitude,
					// 		pos_invoice: this.invoice_doc.name,
					// 		attempt: attempt,
					// 	});
				} catch (err) {
					if (err.indeterminate) {
						frappe.msgprint({
							title: __("Card payment unresolved"),
							message: __("The card machine did not confirm this payment. Use a different payment method, or check Alhamrani Transaction {0} later.", [err.txn]),
							indicator: "orange",
						});
						return { ok: false, reason: "not_charged" };
					}

					frappe.msgprint({
						title: __("Card payment failed"),
						message: err.message,
						indicator: "red",
					});
					return { ok: false, reason: "error" };
				}

				if (result.approved) {
					return { ok: true, transaction_id: result.rrn };
				}

				if (result.status === "Unconfirmed") {
					frappe.msgprint({
						title: __("Card payment unresolved"),
						message: __("The card machine did not confirm this payment. Use a different payment method, or check Alhamrani Transaction {0} later.", [result.txn]),
						indicator: "orange",
					});
					return { ok: false, reason: "not_charged" };
				}

				const retry = await this.confirm_async(
					__("Card declined: {0}. Try again?", [result.meaning])
				);
				if (!retry) return { ok: false, reason: "declined" };
				attempt += 1;
			}
		},

		// ---------------------------------------------------------------
		// cashier-facing resolution
		// ---------------------------------------------------------------

		/**
		 * Ask the cashier what the terminal actually shows.
		 *
		 * Resolves "charged" or "not_charged". Cannot be dismissed: an
		 * unresolved payment left open is exactly the state that produces a
		 * double charge on the next attempt.
		 *
		 * Refund and write-off are deliberately absent. Those are manager
		 * decisions taken on the desk form, not by a cashier mid-queue.
		 */
		resolve_unconfirmed(txn, amount) {
			return new Promise((resolve) => {
				const formatted = format_currency(amount, this.invoice_doc.currency);

				const d = new frappe.ui.Dialog({
					title: __("Did the payment go through?"),
					fields: [
						{
							fieldtype: "HTML",
							options: `
								<div class="alert alert-warning">
									<b>${__("Do not take payment again yet.")}</b><br><br>
									${__("The card machine did not confirm {0}.", [formatted])}<br><br>
									${__("Look at the card machine screen, or print its last receipt.")}
								</div>`,
						},
						{
							fieldname: "resolution",
							fieldtype: "Select",
							label: __("What does the card machine show?"),
							reqd: 1,
							options: [
								"",
								"Confirmed Approved at Terminal",
								"Confirmed Not Charged",
							].join("\n"),
						},
						{
							fieldname: "note",
							fieldtype: "Small Text",
							label: __("How did you check?"),
							reqd: 1,
							description: __("e.g. printed the last receipt, approval code 123456"),
						},
					],
					primary_action_label: __("Confirm"),
					primary_action: (values) => {
						frappe.call({
							method: "geidea_erpgulf.alhamrani.resolve",
							args: {
								txn: txn,
								resolution: values.resolution,
								note: values.note,
							},
							freeze: true,
							callback: () => {
								d.hide();
								resolve(
									values.resolution === "Confirmed Approved at Terminal"
										? "charged"
										: "not_charged"
								);
							},
						});
					},
				});

				// Must be resolved before anything else happens.
				d.$wrapper.find(".modal-header .btn-modal-close").hide();
				d.$wrapper.modal({ backdrop: "static", keyboard: false });

				// Offer the terminal lookup only where the model supports it.
				// AU MI 25-007 restricts bill-number GET to Move2500, and the
				// journal is wiped by a terminal reboot, so a miss means
				// "unknown", never "not charged".
				const device = alhamrani_payment.get_device();
				if (device && device.supports_bill_get) {
					d.set_secondary_action_label(__("Ask the card machine"));
					d.set_secondary_action(() => this.query_terminal(txn, d));
				}

				d.show();
			});
		},

		async query_terminal(txn, dialog) {
			try {
				const r = await frappe.call({
					method: "frappe.client.get_value",
					args: {
						doctype: "Alhamrani Transaction",
						filters: { name: txn },
						fieldname: "bill_no",
					},
				});
				const bill_no = r.message && r.message.bill_no;
				if (!bill_no) return;

				frappe.freeze(__("Asking the card machine..."));
				const res = await alhamrani_payment.query_bill(bill_no);
				frappe.unfreeze();

				const approved = ["000", "001", "003", "007", "060", "086", "087", "089"]
					.includes(String(res.response_code));

				if (approved) {
					dialog.set_value("resolution", "Confirmed Approved at Terminal");
					dialog.set_value(
						"note",
						__("Card machine lookup: approved, approval code {0}, RRN {1}", [
							res.auth_code || "-",
							res.rrn || "-",
						])
					);
				} else {
					frappe.msgprint({
						title: __("No record found"),
						indicator: "orange",
						message: __(
							"The card machine has no record of this payment. That does not prove it was not charged — the record is lost if the machine restarts. Check the printed receipt as well."
						),
					});
				}
			} catch (e) {
				frappe.unfreeze();
				frappe.msgprint({
					title: __("Lookup failed"),
					message: e.message,
					indicator: "orange",
				});
			}
		},

		async get_transaction_reference(txn) {
			try {
				const r = await frappe.call({
					method: "frappe.client.get_value",
					args: {
						doctype: "Alhamrani Transaction",
						filters: { name: txn },
						fieldname: "rrn",
					},
				});
				return (r.message && r.message.rrn) || null;
			} catch (e) {
				return null;
			}
		},

		// ---------------------------------------------------------------
		// helpers
		// ---------------------------------------------------------------

		card_amount_on(invoice_doc) {
			return (invoice_doc.payments || [])
				.filter(
					(p) =>
						p.mode_of_payment &&
						p.mode_of_payment.toLowerCase() === CARD_MOP &&
						flt(p.amount) > 0
				)
				.reduce((total, p) => total + flt(p.amount), 0);
		},

		confirm_async(message) {
			return new Promise((resolve) => {
				frappe.confirm(
					message,
					() => resolve(true),
					() => resolve(false)
				);
			});
		},
	},
};