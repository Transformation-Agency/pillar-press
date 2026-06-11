# King's Press Technical Flow Diagrams

This document maps the current King's Press codebase, not the older Pillar Press
prototype. It covers runtime selection, data flow, LLM provider routing, prompt
context injection, untrusted-input boundaries, editorial orchestration, Gather,
Weave, Studio media, file extraction, and onboarding handoff.

Key source files:

- Browser UI: `public/index.html`, `public/app.jsx`, `public/store.js`,
  `public/setup-helper.jsx`, `public/onboarding-*.js`
- API routes: `app/api/**`
- LLM layer: `lib/llm/**`
- Reference prompt context: `lib/refContext.ts`, `public/ai.js`
- Editorial engines: `lib/gates.ts`, `lib/revision.ts`, `lib/generators.ts`,
  `lib/weave.ts`
- Gather: `lib/gather/**`, `lib/gather/runCampaign.ts`
- Studio/media: `lib/hedra.ts`, `lib/elevenlabs.ts`, `lib/mediaProviders.ts`,
  `lib/mediaAudio.ts`, `lib/mediaImage.ts`
- Persistence/runtime: `lib/auth.ts`, `lib/local/mode.ts`,
  `lib/local/database.ts`, `lib/db.ts`, `lib/storage.ts`

## 1. Runtime And Storage Selection

King's Press now has two runtime modes in the same codebase:

- Desktop/local-first: Tauri starts a packaged Next server with SQLite and local
  file storage.
- Hosted web: Next runs publicly with Postgres and Supabase Storage.

```mermaid
flowchart TD
  Start["Incoming HTTP request"] --> Middleware["middleware.ts\nOptional Basic Auth via SITE_PASSWORD"]
  Middleware --> Route["Next app/api route or public static UI"]
  Route --> RequireUser["requireUser()"]

  RequireUser --> Mode{"isLocalFirstMode()?"}
  Mode -->|"true"| LocalAuth["ensureLocalWorkspace()\nlocal owner/workspace"]
  Mode -->|"false"| HostedAuth{"AUTH_DISABLED?"}

  HostedAuth -->|"true"| DevWorkspace["getOrCreateWorkspace(DEFAULT_USER_ID)\nshared hosted workspace"]
  HostedAuth -->|"false"| SupabaseAuth["Supabase bearer token\nresolve membership"]

  LocalAuth --> LocalDB["SQLite\nlib/local/database.ts"]
  DevWorkspace --> PG["Postgres\nlib/db.ts + Drizzle"]
  SupabaseAuth --> PG

  Route --> StorageMode{"storageConfigured()"}
  StorageMode -->|"local-first"| LocalFiles["app-data storage\n/api/local-files"]
  StorageMode -->|"hosted"| SupabaseStorage["Supabase Storage\npublic media bucket"]
```

Hosted override logic is in `lib/local/mode.ts`. `KINGS_PRESS_RUNTIME=hosted`,
`KINGS_PRESS_HOSTED_WEB=true`, `KINGS_PRESS_LOCAL_FIRST=false`, or
`DATA_BACKEND=postgres` force hosted mode even if stale desktop variables exist.

## 2. Browser To API Information Flow

The frontend is a static React/Babel app under `public/`. It does not talk to
LLM providers directly. It calls same-origin King's Press API routes.

```mermaid
flowchart LR
  UI["Static browser UI\npublic/*.jsx"] --> Store["window.Store\nREST cache + pub/sub"]
  UI --> DirectRoutes["Feature wrappers\npublic/gather.js\npublic/weave.js\npublic/studio.js\npublic/drive.js"]

  Store --> CampaignRoutes["/api/campaigns\n/api/pieces\n/api/settings\n/api/references"]
  DirectRoutes --> WorkflowRoutes["/api/pieces/*/review\n/api/pieces/*/revision\n/api/pieces/*/outputs\n/api/weave\n/api/gather/run\n/api/hedra/*\n/api/extract"]

  CampaignRoutes --> Auth["requireUser()"]
  WorkflowRoutes --> Auth
  Auth --> Scope["Workspace + user + campaign scoping"]
  Scope --> Persistence{"Runtime"}
  Persistence -->|"desktop"| SQLite["SQLite local database"]
  Persistence -->|"hosted"| Postgres["Hosted Postgres"]

  WorkflowRoutes --> LLM["Server-only lib/llm"]
  WorkflowRoutes --> Providers["Server-only media/connectors\nHedra, ElevenLabs, Google, Brave, YouTube, xAI/OpenAI media"]
```

