# Reading Megagames website

HTML, CSS and vanilla JavaScript are served directly. The browser fetches and
parses `games.neon`, then renders games on navigation. There is no framework,
image-processing dependency or compiled event content. The runtime loading and
equal-area photo galleries are adapted from `jkeywo/ox-hog-site`.

## Local preview

With Node.js 20 or newer installed, double-click `test-site.bat`, or run:

```text
npm start
```

Open <http://127.0.0.1:4173/>. No npm installation or build is needed. Changes
are visible on reload. Stop the server with Ctrl+C. Use HTTP rather than opening
the HTML file directly.

To preview alternate content, run `test-site.bat test.neon`, or visit
<http://127.0.0.1:4173/?source=test.neon#home>. The query accepts relative Neon
filenames; hash navigation keeps the query. The batch argument maps that file
to the preview server's `games.neon` without modifying either source file.

## Editing content

Keep events in `games.neon` and general copy in `content/site.json`. Existing
event fields and Markdown formatting (paragraphs, bold and italic) are retained.
Each event needs a unique lowercase hyphenated slug, an English date such as
`10 October 2026`, a name, description, list image and banner image. Raw HTML is
escaped, external links must use HTTPS, and image paths must be relative.

Optional `photos` are comma-separated filenames under `photos/<slug>/`.
Past-event galleries give each photo equal display area while retaining its
natural proportions. The target is roughly four photos across on desktop, two
on tablets and one on small screens. Short galleries retain their thumbnail
size. Photos load lazily and open in a keyboard-accessible full-size dialog.
Images are served in their original format and size; use suitably sized source
files when adding artwork. No responsive variants are generated.

Games become past at **16:00 UTC on their event date**, regardless of the
visitor's timezone. This is calculated on navigation or reload; an idle page
does not automatically change at the cutoff. Games are revalidated with the
server on each navigation, sharing only requests already in flight. There is
no scheduled deployment to move games between lists.

Links use `/#home`, `/#upcoming`, `/#past`, `/#about` and `/#game/<slug>`.
The Code of Conduct link is `/#about/code-of-conduct`. Bookmarks and browser
Back/Forward work normally. Old clean page and game URLs have small redirect
shells pointing to their corresponding hash route, including `/game/<slug>`.
Game content requires JavaScript; the shell provides an email contact when it
is disabled. Page titles update on navigation; social previews use site-level
metadata, and the sitemap lists only the root document.

## Ticket availability

The home page shows the next three games, with a link to all upcoming games
when there are more. Home and upcoming cards show **Sold Out** when public
inventory is exhausted and **Nearly sold out** when at most 20% remains.
The calculation respects ticket-type, ticket-group and shared event capacities,
including holds and baskets when applying shared caps. Closed sales and hidden
tickets do not by themselves mean an event has sold out.

`functions/api/ticket-status.js` runs on Cloudflare Pages. Set the encrypted
**production secret** `TICKET_TAILOR_API_KEY` in the `reading-megagames` Pages
project (Settings → Variables and Secrets), then deploy production. A GitHub
Actions secret alone does not configure the running Pages Function. The key
needs read access to events; never put it in public files or browser JavaScript.
Also set the repository Actions secret `TICKET_TAILOR_API_KEY`: the production
workflow verifies API access before deployment and logs only public game slugs
and statuses. Run the same check locally with `node tools/check-ticket-api.mjs`
when the environment variable is set.
Wrangler uploads the root `functions/` directory alongside `dist/` in the
existing production workflow. Server modules are not copied into static assets.

The endpoint only returns statuses for upcoming games listed in `games.neon`;
it does not expose attendee details, private events or the raw API response.
Cloudflare caches successful results for five minutes. Pages load independently
of the API, refreshing banners on navigation, every minute while visible, and
when returning to the tab. Stale or failed checks remove the banners and leave
the ticket links usable. Complex overlapping group caps or bundle-based group
limits are treated as unknown rather than guessing availability.

GitHub Pages staging reads `https://staging.reading-megagames.pages.dev/api/ticket-status`
with public CORS. Its workflow deploys a Cloudflare Pages **preview** on the
`staging` branch, configures the preview secret from the GitHub Actions secret,
and verifies the endpoint before publishing GitHub Pages. This does not deploy
production, and staging no longer depends on the production API. Local `npm start` can use a
`TICKET_TAILOR_API_KEY` environment variable; without it, banners remain hidden.
Alternate `?source=test.neon` previews do not request live ticket status.

API reference: <https://developers.tickettailor.com/docs/api/get-all-events/>.

## Validation and packaging

```text
npm test                 Parser, browser logic, galleries, package and server tests
npm run package          Validate and package production into dist/
npm run package:staging  Validate and package staging into dist/
npm run check            Validate the current dist/ package
```

`npm run build` and `npm run build:staging` remain aliases for packaging.
The old `tools/build-site.mjs` entrypoint also forwards to packaging.

Packaging copies original public assets and Neon byte-for-byte, writes
environment-specific shell metadata, robots directives and headers, and creates
legacy redirect shells. It does not render game content, classify dates, resize
images or bundle JavaScript. Node's built-in tools are sufficient.

Only `index.html`, `games.neon`, `content/site.json`, `scripts/`, `styles/`,
`logos/`, `images/`, `photos/`, `carousel/`, `favicon.ico` and generated hosting
files are published. Tests, tooling, repository metadata and local fixtures
are excluded. Output is replaced on each run and is restricted to `dist/` or
`.local-site/` inside the repository.

```text
node tools/package-site.mjs --source test.neon --output .local-site --environment local
node tools/serve-site.mjs --root dist --port 4174
```

## Deployment

GitHub Pages staging remains <https://test.readingmegagames.co.uk/>. In repository
Settings → Pages, use **GitHub Actions** and this custom domain. In Cloudflare
DNS, point the hostname to `jkeywo.github.io`. Every push to `main` runs tests,
packages and publishes staging, marked `noindex,nofollow`. The workflow retains
unique artifact names and waits for artifact metadata before deployment.

Production remains <https://readingmegagames.co.uk/> on the Cloudflare Pages
Direct Upload project `reading-megagames`, with production branch `production`.
Keep `readingmegagames.co.uk` and `www.readingmegagames.co.uk` attached as custom
domains with HTTPS, and the repository secrets `CLOUDFLARE_ACCOUNT_ID` and
`CLOUDFLARE_API_TOKEN` configured for deployment.

Run **Deploy production** manually to validate, package and deploy latest `main`,
then advance the `production` branch. Production remains a manual release; no
schedule or event-day workflow remains. Hosting files set security headers and
revalidation for unversioned assets. No DNS or provider configuration changes
are required for this migration.
