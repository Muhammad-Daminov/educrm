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
});
