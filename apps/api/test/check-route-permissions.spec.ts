import { describe, expect, it } from 'vitest';
import { checkSource } from '../scripts/check-route-permissions';

describe('check-route-permissions (CI route scanner)', () => {
  it('flags a route with neither @Public() nor @RequirePermission()', () => {
    const source = `
@Controller('widgets')
export class WidgetsController {
  @Get()
  findAll() {
    return [];
  }
}
`;
    const violations = checkSource(source);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.decorator).toBe('@Get(');
  });

  it('passes a route guarded with @Public()', () => {
    const source = `
@Controller('widgets')
export class WidgetsController {
  @Public()
  @Get()
  findAll() {
    return [];
  }
}
`;
    expect(checkSource(source)).toHaveLength(0);
  });

  it('passes a route guarded with @RequirePermission(...)', () => {
    const source = `
@Controller('widgets')
export class WidgetsController {
  @RequirePermission('widget.view')
  @Get()
  findAll() {
    return [];
  }
}
`;
    expect(checkSource(source)).toHaveLength(0);
  });

  it('flags only the undecorated route when a controller mixes decorated and bare routes', () => {
    const source = `
@Controller('widgets')
export class WidgetsController {
  @RequirePermission('widget.view')
  @Get()
  findAll() {
    return [];
  }

  @Post()
  create() {
    return {};
  }
}
`;
    const violations = checkSource(source);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.decorator).toBe('@Post(');
  });

  it('real controllers in this repo all pass', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const srcDir = path.resolve(__dirname, '../src');

    function findControllerFiles(dir: string): string[] {
      const results: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          results.push(...findControllerFiles(full));
        } else if (entry.name.endsWith('.controller.ts')) {
          results.push(full);
        }
      }
      return results;
    }

    const files = findControllerFiles(srcDir);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      expect(checkSource(source), file).toHaveLength(0);
    }
  });

  /**
   * Step 0.3 requirement E / spec test list: "lint fails when a test
   * controller route has no decorator (prove the CI check works)". The
   * tests above exercise checkSource in-process; this one runs the actual
   * script the way `pnpm lint` does and asserts it really exits non-zero,
   * which is what makes CI fail.
   */
  it('the real script exits non-zero on an undecorated route (so pnpm lint fails)', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const { spawnSync } = await import('node:child_process');

    const script = path.resolve(__dirname, '../scripts/check-route-permissions.js');
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'route-perm-check-'));

    try {
      fs.writeFileSync(
        path.join(fixtureDir, 'bad.controller.ts'),
        `@Controller('widgets')
export class WidgetsController {
  @Get()
  findAll() {
    return [];
  }
}
`,
      );

      const bad = spawnSync(process.execPath, [script, fixtureDir], { encoding: 'utf8' });
      expect(bad.status).toBe(1);
      expect(bad.stderr).toContain('has neither @Public() nor @RequirePermission(...)');

      // Same script, same fixture dir, once the route is decorated: exit 0.
      fs.writeFileSync(
        path.join(fixtureDir, 'bad.controller.ts'),
        `@Controller('widgets')
export class WidgetsController {
  @RequirePermission('widget.view')
  @Get()
  findAll() {
    return [];
  }
}
`,
      );

      const good = spawnSync(process.execPath, [script, fixtureDir], { encoding: 'utf8' });
      expect(good.status).toBe(0);
    } finally {
      fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
  });
});