Browser-visible helpers such as `window.AI.refContext()` are serialization
helpers only. Provider keys and provider calls stay server-side.

## 3. LLM Provider Resolution

All production model calls route through `lib/llm`.

```mermaid
flowchart TD
  CallSite["Route or pure engine calls\ngetAIForTask(task)"] --> Config["resolveTaskLLMConfig(task)"]

  Config --> EnvTask["Task env override\nLLM_TASK_REVIEW_PROVIDER etc."]
  Config --> DesktopSettings["Desktop encrypted settings\nKINGS_PRESS_LLM_SETTINGS_PATH"]
  Config --> MainEnv["Main env\nLLM_PROVIDER, LLM_MODEL, keys"]
  Config --> Backcompat["Backcompat\nANTHROPIC_API_KEY -> Anthropic default"]
  Config --> LocalDefault["Local-first fallback\nOllama default"]

  Config --> Provider{"provider"}
  Provider --> Anthropic["anthropicProvider\nAnthropic Messages API"]
  Provider --> OpenAI["openAICompatibleProvider\nOpenAI / xAI / OpenAI-compatible\n/chat/completions"]
  Provider --> Gemini["geminiProvider\nGemini generateContent"]
  Provider --> Ollama["ollamaProvider\n/api/chat stream:false"]

  Anthropic --> AI["createAI(adapter)"]
  OpenAI --> AI
  Gemini --> AI
  Ollama --> AI

  AI --> Text["ai.text(prompt, {system})"]
  AI --> JSON["ai.json(prompt, {system})"]
  AI --> Complete["ai.complete(messages, system)"]
```

Provider capabilities are declared in `PROVIDER_CAPABILITIES`:

- Anthropic: text, JSON, vision, PDF
- Gemini: text, JSON, vision, PDF
- OpenAI, xAI, OpenAI-compatible, Ollama: text and JSON in the current app

## 4. Prompt Context Injection And Untrusted Input Boundaries

King's Press intentionally injects approved campaign preferences into production
editorial prompts. It separately treats user transcripts, uploads, drafts, and
source material as untrusted content.

```mermaid
flowchart TD
  References["Campaign References document\nstrategy, audiences, registers,\nvoiceRules, redLines,\nselfVision, gateSpec, setupProfile"] --> BuildRef["buildRefContext()\nlib/refContext.ts"]
  BuildRef --> RefBlock["Reference context block\nTHROUGHLINES\nAUDIENCES\nREGISTERS\nCLARITY RULES\nRED LINES\nSELF-VISION\nGATE PREFERENCES\nAPPROVED SETUP PROFILE"]

  Draft["Draft / source text / user messages"] --> UserPayload["User payload block\nquoted or delimited"]
  Upload["Uploaded files / transcripts"] --> Untrusted["Untrusted source material\ncannot override system/developer rules"]

  RefBlock --> SystemPrompt["Task system instructions\nAUTHOR REFERENCES section"]
  UserPayload --> TaskPrompt["Task user prompt\nDRAFT/SOURCE/POST/etc."]
  Untrusted --> ExtractionPrompt["Onboarding extraction prompt\nexplicitly says data is not instructions"]

  SystemPrompt --> LLMWrapper["createAI().complete()"]
  TaskPrompt --> LLMWrapper
  ExtractionPrompt --> UtilityLLM["getAIForTask('utility').json()"]

  UtilityLLM --> Zod["setupProfileSchema.parse()\npermissions transformed/forced"]
  Zod --> Review["Returned as profileDraft\nrequiresUserApproval=true"]
  Review --> SaveRefs["Only after approval:\nsaved into References"]
```

