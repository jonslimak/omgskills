# omgskills portal

React/Vite portal for Skill Groups.

## Local setup

Use Node 20:

```bash
nvm use
npm install
```

Run the portal only:

```bash
npm run dev:portal
```

Run the full Netlify app when using Node 20:

```bash
npm run dev
```

The local portal expects:

```text
VITE_CLERK_PUBLISHABLE_KEY
CLERK_SECRET_KEY
```

Do not commit `.env` files.

## Verification

Build the portal and combined Netlify output:

```bash
npm run check
npm run build:netlify
SITE_DIR=dist/netlify-site node ./scripts/prepare-netlify-site-deploy.mjs
```

Create a draft deploy:

```bash
npx netlify-cli deploy --dir=dist/netlify-site --site "$NETLIFY_SITE_ID"
```

Milestone 0 smoke endpoints:

```text
/api/portal/auth-smoke
/api/portal/db-smoke
```

Both require a Clerk bearer token.
