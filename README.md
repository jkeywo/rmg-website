# Reading Megagames website

The site is generated from `games.neon`. Browsers receive complete static HTML,
responsive images, and a small first-party interaction script; they do not parse
the Neon source or load third-party code on initial page load.

## Local test site

On Windows, double-click `test-site.bat` or run:

```bat
test-site.bat
```

The script installs the pinned build tools when necessary, builds into the
ignored `.local-site` directory, validates the output, starts a server at
<http://127.0.0.1:4173/>, and opens it in the default browser. Press Ctrl+C in
the command window to stop it.

To build the fixture content instead:

```bat
test-site.bat test.neon
```

Node.js 20 or newer is required.

## Commands

```text
npm test                 Generator unit tests
npm run build            Production build in dist/
npm run build:staging    Staging build in dist/
npm run check            Validate the current dist/ build
```

The generator can also be invoked directly:

```text
node tools/build-site.mjs --source games.neon --output dist --base-url https://example.com/ --environment local|staging|production
```

Use `--now <ISO timestamp>` only for deterministic date-boundary testing.

## Deployment setup

### GitHub Pages staging

1. In repository Settings → Pages, change the publishing source to **GitHub
   Actions**.
2. Set the Pages custom domain to `test.readingmegagames.co.uk`.
3. In Cloudflare DNS, point that hostname to `jkeywo.github.io` with a CNAME.

Every push to `main` then builds and publishes staging. Staging output is marked
`noindex,nofollow`.

### Cloudflare Pages production

1. Create a Direct Upload Pages project named `reading-megagames` whose
   production branch is `production`.
2. Add `readingmegagames.co.uk` and `www.readingmegagames.co.uk` as its custom
   domains and enforce HTTPS.
3. Create GitHub repository secrets `CLOUDFLARE_ACCOUNT_ID` and
   `CLOUDFLARE_API_TOKEN`. The token needs permission to deploy to that Pages
   project.
4. Create a GitHub environment named `production` without required reviewers;
   a required-reviewer rule would prevent the scheduled event-day deployment.
5. Run the **Deploy production** workflow manually for the initial release.

A manual release always validates and deploys the latest `main`, then advances
the `production` branch. At 16:00 UTC each day, the scheduled job checks only
that promoted branch. It exits without deploying unless a promoted game occurs
on that UTC date, and it skips the upload when the live content hash already
matches.

Before merging these changes, switch GitHub Pages away from its legacy
`main`/root publishing mode so pushes cannot update the production hostname.
The legacy root files remain in the repository only as a cutover fallback and
are not included in generated deployment artifacts.
