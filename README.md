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
