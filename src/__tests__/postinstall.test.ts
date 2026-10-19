import test, { type TestContext } from "node:test";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(
  import.meta.dirname,
  "..",
  "..",
  "scripts",
  "postinstall-install-skills.js",
);
const built = existsSync(join(import.meta.dirname, "..", "..", "dist", "cli.js"));
const skillFile = ".claude/skills/tracebound/analyze-traces/SKILL.md";

async function runPostinstall(
  t: TestContext,
  env: Record<string, string>,
): Promise<{ status: number | null; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), "tracebound-postinstall-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [script], {
    // Start from a clean environment so the host's own npm_config_* values
    // cannot leak into the run.
    env: { PATH: process.env.PATH ?? "", INIT_CWD: dir, ...env },
    encoding: "utf8",
  });
  return { status: result.status, dir };
}

test(
  "postinstall installs the skills into INIT_CWD on a local install",
  { skip: built ? false : "needs `npm run build` first" },
  async (t: TestContext) => {
    const { status, dir } = await runPostinstall(t, {});
    t.assert.strictEqual(status, 0);
    t.assert.strictEqual(existsSync(join(dir, skillFile)), true);
  },
);

test("postinstall writes nothing on a global install", async (t: TestContext) => {
  const { status, dir } = await runPostinstall(t, {
    npm_config_global: "true",
  });
  t.assert.strictEqual(status, 0);
  t.assert.strictEqual(existsSync(join(dir, ".claude")), false);
});

test(
  "postinstall still installs when npm_config_global is false",
  { skip: built ? false : "needs `npm run build` first" },
  async (t: TestContext) => {
    const { status, dir } = await runPostinstall(t, {
      npm_config_global: "false",
    });
    t.assert.strictEqual(status, 0);
    t.assert.strictEqual(existsSync(join(dir, skillFile)), true);
  },
);
