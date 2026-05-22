import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type Unzipped, unzip } from "fflate";

// fflate's async unzip yields the event loop so the Electron main thread
// stays responsive on large archives. Do not switch back to unzipSync.
export function unzipAsync(data: Uint8Array): Promise<Unzipped> {
  return new Promise((resolve, reject) => {
    unzip(data, (err, unzipped) => {
      if (err) reject(err);
      else resolve(unzipped);
    });
  });
}

/**
 * Extracts a ZIP file to a directory using fflate (cross-platform, no native dependencies).
 */
export async function extractZip(
  zipPath: string,
  extractDir: string,
): Promise<void> {
  const data = await readFile(zipPath);
  const unzipped = await unzipAsync(new Uint8Array(data));
  for (const [filename, content] of Object.entries(unzipped)) {
    const fullPath = join(extractDir, filename);
    if (filename.endsWith("/")) {
      await mkdir(fullPath, { recursive: true });
    } else {
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, content);
    }
  }
}
