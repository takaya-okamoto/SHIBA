// CI-every-run search regression (docs/95 B-1, layer 1): every fixture case must pass. New
// behavior is locked in by adding a YAML case under fixtures/ — no code change needed here.
import { describe, it } from "vitest";
import { loadFixtureSuites, runCase } from "./runner.js";

for (const suite of loadFixtureSuites()) {
  describe(`eval:${suite.suite}`, () => {
    for (const c of suite.cases) {
      it(c.name, async () => {
        const res = await runCase(suite, c);
        if (!res.passed) {
          throw new Error(`${res.failures.join("; ")} | got=[${res.got.join(", ")}]`);
        }
      });
    }
  });
}
