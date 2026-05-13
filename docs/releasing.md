# Releasing

This document is for package maintainers publishing
`@emipac/project-context-platform` to npm.

## Prerequisites

- npm account with publish access to the `@emipac` scope
- clean working tree
- Node.js 22.5+; Node.js 24+ recommended
- Docker available if you want to smoke-test sidecars before release

## Pre-Release Checklist

Run:

```bash
npm install
npm run typecheck
npm test
npm run build:package
```

Inspect package contents:

```bash
npm pack --dry-run
```

Confirm the tarball does not include generated or private local state:

- `.env`
- `.project-context/`
- `project-catalog.json`
- `spdd/`
- `requirements/`
- `node_modules/`

The expected package includes compiled entrypoints under `dist/package`, docs,
sidecar source, `.env.example`, `docker-compose.yml`, `README.md`, `LICENSE`,
and `package.json`.

## Versioning

Update the version in:

```text
package.json
package-lock.json
```

Use npm version helpers when appropriate:

```bash
npm version patch
npm version minor
npm version major
```

For prereleases:

```bash
npm version prerelease --preid beta
```

## Publish

Log in:

```bash
npm login
```

Publish publicly:

```bash
npm publish --access public
```

For a dry run:

```bash
npm publish --access public --dry-run
```

## Post-Release Smoke Checks

Check package metadata:

```bash
npm view @emipac/project-context-platform
```

Run the CLI with npm:

```bash
npx @emipac/project-context-platform projects list
```

Run the MCP executable help/smoke path from a temporary project if needed:

```bash
npx @emipac/project-context-platform project-context-mcp
```

For Cursor users, update MCP config examples only if executable names or required
environment variables changed.

