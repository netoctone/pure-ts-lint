#!/usr/bin/env node
import { globSync } from 'glob';
import { readFileSync } from 'node:fs';

import { parseAndLint } from './parser.ts';
import { suppress, type FileAndErrs } from './suppress.ts';

const lintJS = process.argv.includes('--js');

const globConfig = {
  ignore: {
    childrenIgnored: (p: { name: string }) => {
      return p.name === 'node_modules' || p.name === 'dist';
    }
  }
};
const packages = [
  // ensure cwd() will get suppressions.json file even if cwd() doesn't contain package.json file:
  `${process.cwd()}/package.json`,
  ...globSync(`${process.cwd()}/**/package.json`, globConfig)
];
const files = globSync(`${process.cwd()}/**/*.{ts,mts,tsx${lintJS ? ',js,mjs,jsx' : ''}}`, globConfig);

const filesErrs = files
  .map((file) => ({ file, errs: parseAndLint(file) }))
  .filter(({ errs }) => errs.length > 0);

const remainigFilesErrs = suppress(process.argv, packages, filesErrs, process.cwd());

let totalErrors = 0;
for (const { file, errs } of remainigFilesErrs) {
  totalErrors += errs.length;
  console.log('');
  console.log(file);
  for (const err of errs) {
    console.log(err);
  }
}
if (totalErrors === 0) {
  process.exit(0);
} else {
  console.log('');
  console.log(`x ${totalErrors} errors`);
  process.exit(1);
}
