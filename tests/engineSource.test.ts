/**
 * The injected engine is committed as a generated string. Fail if someone
 * changed src/injected or src/core without running `npm run build:engine`.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildEngineSource, renderModule, readGeneratedModule } = require('../scripts/build-engine.js');

describe('generated engine source', () => {
  it('is up to date (run `npm run build:engine` if this fails)', () => {
    expect(readGeneratedModule()).toBe(renderModule(buildEngineSource()));
  });

  it('is small enough to inject on every page load', () => {
    expect(buildEngineSource().length).toBeLessThan(30 * 1024);
  });
});
