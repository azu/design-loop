import { createWriteStream } from "node:fs";
import { chmod, rename, unlink } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import pkg from "../package.json" with { type: "json" };

const REPO = "azu/design-loop";

type GitHubRelease = {
  tag_name: string;
  assets: Array<{
    name: string;
    browser_download_url: string;
  }>;
};

function getCurrentVersion(): string {
  return pkg.version;
}

function getPlatformAssetName(): string {
  const platform = process.platform; // "darwin" | "linux"
  const arch = process.arch; // "arm64" | "x64"
  let os: string;
  if (platform === "darwin") {
    os = "darwin";
  } else if (platform === "linux") {
    os = "linux";
  } else {
    throw new Error(`Unsupported platform: ${platform}`);
  }
  let cpu: string;
  if (arch === "arm64") {
    cpu = "arm64";
  } else if (arch === "x64") {
    cpu = "x64";
  } else {
    throw new Error(`Unsupported architecture: ${arch}`);
  }
  return `design-loop-${os}-${cpu}`;
}

async function fetchLatestRelease(): Promise<GitHubRelease> {
  const url = `https://api.github.com/repos/${REPO}/releases/latest`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "design-loop-updater",
    },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch latest release: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as GitHubRelease;
}

function parseVersion(tag: string): string {
  return tag.replace(/^v/, "");
}

function compareVersions(a: string, b: string): number {
  const partsA = a.split(".").map(Number);
  const partsB = b.split(".").map(Number);
  const len = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < len; i++) {
    const numA = partsA[i] ?? 0;
    const numB = partsB[i] ?? 0;
    if (numA !== numB) return numA - numB;
  }
  return 0;
}

async function downloadBinary(downloadUrl: string, destPath: string): Promise<void> {
  const res = await fetch(downloadUrl, {
    headers: { "User-Agent": "design-loop-updater" },
  });
  if (!res.ok) {
    throw new Error(`Failed to download binary: ${res.status} ${res.statusText}`);
  }
  if (!res.body) {
    throw new Error("Empty response body");
  }
  const fileStream = createWriteStream(destPath);
  await pipeline(Readable.fromWeb(res.body as never), fileStream);
}

export async function runUpdate(): Promise<void> {
  const currentVersion = getCurrentVersion();
  console.log(`Current version: v${currentVersion}`);
  console.log("Checking for updates...");

  const release = await fetchLatestRelease();
  const latestVersion = parseVersion(release.tag_name);

  if (compareVersions(latestVersion, currentVersion) <= 0) {
    console.log(`Already up to date (v${currentVersion}).`);
    return;
  }

  console.log(`New version available: v${latestVersion}`);

  const assetName = getPlatformAssetName();
  const asset = release.assets.find((a) => a.name === assetName);
  if (!asset) {
    throw new Error(
      `No binary found for your platform (${assetName}). Available: ${release.assets.map((a) => a.name).join(", ")}`,
    );
  }

  const binaryPath = process.argv[0];
  if (!binaryPath) {
    throw new Error("Could not determine current binary path");
  }
  const tmpPath = `${binaryPath}.update-tmp`;

  console.log(`Downloading ${assetName}...`);
  await downloadBinary(asset.browser_download_url, tmpPath);
  await chmod(tmpPath, 0o755);

  // Atomic replace: rename new over old
  await rename(tmpPath, binaryPath);
  console.log(`Updated to v${latestVersion} successfully.`);
}

export async function runUpdateSafe(): Promise<void> {
  try {
    await runUpdate();
  } catch (err) {
    // Clean up tmp file on failure
    const binaryPath = process.argv[0];
    if (binaryPath) {
      try {
        await unlink(`${binaryPath}.update-tmp`);
      } catch {
        // ignore cleanup errors
      }
    }
    if (err instanceof Error) {
      console.error(`Update failed: ${err.message}`);
    } else {
      console.error("Update failed:", err);
    }
    process.exit(1);
  }
}
