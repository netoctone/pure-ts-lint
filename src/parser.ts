import { readFileSync } from 'node:fs';
import { parseSync } from 'oxc-parser';
import type * as T from 'oxc-parser';

type LintRule = 'pure-ts/immutable' | 'pure-ts/typecast';

type RowToDisabledRules = Map<number, (LintRule | 'all')[]>; // 0-indexed row number to ignored rules array

interface LinterContext {
  path: string;
  program: string;
  programLines: { code: string; start: number }[]; // 0-indexed row to line-of-code string and 0-indexed pos (line's first character's absolute offset in a whole file)
  filePosToRow: number[]; // 0-indexed pos to 0-indexed row number
  rowToDisabledRules: RowToDisabledRules;
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

const filterLintErr = (ctx: LinterContext, err: LintErr): LintErr[] => {
  const row = ctx.filePosToRow[err.node.start];
  if (!!row || row === 0) {
    const disabledRules = ctx.rowToDisabledRules.get(row);
    if (disabledRules?.includes('all') || disabledRules?.includes(err.rule)) {
      return [];
    }
  }
  return [err];
};

const genFilePosToRow = (program: string): number[] => {
  const result = new Array<number>(program.length); // eslint-disable-line no-new-array
  let curRow = 0;
  for (let i = 0; i < program.length; i += 1) {
    result[i] = curRow;
    // TODO: potentially may have issues with \r\n:
    if (program.charAt(i) === '\n') {
      curRow += 1;
    }
  }
  return result;
};

const getCodeChunk = (ctx: LinterContext, node: T.Span): string => {
  return ctx.program.substring(node.start, node.end);
};

const getCodeLine = (
  ctx: LinterContext,
  node: T.Span
): { row: number; col: number; code: string } => {
  const row = ctx.filePosToRow[node.start];
  const programLine = ctx.programLines[row ?? 0];
  if ((!!row || row === 0) && programLine) {
    const col = node.start - programLine.start;
    // converting 0-indexed row and col to 1-indexed:
    return { row: row + 1, col: col + 1, code: programLine.code };
  }
  // since row and col are 1-indexed, 0 (and '') are good falsy values to indicate failure:
  return { row: 0, col: 0, code: '' };
};

const getCodeLineToPrint = (ctx: LinterContext, node: T.Span): string => {
  const { row, col, code } = getCodeLine(ctx, node);
  return `${row}:${col} ${code}`;
};

// print utils (most simple):

const _printCodeLine = (ctx: LinterContext, node: T.Span): void => {
  console.log(getCodeLineToPrint(ctx, node));
};

const _printCodeChunk = (ctx: LinterContext, node: T.Span): void => {
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

const isAllowedLetOrVar = (ctx: LinterContext, _node: T.Declaration): boolean => {
  if (isSpecFile(ctx)) {
    return true;
  }
  return false;
};

const isAllowedTypecast = (
  ctx: LinterContext,
  node: T.TSAsExpression | T.TSTypeAssertion
): boolean => {
  if (node.typeAnnotation.type === 'TSTypeReference') {
    const typeNameNode = node.typeAnnotation.typeName;
    if (typeNameNode.type === 'Identifier' && typeNameNode.name === 'const') {
      return true;
    }
  }
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

function parseFunction(ctx: LinterContext, node: T.Function): LintErr[] {
  // TODO: maybe parse node.params as well? (nested T.AssignmentPattern contains expression, although it's ulikely to have side effects)
  if (node.body) {
    return parseBody(ctx, node.body.body);
  }
  return [];
}

function parseDeclaration(ctx: LinterContext, node: T.Declaration): LintErr[] {
  switch (node.type) {
    case 'ClassDeclaration':
      return node.body.body.flatMap((itemNode) => parseClassBodyNode(ctx, itemNode));
    case 'FunctionDeclaration':
    case 'FunctionExpression':
    case 'TSDeclareFunction':
    case 'TSEmptyBodyFunctionExpression':
      return parseFunction(ctx, node);
    case 'VariableDeclaration':
      if (node.kind === 'let' || node.kind === 'var') {
        if (isAllowedLetOrVar(ctx, node)) {
          return [];
        }
        return filterLintErr(ctx, {
          rule: 'pure-ts/immutable',
          node,
          msg: 'Do not use let/var - only use const'
        });
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
  // node.type not processing:
  // ChainExpression, ClassExpression, ImportExpression, TaggedTemplateExpression,
  // JSXElement, JSXFragment, TSInstantiationExpression, V8IntrinsicExpression
  switch (node.type) {
    case 'ArrayExpression':
      return node.elements.flatMap((itemNode) =>
        !itemNode
          ? []
          : itemNode.type === 'SpreadElement'
            ? parseExpression(ctx, itemNode.argument)
            : parseExpression(ctx, itemNode)
      );
    case 'ArrowFunctionExpression':
      if (node.body.type === 'BlockStatement') {
        return parseBody(ctx, node.body.body);
      }
      return parseExpression(ctx, node.body);
    case 'AssignmentExpression':
      const leftErrs = isAllowedAssignmentTarget(ctx, node.left)
        ? []
        : filterLintErr(ctx, {
            rule: 'pure-ts/immutable' as const,
            node,
            msg: "Do not reassign variable's value unless absolutely necessary."
          });
      const rightErrs = parseExpression(ctx, node.right);
      return [...leftErrs, ...rightErrs];
    case 'AwaitExpression':
      return parseExpression(ctx, node.argument);
    case 'BinaryExpression':
      return [
        ...(node.operator !== 'in' ? parseExpression(ctx, node.left) : []),
        ...parseExpression(ctx, node.right)
      ];
    case 'CallExpression':
      return [...parseExpression(ctx, node.callee), ...parseArguments(ctx, node.arguments)];
    case 'ConditionalExpression':
      return [
        ...parseExpression(ctx, node.test),
        ...parseExpression(ctx, node.consequent),
        ...parseExpression(ctx, node.alternate)
      ];
    case 'FunctionExpression':
      return parseFunction(ctx, node);
    case 'LogicalExpression':
      return [...parseExpression(ctx, node.left), ...parseExpression(ctx, node.right)];
    case 'MemberExpression':
      return [
        ...parseExpression(ctx, node.object),
        ...(node.property.type !== 'Identifier' && node.property.type !== 'PrivateIdentifier'
          ? parseExpression(ctx, node.property)
          : [])
      ];
    case 'NewExpression':
      return [...parseExpression(ctx, node.callee), ...parseArguments(ctx, node.arguments)];
    case 'ObjectExpression':
      return node.properties.flatMap((itemNode) => parseObjectProperty(ctx, itemNode));
    case 'ParenthesizedExpression':
      return parseExpression(ctx, node.expression);
    case 'SequenceExpression':
      return node.expressions.flatMap((itemNode) => parseExpression(ctx, itemNode));
    case 'TemplateLiteral':
      return node.expressions.flatMap((itemNode) => parseExpression(ctx, itemNode));
    case 'TSAsExpression':
    case 'TSTypeAssertion':
      if (isAllowedTypecast(ctx, node)) {
        return [];
      }
      return filterLintErr(ctx, {
        rule: 'pure-ts/typecast',
        node,
        msg: `Do not use \`${node.type === 'TSAsExpression' ? 'as' : '<>'}\` type assertion (typecast). Consider instead using TypeScript type narrowing based on type guards aka type predicates - https://www.typescriptlang.org/docs/handbook/advanced-types.html#user-defined-type-guards`
      });
    case 'TSNonNullExpression':
      return parseExpression(ctx, node.expression);
    case 'UnaryExpression':
      return parseExpression(ctx, node.argument);
    case 'UpdateExpression':
      return filterLintErr(ctx, {
        rule: 'pure-ts/immutable' as const,
        node,
        msg: "Do not change variable's value unless absolutely necessary."
      });
    case 'YieldExpression':
      if (node.argument) {
        return parseExpression(ctx, node.argument);
      }
      return [];
    default:
      return [];
  }
}

function parseForStatementInit(ctx: LinterContext, node: T.ForStatementInit): LintErr[] {
  if (node.type === 'VariableDeclaration') {
    return parseDeclaration(ctx, node);
  } else {
    return parseExpression(ctx, node);
  }
}

function parseBodyNode(ctx: LinterContext, node: T.Directive | T.Statement): LintErr[] {
  switch (node.type) {
    case 'BlockStatement':
      return parseBody(ctx, node.body);
    case 'DoWhileStatement':
      return [...parseBodyNode(ctx, node.body), ...parseExpression(ctx, node.test)];
    case 'ExportNamedDeclaration':
      if (node.declaration) {
        return parseDeclaration(ctx, node.declaration);
      }
      return [];
    case 'ExpressionStatement':
      return parseExpression(ctx, node.expression);
    case 'ForStatement':
      return [
        ...(node.init ? parseForStatementInit(ctx, node.init) : []),
        ...(node.test ? parseExpression(ctx, node.test) : []),
        ...(node.update ? parseExpression(ctx, node.update) : []),
        ...parseBodyNode(ctx, node.body)
      ];
    case 'IfStatement':
      return [
        ...parseExpression(ctx, node.test),
        ...parseBodyNode(ctx, node.consequent),
        ...(node.alternate ? parseBodyNode(ctx, node.alternate) : [])
      ];
    case 'ReturnStatement':
      if (node.argument) {
        return parseExpression(ctx, node.argument);
      }
      return [];
    case 'WhileStatement':
      return [...parseExpression(ctx, node.test), ...parseBodyNode(ctx, node.body)];
    default:
      // avoid `as T.Declaration` - it only works because `parseDeclaration` returns `[]` for non-recognized node.type values
      return parseDeclaration(ctx, node as T.Declaration);
  }
}

const MSG_MUTABLE_CLASS_PROPERTY =
  'Do not define mutable class property - consider instead using readonly property or redux/ngrx action/reducer/store/selector for things that really need to mutate. Also can consider react hook or angular signal if mutable state is small and used in just one or few classes.';

// TODO: rewrite via parsing AST nodes (similar to all other parse* fns):
const isChunkAnAllowedFnCall = (codeChunk: string, allowedFns: string[]): boolean => {
  return allowedFns.some(
    (prefix) => codeChunk.startsWith(`${prefix}(`) || codeChunk.startsWith(`${prefix}<`)
  );
};

function parseClassPropertyDefinition(ctx: LinterContext, node: T.PropertyDefinition): LintErr[] {
  const getMainErrs = () => {
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
      return filterLintErr(ctx, {
        rule: 'pure-ts/immutable',
        node,
        msg: MSG_MUTABLE_CLASS_PROPERTY
      });
    }

    // allowed initial values for Angular:
    const initValueChunk = getCodeChunk(ctx, node.value);
    if (
      !isChunkAnAllowedFnCall(initValueChunk, [
        'inject',
        'signal',
        'computed',
        'input',
        'input.required',
        'output',
        'this.store.selectSignal'
      ])
    ) {
      return filterLintErr(ctx, {
        rule: 'pure-ts/immutable',
        node,
        msg: MSG_MUTABLE_CLASS_PROPERTY
      });
    }
    return [];
  };

  const mainErrs = getMainErrs();
  const valueExpressionErrs = node.value ? parseExpression(ctx, node.value) : [];

  if (valueExpressionErrs.length) {
    return [...mainErrs, ...valueExpressionErrs];
  } else {
    return mainErrs;
  }
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

const genProgramLines = (programString: string): { code: string; start: number }[] => {
  // TODO: potentially may have issues with \r\n:
  const programLinesCode = programString.split('\n');
  const programLines = new Array<{ code: string; start: number }>(programLinesCode.length); // eslint-disable-line no-new-array
  let lineStart = 0; // absolute offset in whole file
  for (let i = 0; i < programLinesCode.length; i += 1) {
    const lineCode = programLinesCode[i]!;
    programLines[i] = { code: lineCode, start: lineStart };
    // TODO: potentially may have issues with \r\n:
    lineStart += lineCode.length + 1; // + 1 because of dropped '\n'
  }
  return programLines;
};

const IGNORE_CUR_LINE = 'ptsl-disable-line';
const IGNORE_NEXT_LINE = 'ptsl-disable-next-line';

const genRowToDisabledRules = (
  comments: T.Comment[],
  filePosToRow: number[]
): RowToDisabledRules => {
  const result = new Map();
  for (const comment of comments) {
    const row = filePosToRow[comment.start];
    // TODO: support comment.type = 'Block' as well:
    if ((!!row || row === 0) && comment.type === 'Line') {
      const [directive, ...rules] = comment.value.trim().split(/,?\s/);
      if (directive === IGNORE_CUR_LINE || directive === IGNORE_NEXT_LINE) {
        const rowAffected = directive === IGNORE_CUR_LINE ? row : row + 1;
        const disabledRules = rules.length ? rules : ['all' as const];
        const existingRules = result.get(rowAffected);
        result.set(
          rowAffected,
          existingRules ? [...existingRules, ...disabledRules] : disabledRules
        );
      }
    }
  }
  return result;
};

export const parseAndLint = (filePath: string): LintError[] => {
  const bytes = readFileSync(filePath);
  const programString = bytes.toString();
  const { program: programAST, comments } = parseSync(filePath, programString);

  const programLines = genProgramLines(programString);
  const filePosToRow = genFilePosToRow(programString);
  const rowToDisabledRules = genRowToDisabledRules(comments, filePosToRow);
  const context = {
    path: filePath,
    program: programString,
    programLines,
    filePosToRow,
    rowToDisabledRules
  };
  const lintErrs = parseBody(context, programAST.body);

  return lintErrs.map((e) => ({
    rule: e.rule,
    msg: e.msg,
    line: getCodeLineToPrint(context, e.node)
  }));
};