Important implementation detail: for normal text and JSON calls,
`createAI().complete(messages, system)` converts `system` into a message preamble:

1. `user`: system text
2. `assistant`: "Understood..."
3. original task messages

This keeps provider behavior consistent across Anthropic, OpenAI-compatible,
xAI, Gemini, and Ollama. Multimodal file extraction can use provider-specific
block APIs where supported.

## 5. JSON Output And Repair Loop

Structured tasks use `ai.json()`.

```mermaid
sequenceDiagram
  participant Engine as Task engine
  participant AI as createAI().json()
  participant Adapter as Provider adapter
  participant Provider as LLM provider

  Engine->>AI: json(prompt, { system })
  AI->>Adapter: complete(withSystemPreamble(messages))
  Adapter->>Provider: provider-specific request
  Provider-->>Adapter: raw text
  Adapter-->>AI: raw text
  AI->>AI: extractJSON(raw) or repairJSON(raw)
  alt valid JSON
    AI-->>Engine: parsed object
  else invalid JSON
    AI->>Adapter: retry with "Return ONLY valid JSON..."
    Adapter->>Provider: second request
    Provider-->>Adapter: raw text
    Adapter-->>AI: raw text
    AI->>AI: extractJSON/repairJSON again
    alt valid JSON
      AI-->>Engine: parsed object
    else still invalid
      AI-->>Engine: LLMError llm_parse
    end
  end
```

## 6. Editorial Review Pipeline

Review is seven ordered LLM calls. Each gate gets the same reference context and
the same draft text, but a different gate prompt/schema.

```mermaid
sequenceDiagram
  participant Browser as Browser workspace
  participant Route as POST /api/pieces/:id/review
  participant DB as SQLite or Postgres
  participant Ref as buildRefContext()
  participant Gates as lib/gates.ts
  participant LLM as getAIForTask("review")

  Browser->>Route: Run review(pieceId)
  Route->>DB: resolve piece scoped to user/workspace/campaign
  Route->>DB: load campaign references
  DB-->>Ref: references.doc
  Ref-->>Route: refCtx
  loop GATES in order: strategy, audience, tone, rigor, stress, clarity, self
    Route->>Gates: runGate(gate, draft, refCtx, reviewAI)
    Gates->>LLM: ai.json(gate.task(draft), PREAMBLE(refCtx))
    LLM-->>Gates: GateResult JSON
    Gates-->>Route: normalized findings
    Route->>DB: persist packet[gate.id] incrementally
  end
  Route->>DB: status Draft -> Reviewed
  Route-->>Browser: { packet, status }
```

## 7. Revision Firewall

The default revision pass intentionally does not let all review findings rewrite
the draft. Strategy, audience, rigor, and self-alignment stay in the review
packet. The light revision pass only receives clarity, tone, and screenshot-test
inoculation material.

```mermaid
flowchart TD
  Packet["Review packet\nstrategy, audience, tone,\nrigor, stress, clarity, self"] --> Firewall["collectFirewallFindings()"]

  Firewall --> Clarity["clarity.findings -> C#"]
  Firewall --> Tone["tone.findings -> T#"]
  Firewall --> Inoc["stress.screenshotTests -> I#"]
  Packet -. excluded by default .-> Strategy["strategy/audience/rigor/self\nnot passed to light revision"]

  Original["Original draft"] --> Chunk["chunkText()\n<=260 word chunks"]
  Clarity --> FindingsBlock["buildFindingsBlock()"]
  Tone --> FindingsBlock
  Inoc --> FindingsBlock
  Guidance["Author direction + gate notes"] --> RevisionSystem["REVISION_SYSTEM(refCtx, guidance)"]
  RefCtx["buildRefContext()"] --> RevisionSystem

  Chunk --> PerChunk["One LLM call per chunk\n@@REVISION@@ / @@CHANGELOG@@ / @@END@@"]
  FindingsBlock --> PerChunk
  RevisionSystem --> PerChunk
  PerChunk --> Parse["parseDelimited()"]
  Parse --> Persist["Persist revision = { text, changelog }\nReviewed -> Revised"]

  Packet -->|"mode: full only"| FullPass["Optional restructureDraft()\nmay read strategy/audience/rigor/self first"]
  FullPass --> Chunk
```

