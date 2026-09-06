import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The Milestone 4 fixture ROM, assembled from test/fixtures/rom/fixture.s
 * by test/fixtures/rom/build.sh (run as this package's "pretest" script -
 * see package.json - so it's fresh before Vitest runs). See fixture.s's
 * header comment and README.md for its exact behavior: it writes 0x42 to
 * IWRAM 0x03000000, then loops forever. Shared by the native smoke test
 * and these TS tests. Never a committed binary - see .gitignore. */
export const FIXTURE_ROM_PATH = path.join(
	projectRoot,
	"test",
	"fixtures",
	"rom",
	"build",
	"fixture.gba",
);
