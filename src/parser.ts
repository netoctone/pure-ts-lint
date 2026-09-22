import { readFileSync } from 'node:fs';
import { parseSync } from 'oxc-parser';
import type * as T from 'oxc-parser';

type LintRule = 'pure-ts/immutable' | 'pure-ts/typecast';

interface LinterContext {
  path: string;
  program: string;
}

// internal
interface LintErr {
  rule: LintRule;
  node: T.Span;
  msg: string;
}

export interface LintError {
  rule: LintRule;
  line: string;
  msg: string;
}

// utils:

const getCodeChunk = (ctx: LinterContext, node: T.Span): string => {
  return ctx.program.substring(node.start, node.end);
};

const getCodeLine = (
  ctx: LinterContext,
  node: T.Span
): { row: number; col: number; code: string } => {
  let curLine = 1;
  let curLineStart = 0;
  for (let i = 0; i < ctx.program.length; i += 1) {
    if (i === node.start) {
      const restCode = ctx.program.substring(curLineStart);
      return {
        row: curLine,
        col: 1 + i - curLineStart,
        code: restCode.split('\n')[0] ?? restCode
      };
    }
    if (ctx.program.charAt(i) === '\n') {
      curLine += 1;
      curLineStart = i + 1;
    }
  }
  return {
    row: -1,
    col: -1,
    code: ''
  };
};

const getCodeLineToPrint = (ctx: LinterContext, node: T.Span): string => {
  const { row, col, code } = getCodeLine(ctx, node);
  return `${row}:${col} ${code}`;
};

// print utils (most simple):

const printCodeLine = (ctx: LinterContext, node: T.Span): void => {
  console.log(getCodeLineToPrint(ctx, node));
};

const printCodeChunk = (ctx: LinterContext, node: T.Span): void => {
  console.log(getCodeChunk(ctx, node));
};

// parser fns utils:

const isSpecFile = (ctx: LinterContext): boolean => {
  return ctx.path.endsWith('.spec.ts');
};

const isAllowedAssignmentTarget = (ctx: LinterContext, node: T.AssignmentTarget): boolean => {
  if (getCodeChunk(ctx, node) === 'module.exports') {
    return true;
  }
  // TODO: maybe remove once `overrides` config is implemented:
  if (isSpecFile(ctx)) {
    return true;
  }
  return false;
};

const isAllowedLetOrVar = (ctx: LinterContext, node: T.Declaration): boolean => {
  if (isSpecFile(ctx)) {
    return true;
  }
  return false;
};

const isAllowedTSAsExpression = (ctx: LinterContext, node: T.TSAsExpression): boolean => {
  if (isSpecFile(ctx)) {
    return true;
  }
  if (node.expression.type === 'ArrayExpression' && node.expression.elements.length === 0) {
    return true;
  }
  return false;
};

// === parser fns for various node types start ===

// they are not arrow functions because of complex cross-dependencies that are much easier with js `function` hoisting https://developer.mozilla.org/en-US/docs/Glossary/Hoisting
// that is, `const`/`let` in most cases are better than `var`/`function`, but not always.

function parseDeclaration(ctx: LinterContext, node: T.Declaration): LintErr[] {
  switch (node.type) {
    case 'ClassDeclaration':
      return node.body.body.flatMap((itemNode) => parseClassBodyNode(ctx, itemNode));
    case 'FunctionDeclaration':
    case 'FunctionExpression':
    case 'TSDeclareFunction':
    case 'TSEmptyBodyFunctionExpression':
      if (node.body) {
        return parseBody(ctx, node.body.body);
      }
      return [];
    case 'VariableDeclaration':
      if (node.kind === 'let' || node.kind === 'var') {
        if (isAllowedLetOrVar(ctx, node)) {
          return [];
        }
        return [
          {
            rule: 'pure-ts/immutable',
            node,
            msg: 'Do not use let/var - only use const'
          }
        ];
      }
      // TODO: potentially worth to ban `using`, `await using`
      // const, using, await using:
      return node.declarations.flatMap((itemNode) =>
        itemNode.init ? parseExpression(ctx, itemNode.init) : []
      );
    default:
      return [];
  }
}

function parseObjectProperty(ctx: LinterContext, node: T.ObjectPropertyKind): LintErr[] {
  switch (node.type) {
    case 'SpreadElement':
      return parseExpression(ctx, node.argument);
    case 'Property':
      return parseExpression(ctx, node.value);
    default:
      return [];
  }
}

function parseArguments(ctx: LinterContext, args: T.Argument[]): LintErr[] {
  return args.flatMap((arg) => {
    return arg.type === 'SpreadElement'
      ? parseExpression(ctx, arg.argument)
      : parseExpression(ctx, arg);
  });
}

