import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import {
  DEFAULT_ONBOARDING_UI_PROOF,
  driveOnboardingUiProof,
} from "./onboarding-ui-proof";
import { launchProofBrowser } from "./puppeteer-launch";

const root = process.cwd();
const publicDir = join(root, "public");
const focusName = DEFAULT_ONBOARDING_UI_PROOF.focusName;
const voiceAnswer = DEFAULT_ONBOARDING_UI_PROOF.voiceAnswer;

type Campaign = { id: string; name: string; slug: string; references?: Record<string, unknown> };

type TestState = {
  campaigns: Campaign[];
  refs: Map<string, Record<string, unknown>>;
  prefs: Record<string, unknown>;
  desk: { threads: unknown[]; activeId: string | null };
  pieces: unknown[];
  gatherSources: unknown[];
  gatherItems: unknown[];
  media: unknown[];
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function contentType(filePath: string) {
  const ext = extname(filePath);
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js" || ext === ".jsx") return "application/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".png") return "image/png";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".ico") return "image/x-icon";
  if (ext === ".woff2") return "font/woff2";
  return "application/octet-stream";
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

function referencesSkeleton() {
  return {
    strategy: { throughlines: [], body: "" },
    audiences: { list: [] },
    registers: { list: [], body: "" },
    voiceRules: { rules: [] },
    redLines: { rules: [] },
    selfVision: { body: "" },
    gateSpec: { body: "" },
  };
}

function slugFor(name: string) {
  return String(name || "untitled-focus")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "untitled-focus";
}

function createApiState(): TestState {
  return {
    campaigns: [],
    refs: new Map(),
    prefs: {},
    desk: { threads: [], activeId: null },
    pieces: [],
    gatherSources: [],
    gatherItems: [],
    media: [],
  };
}

async function handleApi(req: IncomingMessage, res: ServerResponse, state: TestState, url: URL) {
  const method = req.method || "GET";
  const path = url.pathname.replace(/^\/api/, "") || "/";

  if (method === "GET" && path === "/campaigns") {
    return sendJson(res, 200, { campaigns: state.campaigns });
  }

  if (method === "POST" && path === "/campaigns") {
    const body = await readBody(req);
    const name = String((body as any).name || "Untitled focus").trim() || "Untitled focus";
    const campaign = {
      id: "campaign_" + String(state.campaigns.length + 1),
      name,
      slug: slugFor(name),
    };
    state.campaigns.push(campaign);
    state.refs.set(campaign.id, referencesSkeleton());
    state.prefs.activeCampaignId = campaign.id;
    return sendJson(res, 200, { campaign });
  }

  const referencesMatch = path.match(/^\/campaigns\/([^/]+)\/references$/);
  if (referencesMatch && method === "GET") {
    const campaignId = decodeURIComponent(referencesMatch[1]);
    const doc = state.refs.get(campaignId) || referencesSkeleton();
    state.refs.set(campaignId, doc);
    return sendJson(res, 200, { references: { id: "refs_" + campaignId, campaignId, doc } });
  }

  if (referencesMatch && method === "PUT") {
    const campaignId = decodeURIComponent(referencesMatch[1]);
    const body = await readBody(req);
    const current = state.refs.get(campaignId) || referencesSkeleton();
    const doc = Object.assign({}, current, (body as any).patch || {});
    state.refs.set(campaignId, doc);
    return sendJson(res, 200, { references: { id: "refs_" + campaignId, campaignId, doc } });
  }

  const piecesMatch = path.match(/^\/campaigns\/([^/]+)\/pieces$/);
  if (piecesMatch && method === "GET") return sendJson(res, 200, { pieces: state.pieces });
  if (piecesMatch && method === "POST") {
    const body = await readBody(req);
    const campaignId = decodeURIComponent(piecesMatch[1]);
    const piece = {
      id: "piece_" + String(state.pieces.length + 1),
      campaignId,
      title: (body as any).title || "Untitled piece",
      original: (body as any).original || "",
      status: "Draft",
    };
    state.pieces.push(piece);
    return sendJson(res, 200, { piece });
  }

  if (path === "/settings" && method === "GET") {
    return sendJson(res, 200, { settings: { prefs: state.prefs } });
  }

  if (path === "/settings" && method === "PUT") {
    const body = await readBody(req);
    state.prefs = Object.assign({}, state.prefs, (body as any).prefs || {});
    return sendJson(res, 200, { settings: { prefs: state.prefs } });
  }

  if (path === "/desk/session" && method === "GET") {
    return sendJson(res, 200, { session: { state: state.desk } });
  }

  if (path === "/desk/session" && method === "PUT") {
    const body = await readBody(req);
    state.desk = Object.assign({ threads: [], activeId: null }, (body as any).state || {});
    return sendJson(res, 200, { session: { state: state.desk } });
  }

  if (path === "/onboarding/extract-setup-profile" && method === "POST") {
    await readBody(req);
    return sendJson(res, 200, {
      profileDraft: {
        version: "browser-shell-proof",
        brand: "pillar_press",
        sourceTranscript: voiceAnswer,
        communicationPlatforms: [
          { platform: focusName, priority: "primary", notes: "Mentioned during setup." },
        ],
        writingHelpFirst: "",
        voiceProfile: {
          userDescription: voiceAnswer,
          toneWords: ["plainspoken", "useful"],
          avoid: [],
          examplesPermission: "not_asked",
          memoryPermission: "not_asked",
        },
        publicationDefaults: {
          defaultOutputTypes: ["custom"],
          preserveRawLanguage: "polish_lightly",
          humanReviewRequired: true,
        },
        permissions: {
          mayUseSavedMemory: false,
          mayUseUploadedVoiceExamples: false,
          mayUseWebResearch: false,
          mayPublishOrSend: false,
        },
      },
      requiresUserApproval: true,
    });
  }

  if (path === "/llm/status" && method === "GET") {
    return sendJson(res, 200, {
      provider: "ollama",
      model: "local-proof-model",
      fileProvider: "anthropic",
      fileModel: "claude-haiku-4-5",
      capabilities: ["text"],
    });
  }

  if (path === "/llm/models" && method === "GET") {
    return sendJson(res, 200, { models: [{ id: "local-proof-model", name: "local-proof-model" }] });
  }

  if (path === "/media/providers" && method === "GET") {
    return sendJson(res, 200, {
      providers: [
        { id: "openai", label: "OpenAI", configured: false, capabilities: ["voice", "image"] },
        { id: "elevenlabs", label: "ElevenLabs", configured: false, capabilities: ["voice"] },
        { id: "hedra", label: "Hedra", configured: false, capabilities: ["video"] },
      ],
    });
  }

  if (path === "/media" && method === "GET") return sendJson(res, 200, { media: state.media });
  if (path === "/gather/sources" && method === "GET") return sendJson(res, 200, { sources: state.gatherSources });
  if (path === "/gather/items" && method === "GET") return sendJson(res, 200, { items: state.gatherItems });
  if (path === "/gather/schedules" && method === "GET") return sendJson(res, 200, { schedules: [] });
  if (path === "/drive/status" && method === "GET") return sendJson(res, 200, { connected: false });
  if (path === "/eleven/voices" && method === "GET") return sendJson(res, 200, { voices: [] });
  if (path === "/hedra/models" && method === "GET") return sendJson(res, 200, { models: [] });
  if (path === "/hedra/credits" && method === "GET") return sendJson(res, 200, { credits: null, configured: false });

  return sendJson(res, 200, {});
}

