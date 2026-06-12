import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAsset, uploadAsset } from "@/lib/hedra";
import { validateUpload, sanitizeFilename } from "@/lib/validation";
import { toErrorResponse } from "@/lib/errors";
import { releaseStorageReservation, reserveStorageBytes, type StorageReservation } from "@/lib/billing/usage";
import { getHedraProviderForUser } from "@/lib/mediaProviders";
import { isLocalFirstMode } from "@/lib/local/mode";
import { requireByokProviderAccess, requireManagedProviderAccess } from "@/lib/billing/entitlements";

// POST /api/hedra/assets   (multipart/form-data: file, kind=image|audio)
// Validates type/size, registers a Hedra asset, uploads the bytes, returns the
// asset id for use as a start frame / audio track in /generate.
export async function POST(req: Request) {
  let storageReservation: StorageReservation = null;
  try {
    const user = await requireUser();
    const form = await req.formData();
    const file = form.get("file");
    const kind = (form.get("kind") as string) === "audio" ? "audio" : "image";
    const profileId = typeof form.get("mediaProfileId") === "string"
      ? (form.get("mediaProfileId") as string).trim() || undefined
      : undefined;
    if (!(file instanceof File)) return NextResponse.json({ error: "No file.", code: "bad_request" }, { status: 400 });

    const err = validateUpload({ type: file.type, size: file.size }, kind);
    if (err) return NextResponse.json({ error: err, code: "validation" }, { status: 422 });

    const name = sanitizeFilename(file.name);
    const hedraProvider = await getHedraProviderForUser(user, process.env, profileId);
    if (!isLocalFirstMode() && user.workspaceId) {
      const billingUser = { ...user, workspaceId: user.workspaceId };
      if (hedraProvider?.providerSource === "byok") await requireByokProviderAccess(billingUser);
      else await requireManagedProviderAccess(billingUser);
    }
    storageReservation = await reserveStorageBytes({
      user,
      bytes: file.size,
      feature: `storage.hedra_asset.${kind}`,
    });
    const asset = await createAsset({ name, type: kind }, { apiKey: hedraProvider?.apiKey });
    const uploaded = await uploadAsset(asset.id, file, name, { apiKey: hedraProvider?.apiKey });
    return NextResponse.json({ asset: uploaded }, { status: 201 });
  } catch (err) {
    await releaseStorageReservation(storageReservation);
    return toErrorResponse(err);
  }
}
