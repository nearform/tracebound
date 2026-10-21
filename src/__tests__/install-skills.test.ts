import test, { type TestContext } from "node:test";
import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { join } from "node:path";

import {
  bundledSkillsDir,
  runInstallSkills,
  DEFAULT_TARGET,
  MANIFEST_FILE,
  reportText,
} from "../commands/install-skills.ts";

async function makeTmpDir(t: TestContext): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tracebound-install-skills-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function listSkillNames(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

test("bundledSkillsDir resolves to the repo's skills/ directory", async (t: TestContext) => {
  const dir = bundledSkillsDir();
  const s = await stat(dir);
  t.assert.strictEqual(s.isDirectory(), true);
  const names = await listSkillNames(dir);
  t.assert.ok(names.includes("analyze-traces"));
  t.assert.ok(names.includes("create-adapter"));
  t.assert.ok(names.includes("research-failure-mode"));
  t.assert.ok(names.includes("implement-failure-mode"));
});

test("runInstallSkills copies every bundled skill into the default target on a clean directory", async (t: TestContext) => {
  const cwd = await makeTmpDir(t);

  const bundled = await listSkillNames(bundledSkillsDir());
  const result = await runInstallSkills({ cwd });

  t.assert.strictEqual(result.selfInstallSkipped, false);
  t.assert.strictEqual(result.dryRun, false);
  t.assert.strictEqual(result.targetDir, join(cwd, DEFAULT_TARGET));
  t.assert.deepStrictEqual(result.installed, bundled);
  t.assert.deepStrictEqual(result.upToDate, []);
  t.assert.deepStrictEqual(result.skipped, []);

  for (const skill of bundled) {
    const targetPath = join(result.targetDir, skill, "SKILL.md");
    const s = await stat(targetPath);
    t.assert.strictEqual(s.isFile(), true);
  }
});

test("runInstallSkills is idempotent: a second run reports every skill as up-to-date", async (t: TestContext) => {
  const cwd = await makeTmpDir(t);

  const first = await runInstallSkills({ cwd });
  t.assert.ok(first.installed.length > 0);

  const second = await runInstallSkills({ cwd });
  t.assert.deepStrictEqual(second.installed, []);
  t.assert.deepStrictEqual(second.upToDate.sort(), first.installed.slice().sort());
  t.assert.deepStrictEqual(second.skipped, []);
});

test("runInstallSkills leaves user-edited skills untouched by default", async (t: TestContext) => {
  const cwd = await makeTmpDir(t);

  const first = await runInstallSkills({ cwd });
  const bundled = first.installed.slice().sort();

  const skill = "analyze-traces";
  const targetPath = join(cwd, DEFAULT_TARGET, skill, "SKILL.md");
  const userContent = "# user-edited\n";
  await writeFile(targetPath, userContent, "utf8");

  const result = await runInstallSkills({ cwd });
  t.assert.deepStrictEqual(result.installed, []);
  t.assert.deepStrictEqual(
    result.upToDate.slice().sort(),
    bundled.filter((s) => s !== skill),
  );
  t.assert.deepStrictEqual(result.skipped, [skill]);

  const after = await readFile(targetPath, "utf8");
  t.assert.strictEqual(after, userContent);
});

test("runInstallSkills --force overwrites user-edited skills", async (t: TestContext) => {
  const cwd = await makeTmpDir(t);

  await runInstallSkills({ cwd });

  const skill = "analyze-traces";
  const targetPath = join(cwd, DEFAULT_TARGET, skill, "SKILL.md");
  const userContent = "# user-edited\n";
  await writeFile(targetPath, userContent, "utf8");

  const result = await runInstallSkills({ cwd, force: true });
  t.assert.ok(result.installed.includes(skill));
  t.assert.strictEqual(result.skipped.length, 0);

  const bundledRaw = await readFile(
    join(bundledSkillsDir(), skill, "SKILL.md"),
    "utf8",
  );
  const after = await readFile(targetPath, "utf8");
  t.assert.strictEqual(after, bundledRaw);
});

test("runInstallSkills --dry-run writes nothing", async (t: TestContext) => {
  const cwd = await makeTmpDir(t);

  const bundled = await listSkillNames(bundledSkillsDir());
  const result = await runInstallSkills({ cwd, dryRun: true });

  t.assert.strictEqual(result.dryRun, true);
  t.assert.deepStrictEqual(result.installed, bundled);
  t.assert.strictEqual(result.upToDate.length, 0);

  await t.assert.rejects(
    () => stat(join(result.targetDir, "analyze-traces", "SKILL.md")),
    /ENOENT/,
  );
});

test("runInstallSkills honours --target for a custom install location", async (t: TestContext) => {
  const cwd = await makeTmpDir(t);

  const result = await runInstallSkills({
    cwd,
    target: "my/custom/skills",
  });

  t.assert.strictEqual(result.targetDir, join(cwd, "my", "custom", "skills"));
  const s = await stat(join(result.targetDir, "analyze-traces", "SKILL.md"));
  t.assert.strictEqual(s.isFile(), true);
});

test("runInstallSkills skips silently when --cwd is the tracebound package itself", async (t: TestContext) => {
  const cwd = await makeTmpDir(t);

  await writeFile(
    join(cwd, "package.json"),
    `${JSON.stringify({ name: "@nearform/tracebound" }, null, 2)}\n`,
    "utf8",
  );

  const result = await runInstallSkills({ cwd });
  t.assert.strictEqual(result.selfInstallSkipped, true);
  t.assert.strictEqual(result.installed.length, 0);
  await t.assert.rejects(
    () => stat(join(cwd, ".claude")),
    /ENOENT/,
  );
});

test("runInstallSkills rejects --cwd that does not exist", async (t: TestContext) => {
  const missing = join(
    tmpdir(),
    `tracebound-missing-${process.pid}-${Date.now()}`,
  );
  await t.assert.rejects(
    () => runInstallSkills({ cwd: missing }),
    /does not exist/,
  );
});

test("runInstallSkills rejects --cwd that is a file, not a directory", async (t: TestContext) => {
  const cwd = await makeTmpDir(t);
  const filePath = join(cwd, "not-a-dir");
  await writeFile(filePath, "x", "utf8");

  await t.assert.rejects(
    () => runInstallSkills({ cwd: filePath }),
    /not a directory/,
  );
});

test("runInstallSkills rejects --cwd whose package.json is malformed JSON", async (t: TestContext) => {
  const cwd = await makeTmpDir(t);

  await writeFile(join(cwd, "package.json"), "{ not valid json", "utf8");

  await t.assert.rejects(
    () => runInstallSkills({ cwd }),
    /malformed JSON in .*package\.json/,
  );
});

test("runInstallSkills rejects --target that resolves outside --cwd", async (t: TestContext) => {
  const cwd = await makeTmpDir(t);
  await t.assert.rejects(
    () => runInstallSkills({ cwd, target: "../escape" }),
    /--target must resolve inside --cwd/,
  );
  await t.assert.rejects(
    () => runInstallSkills({ cwd, target: "/etc" }),
    /--target must resolve inside --cwd/,
  );
});

test("runInstallSkills accepts --target equal to --cwd", async (t: TestContext) => {
  const cwd = await makeTmpDir(t);
  const result = await runInstallSkills({ cwd, target: "." });
  // targetDir is resolved against the realpath of cwd to prevent symlink-bypass.
  // On filesystems where the tmp path contains symlinks (e.g. macOS /tmp -> /private/tmp),
  // the realpath differs from the original cwd.
  const { realpath } = await import("node:fs/promises");
  const cwdReal = await realpath(cwd);
  t.assert.strictEqual(result.targetDir, cwdReal);
});

test("runInstallSkills resolves --cwd symlinks before checking target containment", async (t: TestContext) => {
  const realDir = await makeTmpDir(t);
  const linkParent = await makeTmpDir(t);
  const linkPath = join(linkParent, "link");
  await symlink(realDir, linkPath);

  // --target that would be outside realDir if symlink resolution were skipped,
  // but is inside it after realpath resolves the link.
  const result = await runInstallSkills({ cwd: linkPath });
  t.assert.ok(result.targetDir.startsWith(realDir));
});

test("runInstallSkills rejects an intermediate --target symlink that escapes --cwd", async (t: TestContext) => {
  const outside = await makeTmpDir(t);
  const project = await makeTmpDir(t);
  // Symlink inside the project that points outside it. The default target
  // path is .claude/skills/tracebound; we make .claude a symlink to `outside`
  // so the realpath of the resolved target lands outside project.
  await symlink(outside, join(project, ".claude"));

  await t.assert.rejects(
    () => runInstallSkills({ cwd: project }),
    /--target resolved through a symlink that escapes --cwd/,
  );
});

const SKILL = "analyze-traces";
const sha256 = (contents: string) =>
  createHash("sha256").update(contents).digest("hex");

async function readManifestSkills(
  targetDir: string,
): Promise<Record<string, string>> {
  const raw = await readFile(join(targetDir, MANIFEST_FILE), "utf8");
  return (JSON.parse(raw) as { skills: Record<string, string> }).skills;
}

// Leaves the skill as an older release would have installed it: different from
// the bundled copy, with the manifest recording that exact content.
async function installAsOldRelease(
  targetDir: string,
  oldContents: string,
): Promise<string> {
  const path = join(targetDir, SKILL, "SKILL.md");
  await writeFile(path, oldContents, "utf8");
  const skills = await readManifestSkills(targetDir);
  skills[SKILL] = sha256(oldContents);
  await writeFile(
    join(targetDir, MANIFEST_FILE),
    JSON.stringify({ skills }),
    "utf8",
  );
  return path;
}

test("runInstallSkills records the hash of every skill it installs", async (t: TestContext) => {
  const cwd = await makeTmpDir(t);

  const result = await runInstallSkills({ cwd });

  const skills = await readManifestSkills(result.targetDir);
  t.assert.deepStrictEqual(Object.keys(skills).sort(), result.installed);
  const bundled = await readFile(
    join(bundledSkillsDir(), SKILL, "SKILL.md"),
    "utf8",
  );
  t.assert.strictEqual(skills[SKILL], sha256(bundled));
});

test("runInstallSkills refreshes a skill that is still the version it installed", async (t: TestContext) => {
  const cwd = await makeTmpDir(t);
  const first = await runInstallSkills({ cwd });
  const path = await installAsOldRelease(first.targetDir, "old release text\n");

  const result = await runInstallSkills({ cwd });

  t.assert.deepStrictEqual(result.updated, [SKILL]);
  t.assert.deepStrictEqual(result.skipped, []);
  const bundled = await readFile(
    join(bundledSkillsDir(), SKILL, "SKILL.md"),
    "utf8",
  );
  t.assert.strictEqual(await readFile(path, "utf8"), bundled);
  const skills = await readManifestSkills(result.targetDir);
  t.assert.strictEqual(skills[SKILL], sha256(bundled));
});

test("runInstallSkills does not refresh a skill the user edited after installing it", async (t: TestContext) => {
  const cwd = await makeTmpDir(t);
  const first = await runInstallSkills({ cwd });
  const path = await installAsOldRelease(first.targetDir, "old release text\n");
  await writeFile(path, "old release text\nMY EDIT\n", "utf8");

  const result = await runInstallSkills({ cwd });

  t.assert.deepStrictEqual(result.updated, []);
  t.assert.deepStrictEqual(result.skipped, [SKILL]);
  t.assert.deepStrictEqual(result.unrecorded, []);
  t.assert.strictEqual(
    await readFile(path, "utf8"),
    "old release text\nMY EDIT\n",
  );
  t.assert.match(reportText(result), /modified locally/);
});

test("runInstallSkills treats a differing skill with no manifest entry as edited", async (t: TestContext) => {
  const cwd = await makeTmpDir(t);
  const first = await runInstallSkills({ cwd });
  const path = join(first.targetDir, SKILL, "SKILL.md");
  await writeFile(path, "from before the manifest\n", "utf8");
  await rm(join(first.targetDir, MANIFEST_FILE));

  const result = await runInstallSkills({ cwd });

  t.assert.deepStrictEqual(result.skipped, [SKILL]);
  t.assert.deepStrictEqual(result.unrecorded, [SKILL]);
  t.assert.strictEqual(await readFile(path, "utf8"), "from before the manifest\n");
  t.assert.match(reportText(result), /there is no record of installing it/);
});

test("runInstallSkills adopts an identical copy that predates the manifest", async (t: TestContext) => {
  const cwd = await makeTmpDir(t);
  const first = await runInstallSkills({ cwd });
  await rm(join(first.targetDir, MANIFEST_FILE));

  const second = await runInstallSkills({ cwd });
  t.assert.deepStrictEqual(second.upToDate.sort(), first.installed.slice().sort());

  // Recorded now, so a later release can refresh it.
  const path = await installAsOldRelease(first.targetDir, "old release text\n");
  const third = await runInstallSkills({ cwd });
  t.assert.deepStrictEqual(third.updated, [SKILL]);
  t.assert.ok((await readFile(path, "utf8")).length > "old release text\n".length);
});

test("runInstallSkills reads a corrupt manifest as empty and edits nothing", async (t: TestContext) => {
  const cwd = await makeTmpDir(t);
  const first = await runInstallSkills({ cwd });
  const path = await installAsOldRelease(first.targetDir, "old release text\n");
  await writeFile(join(first.targetDir, MANIFEST_FILE), "{not json", "utf8");

  const result = await runInstallSkills({ cwd });

  t.assert.deepStrictEqual(result.skipped, [SKILL]);
  t.assert.strictEqual(await readFile(path, "utf8"), "old release text\n");
});

test("runInstallSkills --dry-run reports a refresh without writing it or the manifest", async (t: TestContext) => {
  const cwd = await makeTmpDir(t);
  const first = await runInstallSkills({ cwd });
  const path = await installAsOldRelease(first.targetDir, "old release text\n");
  const manifestBefore = await readFile(join(first.targetDir, MANIFEST_FILE), "utf8");

  const result = await runInstallSkills({ cwd, dryRun: true });

  t.assert.deepStrictEqual(result.updated, [SKILL]);
  t.assert.strictEqual(await readFile(path, "utf8"), "old release text\n");
  t.assert.strictEqual(
    await readFile(join(first.targetDir, MANIFEST_FILE), "utf8"),
    manifestBefore,
  );
});

test("runInstallSkills --force on an edited skill records the new hash so later refreshes work", async (t: TestContext) => {
  const cwd = await makeTmpDir(t);
  const first = await runInstallSkills({ cwd });
  const path = join(first.targetDir, SKILL, "SKILL.md");
  await writeFile(path, "MY EDIT\n", "utf8");

  await runInstallSkills({ cwd, force: true });

  const bundled = await readFile(join(bundledSkillsDir(), SKILL, "SKILL.md"), "utf8");
  t.assert.strictEqual((await readManifestSkills(first.targetDir))[SKILL], sha256(bundled));
});
