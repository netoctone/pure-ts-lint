# pure-ts-lint

TypeScript linter to prioritise pure functions and type safety (beyond TS strict: true).

Inspired by eslint-plugin-react-hooks react-hooks/immutability rule.

Powered by oxc-parser.

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

Add `ptsl` to your package.json lint script: `"lint": "ptsl && eslint ."`

Or run

```sh
./node_modules/.bin/ptsl
```

## Rules

pure-ts/immutable

pure-ts/typecast

## Disable rules

Supports eslint-like single line comments `ptsl-diable-line` and `ptsl-disable-next-line`

```ts
type Color = 'red' | 'green';

// ptsl-disable-next-line pure-ts/immutable, pure-ts/typecast
let a = ['red'] as Color[];
```

```ts
let x = 0; // ptsl-disable-line
```
