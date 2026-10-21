import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const isOn = (value) =>
  value !== undefined && !["", "0", "false"].includes(value.toLowerCase());

// A global install is not a project, and INIT_CWD is wherever npm happened to
// be run from, so writing there would put .claude/ into an unrelated directory.
// CI and build steps should not write into the checkout either, and
// TRACEBOUND_SKIP_SKILLS opts out anywhere else.
if (
  process.env.npm_config_global === "true" ||
  isOn(process.env.CI) ||
  isOn(process.env.TRACEBOUND_SKIP_SKILLS)
) {
  process.exit(0);
}

const here = dirname(fileURLToPath(import.meta.url));
const cliPath = join(here, "..", "dist", "cli.js");
const cwd = process.env.INIT_CWD ?? ".";

const result = spawnSync(
  process.execPath,
  [cliPath, "install-skills", "--cwd", cwd],
  { stdio: "inherit" },
);

if (result.error) {
  process.stderr.write(
    `install-skills failed to start: ${result.error.message}\n`,
  );
}

if (result.signal !== null) {
  process.stderr.write(
    `install-skills child terminated by signal ${result.signal}\n`,
  );
}

process.exit(result.status ?? 1);
