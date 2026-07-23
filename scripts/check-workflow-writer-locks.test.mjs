import assert from "node:assert/strict";
import test from "node:test";
import { validateWorkflowWriterSafety } from "./check-workflow-writer-locks.mjs";

const compliantWriter = `
name: writer
permissions:
  contents: write
concurrency:
  group: app-data-writers
  cancel-in-progress: false
jobs:
  write:
    steps:
      - name: Sync latest main
        run: |
          git fetch origin main --depth=1
          git reset --hard origin/main
      - name: Commit
        run: git push
`;

const compliantDeployer = `
name: deployer
permissions:
  contents: read
  issues: write
concurrency:
  group: app-data-writers
  cancel-in-progress: false
jobs:
  deploy:
    steps:
      - name: Sync latest main
        run: |
          git fetch origin main --depth=1
          git reset --hard origin/main
      - name: Build
        run: npm run build:netlify
      - name: Deploy site to Netlify
        id: production_deploy
        run: npm run deploy:production
      - name: Upload production deploy receipt
        if: always() && steps.production_deploy.outcome != 'skipped'
        uses: actions/upload-artifact@v4
        with:
          path: dist/netlify-deploy-receipt.json
`;

test("accepts a serialized writer that syncs main", () => {
  assert.deepEqual(validateWorkflowWriterSafety(compliantWriter, "writer.yml"), []);
});

test("ignores workflows that do not push", () => {
  assert.deepEqual(validateWorkflowWriterSafety("name: read-only\n", "read.yml"), []);
});

test("rejects a writer without the shared lock", () => {
  const source = compliantWriter.replace("group: app-data-writers", "group: writer");
  assert.match(validateWorkflowWriterSafety(source, "writer.yml").join("\n"), /app-data-writers/);
});

test("rejects a writer without a sync step", () => {
  const source = compliantWriter.replace(
    /      - name: Sync latest main[\s\S]*?(?=      - name: Commit)/,
    "",
  );
  assert.match(validateWorkflowWriterSafety(source, "writer.yml").join("\n"), /Sync latest main/);
});

test("rejects an incomplete sync step", () => {
  const source = compliantWriter.replace("          git reset --hard origin/main\n", "");
  assert.match(validateWorkflowWriterSafety(source, "writer.yml").join("\n"), /reset to origin\/main/);
});

test("root data publishers must stage the complete data directory", () => {
  const source = compliantWriter.replace(
    "      - name: Commit",
    "      - name: Publish\n        run: ./scripts/publish-data.sh\n      - name: Commit",
  );
  assert.match(
    validateWorkflowWriterSafety(source, "writer.yml").join("\n"),
    /stage the complete site\/data directory/,
  );
  assert.deepEqual(
    validateWorkflowWriterSafety(
      source.replace("        run: git push", "        run: |\n          git add -A -- site/data\n          git push"),
      "writer.yml",
    ),
    [],
  );
});

test("accepts a serialized production deploy through the shared helper", () => {
  assert.deepEqual(validateWorkflowWriterSafety(compliantDeployer, "deploy.yml"), []);
});

test("rejects a direct production deploy", () => {
  const source = compliantDeployer.replace(
    "npm run deploy:production",
    "npx netlify-cli deploy --prod --dir=dist/netlify-site --no-build",
  );
  assert.match(validateWorkflowWriterSafety(source, "deploy.yml").join("\n"), /shared deploy helper/);
});

test("production deploys require the shared lock and latest-main sync", () => {
  assert.match(
    validateWorkflowWriterSafety(
      compliantDeployer.replace("group: app-data-writers", "group: deployer"),
      "deploy.yml",
    ).join("\n"),
    /app-data-writers/,
  );
  assert.match(
    validateWorkflowWriterSafety(
      compliantDeployer.replace(
        /      - name: Sync latest main[\s\S]*?(?=      - name: Build)/,
        "",
      ),
      "deploy.yml",
    ).join("\n"),
    /Sync latest main/,
  );
});

test("production deploys run after the workflow's own push", () => {
  const source = compliantDeployer.replace(
    "      - name: Deploy site to Netlify",
    "      - name: Push\n        run: git push\n      - name: Deploy site to Netlify",
  );
  assert.deepEqual(validateWorkflowWriterSafety(source, "deploy.yml"), []);
  assert.match(
    validateWorkflowWriterSafety(
      source.replace("        run: git push", "        run: true").replace(
        "        run: npm run deploy:production",
        "        run: |\n          npm run deploy:production\n          git push",
      ),
      "deploy.yml",
    ).join("\n"),
    /after the workflow's git push/,
  );
});
