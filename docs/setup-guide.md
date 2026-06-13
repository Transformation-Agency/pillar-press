# Setup Guide

Pillar Press is designed to start with a guided desktop setup and keep the
important choices editable later from Setup.

## 1. Choose Voice Setup

Voice is optional. If you connect a provider, Pillar Press can read responses
aloud and save audio from generated revisions.

Recommended first option:

- OpenAI for general read-aloud and setup reuse.

Optional:

- ElevenLabs for higher-quality voice output when connected.

If you skip voice, the rest of setup still works normally.

## 2. Choose Writing Models

Pick Cloud or Local.

Cloud providers:

- OpenAI
- Anthropic
- Gemini
- xAI/Grok
- OpenAI-compatible endpoint

Local providers:

- Ollama
- LM Studio
- Docker Model Runner

After you save a provider key or connect a local provider, Pillar Press detects
usable writing models and lets you choose the default. You can still change the
model per Desk thread later.

## 3. Describe Your Editorial Voice

Use the writing-profile setup to describe:

- What you publish
- Who you write for
- Your recurring point of view
- Tone and style preferences
- Topics, claims, or phrasing to avoid

Pillar Press turns that into editable settings for audience, throughline,
drafting notes, tone rules, and editorial guardrails.

## 4. Start On The Desk

The Desk is where you think out loud and draft with the selected model. When a
response is useful, send it to Library as a draft. From there, move it through
Draft, Review, Revision, Outputs, Media, or Book workflows.

## 5. Add Optional Connectors

Gather and export workflows can use optional integrations such as Brave Search,
YouTube, NCBI, and Google Drive. Add these only when the workflow needs them.

Provider keys and integration settings should be entered in the app rather than
hard-coded in source files.
