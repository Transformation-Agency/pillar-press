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
    providerReady?: boolean;
    nextAssistantMode?: string;
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
    threads?: Array<{
      source?: string;
      messages?: Array<{
        role?: string;
        content?: string;
      }>;
    }>;
  };
};

export type OnboardingUiProofOptions = {
  focusName?: string;
  focusAnswer?: string;
  expectedCampaignName?: string;
  voiceAnswer?: string;
  answerInputMethod?: "typed" | "voice";
  expectProviderReady?: boolean;
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

function trace(message: string) {
  if (process.env.KP_ONBOARDING_PROOF_DEBUG) console.log(`[onboarding-proof] ${message}`);
}

async function clickButton(page: Page, label: string) {
  trace(`click ${label}`);
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
  trace(`type ${selector}`);
  await page.evaluate(
    ({ selector, value }) => {
      const input = document.querySelector(selector);
      if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) {
        throw new Error("Missing input: " + selector);
      }
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set;
      input.focus();
      if (setter) setter.call(input, value);
      else input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    },
    { selector, value },
  );
}

async function typeIntoFirstTextarea(page: Page, value: string) {
  trace("type first textarea");
  await page.evaluate((value) => {
    const area = document.querySelector("textarea");
    if (!(area instanceof HTMLTextAreaElement)) {
      throw new Error("No textarea was available for setup answer entry.");
    }
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(area), "value")?.set;
    area.focus();
    if (setter) setter.call(area, value);
    else area.value = value;
    area.dispatchEvent(new Event("input", { bubbles: true }));
    area.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

async function waitForText(page: Page, text: string) {
  trace(`wait text ${text}`);
  const startedAt = Date.now();
  let body = "";
  let lastError: unknown = null;
  while (Date.now() - startedAt < 30000) {
    try {
      body = await page.evaluate(() => document.body.innerText) as string;
      if (body.includes(text)) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Timed out waiting for text: " + text + "\n\nCurrent page text:\n" + body.slice(0, 4000), { cause: lastError });
}

async function waitForPageState(page: Page, predicate: () => boolean, message: string) {
  const startedAt = Date.now();
  let lastError: unknown = null;
  while (Date.now() - startedAt < 30000) {
    try {
      if (await page.evaluate(predicate)) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(message, { cause: lastError });
}

async function installSpeechRecognitionMock(page: Page, transcripts: string[]) {
  await page.evaluate(`
    (() => {
      window.__kpSpeechRecognitionQueue = ${JSON.stringify(transcripts)}.slice();
      function MockSpeechRecognition() {
        this.continuous = false;
        this.interimResults = false;
        this.lang = "en-US";
        this.onresult = null;
        this.onerror = null;
        this.onend = null;
      }
      MockSpeechRecognition.prototype.start = function () {
        const queue = window.__kpSpeechRecognitionQueue || [];
        const transcript = queue.shift() || "";
        window.__kpSpeechRecognitionQueue = queue;
        setTimeout(() => {
          if (transcript && this.onresult) {
            this.onresult({ results: [[{ transcript }]] });
          }
          if (this.onend) this.onend();
        }, 20);
      };
      MockSpeechRecognition.prototype.stop = function () {
        if (this.onend) this.onend();
      };
      window.SpeechRecognition = MockSpeechRecognition;
      window.webkitSpeechRecognition = MockSpeechRecognition;
    })()
  `);
}

export async function driveOnboardingUiProof(page: Page, options?: OnboardingUiProofOptions): Promise<OnboardingUiProofResult> {
  trace("start");
  const focusName = options?.focusName || DEFAULT_ONBOARDING_UI_PROOF.focusName;
  const focusAnswer = options?.focusAnswer || focusName;
  const voiceAnswer = options?.voiceAnswer || DEFAULT_ONBOARDING_UI_PROOF.voiceAnswer;
  const answerInputMethod = options?.answerInputMethod || "typed";
  const expectProviderReady = options?.expectProviderReady === true;
  const expectedCampaignName = options?.expectedCampaignName || focusName;
  const sentimentRating = Math.max(1, Math.min(5, Math.round(Number(options?.sentimentRating || 5))));

  // The desktop bundle still uses in-browser Babel. Polling the page while Babel is
  // compiling can wedge Chromium protocol calls on slower machines, so give the
  // shell a short grace period before the readiness assertion.
  await new Promise((resolve) => setTimeout(resolve, 5000));
  trace("assert setup ready");
  const setupReady = await page.evaluate(() => {
    const canvas = document.querySelector(".kp-conversation-canvas");
    if (!canvas) return false;
    const rect = canvas.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && document.body.innerText.includes("Would you like a guided intro");
  });
  assert(setupReady, "Setup conversation canvas did not become visible.");
  if (options?.requireNoStepper !== false) {
    assert(
      await page.$("nav[aria-label='Setup progress']") === null,
      "Setup stepper is still visible; expected one continuous conversation canvas.",
    );
  }
  await waitForText(page, "Mute");
  await clickButton(page, "Mute");
  await waitForText(page, "Muted");
  await waitForText(page, "Would you like a guided intro");

  await clickButton(page, "Yes, guide me");
  await waitForText(page, "Can I help you set up voice?");
  await clickButton(page, "Skip voice");

  await waitForText(page, "AI & models");
  await clickButton(page, "Continue");

  await waitForText(page, "First project or campaign name");
  if (answerInputMethod === "voice") {
    await installSpeechRecognitionMock(page, [focusAnswer, voiceAnswer]);
    await clickButton(page, "Speak answer");
    await waitForText(page, "I heard: " + focusAnswer);
    await waitForText(page, focusAnswer);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await page.waitForFunction(`
      Array.from(document.querySelectorAll("input"))
        .some((input) => input.placeholder === "e.g. Smoke Test" && input.value.trim().length > 0)
    `, { timeout: 30000 });
  } else {
    await typeInto(page, "input[placeholder='e.g. Smoke Test']", focusName);
  }
  await clickButton(page, "Continue");

  await waitForText(page, "Tell me how this desk should sound for you.");
  if (answerInputMethod === "voice") {
    await clickButton(page, "Speak answer");
    await waitForText(page, "I heard: " + voiceAnswer);
    await new Promise((resolve) => setTimeout(resolve, 100));
  } else {
    await typeIntoFirstTextarea(page, voiceAnswer);
    await clickButton(page, "Use for defaults");
  }
  await waitForText(page, "HERE IS WHAT I UNDERSTOOD");
  await clickButton(page, "Finish setup");

  await waitForPageState(
    page,
    () => {
      const Store = (window as any).Store;
      return !document.querySelector(".kp-conversation-canvas") &&
        Boolean(Store) &&
        Store.getPref("setupHelperCompleteV1", false) === true;
    },
    "Setup did not close after activation.",
  );

  await waitForText(page, "Was setup useful?");
  await clickButton(page, String(sentimentRating));
  await waitForPageState(
    page,
    () => {
      const Store = (window as any).Store;
      return Boolean(Store) &&
        !!Store.getPref("onboardingSentimentV1", null) &&
        Store.getPref("onboardingMetricsSummaryV1", {}).sentimentResponses >= 1;
    },
    "Setup sentiment was not persisted.",
  );

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
  assert(result.firstValue?.campaignName === expectedCampaignName, "First-value campaign name was not persisted.");
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
      turn.inputMethod === answerInputMethod &&
      turn.text === focusAnswer,
    ),
    "Focus answer was not captured as a " + answerInputMethod + " communication-platform setup turn.\n" +
      JSON.stringify(result.transcript.turns, null, 2),
  );
  assert(
    result.transcript.turns.some((turn) =>
      turn.role === "user" &&
      turn.slotId === "voice_profile" &&
      turn.inputMethod === answerInputMethod &&
      turn.text === voiceAnswer,
    ),
    "Voice/preference answer was not captured as a " + answerInputMethod + " setup turn.",
  );
  assert(result.handoff?.deskThreadId, "Assistant handoff did not persist a Desk thread id.");
  assert(result.desk?.activeId === result.handoff.deskThreadId, "Handoff Desk thread is not active.");
  assert(result.desk?.threads?.[0]?.source === "pillar_press_setup", "Handoff thread source is not Pillar Press setup.");
  if (expectProviderReady) {
    assert(result.handoff.providerReady === true, "Provider-ready handoff was not persisted.");
    assert(result.handoff.nextAssistantMode === "live_assistant_ready", "Provider-ready setup did not hand off to live assistant mode.");
    assert(
      result.desk?.threads?.[0] &&
        Array.isArray(result.desk.threads[0].messages) &&
        result.desk.threads[0].messages.some((message) =>
          message.role === "assistant" &&
          /Setup is ready/.test(String(message.content || "")),
        ),
      "Provider-ready handoff thread did not include the live assistant ready message.",
    );
  }
  assert(result.sentiment?.rating === sentimentRating, "Setup sentiment rating was not persisted.");
  assert((result.metricsSummary?.sentimentResponses || 0) >= 1, "Setup sentiment metric was not counted.");
  assert(result.metricsSummary?.averageSentiment === sentimentRating, "Setup sentiment average was not updated.");
  assert(result.metricsSummary?.latestEventType === "sentiment_submitted", "Latest onboarding metric was not the submitted sentiment.");

  return result;
}
