/* ============================================================
   Billing client helpers — tiny browser-side bridge for hosted
   subscription/upgrade prompts. Server routes remain source of truth.
   ============================================================ */
(function () {
  const BILLING_CODES = [
    "quota_exceeded",
    "subscription_required",
    "subscription_inactive",
    "trial_expired",
    "campaign_limit_exceeded",
    "concurrent_job_limit_exceeded",
    "drive_not_enabled",
    "managed_provider_not_enabled",
    "byok_provider_not_enabled",
    "export_not_enabled",
    "storage_quota_exceeded",
  ];

  function notifyRequired(detail) {
    const payload = Object.assign({
      status: 402,
      code: "subscription_required",
      error: "A subscription or upgrade is required.",
    }, detail || {});
    window.dispatchEvent(new CustomEvent("pillarpress:billing-action-required", { detail: payload }));
  }

  function notifyDriveDisabled() {
    notifyRequired({
      code: "drive_not_enabled",
      error: "Google Drive export is not included in your current plan. Upgrade to save files to Drive.",
    });
  }

  function notifyExportDisabled() {
    notifyRequired({
      code: "export_not_enabled",
      error: "Downloads and exports are not included in your current plan. Upgrade to export files.",
    });
  }

  window.KP_BILLING = {
    codes: BILLING_CODES.slice(),
    isBillingCode: (code) => BILLING_CODES.includes(code),
    notifyRequired,
    notifyDriveDisabled,
    notifyExportDisabled,
  };
})();