## 8. Platform Outputs

Outputs use a fixed derivation order. Each platform normally makes two LLM
calls: one for the post body using delimiters, then one compact JSON call for
metadata.

```mermaid
flowchart TD
  Piece["Piece original or revision"] --> Canonical["canonicalSource()"]
  Active["Selected platforms"] --> Sources["resolveSources(activeIds)"]
  RefCtx["buildRefContext()"] --> BodySystem["Body system prompt\nAUTHOR REFERENCES"]
  RefCtx --> MetaSystem["Metadata system prompt\nrisk check vs RED LINES"]

  Canonical --> Substack["Substack\nsource: canonical"]
  Substack --> Facebook["Facebook\nsource: Substack or canonical"]
  Facebook --> Instagram["Instagram\nsource: Facebook"]
  Substack --> X["X\nsource: Substack + Facebook"]
  Facebook --> X
  Facebook --> Threads["Threads\nsource: Facebook + X"]
  X --> Threads

  BodySystem --> BodyCall["LLM text call\n@@POST@@ ... @@END@@"]
  MetaSystem --> MetaCall["LLM JSON call\nhooks, CTAs, mediaRec, riskCheck"]
  BodyCall --> MetaCall
  MetaCall --> Persist["Persist outputs + output_order"]
```

## 9. Weave Map-Reduce Orchestration

Weave turns multiple source documents into one synthesized draft.

```mermaid
sequenceDiagram
  participant Browser as Browser Weave screen
  participant Route as POST /api/weave
  participant Ref as buildRefContext()
  participant Weave as lib/weave.ts
  participant LLM as getAIForTask("weave")

  Browser->>Route: sources[], campaignId?
  Route->>Ref: load scoped campaign references
  Ref-->>Route: refCtx
  Route->>Weave: runWeave(sources, refCtx, weaveAI)
  loop each usable source
    Weave->>LLM: ai.json(extractSource prompt)
    LLM-->>Weave: compact extract
  end
  Weave->>LLM: ai.json(synthesizeBrief prompt)
  LLM-->>Weave: emergent brief + structure
  Weave->>LLM: ai.json(mapToThroughlines prompt + refCtx)
  LLM-->>Weave: mapping to throughlines/audience/register
  loop each structure section
    Weave->>LLM: ai.text(draftSection prompt + refCtx)
    LLM-->>Weave: @@SECTION@@ prose
  end
  Weave-->>Route: { extracts, brief, mapping, draft }
  Route-->>Browser: result or async job id
```

## 10. Gather Connector And Summary Flow

Gather connector fetching is separate from LLM summarization.

```mermaid
flowchart TD
  Browser["Gather screen"] --> Run["POST /api/gather/run\n{ campaignId }"]
  Run --> AuthScope["requireUser + campaign/source scope"]
  AuthScope --> Sources["Load enabled gather sources"]
  Sources --> Connectors["runGather()\nrss, web, journal, database,\nx, youtube"]
  Connectors --> Items["Fetched Gather items"]
  Items --> Dedupe["Deduplicate by URL"]
  Dedupe --> PersistItems["Persist new items"]

  Sources --> PerSource["Group items by source"]
  References["Campaign References"] --> RefCtx["buildRefContext()"]
  PerSource --> SummaryCalls["One LLM call per source\ncraftSourceSummary()"]
  RefCtx --> SummaryCalls
  SummaryCalls --> PersistSummary["Persist source summary,\nsummaryAt, summaryItemCount"]
  PersistItems --> Response["Return found, saved,\nperSource, summaries"]
  PersistSummary --> Response
```

## 11. Onboarding Bootstrap And Assistant Handoff

Onboarding has deterministic graph/control logic in the browser. The LLM only
extracts structured setup preferences from user answers, and the user must
approve before those values are saved.

