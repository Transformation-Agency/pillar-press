# AGENTS.md Instruction Hierarchy Audit

Date: 2026-06-24  
Repository: `/Users/paul/pillar-press`  
Branch: `codex/fix-kings-press-port-isolation`  
HEAD at audit: `7495b907911dfa3286c2fb83b85521d0ce0c9ba9`

## Executive Assessment

Applied safe local instruction-file changes. The repository now has a layered
Codex instruction hierarchy with:

- root project instructions in `AGENTS.md`;
- scoped component instructions in `src-tauri/`, `lib/llm/`, `db/`, and
  `public/`;
- a local reference copy of the Metacanon Constitution Third Edition at
  `constitution/Metacanon_Constitution_v3.0.md`;
- a lock/provenance file at `constitution/CONSTITUTION.lock`.

No application source code, tests, manifests, CI, product docs outside this
audit report, GitHub state, release state, deployment state, or Git metadata was
modified.

## Constitution Discovery

Initial repository search found no constitution file in King's Press. After the
human follow-up request, "add the constitution file", a canonical source was
located outside this repository:

- source: `/Users/paul/prism-pillar-law/governance/bundles/dev/constitution.md`
- source SHA-256:
  `ecf3b151a8b9bc1f296060b6d82c4af0d2d5929536f4eca7bf0683884ba1dc89`
- supporting manifest:
  `/Users/paul/prism-pillar-law/governance/source-manifest.json`
- source manifest SHA-256:
  `7c004cb974ac0845b9467c0843c4f716ebd088603cc99b93f7993d874bc39c62`
- bundle manifest:
  `/Users/paul/prism-pillar-law/governance/bundles/dev/manifest.json`
- bundle manifest SHA-256:
  `91e763050fd6d90940b259ee6f6905239addd4c19d4527e7e31267f0c44e46bf`

The copied repository file verifies to the same canonical hash:

```text
ecf3b151a8b9bc1f296060b6d82c4af0d2d5929536f4eca7bf0683884ba1dc89  constitution/Metacanon_Constitution_v3.0.md
```

The constitution file is intentionally not inlined into `AGENTS.md`; it is about
88 KiB and would exceed the normal Codex project instruction budget.

## Codex Discovery Configuration

Readable global Codex config:

- `/Users/paul/.codex/config.toml`
- `sandbox_mode = "danger-full-access"`
- `approval_policy = "on-request"`
- trusted project entry for `/Users/paul/pillar-press`

Readable global instruction file:

- `/Users/paul/.codex/AGENTS.md`
- byte count: `0`

No `AGENTS.override.md` was found at global or project scope. No
`project_doc_fallback_filenames` or `project_doc_max_bytes` setting was found in
the readable Codex configuration, so the default behavior applies:

- active project instruction filename: `AGENTS.md`;
- same-directory `AGENTS.override.md` would shadow `AGENTS.md` if present;
- default effective project instruction budget is treated as 32 KiB, with a 28
  KiB target used for this audit.

## Worktree Inventory

`git worktree list --porcelain` returned one linked worktree.

