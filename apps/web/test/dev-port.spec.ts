import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The web dev server runs on 3100, permanently: port 3000 belongs to
 * another project on the development machine (product-owner decision,
 * docs/ROADMAP.md). Next's default is 3000, so anyone regenerating these
 * scripts or copying a snippet from the Next docs will reintroduce it —
 * hence a test rather than a comment.
 */
const WEB_PORT = 3100;

const packageJson = JSON.parse(
  readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'),
) as { scripts: Record<string, string> };

describe('web dev server port', () => {
  it.each(['dev', 'start'])('`%s` serves on 3100', (script) => {
    expect(packageJson.scripts[script]).toContain(`--port ${WEB_PORT}`);
  });

  it('mentions 3000 nowhere in the scripts', () => {
    for (const [name, command] of Object.entries(packageJson.scripts)) {
      expect(command, `script "${name}"`).not.toContain('3000');
    }
  });
});
