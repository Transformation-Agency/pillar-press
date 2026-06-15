import fs from "node:fs";
import path from "node:path";

const releaseDir = process.env.RELEASE_DIR || "release";
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const version = process.env.VERSION || pkg.version;
const tag = process.env.RELEASE_TAG || `v${version}`;
const repo = process.env.GITHUB_REPOSITORY || "Transformation-Agency/pillar-press";
const baseUrl = `https://github.com/${repo}/releases/download/${tag}`;
const releaseNotes = process.env.RELEASE_NOTES_FILE && fs.existsSync(process.env.RELEASE_NOTES_FILE)
  ? fs.readFileSync(process.env.RELEASE_NOTES_FILE, "utf8").trim()
  : (process.env.RELEASE_NOTES || "");

function readSignature(assetName) {
  const signaturePath = path.join(releaseDir, `${assetName}.sig`);
  if (!fs.existsSync(signaturePath)) {
    throw new Error(`Missing updater signature: ${signaturePath}`);
  }
  return fs.readFileSync(signaturePath, "utf8").trim();
}

const macArm = `Pillar.Press_${version}_aarch64.app.tar.gz`;
const macIntel = `Pillar.Press_${version}_x64.app.tar.gz`;
const winX64 = `Pillar.Press_${version}_x64-setup.exe`;

const manifest = {
  version,
  notes: releaseNotes,
  pub_date: new Date().toISOString(),
  platforms: {
    "darwin-aarch64": {
      signature: readSignature(macArm),
      url: `${baseUrl}/${macArm}`,
    },
    "darwin-x86_64": {
      signature: readSignature(macIntel),
      url: `${baseUrl}/${macIntel}`,
    },
    "windows-x86_64": {
      signature: readSignature(winX64),
      url: `${baseUrl}/${winX64}`,
    },
  },
};

fs.mkdirSync(releaseDir, { recursive: true });
fs.writeFileSync(path.join(releaseDir, "latest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