| Path | Branch / HEAD | Exists | Writable | Locked | Prunable | Bare | Status | Assessment |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/Users/paul/pillar-press` | `codex/fix-kings-press-port-isolation` / `7495b907911dfa3286c2fb83b85521d0ce0c9ba9` | yes | yes | no | no | no | dirty from untracked local files | active primary checkout |

Likely Work Cell ID: none declared in repository metadata.  
Likely Work Item IDs: not declared in repository metadata.  
Likely agent role: general implementation/audit agent under direct Human
Request.  
Likely component: King's Press desktop/local-first app.

Pre-existing untracked files before this audit included:

- `AGENTS.md`
- `docs/cowork-audit-2026-06-22.md`
- `release-artifacts/Kings-Press-Editorial-Desk_0.1.0_aarch64.dmg`
- `release-artifacts/Kings-Press-Editorial-Desk_0.1.0_x64.dmg`

The pre-existing untracked `AGENTS.md` was intentionally updated because it was
the active root project instruction file requested by this audit.

## Instruction File Inventory

Project instruction files after migration:

| File | Type | Tracked status | SHA-256 | Bytes | Effective role |
| --- | --- | --- | --- | ---: | --- |
| `AGENTS.md` | active root project instructions | untracked | `20e880106e21911518a07951c8d16f8629abb4333191d881861305df52318bca` | 9536 | universal project and AI Contact boundary |
| `src-tauri/AGENTS.md` | active nested instructions | untracked | `bdeec1225560337585c4ed2e72447f95124cb19ebce918e91a1b876a0f15473d` | 2187 | Tauri/native desktop scope |
| `lib/llm/AGENTS.md` | active nested instructions | untracked | `666b7bffd685065545cc17244d6033062d278f0c828407ad6d336f4a135491bd` | 1541 | provider-neutral LLM scope |
| `db/AGENTS.md` | active nested instructions | untracked | `307fb2c226bda29ae2feda48783d016f9f66bb489d9f6f9cf015990f259413df` | 1411 | local SQLite/hosted migration scope |
| `public/AGENTS.md` | active nested instructions | untracked | `b744bd1e4785e062289ab28d2cb8a398520d5f892acc04debc299d5772fed659` | 1490 | static browser/onboarding scope |

Other instruction-like files:

- `CLAUDE.md`: not recognized by Codex config; inactive for Codex.
- `docs/CLAUDE.md`: not recognized by Codex config; inactive for Codex.
- `node_modules/@supabase/*/AGENTS.md`: vendored dependency instruction files.
  They were not migrated. They are outside the project source instruction
  hierarchy for normal King's Press work and should not be treated as project
  policy.

No project `AGENTS.override.md` files were found or created.

## Effective Chain Sizes

The largest active project chain remains below the 28 KiB audit target:

| Directory | Effective files | Combined bytes |
| --- | --- | ---: |
| repository root | `AGENTS.md` | 9536 |
| `src-tauri/` | root + `src-tauri/AGENTS.md` | 11723 |
| `lib/llm/` | root + `lib/llm/AGENTS.md` | 11077 |
| `db/` | root + `db/AGENTS.md` | 10947 |
| `public/` | root + `public/AGENTS.md` | 11026 |

`constitution/Metacanon_Constitution_v3.0.md` is a reference file, not part of
the active Codex instruction chain.

## Command Evidence

Commands placed in `AGENTS.md` were supported by repository evidence:

- `package.json`
- `README.md`
- `docs/DESKTOP_LOCAL_FIRST.md`
- `docs/LOCAL_DEV.md`
- `.github/workflows/desktop-ci.yml`
- `src-tauri/Cargo.toml`

Supported commands include:

```bash
npm run typecheck
npm test
npm audit --audit-level=moderate
npm run onboarding:verify
npm run onboarding:verify:browser
npm run desktop:web:build
npm run desktop:release-readiness
npm run desktop:build
npm run desktop:verify-release
npm run desktop:verify-installed
npm run desktop:build:signed
npm run desktop:verify-signed-release
cargo test --manifest-path src-tauri/Cargo.toml
```

Database commands from `package.json` were documented only in `db/AGENTS.md`
with mutation warnings:

```bash
npm run local:db:schema
npm run db:generate
npm run db:migrate
npm run db:push
```

## Changes Applied

Root `AGENTS.md` was replaced with layered instructions covering:

- project purpose and repository map;
- authority/source hierarchy;
- AI Contact constitutional boundary;
- Work Cell versus Sub-Sphere terminology;
- common command set with evidence;
- local-first desktop product rules;
- Git/worktree safety;
- protected paths;
- Human Request and approval boundaries;
- evidence and AI-complete versus human-accepted distinction.

Nested instruction files were added only where directory-specific rules are
useful:

- `src-tauri/AGENTS.md`: native/Tauri/signing/permission boundaries.
- `lib/llm/AGENTS.md`: provider-neutral model and secret handling boundaries.
- `db/AGENTS.md`: SQLite versus hosted migration boundaries.
- `public/AGENTS.md`: browser/onboarding/local asset boundaries.

Constitution reference files added:

- `constitution/Metacanon_Constitution_v3.0.md`
- `constitution/CONSTITUTION.lock`

## Audit Criteria Assessment

### A. Discovery Correctness

Pass. Active Codex filenames use `AGENTS.md`. No unexpected project override was
found. No configured fallback filenames were found. Effective chain sizes remain
below the 28 KiB target.

### B. Constitutional Correctness

Pass with one caveat. New instructions explicitly prohibit AI Contacts from
voting, approving, ratifying, deciding for humans, accepting risk, interpreting
constitutional ambiguity, changing Governance, exercising Individual Action,
expanding authority, bypassing Material Impact review, bypassing a Human
Request, or bypassing Ratchet/suspension.

Caveat: no King's Press-specific Governance activation record, AI Contact Lens,
Prism Holder, or Accountability Member record was found in this repository. The
root instructions require stopping where such records are required but missing.

### C. Terminology Correctness

Pass. New instructions use "Work Cell" for temporary project teams and reserve
"Sub-Sphere" for legally anchored constitutional structures.

### D. Role Clarity

Pass for current repository state. No role-specific Work Cell directories were
found. Root instructions define generic AI Contact boundaries and completion
limits. No planner/implementer/auditor/verifier role files were fabricated.

### E. Worktree Safety

Pass. Root instructions include worktree discovery, branch awareness, protected
paths, no-prune/no-delete/no-revert rules, stale-context stop conditions, and
prohibition on altering other worktrees.

### F. Human-In-The-Loop Boundaries

Pass. Root and component files identify stop conditions for missing Human
Request, missing Governance authority artifacts where required, ambiguity, scope
expansion, new commands/tools/paths, Material Impact, external communication,
GitHub mutation, merge, release, deployment, destructive operations, repeated
repair failure, Ratchet, or emergency suspension.

### G. Evidence And Completion

Pass. Root instructions require inspected/changed file lists, commands/methods,
working directories, results, evidence paths, hashes where practical,
limitations, unresolved questions, and requested human next action. The
instructions distinguish AI-complete from human acceptance.

### H. Repository-Specific Accuracy

Pass. Commands and paths were derived from repository files. The root and nested
files preserve King’s Press local-first desktop behavior, `lib/llm` provider
neutrality, secret handling, SQLite/local storage, Tauri build verification, and
editorial prompt stability.

## Validation Performed

Commands run:

```bash
git rev-parse --show-toplevel
git rev-parse --git-common-dir
git worktree list --porcelain
find /Users/paul/pillar-press ... AGENTS candidates ...
sed -n ... /Users/paul/.codex/config.toml
sed -n ... package.json README.md docs/DESKTOP_LOCAL_FIRST.md docs/LOCAL_DEV.md docs/BUILD_BRIEF.md
sed -n ... .github/workflows/desktop-ci.yml src-tauri/Cargo.toml vitest.config.ts
shasum -a 256 constitution/Metacanon_Constitution_v3.0.md
wc -c AGENTS.md src-tauri/AGENTS.md lib/llm/AGENTS.md db/AGENTS.md public/AGENTS.md
shasum -a 256 AGENTS.md src-tauri/AGENTS.md lib/llm/AGENTS.md db/AGENTS.md public/AGENTS.md
git status --short --branch --untracked-files=all
```

No build/test suite was run because this task intentionally modified only local
instruction files and audit documentation, not application behavior.

## Remaining Human Review Items

1. Decide whether these untracked instruction and constitution files should be
   committed.
2. Decide whether King's Press needs formal Governance activation records,
   project-specific AI Contact Lens records, Prism Holder records, or
   Accountability Member records.
3. Decide whether to migrate inactive `CLAUDE.md` content into Codex
   instructions or keep it as tool-specific documentation.
4. Decide whether `node_modules/@supabase/*/AGENTS.md` should be ignored in
   future audits as vendored dependency content.

