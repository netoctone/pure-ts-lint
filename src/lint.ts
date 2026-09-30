#!/usr/bin/env node
import { globSync } from 'node:fs';

import { parseAndLint } from './parser.ts';
import { suppress, type FileAndErrs } from './suppress.ts';

const lintJS = process.argv.includes('--js');

const startAt = new Date().getTime();
const globConfig = {
  exclude: ['node_modules', 'dist']
};
const packages = [
  // ensure cwd() will get suppressions.json file even if cwd() doesn't contain package.json file:
  `${process.cwd()}/package.json`,
  ...globSync(`${process.cwd()}/**/package.json`, globConfig)
];
const files = globSync(
  `${process.cwd()}/**/*.{ts,mts,tsx${lintJS ? ',js,mjs,jsx' : ''}}`,
  globConfig
);

const filesErrs = files
  .map((file) => ({ file, errs: parseAndLint(file) }))
  .filter(({ errs }) => errs.length > 0);

export const remainingFilesErrs: FileAndErrs[] = suppress(process.argv, packages, filesErrs, process.cwd());
const endAt = new Date().getTime();

let totalErrors = 0; // ptsl-disable-line immutable
for (const { file, errs } of remainingFilesErrs) {
  totalErrors += errs.length; // ptsl-disable-line immutable
  console.log('');
  console.log(file);
  for (const err of errs) {
    console.log(err);
  }
}
if (totalErrors === 0) {
  console.log(`0 errors. Took ${endAt - startAt}ms`);
  process.exit(0);
} else {
  console.log('');
  console.log(`x ${totalErrors} errors. Took ${endAt - startAt}ms`);
  process.exit(1);
}
