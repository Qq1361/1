import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function installedBrowserCandidates() {
  const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
  const programFilesX86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";

  return [
    { label: "system Chrome", path: path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe") },
    { label: "system Chrome", path: path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe") },
    { label: "system Edge", path: path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe") },
    { label: "system Edge", path: path.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe") },
  ];
}

async function installedBrowserLaunchCandidates() {
  const candidates = [];
  const seen = new Set();
  for (const candidate of installedBrowserCandidates()) {
    if (seen.has(candidate.path)) continue;
    try {
      await fs.access(candidate.path);
      candidates.push(candidate);
      seen.add(candidate.path);
    } catch {
      // Keep checking portable installation paths without assuming one exists.
    }
  }
  return candidates;
}

async function createProfileDirectory() {
  return fs.mkdtemp(path.join(os.tmpdir(), "resale-erp-browser-"));
}

async function launchContext(userDataDir, contextOptions, executablePath) {
  return chromium.launchPersistentContext(userDataDir, {
    ...contextOptions,
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  });
}

/**
 * Browser adapter for verification scripts.
 *
 * It retains the small Browser.newContext()/close() surface that existing
 * scripts use, but gives every context an isolated temporary profile. Launch
 * order is explicit executable, Playwright Chromium, system Chrome, then
 * system Edge. Each failed attempt removes only its own temporary profile.
 */
export async function launchAcceptanceBrowser() {
  const contexts = new Set();
  const profileDirectories = new Set();

  async function closeContext(context) {
    contexts.delete(context);
    await context.close();
  }

  async function newContext(contextOptions = {}) {
    const explicitExecutablePath =
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
      process.env.PLAYWRIGHT_EXECUTABLE_PATH;
    const launchCandidates = [
      ...(explicitExecutablePath ? [{ label: "explicit executable", executablePath: explicitExecutablePath }] : []),
      { label: "Playwright Chromium", executablePath: null },
      ...(await installedBrowserLaunchCandidates()).map((candidate) => ({
        label: candidate.label,
        executablePath: candidate.path,
      })),
    ];
    const failures = [];

    for (const candidate of launchCandidates) {
      const userDataDir = await createProfileDirectory();
      profileDirectories.add(userDataDir);

      try {
        const context = await launchContext(userDataDir, contextOptions, candidate.executablePath);
        contexts.add(context);
        return context;
      } catch (error) {
        await fs.rm(userDataDir, { recursive: true, force: true });
        profileDirectories.delete(userDataDir);
        failures.push(`${candidate.label}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    throw new Error(`Unable to launch an acceptance browser. Attempts: ${failures.join(" | ")}`);
  }

  return {
    newContext,

    async newPage(pageOptions = {}) {
      const context = await newContext(pageOptions);
      return context.newPage();
    },

    async close() {
      const closeErrors = [];
      for (const context of contexts) {
        try {
          await closeContext(context);
        } catch (error) {
          closeErrors.push(error);
        }
      }

      await Promise.all([...profileDirectories].map((directory) => fs.rm(directory, { recursive: true, force: true })));
      profileDirectories.clear();

      if (closeErrors.length > 0) throw closeErrors[0];
    },
  };
}
