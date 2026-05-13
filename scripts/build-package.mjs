import { build } from "esbuild";
import { rmSync } from "node:fs";

const outdir = "dist/package";
const shared = {
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22.5",
  sourcemap: true,
  banner: { js: "#!/usr/bin/env node" },
  external: [
    "node:*",
    "@fastify/cors",
    "@modelcontextprotocol/sdk",
    "@modelcontextprotocol/sdk/*",
    "commander",
    "fastify",
    "zod",
    "zod/*"
  ],
  tsconfig: "tsconfig.base.json"
};

rmSync(outdir, { recursive: true, force: true });

await Promise.all([
  build({
    ...shared,
    entryPoints: ["packages/cli/src/index.ts"],
    outfile: `${outdir}/project-context.js`
  }),
  build({
    ...shared,
    entryPoints: ["packages/mcp-server/src/server.ts"],
    outfile: `${outdir}/project-context-mcp.js`
  }),
  build({
    ...shared,
    entryPoints: ["packages/api/src/server.ts"],
    outfile: `${outdir}/project-context-api.js`
  })
]);
