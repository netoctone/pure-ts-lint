import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import type { LintError } from './parser.ts';

export interface FileAndErrs {
  file: string;
  errs: LintError[];
}

interface DirsTree {
  suppressFile?: string;
  nodes: { [folder: string]: DirsTree };
}

const PTSL_SUPPRESSIONS_JSON = 'ptsl-suppressions.json' as const;

const getPathParts = (file: string): string[] => {
  const parts = file.split('/');
  parts.pop();
  if (parts[0] === '') {
    parts.shift();
  }
  return parts;
};

const genDirsTree = (packages: string[]): DirsTree => {
  const dirsTree: DirsTree = { nodes: {} };
  for (const packageFile of packages) {
    const parts = getPathParts(packageFile);
    let node = dirsTree;
    for (const part of parts) {
      node = node.nodes[part] ||= { nodes: {} };
    }
    const suppressFileDir = packageFile.substring(
      0,
      packageFile.length - 'package.json'.length - 1
    );
    node.suppressFile = `${suppressFileDir}/${PTSL_SUPPRESSIONS_JSON}`;
  }
  return dirsTree;
};

const findClosestSuppressFile = (tsFile: string, dirsTree: DirsTree): string => {
  const parts = getPathParts(tsFile);
  let suppressFile = dirsTree.suppressFile || '';
  let node = dirsTree;
  for (const part of parts) {
    const nextNode = node.nodes[part];
    if (!nextNode) {
      break;
    }
    node = nextNode;
    if (node.suppressFile) {
      suppressFile = node.suppressFile;
    }
  }
  return suppressFile;
};

interface RuleSuppData {
  max: number;
}

interface SingleFileRuleErrorsCounts {
  [rule: string]: RuleSuppData;
}

interface SuppressFileContent {
  [file: string]: SingleFileRuleErrorsCounts;
}

// maps suppression file's relative path to file's parsed content.
// path is relative to project root dir.
type SuppressFileToContentMap = Map<string, SuppressFileContent>;

const genSingleFileRuleErrorsCounts = (errs: LintError[]): SingleFileRuleErrorsCounts => {
  const res: SingleFileRuleErrorsCounts = {};
  for (const err of errs) {
    const ruleData = (res[err.rule] ||= { max: 0 });
    ruleData.max += 1;
  }
  return res;
};

const readAllSuppressionsFiles = (packages: string[]): SuppressFileToContentMap => {
  const res: SuppressFileToContentMap = new Map();
  for (const packageFile of packages) {
    const suppressFile = packageFile.replace('package.json', PTSL_SUPPRESSIONS_JSON);
    if (existsSync(suppressFile)) {
      res.set(suppressFile, JSON.parse(readFileSync(suppressFile).toString()));
    }
  }
  return res;
};

export const suppress = (
  argv: string[],
  packages: string[], // absolule paths
  filesErrs: FileAndErrs[],
  rootDir: string
): FileAndErrs[] => {
  const isSuppress = argv.includes('--suppress');
  const isSuppressInit = argv.includes('--suppress-init');
  const isSuppressPrune = argv.includes('--suppress-prune');

  const isEnabled = isSuppress || isSuppressInit || isSuppressPrune;
  if (!isEnabled) {
    return filesErrs;
  }

  const dirsTree: DirsTree = genDirsTree(packages);

  const suppFileToItsContent: SuppressFileToContentMap =
    isSuppress || isSuppressPrune
      ? // prettier
        readAllSuppressionsFiles(packages)
      : new Map();
  const remainingFilesErrsWithNulls = filesErrs.map((fileAndErrs) => {
    const { file, errs } = fileAndErrs;
    const fileRelative = file.substring(rootDir.length + 1);
    const suppressFile = findClosestSuppressFile(file, dirsTree);
    const fileLiveErrorsCounts = genSingleFileRuleErrorsCounts(errs);

    if (isSuppress || isSuppressPrune) {
      const suppFileContent = suppFileToItsContent.get(suppressFile);
      if (!suppFileContent) {
        return fileAndErrs; // ptsl-suppressions.json file not found = errors are not suppressed
      }
      const ruleToData = suppFileContent[fileRelative];
      if (!ruleToData) {
        return fileAndErrs; // ptsl-suppressions.json doesn't contain suppressions for `file` = errors are not suppressed
      }
      const rulesExceedingMaxErrors = Object.entries(fileLiveErrorsCounts)
        .map(([rule, { max }]) => {
          if (max > (ruleToData[rule]?.max || 0)) {
            return rule;
          }
          return null;
        })
        .filter((rule) => !!rule);
      suppFileContent[fileRelative] = fileLiveErrorsCounts; // safe to override, because `file` is processed now. Needed for `isSuppressPrune`
      if (rulesExceedingMaxErrors.length <= 0) {
        return null;
      }
      return { file, errs: errs.filter(({ rule }) => rulesExceedingMaxErrors.includes(rule)) };
    } else if (isSuppressInit) {
      const suppFileContent = suppFileToItsContent.get(suppressFile) || {};
      suppFileContent[fileRelative] = fileLiveErrorsCounts;
      suppFileToItsContent.set(suppressFile, suppFileContent);
      return null;
    }
  });
  const remainingFilesErrs = remainingFilesErrsWithNulls.filter((fileAndErrs) => !!fileAndErrs);

  if (isSuppressInit || (isSuppressPrune && remainingFilesErrs.length === 0)) {
    suppFileToItsContent.forEach((content, suppressFile) => {
      writeFileSync(suppressFile, JSON.stringify(content, null, 2));
    });
  }

  return remainingFilesErrs;
};
