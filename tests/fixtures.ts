// Test helper: reads a file under tests/fixtures (Jest runs in Node; the app's types don't include Node's).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs') as { readFileSync(path: string, encoding: 'utf8'): string };

const dir = `${(expect.getState().testPath ?? '').replace(/\/[^/]+$/, '')}/fixtures`;

export function fixture(name: string): string {
  return fs.readFileSync(`${dir}/${name}`, 'utf8');
}

export function jsonFixture<T = unknown>(name: string): T {
  return JSON.parse(fixture(name)) as T;
}
