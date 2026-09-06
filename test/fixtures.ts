import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The Milestone 4 placeholder fixture ROM (see native/test/fixtures.md /
 * README for its exact behavior): writes 0x42 to IWRAM 0x03000000 then
 * loops forever. Shared by the native smoke test and these TS tests. */
export const FIXTURE_ROM_PATH = path.join(projectRoot, "native", "test", "fixtures", "minimal.gba");
