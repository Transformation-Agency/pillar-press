/**
 * Google Drive — SERVER-SIDE OAuth + upload (Unit U4.2).
 *
 * The prototype (`prototype-reference/drive.js`) ran the whole OAuth dance in
 * the browser with Google Identity Services and a user-entered Client ID, then
 * uploaded via a multipart `fetch` to the Drive REST API. Per BUILD_BRIEF §8 we
 * move ALL of that server-side:
 *
 *   - OAuth uses `googleapis` with GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET and a
 *     fixed redirect URI (GOOGLE_REDIRECT_URI). We request `access_type:offline`
 *     so Google returns a REFRESH token, which we persist in the caller's
 *     `settings.drive_refresh_token` column (a server-only secret).
 *   - Upload uses the persisted refresh token to mint a short-lived access token
 *     on each request, then uploads multipart to the linked folder — the same
 *     upload contract as `drive.js#uploadFile` (drive.file scope, optional
 *     `parents:[folderId]`, returns `{id,name,webViewLink}`).
 *
 * SERVER ONLY. The Google client secret + the user's refresh token never reach
 * the client; the browser only calls our own /api/drive/* routes.
 */
import { Readable } from "node:stream";
import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";

/** Scope: drive.file — per-file access to files the app creates (same as proto). */
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

/** Tagged error so lib/errors.ts can surface a clean status to the client. */
export class DriveError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 502, code = "drive_error") {
    super(message);
    this.name = "DriveError";
    this.status = status;
    this.code = code;
  }
}

/** Read + validate the Google OAuth env config. Throws a clear server error. */
function oauthConfig(): { clientId: string; clientSecret: string; redirectUri: string } {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || process.env.GOOGLE_OAUTH_REDIRECT_URL;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new DriveError(
      "Google Drive is not configured on the server.",
      500,
      "drive_unconfigured",
    );
  }
  return { clientId, clientSecret, redirectUri };
}

/** Build a fresh OAuth2 client from env config. */
export function oauthClient(): OAuth2Client {
  const { clientId, clientSecret, redirectUri } = oauthConfig();
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

/**
 * Build the consent URL. `access_type:offline` + `prompt:consent` guarantees a
 * refresh token even on re-consent. `state` round-trips an opaque value (we use
 * it to tie the callback back to the initiating user/workspace).
 */
export function consentUrl(state: string): string {
  return oauthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [DRIVE_SCOPE],
    state,
    include_granted_scopes: true,
  });
}

/**
 * Exchange an authorization code for tokens. Returns the refresh token (to
 * persist) — Google only returns it with offline access + consent.
 */
export async function exchangeCode(code: string): Promise<{ refreshToken: string | null }> {
  const client = oauthClient();
  try {
    const { tokens } = await client.getToken(code);
    return { refreshToken: tokens.refresh_token ?? null };
  } catch (e) {
    throw new DriveError(
      "Could not complete Google Drive authorization.",
      502,
      "drive_oauth_failed",
    );
  }
}

/** An OAuth2 client primed with a stored refresh token, ready to call the API. */
function authedClient(refreshToken: string): OAuth2Client {
  const client = oauthClient();
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

/** A Drive v3 API client backed by the caller's refresh token. */
function driveApi(refreshToken: string) {
  return google.drive({ version: "v3", auth: authedClient(refreshToken) });
}

/** Result of uploading one file — mirrors the proto's `{id,name,webViewLink}`. */
export interface UploadedFile {
  id: string;
  name: string;
  webViewLink: string;
}

/**
 * Fetch the display name of the linked folder (for /api/drive/status). Returns
 * null if no folder is set or it can't be read (e.g. deleted / revoked).
 */
export async function folderName(
  refreshToken: string,
  folderId: string | null | undefined,
): Promise<string | null> {
  if (!folderId) return null;
  try {
    const res = await driveApi(refreshToken).files.get({
      fileId: folderId,
      fields: "name",
    });
    return res.data.name ?? null;
  } catch {
    return null;
  }
}

/**
 * uploadFile — server port of `drive.js#uploadFile`. Creates a markdown file in
 * the linked folder (when `folderId` is set) and returns its links.
 */
export async function uploadFile(
  refreshToken: string,
  folderId: string | null | undefined,
  name: string,
  content: string,
  mime = "text/markdown",
): Promise<UploadedFile> {
  try {
    const res = await driveApi(refreshToken).files.create({
      requestBody: {
        name,
        ...(folderId ? { parents: [folderId] } : {}),
      },
      media: {
        mimeType: mime,
        body: content,
      },
      fields: "id,name,webViewLink",
    });
    const f = res.data;
    if (!f.id) throw new DriveError("Drive upload returned no file id.");
    return {
      id: f.id,
      name: f.name ?? name,
      webViewLink: f.webViewLink ?? "",
    };
  } catch (e) {
    if (e instanceof DriveError) throw e;
    throw new DriveError("Drive upload failed.", 502, "drive_upload_failed");
  }
}

/**
 * uploadBinaryFile — upload raw bytes (image / video / audio) to the linked
 * folder. Same as uploadFile but the media body is a binary stream.
 */
export async function uploadBinaryFile(
  refreshToken: string,
  folderId: string | null | undefined,
  name: string,
  bytes: Buffer | Uint8Array,
  mime: string,
): Promise<UploadedFile> {
  try {
    const res = await driveApi(refreshToken).files.create({
      requestBody: { name, ...(folderId ? { parents: [folderId] } : {}) },
      media: { mimeType: mime, body: Readable.from(Buffer.from(bytes)) },
      fields: "id,name,webViewLink",
    });
    const f = res.data;
    if (!f.id) throw new DriveError("Drive upload returned no file id.");
    return { id: f.id, name: f.name ?? name, webViewLink: f.webViewLink ?? "" };
  } catch (e) {
    if (e instanceof DriveError) throw e;
    throw new DriveError("Drive upload failed.", 502, "drive_upload_failed");
  }
}

/**
 * uploadMany — server port of `drive.js#uploadMany`. Sequential to mirror the
 * prototype and keep ordering deterministic.
 */
export async function uploadMany(
  refreshToken: string,
  folderId: string | null | undefined,
  files: { name: string; content: string; mime?: string }[],
): Promise<UploadedFile[]> {
  const results: UploadedFile[] = [];
  for (const f of files) {
    results.push(await uploadFile(refreshToken, folderId, f.name, f.content, f.mime));
  }
  return results;
}
