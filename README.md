# pure-ts-lint

TypeScript linter to prioritise pure functions and type safety (beyond TS strict: true).

Inspired by `eslint-plugin-react-hooks` `react-hooks/immutability` rule.

Powered by high-performance oxc-parser (oxlint is 50x - 100x faster than ESLint)

## Why

Immutable objects and data structures are first-class citizens in some great programming languages like Erlang, Scala, Haskell, OCaml etc.

This is because they prevent mistakes in distributed systems and provide thread-safe data.

It is also true for some languages that compile to JavaScript - Elm, PureScript, ClojureScript.

The success of React, Redux, RxJS, effects, etc. prove that immutability is very useful for production grade TypeScript client-side applications just as well.

However, TypeScript itself does not prioritise immutability over mutability.

Hence the existence of libraries like `immutable.js` and custom linter rules like `react-hooks/immutability`.

This project attempts to prioritise immutability in all of the application's code via custom linter rule `pure-ts/immutable`.

It doesn't fully ban mutability.

If it is really necessary, linter rule(s) can be disabled via comments `// ptsl-disable-line` and `// ptsl-disable-next-line`.

## Usage

### If installing globally

```sh
npm install -g pure-ts-lint
```

Run

```sh
ptsl
```

### If installing locally

After installing locally npm package `pure-ts-lint`

Add `ptsl` to your package.json lint script: `"lint": "ptsl && echo 'ptsl done' && eslint ."`

Or run

```sh
./node_modules/.bin/ptsl
```

## Rules

### pure-ts/immutable

Examples of _incorrect_ code:

```ts
// Do not use let/var - only use const (or explicit disable comment)
var a;
let x;
var a2 = 1;
let x2 = 1;

// Do not change variable's value unless absolutely necessary.
a = 1;
a.b = 1;
a++;
a += 1;

class Component {
  // Do not define mutable class property - consider instead using readonly property or redux/ngrx action/reducer/store/selector for things that really need to mutate. Also can consider react hook or angular signal if mutable state is small and used in just one or few classes.
  public a;
  public b = 1;
}
```

Examples of _correct_ code for pure-ts/immutable rule:

```ts
const a = 1;

class Component {
  public readonly a = 1;
  private readonly b = 2;

  public store = inject(Store);
  public c = this.store.selectSignal(...);
  public d = signal(1);
  public e = input();
  public f = output();
}
```

### pure-ts/typecast

Examples of _incorrect_ code:

```ts
const x = { a: 1 } as object; // Do not use `as` type assertion (typecast). Consider instead using TypeScript type narrowing based on type guards aka type predicates - https://www.typescriptlang.org/docs/handbook/advanced-types.html#user-defined-type-guards

const y = <object>{ b: 2 }; // Do not use `<>` type assertion (typecast). Consider instead using TypeScript type narrowing based on type guards aka type predicates - https://www.typescriptlang.org/docs/handbook/advanced-types.html#user-defined-type-guards
```

Examples of _correct_ code for pure-ts/typecast rule:

```ts
const x = { a: 1 } as const;
const y = <const>{ b: 2 };
```

## Disable rules

Supports an advanced function-scope single-line comment `ptsl-disable-fn`

And also supports ESLint-like single line comments `ptsl-disable-line`, `ptsl-disable-next-line`

### ptsl-disable-fn

Disables lint rule(s) for the whole body of a function,

including nested functions if they are defined in the body.

Should be specified on the first line of the function body on a line by itself.

```ts
const lambda = () => {
  // ptsl-disable-fn immutable
  let x = 0;
  const increment = () => {
    return x += 1;
  }
  return increment;
};

function lambda2(): number {
  // ptsl-disable-fn typecast
  return <number>'10';
}
```

### ptsl-disable-next-line

```ts
type Color = 'red' | 'green';

// ptsl-disable-next-line immutable, typecast
let a = ['red'] as Color[];

// ptsl-disable-next-line pure-ts/immutable, pure-ts/typecast
let b = ['green'] as Color[];

// ptsl-disable-next-line
for (let i = 0; i < 10; i += 1) {
  console.log(i);
}
```

### ptsl-disable-line

```ts
let x = 0; // ptsl-disable-line pure-ts/immutable
let y = 1; // ptsl-disable-line immutable
```

## Bulk suppressions

Intended for gradual legacy codebase improvement that has too many rule violations to fix or disable at once.

Inspired by ESLint bulk suppressions, but is much simpler.

Init with

```sh
ptsl --suppress-init
```

It will create `ptsl-suppression.json` files in each folder that has `package.json` and in root folder (regardless if it has `package.json`).

These files contain per-file per-rule maximum allowed number of errors.

Subsequent

```sh
ptsl --suppress
```

run will succeed if in all typescript files the number of current rule errors is not exceeding the maximum numbers described in ptsl-suppression.json files.

Otherwise, `ptsl --suppress` run will fail - only for those files and those rules that exceeded the maximum.

To decrease the maximums (or fail if some maximums were exceeded) run

```sh
ptsl --suppress-prune
```

Useful to run before finalising each improvement commit.

In some cases you may need the opposite. To increase maximums simply reset them via running `ptsl --suppress-init` again.

## Linting JavaScript

To lint JavaScript files in addition to TypeScript, use `--js` option

```sh
ptsl --js
```
