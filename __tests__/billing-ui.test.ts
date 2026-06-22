import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

function CustomEvent(type: string, init?: { detail?: unknown }) {
  return { type, detail: init?.detail };
}

function loadBillingClientWindow() {
  const source = readFileSync(new URL("../public/billing-client.js", import.meta.url), "utf8");
  const events: Array<{ type: string; detail?: unknown }> = [];
  const window = {
    dispatchEvent: (event: { type: string; detail?: unknown }) => {
      events.push(event);
      return true;
    },
  } as Record<string, any>;
  runInNewContext(source, { window, CustomEvent });
  return { window, events };
}

describe("browser billing upgrade helpers", () => {
  it("dispatches a standard billing event for Drive plan blocks", () => {
    const { window, events } = loadBillingClientWindow();

    window.KP_BILLING.notifyDriveDisabled();

    expect(events).toEqual([{
      type: "kingspress:billing-action-required",
      detail: {
        status: 402,
        code: "drive_not_enabled",
        error: "Google Drive export is not included in your current plan. Upgrade to save files to Drive.",
      },
    }]);
  });

  it("Drive uploads stop before upload and open the billing prompt when Drive is plan-disabled", async () => {
    const billingSource = readFileSync(new URL("../public/billing-client.js", import.meta.url), "utf8");
    const driveSource = readFileSync(new URL("../public/drive.js", import.meta.url), "utf8");
    const events: Array<{ type: string; detail?: any }> = [];
    const fetchCalls: string[] = [];
    const window = {
      dispatchEvent: (event: { type: string; detail?: unknown }) => {
        events.push(event);
        return true;
      },
    } as Record<string, any>;
    const fetch = async (url: string) => {
      fetchCalls.push(url);
      return {
        ok: true,
        json: async () => ({ linked: false, localExportAvailable: false, driveEnabled: false }),
      };
    };

    runInNewContext(billingSource, { window, CustomEvent });
    runInNewContext(driveSource, { window, CustomEvent, fetch });
    await window.DRIVE.refresh();

    await expect(window.DRIVE.uploadMany([{ name: "draft.md", content: "Draft" }]))
      .rejects.toMatchObject({ code: "drive_not_enabled", status: 402 });
    expect(fetchCalls.length).toBeGreaterThanOrEqual(2);
    expect(fetchCalls.every((url) => url === "/api/drive/status")).toBe(true);
    expect(events[0]).toMatchObject({
      type: "kingspress:billing-action-required",
      detail: { code: "drive_not_enabled", status: 402 },
    });
  });

  it("output, media, and book screens route disabled Drive/export actions to billing prompts", () => {
    const outputs = readFileSync(new URL("../public/screen-outputs.jsx", import.meta.url), "utf8");
    const media = readFileSync(new URL("../public/media-components.jsx", import.meta.url), "utf8");
    const book = readFileSync(new URL("../public/screen-book.jsx", import.meta.url), "utf8");
    const index = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

    expect(index).toContain('<script src="billing-client.js"></script>');
    expect(outputs).toContain("window.KP_BILLING.notifyExportDisabled");
    expect(outputs).toContain("window.KP_BILLING.notifyDriveDisabled");
    expect(outputs).toContain("!window.DRIVE.isDriveEnabled()");
    expect(media).toContain("driveDisabledByPlan");
    expect(media).toContain("window.KP_BILLING.notifyDriveDisabled");
    expect(book).toContain("bookExportAllowed");
    expect(book).toContain("notifyBookDriveBlocked");
    expect(book).toContain("driveActionVisible");
  });

  it("app shell wires the Billing and usage panel to status, usage, checkout, and portal flows", () => {
    const app = readFileSync(new URL("../public/app.jsx", import.meta.url), "utf8");

    expect(app).toContain('aria-label="Billing and usage"');
    expect(app).toContain("window.Store.refreshBilling()");
    expect(app).toContain("window.Store.startCheckout(plan.id)");
    expect(app).toContain("window.Store.openBillingPortal()");
    expect(app).toContain("kingspress:billing-action-required");
    expect(app).toContain("This billing period");
    expect(app).toContain('["llm", "gather", "media", "storage"]');
    expect(app).toContain("AI credits");
    expect(app).toContain("Gather runs");
    expect(app).toContain("Media generations");
    expect(app).toContain("Storage");
    expect(app).toContain("Manage billing");
    expect(app).toContain("Use Stripe Customer Portal to change or cancel your current plan.");
  });
});
