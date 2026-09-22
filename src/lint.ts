import { globSync } from 'glob';
import { readFileSync } from 'node:fs';

import { parseAndLint } from './parser.ts';

const files = globSync(`${process.cwd()}/**/*.{ts,tsx}`, {
  ignore: {
    childrenIgnored: (p) => {
      return p.name === 'node_modules';
    }
  }
});
let totalErrors = 0;
for (const file of files) {
  const errs = parseAndLint(file);
  totalErrors += errs.length;
  if (errs.length) {
    console.log('');
    console.log(file);
    for (const err of errs) {
      console.log(err);
    }
  }
}
if (totalErrors === 0) {
  process.exit(0);
} else {
  console.log('');
  console.log(`x ${(totalErrors)} errors`);
  process.exit(1);
}
