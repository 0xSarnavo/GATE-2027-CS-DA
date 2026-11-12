import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderMd } from '../../web/src/md-render';

const content = join(import.meta.dir, '../../data');
const strings = (x: unknown): string[] => typeof x === 'string' ? [x] : Array.isArray(x) ? x.flatMap(strings) : x && typeof x === 'object' ? Object.values(x).flatMap(strings) : [];
const katex = { renderToString: () => 'MATH' };

test('bold Markdown may contain a single asterisk', () => {
  expect(renderMd('The **h*(n)** bound', katex)).toContain('<b>h*(n)</b>');
});

test('real ladder and explainer Markdown renders without visible syntax', () => {
  for (const folder of ['ladders', 'explainers']) {
    const samples = readdirSync(join(content, folder)).filter(x => x.endsWith('.json')).sort().slice(0, 8)
      .flatMap(x => strings(JSON.parse(readFileSync(join(content, folder, x), 'utf8'))))
      .filter(x => /\*\*|\$|`|^\s*- /m.test(x)).slice(0, 100);
    expect(samples.length).toBeGreaterThan(10);
    for (const s of samples) {
      const visible = renderMd(s, katex).replace(/<[^>]*>/g, '');
      expect(visible).not.toMatch(/\*\*|\$[^\s]|\\frac|`|^\s*- /m);
    }
  }
});
