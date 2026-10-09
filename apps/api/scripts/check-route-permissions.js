#!/usr/bin/env node
'use strict';

/**
 * TZ 3.3 / step 0.3 requirement E: "CI'da skript barcha controller
 * route'larini skanerlaydi: guard'siz yoki @Public() belgisiz route —
 * build xatosi." Scans every *.controller.ts for HTTP-verb-decorated
 * methods (and the whole class) that have neither @Public() nor
 * @RequirePermission(...) attached, and fails the build if any are found.
 *
 * Exported as a plain function (checkSource) so a unit test can prove this
 * actually catches a bad example without needing a real build.
 */

const fs = require('node:fs');
const path = require('node:path');

const HTTP_VERB_DECORATOR = /^@(Get|Post|Put|Patch|Delete|All)\(/;
const DECORATOR_LINE = /^@([A-Za-z]+)\(/;
const GUARD_DECORATORS = new Set(['Public', 'RequirePermission']);

/**
 * @param {string} source
 * @returns {{ line: number, decorator: string }[]} violations
 */
const CLASS_DECORATOR = /^@Controller\(/;

function checkSource(source) {
  const lines = source.split('\n').map((line) => line.trim());

  // Only a guard decorator stacked directly on @Controller(...) applies to
  // every route in the class — a decorator on one method must not exempt
  // sibling methods from this check.
  let classHasGuardDecorator = false;
  for (let i = 0; i < lines.length; i += 1) {
    if (!CLASS_DECORATOR.test(lines[i])) {
      continue;
    }
    let start = i;
    while (start > 0 && DECORATOR_LINE.test(lines[start - 1])) {
      start -= 1;
    }
    const block = lines.slice(start, i + 1);
    classHasGuardDecorator = block.some(
      (line) => GUARD_DECORATORS.has((DECORATOR_LINE.exec(line) ?? [])[1]),
    );
    break;
  }

  const violations = [];

  for (let i = 0; i < lines.length; i += 1) {
    const verbMatch = HTTP_VERB_DECORATOR.exec(lines[i]);
    if (!verbMatch) {
      continue;
    }

    // Collect the contiguous run of decorator lines this route decorator
    // belongs to: walk up and down from this line while lines are
    // decorators (our codebase always stacks one decorator per line).
    let start = i;
    while (start > 0 && DECORATOR_LINE.test(lines[start - 1])) {
      start -= 1;
    }
    let end = i;
    while (end < lines.length - 1 && DECORATOR_LINE.test(lines[end + 1])) {
      end += 1;
    }

    const block = lines.slice(start, end + 1);
    const hasGuardDecorator = block.some(
      (line) => GUARD_DECORATORS.has((DECORATOR_LINE.exec(line) ?? [])[1]),
    );

    if (!hasGuardDecorator && !classHasGuardDecorator) {
      violations.push({ line: i + 1, decorator: verbMatch[0] });
    }
  }

  return violations;
}

function findControllerFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findControllerFiles(full));
    } else if (entry.name.endsWith('.controller.ts')) {
      results.push(full);
    }
  }
  return results;
}

function main() {
  const srcDir = path.join(__dirname, '..', 'src');
  const files = findControllerFiles(srcDir);
  let failed = false;

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    const violations = checkSource(source);
    for (const violation of violations) {
      failed = true;
      console.error(
        `${path.relative(process.cwd(), file)}:${violation.line}: ${violation.decorator} route has neither @Public() nor @RequirePermission(...)`,
      );
    }
  }

  if (failed) {
    console.error('\ncheck-route-permissions: every route needs @Public() or @RequirePermission(...).');
    process.exit(1);
  }

  console.log(`check-route-permissions: ${files.length} controller file(s) OK.`);
}

module.exports = { checkSource };

if (require.main === module) {
  main();
}
