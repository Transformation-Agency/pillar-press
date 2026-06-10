import type { Page } from "puppeteer";

export type OnboardingUiProofResult = {
  setupOpen: boolean;
  complete: boolean;
  firstValue: null | {
    complete?: boolean;
    campaignName?: string;
  };
  transcript: null | {
    complete?: boolean;
    progress?: unknown;
    turns?: Array<{
      role?: string;
      slotId?: string;
      inputMethod?: string | null;
      text?: string;
    }>;
  };
  handoff: null | {
    deskThreadId?: string;
  };
  sentiment: null | {
    rating?: number;
    submittedAt?: string;
  };
  metricsSummary: null | {
    sentimentResponses?: number;
    averageSentiment?: number | null;
    latestEventType?: string | null;
  };
  desk: null | {
    activeId?: string | null;
    threads?: Array<{ source?: string }>;
  };
};

export type OnboardingUiProofOptions = {
  focusName?: string;
  voiceAnswer?: string;
  requireNoStepper?: boolean;
  sentimentRating?: number;
};

export const DEFAULT_ONBOARDING_UI_PROOF = {
  focusName: "Browser Shell Focus",
  voiceAnswer: "I write for operators. Keep it plainspoken and useful.",
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function clickButton(page: Page, label: string) {
  await page.evaluate(`
    (() => {
      const targetLabel = ${JSON.stringify(label)};
      const normalizeText = (value) => value.replace(/\\s+/g, " ").trim();
      const button = Array.from(document.querySelectorAll("button"))
        .find((item) => normalizeText(item.textContent || "") === targetLabel);
      if (!button) throw new Error("Missing button: " + targetLabel);
      button.click();
    })()
  `);
}

async function typeInto(page: Page, selector: string, value: string) {
  await page.waitForSelector(selector, { visible: true });
  await page.click(selector, { count: 3 });
  await page.keyboard.type(value);
}

async function typeIntoFirstTextarea(page: Page, value: string) {
  await page.waitForSelector("textarea", { visible: true });
  const areas = await page.$$("textarea");
  assert(areas[0], "No textarea was available for setup answer entry.");
  await areas[0].click({ count: 3 });
  await page.keyboard.type(value);
}

async function waitForText(page: Page, text: string) {
  try {
    await page.waitForFunction(`document.body.innerText.includes(${JSON.stringify(text)})`);
  } catch (error) {
    const body = await page.evaluate("document.body.innerText") as string;
    throw new Error("Timed out waiting for text: " + text + "\n\nCurrent page text:\n" + body.slice(0, 4000), { cause: error });
  }
}

export async function driveOnboardingUiProof(page: Page, options?: OnboardingUiProofOptions): Promise<OnboardingUiProofResult> {
  const focusName = options?.focusName || DEFAULT_ONBOARDING_UI_PROOF.focusName;
  const voiceAnswer = options?.voiceAnswer || DEFAULT_ONBOARDING_UI_PROOF.voiceAnswer;
  const sentimentRating = Math.max(1, Math.min(5, Math.round(Number(options?.sentimentRating || 5))));

  await page.waitForSelector(".kp-conversation-canvas", { visible: true, timeout: 30000 });
  if (options?.requireNoStepper !== false) {
    assert(
      await page.$("nav[aria-label='Setup progress']") === null,
      "Setup stepper is still visible; expected one continuous conversation canvas.",
    );
  }
  await waitForText(page, "Would you like a guided intro");

  await clickButton(page, "Yes, guide me");
  await waitForText(page, "Can I help you set up voice?");
  await clickButton(page, "Skip voice");

  await waitForText(page, "AI & models");
  await clickButton(page, "Continue");

  await waitForText(page, "First project or campaign name");
  await typeInto(page, "input[placeholder='e.g. Smoke Test']", focusName);
  await clickButton(page, "Continue");

  await waitForText(page, "Tell me how this desk should sound for you.");
  await typeIntoFirstTextarea(page, voiceAnswer);
  await clickButton(page, "Use for defaults");
  await waitForText(page, "HERE IS WHAT I UNDERSTOOD");
  await clickButton(page, "Finish setup");

  await page.waitForFunction(`
    !document.querySelector(".kp-conversation-canvas") &&
      window.Store &&
      window.Store.getPref("setupHelperCompleteV1", false) === true
  `, { timeout: 30000 });

  await waitForText(page, "Was setup useful?");
  await clickButton(page, String(sentimentRating));
  await page.waitForFunction(`
    window.Store &&
      !!window.Store.getPref("onboardingSentimentV1", null) &&
      window.Store.getPref("onboardingMetricsSummaryV1", {}).sentimentResponses >= 1
  `, { timeout: 30000 });

  const result = await page.evaluate(`
    (() => {
      const Store = window.Store;
      return {
        setupOpen: !!document.querySelector(".kp-conversation-canvas"),
        complete: Store.getPref("setupHelperCompleteV1", false),
        firstValue: Store.getPref("onboardingFirstValueEventV1", null),
        transcript: Store.getPref("onboardingSetupTranscriptV1", null),
        handoff: Store.getPref("onboardingAssistantHandoffV1", null),
        sentiment: Store.getPref("onboardingSentimentV1", null),
        metricsSummary: Store.getPref("onboardingMetricsSummaryV1", null),
        desk: Store.getDesk(),
      };
    })()
  `) as OnboardingUiProofResult;

  assert(result.setupOpen === false, "Setup canvas did not close after activation.");
  assert(result.complete === true, "Completion preference was not saved.");
  assert(result.firstValue?.complete === true, "First-value activation was not completed.");
  assert(result.firstValue?.campaignName === focusName, "First-value campaign name was not persisted.");
  assert(
    result.transcript?.complete === true,
    "Setup transcript did not mark required slots complete.\n" + JSON.stringify({
      progress: result.transcript?.progress,
      turns: result.transcript?.turns,
    }, null, 2),
  );
  assert(Array.isArray(result.transcript?.turns), "Setup transcript turns were not persisted.");
  assert(
    result.transcript.turns.some((turn) =>
      turn.role === "user" &&
      turn.slotId === "communication_platforms" &&
      turn.inputMethod === "typed" &&
      turn.text === focusName,
    ),
    "Focus answer was not captured as a typed communication-platform setup turn.",
  );
  assert(
    result.transcript.turns.some((turn) =>
      turn.role === "user" &&
      turn.slotId === "voice_profile" &&
      turn.inputMethod === "typed" &&
      turn.text === voiceAnswer,
    ),
    "Voice/preference answer was not captured as a typed setup turn.",
  );
  assert(result.handoff?.deskThreadId, "Assistant handoff did not persist a Desk thread id.");
  assert(result.desk?.activeId === result.handoff.deskThreadId, "Handoff Desk thread is not active.");
  assert(result.desk?.threads?.[0]?.source === "kings_press_setup", "Handoff thread source is not King's Press setup.");
  assert(result.sentiment?.rating === sentimentRating, "Setup sentiment rating was not persisted.");
  assert((result.metricsSummary?.sentimentResponses || 0) >= 1, "Setup sentiment metric was not counted.");
  assert(result.metricsSummary?.averageSentiment === sentimentRating, "Setup sentiment average was not updated.");
  assert(result.metricsSummary?.latestEventType === "sentiment_submitted", "Latest onboarding metric was not the submitted sentiment.");

  return result;
}