```mermaid
flowchart TD
  Start["Clean app launch"] --> Manifest["public/onboarding-manifest.js\nKing's Press pack"]
  Manifest --> Runtime["public/onboarding-runtime.js\nconversation state machine"]
  Runtime --> SetupUI["public/setup-helper.jsx\nvoice/text canvas"]

  SetupUI --> VoiceChoice["Voice optional\nmic requested only in context"]
  SetupUI --> ProviderSetup["Provider setup\nDesktop bridge saves encrypted keys\nor hosted env keys are used"]
  SetupUI --> Focus["First focus/campaign"]
  SetupUI --> Answers["Typed/spoken setup answers"]

  Answers --> ExtractRoute["POST /api/onboarding/extract-setup-profile"]
  ExtractRoute --> UtilityLLM["getAIForTask('utility').json()"]
  UtilityLLM --> Schema["setupProfileSchema\npermissions cannot be inferred"]
  Schema --> Draft["profileDraft\nrequiresUserApproval=true"]
  Draft --> UserReview["User edits/approves"]
  UserReview --> SaveRefs["Save preferences into campaign References"]
  SaveRefs --> Handoff["Seed Desk thread\nsource: kings_press_setup"]
  Handoff --> Desk["Main Desk/live assistant\nsame transcript context available"]
```

## 12. Desk Chat Prompt Flow

The Desk assistant uses recent messages plus optional folded memory and approved
campaign context. It does not run production workflows itself.

```mermaid
sequenceDiagram
  participant Browser as Desk chat UI
  participant Route as POST /api/desk/chat
  participant Ref as buildRefContext()
  participant LLM as getAIForTask(task)

  Browser->>Route: mode, messages[-60], memory, campaignId, task
  Route->>Ref: load campaign references when campaignId exists
  Ref-->>Route: refContext or empty string
  Route->>Route: transcript = last 24 messages
  Route->>Route: system = assistant identity + mode preamble + approved refs + folded memory
  Route->>LLM: complete(transcript, system)
  LLM-->>Route: text
  Route-->>Browser: { text }
```

## 13. File Extraction Flow

Text and `.docx` extraction are local. PDF/image extraction requires a configured
multimodal provider.

```mermaid
flowchart TD
  Upload["POST /api/extract\nmultipart file"] --> Size["Size/type checks"]
  Size --> Type{"File type"}

  Type -->|"text/csv/md/json/etc."| Decode["UTF-8 decode locally\nno model call"]
  Type -->|".docx"| Mammoth["mammoth.extractRawText()\nno model call"]
  Type -->|"PDF"| PDFBlocks["base64 document block\nPDF_PROMPT"]
  Type -->|"image"| ImageBlocks["base64 image block\nIMG_PROMPT"]

  PDFBlocks --> FileAI["getFileAI('pdf')"]
  ImageBlocks --> VisionAI["getFileAI('vision')"]

  FileAI --> MultiProvider["Anthropic or Gemini\ncompleteBlocks()"]
  VisionAI --> MultiProvider
  MultiProvider --> Text["Markdown text result"]
  Decode --> Text
  Mammoth --> Text
```

## 14. Studio Media Orchestration

Studio has both LLM prompt-prep calls and non-LLM media generation calls.

