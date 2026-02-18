import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function formatBranchName(date: Date = new Date()): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  return `design-loop/${y}-${mo}-${d}-${h}${mi}${s}`;
}

export async function getCurrentBranch(cwd: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "git",
    ["rev-parse", "--abbrev-ref", "HEAD"],
    { cwd },
  );
  return stdout.trim();
}

export async function createWorkBranch(cwd: string): Promise<string> {
  const branchName = formatBranchName();
  await execFileAsync("git", ["checkout", "-b", branchName], { cwd });
  return branchName;
}

export async function pushAndCreatePR(
  cwd: string,
  branch: string,
  baseBranch: string,
): Promise<void> {
  await execFileAsync("git", ["push", "-u", "origin", branch], { cwd });
  await execFileAsync(
    "gh",
    [
      "pr",
      "create",
      "--title",
      `Design changes (${branch})`,
      "--body",
      "Design changes made via design-loop",
      "--base",
      baseBranch,
    ],
    { cwd },
  );
}
