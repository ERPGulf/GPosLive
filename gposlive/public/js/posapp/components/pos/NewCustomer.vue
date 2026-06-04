<template>
  <v-row justify="center">
    <v-dialog v-model="customerDialog" max-width="600px">
      <v-card :style="{ direction: isRTL ? 'rtl' : 'ltr' }">
        <v-card-title>
          <span class="headline indigo--text">{{ $t("New Customer") }}</span>
        </v-card-title>
        <v-card-text class="pa-0">
          <v-container>
            <v-row>

              <v-col cols="12">
                <v-text-field
                  dense
                  color="indigo"
                  :label="$t('Customer Name') + ' *'"
                  background-color="white"
                  v-model="customer_name"
                  :rules="[(v) => !!v || $t('Customer Name is required')]"
                />
              </v-col>

              <v-col cols="12">
                <v-row :style="{ flexDirection: isRTL ? 'row-reverse' : 'row' }">
                  <v-col cols="4">
                    <v-select
                      dense
                      :label="$t('Country Code')"
                      :items="country_codes"
                      v-model="country_code"
                      item-title="text"
                      item-value="value"
                    >
                      <template v-slot:selection="{ item }">
                        <span style="direction: ltr; unicode-bidi: embed;">{{ item.title }}</span>
                      </template>
                      <template v-slot:item="{ item, props }">
                        <v-list-item v-bind="props" style="direction: ltr;" />
                      </template>
                    </v-select>
                  </v-col>
                  <v-col cols="8">
                    <!-- ltr-input: only the <input> inside goes LTR, label stays RTL -->
                    <v-text-field
                      dense
                      color="indigo"
                      :label="$t('Mobile Number')"
                      background-color="white"
                      v-model="mobile_no"
                      :placeholder="mobile_placeholder"
                      :maxlength="max_length"
                      @input="handleMobileInput"
                      :class="isRTL ? 'ltr-input' : ''"
                    />
                    <div
                      style="color: red; font-size: 12px"
                      :style="{ textAlign: isRTL ? 'right' : 'left' }"
                    >
                      {{ validation_message }}
                    </div>
                  </v-col>
                </v-row>
              </v-col>

              <v-col cols="6">
                <v-text-field
                  dense
                  color="indigo"
                  :label="$t('Email Id')"
                  background-color="white"
                  hide-details
                  v-model="email_id"
                  :class="isRTL ? 'ltr-input' : ''"
                />
              </v-col>

              <v-col cols="6">
                <v-menu
                  ref="birthday_menu"
                  v-model="birthday_menu"
                  :close-on-content-click="false"
                  transition="scale-transition"
                  density="default"
                >
                  <template v-slot:activator="{ props }">
                    <v-text-field
                      v-model="formattedBirthday"
                      @click="birthday_menu = true"
                      :label="$t('Birthday')"
                      readonly
                      dense
                      clearable
                      hide-details
                      v-bind="props"
                      color="primary"
                    />
                  </template>
                  <v-date-picker
                    v-model="birthday"
                    color="primary"
                    no-title
                    scrollable
                    :max="frappe.datetime.now_date()"
                  >
                    <template v-slot:actions>
                      <v-btn text color="primary" @click="birthday_menu = false">
                        {{ $t("Set") }}
                      </v-btn>
                    </template>
                  </v-date-picker>
                </v-menu>
              </v-col>

            </v-row>
          </v-container>
        </v-card-text>

        <v-card-actions>
          <v-spacer />
          <v-btn color="error" dark @click="close_dialog">{{ $t("Close") }}</v-btn>
          <v-btn color="primary" dark @click="submit_dialog">{{ $t("Submit") }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-row>
</template>

<script>
export default {
  data: () => ({
    isRTL: document.documentElement.dir === "rtl",
    country_code: "966",
    mobile_no: "",
    country_codes: [
      { text: "Saudi (+966)", value: "966" },
      { text: "Qatar (+974)", value: "974" },
      { text: "Bahrain (+973)", value: "973" },
      { text: "Oman (+968)", value: "968" },
      { text: "Kuwait (+965)", value: "965" },
      { text: "Egypt (+20)", value: "20" },
    ],
    customerDialog: false,
    pos_profile: "",
    customer_name: "",
    tax_id: "",
    email_id: "",
    referral_code: "",
    company: "",
    companies: [],
    refcodes: [],
    birthday: null,
    formattedBirthday: "",
    birthday_menu: false,
    group: "",
    groups: [],
    territory: "",
    territorys: [],
    address_line1: "",
    address_line2: "",
    custom_building_number: "",
    pincode: "",
    city: "",
    isValid: true,
    isValidPincode: true,
    isValidBuildingNumber: true,
  }),

  computed: {
    max_length() {
      if (this.country_code === "966") return 9;
      if (["974", "973", "968", "965"].includes(this.country_code)) return 8;
      if (this.country_code === "20") return 10;
      return 9;
    },
    mobile_placeholder() {
      return "53535353";
    },
    validation_message() {
      if (this.country_code === "966")
        return this.isRTL
          ? "يجب كتابة 9 أرقام بدون صفر الجوال"
          : "Enter 9 digits without the leading zero";
      if (["974", "973", "968", "965"].includes(this.country_code))
        return this.isRTL
          ? "يجب كتابة 8 أرقام بدون صفر الجوال"
          : "Enter 8 digits without the leading zero";
      if (this.country_code === "20")
        return this.isRTL
          ? "يجب كتابة 10 أرقام بدون صفر الجوال"
          : "Enter 10 digits without the leading zero";
      return "";
    },
  },

  watch: {
    birthday(val) {
      if (val) {
        this.formattedBirthday = new Date(val).toISOString().slice(0, 10);
      } else {
        this.formattedBirthday = "";
      }
    },
  },

  methods: {
    handleMobileInput(value) {
      let digits = value.replace(/\D/g, "");
      if (digits.length > this.max_length) digits = digits.slice(0, this.max_length);
      this.mobile_no = digits;
    },

    validatePincode() {
      const isValid = /^\d{5}$/.test(this.pincode);
      this.isValidPincode = isValid;
      if (!isValid) {
        this.eventBus.emit("show_mesage", {
          text: this.$t("Pincode must be exactly 5 digits!"),
          color: "error",
        });
      }
    },

    validateBuildingNumber() {
      const isValid = /^\d{4}$/.test(this.custom_building_number);
      this.isValidBuildingNumber = isValid;
      if (!isValid) {
        this.eventBus.emit("show_mesage", {
          text: this.$t("Building number must be exactly 4 digits!"),
          color: "error",
        });
      }
    },

    close_dialog() {
      this.customerDialog = false;
    },

    getCustomerGroups() {
      const vm = this;
      frappe.call({
        method: "gposlive.gposlive.api.posapp.get_customers_groups",
        args: {
          posProfile: JSON.parse(sessionStorage.getItem("cached_pos_profile")).name,
        },
        callback(r) {
          if (r.message) vm.groups = r.message;
        },
      });
      vm.refcodes = [
        "Haraj - حراج", "Snap - سناب", "Instagram - انستاجرام",
        "Twitter - تويتر", "Youtube - يوتيوب", "Facebook - فيسبوك",
        "Tik Tok تيك توك", "Google - جوجل", "Friend - صديق او زميل",
        "Customer - عميل قديم", "Wholesale Customer - عميل شركات وجملة",
        "Visitor - زائر محل",
      ];
    },

    getCustomerTerritorys() {
      if (this.territorys.length > 0) return;
      const vm = this;
      frappe.db.get_list("Territory", { fields: ["name"], page_length: 1000 })
        .then((data) => { data.forEach((el) => vm.territorys.push(el.name)); });
    },

    getCompanies() {
      if (this.companies.length > 0) return;
      const vm = this;
      frappe.db.get_list("Company", { fields: ["name"], page_length: 1000 })
        .then((data) => { data.forEach((el) => vm.companies.push(el.name)); });
    },

    submit_dialog() {
      if (!this.customer_name) {
        this.eventBus.emit("show_mesage", { text: "Customer Name is required", color: "error" });
        return;
      }
      if (this.mobile_no.length !== this.max_length) {
        this.eventBus.emit("show_mesage", { text: this.validation_message, color: "error" });
        return;
      }
      var vm = this;
      const args = {
        customer_name: this.customer_name,
        company: this.company,
        tax_id: this.tax_id,
        mobile_no: this.country_code + this.mobile_no,
        email_id: this.email_id,
        city: this.city,
        referral_code: this.referral_code,
        birthday: this.birthday ? this.birthday.toISOString().slice(0, 10) : null,
        customer_group: this.group,
        territory: this.territory,
        address_line1: this.address_line1,
        address_line2: this.address_line2,
        custom_building_number: this.custom_building_number,
        pincode: this.pincode,
      };
      frappe.call({
        method: "gposlive.gposlive.api.posapp.create_customer",
        args,
        callback(r) {
          if (!r.exc && r.message.name) {
            vm.eventBus.emit("show_mesage", {
              text: __("Customer contact created successfully."),
              color: "success",
            });
            args.name = r.message.name;
            frappe.utils.play_sound("submit");
            vm.eventBus.emit("add_customer_to_list", args);
            vm.eventBus.emit("set_customer", r.message.name);
            Object.assign(vm, {
              customer_name: "", tax_id: "", mobile_no: "", city: "",
              email_id: "", referral_code: "", company: "",
              birthday: null, formattedBirthday: "", group: "",
              customerDialog: false, address_line1: "", address_line2: "",
              custom_building_number: "", pincode: "",
            });
          }
        },
      });
      this.customerDialog = false;
    },
  },

  mounted() {
    this.$options._dirObserver = new MutationObserver(() => {
      this.isRTL = document.documentElement.dir === "rtl";
    });
    this.$options._dirObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["dir"],
    });
  },

  beforeUnmount() {
    if (this.$options._dirObserver) {
      this.$options._dirObserver.disconnect();
      this.$options._dirObserver = null;
    }
  },

  created() {
    this.eventBus.on("set_country_and_mobile", (data) => {
      this.country_code = data.country_code;
      this.mobile_no = data.mobile_no;
    });
    this.eventBus.on("open_new_customer", () => {
      this.customerDialog = true;
      this.getCustomerGroups();
    });
    this.eventBus.on("register_pos_profile", (data) => {
      this.pos_profile = data.pos_profile;
    });
    this.getCustomerTerritorys();
    this.getCompanies();
  },
};
</script>

<style scoped>
/*
  .ltr-input targets only the actual <input> element inside v-text-field.
  The label element is NOT affected, so it stays RTL (right-aligned)
  while the typed text and cursor remain left-to-right for phone/email.
*/
.ltr-input :deep(input) {
  direction: ltr;
  text-align: left;
}
</style>