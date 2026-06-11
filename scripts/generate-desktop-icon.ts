import { stat } from "node:fs/promises";

const source = "src-tauri/icons/source-1024.png";

async function main() {
  const info = await stat(source);
  if (!info.isFile()) {
    throw new Error(`Missing Pillar Press source icon at ${source}.`);
  }
  console.log(`Using Pillar Press source icon at ${source}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