function parseExpression(ctx: LinterContext, node: T.Expression): LintErr[] {
  switch (node.type) {
    case 'ArrowFunctionExpression':
      if (node.body.type === 'BlockStatement') {
        return parseBody(ctx, node.body.body);
      }
      return parseExpression(ctx, node.body);
    case 'AssignmentExpression':
      const leftErrs = isAllowedAssignmentTarget(ctx, node.left)
        ? []
        : [
            {
              rule: 'pure-ts/immutable' as const,
              node,
              msg: "Do not reassign variable's value unless absolutely necessary."
            }
          ];
      const rightErrs = parseExpression(ctx, node.right);
      return [...leftErrs, ...rightErrs];
    case 'CallExpression':
      return parseArguments(ctx, node.arguments);
    case 'NewExpression':
      return [...parseExpression(ctx, node.callee), ...parseArguments(ctx, node.arguments)];
    case 'ObjectExpression':
      return node.properties.flatMap((itemNode) => parseObjectProperty(ctx, itemNode));
    case 'ParenthesizedExpression':
      return parseExpression(ctx, node.expression);
    case 'TSAsExpression':
      if (isAllowedTSAsExpression(ctx, node)) {
        return [];
      }
      return [
        {
          rule: 'pure-ts/typecast',
          node,
          msg: 'Do no use `as` typecast. Consider instead using TypeScript type narrowing based on type guards aka type predicates - https://www.typescriptlang.org/docs/handbook/advanced-types.html#user-defined-type-guards'
        }
      ];
    default:
      return [];
  }
}

function parseBodyNode(ctx: LinterContext, node: T.Directive | T.Statement): LintErr[] {
  switch (node.type) {
    case 'ExportNamedDeclaration':
      if (node.declaration) {
        return parseDeclaration(ctx, node.declaration);
      }
      return [];
    case 'ExpressionStatement':
      return parseExpression(ctx, node.expression);
    case 'ReturnStatement':
      if (node.argument) {
        return parseExpression(ctx, node.argument);
      }
      return [];
    default:
      // avoid `as T.Declaration` - it only works because `parseDeclaration` returns `[]` for non-recognized node.type values
      return parseDeclaration(ctx, node as T.Declaration);
  }
}

const MSG_MUTABLE_CLASS_PROPERTY =
  'Do not define mutable class property - consider instead using readonly property or ngrx action/reducer/store/selector for things that really need to mutate';

// TODO: rewrite via parsing AST nodes (similar to all other parse* fns):
const isChunkAnAllowedFnCall = (codeChunk: string, allowedFns: string[]): boolean => {
  return allowedFns.some(
    (prefix) => codeChunk.startsWith(`${prefix}(`) || codeChunk.startsWith(`${prefix}<`)
  );
};

function parseClassPropertyDefinition(ctx: LinterContext, node: T.PropertyDefinition): LintErr[] {
  if (node.readonly) {
    return [];
  }

  // allowed Angular component decorators - @Input, @Output:
  const isAngularInputOrOutput = node.decorators.some((dec) => {
    const decChunk = getCodeChunk(ctx, dec.expression);
    return isChunkAnAllowedFnCall(decChunk, ['Input', 'Output']);
  });
  if (isAngularInputOrOutput) {
    return [];
  }

  // no initial value:
  if (!node.value) {
    return [{ rule: 'pure-ts/immutable', node, msg: MSG_MUTABLE_CLASS_PROPERTY }];
  }

  // allowed initial values for Angular:
  const initValueChunk = getCodeChunk(ctx, node.value);
  if (
    !isChunkAnAllowedFnCall(initValueChunk, [
      'inject',
      'input',
      'input.required',
      'output',
      'computed',
      'this.store.selectSignal'
    ])
  ) {
    return [{ rule: 'pure-ts/immutable', node, msg: MSG_MUTABLE_CLASS_PROPERTY }];
  }
  return [];
}

function parseClassBodyNode(ctx: LinterContext, node: T.ClassElement): LintErr[] {
  switch (node.type) {
    case 'MethodDefinition':
      if (node.value.body) {
        return parseBody(ctx, node.value.body.body);
      }
      return [];
    case 'PropertyDefinition':
      return parseClassPropertyDefinition(ctx, node);
    case 'StaticBlock':
      // TODO: need to process this?
      return [];
    default:
      return [];
  }
}

function parseBody(ctx: LinterContext, body: (T.Directive | T.Statement)[]): LintErr[] {
  return body.flatMap((itemNode) => parseBodyNode(ctx, itemNode));
}

// TODO: maybe ban standalone identifier that does nothing e.g. `a;`, `window;` (unless it's banned by eslint already)

// === parser fns for various node types end ===

export const parseAndLint = (filePath: string): LintError[] => {
  const bytes = readFileSync(filePath);
  const programString = bytes.toString();
  const programAST: T.Program = parseSync(filePath, programString).program;
  const context = { path: filePath, program: programString };
  const lintErrs = parseBody(context, programAST.body);
  return lintErrs.map((e) => ({
    rule: e.rule,
    msg: e.msg,
    line: getCodeLineToPrint(context, e.node)
  }));
};