async function serveStatic(res: ServerResponse, url: URL) {
  const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const filePath = normalize(join(publicDir, pathname));
  if (!filePath.startsWith(publicDir) || !existsSync(filePath)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  const body = await readFile(filePath);
  res.writeHead(200, {
    "content-type": contentType(filePath),
    "cache-control": "no-store",
  });
  res.end(body);
}

async function startServer(state: TestState) {
  const server = createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    Promise.resolve()
      .then(() => {
        if (url.pathname.startsWith("/api/")) return handleApi(req, res, state, url);
        return serveStatic(res, url);
      })
      .catch((error) => {
        sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
      });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object", "Could not start browser-shell test server.");
  return {
    url: "http://127.0.0.1:" + address.port + "/",
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function runBrowserShellProof() {
  const browser = await launchProofBrowser();
  const scenarios = [
    {
      id: "typed",
      state: createApiState(),
      options: {
        expectProviderReady: true,
      },
    },
    {
      id: "voice",
      state: createApiState(),
      options: {
        answerInputMethod: "voice" as const,
        focusAnswer: "Substack and book chapters",
        expectedCampaignName: "Substack focus",
        voiceAnswer: "I write for operators. Keep it spoken, direct, and useful.",
        sentimentRating: 4,
        expectProviderReady: true,
      },
    },
  ];
  const results: unknown[] = [];

  try {
    for (const scenario of scenarios) {
      const server = await startServer(scenario.state);
      const pageErrors: string[] = [];
      const page = await browser.newPage();
      try {
        page.on("pageerror", (error) => {
          pageErrors.push(error instanceof Error ? error.message : String(error));
        });
        page.on("console", (message) => {
          if (message.type() === "error") pageErrors.push(message.text());
        });
        await page.setViewport({ width: 1280, height: 900 });
        await page.goto(server.url, { waitUntil: "domcontentloaded" });

        const result = await driveOnboardingUiProof(page, scenario.options);
        assert(pageErrors.length === 0, "Browser shell logged errors in " + scenario.id + " scenario:\n" + pageErrors.join("\n"));
        results.push({
          id: scenario.id,
          url: server.url,
          campaignName: result.firstValue?.campaignName,
          transcriptTurns: result.transcript?.turns?.length || 0,
          deskThreadId: result.handoff?.deskThreadId,
          nextAssistantMode: result.handoff?.nextAssistantMode,
          sentimentRating: result.sentiment?.rating,
        });
      } finally {
        await page.close();
        await server.close();
      }
    }

    console.log("ok onboarding browser shell proof");
    console.log(JSON.stringify({ scenarios: results }, null, 2));
  } finally {
    await browser.close();
  }
}

await runBrowserShellProof();