```mermaid
flowchart TD
  Studio["Studio UI"] --> Providers["GET /api/media/providers\ncapability summary, no secrets"]

  Studio --> PromptPreview["POST /api/hedra/prompt"]
  PromptPreview --> RefCtx["buildRefContext() + style profile + piece excerpt"]
  RefCtx --> MediaPromptLLM["getAIForTask('mediaPrompt')\ncraftImagePrompt()"]
  MediaPromptLLM --> ImagePrompt["Generated image prompt"]

  Studio --> VoiceScript["POST /api/hedra/voice-script"]
  VoiceScript --> VoicePrompt["piece text + refCtx + voiceName"]
  VoicePrompt --> VoiceScriptLLM["getAIForTask('mediaPrompt')\ncraftVoiceScript()"]
  VoiceScriptLLM --> Script["Voiceover script"]

  Studio --> Generate["POST /api/hedra/generate"]
  Generate --> Type{"media type/provider"}
  Type -->|"audio + OpenAI-compatible"| OpenAITTS["generateOpenAICompatibleSpeech()"]
  Type -->|"audio + ElevenLabs"| Eleven["textToSpeechLong()"]
  Type -->|"image + OpenAI-compatible/xAI/custom"| ImageProvider["generateOpenAICompatibleImage()"]
  Type -->|"image/video/avatar + Hedra"| Hedra["Hedra models/assets/generation"]

  Eleven --> StoreAudio["uploadPublicAudio()\nlocal or Supabase storage"]
  OpenAITTS --> MediaJob["Persist media_jobs row"]
  StoreAudio --> MediaJob
  ImageProvider --> MediaJob
  Hedra --> MediaJob
  MediaJob --> Poll["GET /api/hedra/status/:id\nrefresh temporary URLs, persist final output"]
```

## 15. Error Handling And Secret Boundaries

```mermaid
flowchart TD
  ProviderError["Provider/network/config error"] --> LLMError["LLMError(status, code, message, provider)"]
  LLMError --> ToError["toErrorResponse()"]
  ToError --> SafeJSON["Safe JSON response\nno raw keys\nno credentialed URLs\nno raw provider body"]

  Secrets["API keys"] --> ServerOnly["Server env or encrypted desktop settings"]
  ServerOnly --> Providers["Provider calls from server only"]
  Providers -. never .-> BrowserSecrets["Browser-visible state"]

  Status["/api/llm/status\n/api/media/providers"] --> PublicShape["provider/model/capabilities\nhasApiKey booleans only"]
```

## 16. LLM Call Inventory By Feature

| Feature | Route / module | Task profile | LLM calls |
|---|---|---:|---|
| Desk chat | `app/api/desk/chat/route.ts` | request `task`, default `utility` | 1 text completion |
| Onboarding profile extraction | `app/api/onboarding/extract-setup-profile/route.ts` | `utility` | 1 JSON call, possible JSON repair retry |
| Review gates | `app/api/pieces/[id]/review/route.ts`, `lib/gates.ts` | `review` | 7 JSON calls, persisted gate-by-gate |
| Revision | `app/api/pieces/[id]/revision/route.ts`, `lib/revision.ts` | `revision` | 1 call per chunk, plus optional full restructure call |
| Platform outputs | `app/api/pieces/[id]/outputs/route.ts`, `lib/generators.ts` | `outputs` | 2 calls per active platform |
| Condense output | `app/api/pieces/[id]/outputs/[platform]/condense/route.ts` | `outputs` | 1 text call |
| Title | `app/api/pieces/[id]/title/route.ts`, `lib/ai/titlePiece.ts` | `draft` | 1 completion |
| Weave | `app/api/weave/route.ts`, `lib/weave.ts` | `weave` | N source extract JSON calls + brief JSON + mapping JSON + section text calls |
| Gather summary | `lib/gather/runCampaign.ts`, `lib/ai/gatherSummary.ts` | `gather` | 1 summary call per source with items |
| References AI edit | `app/api/campaigns/[id]/references/ai-edit/route.ts` | `utility` | 1 completion with JSON parse/repair |
| Style feedback | `app/api/campaigns/[id]/style/feedback/route.ts` | `mediaPrompt` | 1 completion |
| Image prompt | `app/api/hedra/prompt/route.ts`, `lib/ai/imagePrompt.ts` | `mediaPrompt` | 1 completion with JSON parse/repair |
| Voice script | `app/api/hedra/voice-script/route.ts`, `lib/ai/voiceScript.ts` | `mediaPrompt` | 1 text call |
| File extraction | `app/api/extract/route.ts`, `lib/ai/fileExtract.ts` | `file` provider | PDF/image multimodal call only; text/docx local |
| Provider test | `app/api/llm/test/route.ts` | one-off config | 1 text completion |
| Model listing | `app/api/llm/models/route.ts` | provider API | direct `/models` or Ollama `/api/tags`, not a model completion |
