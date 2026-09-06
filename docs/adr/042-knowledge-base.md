# ADR-042 — A knowledge base that renders on both surfaces from one source

Status: **accepted** (2026-09-07) · Supersedes nothing. Related: ADR-028 (admin redesign),
ADR-037 (Scalar API docs), E03-5 (white-label), W9-S1 (public site).

## The problem

The product had documentation for developers and nothing for the people who actually buy it. A
fleet owner who does not know what an APN is, why a parked van appears to drift, or what "Never
reported" means had exactly two places to find out: a support e-mail, and us.

Everything we do know is written down — in code comments, ADRs, runbooks and the founder's hardware
sessions. None of it is reachable by a customer. The onboarding sheet warns about the leading spaces
in a config SMS; the trip engine has thresholds nobody outside the repo can see; the lapse ladder is
a three-warning process a customer only meets when the first warning arrives.

Two constraints shaped the answer:

1. **Two audiences, one body of knowledge.** A prospect on the marketing site and an operator inside
   the dashboard need the same explanation of what a geofence is. Writing it twice guarantees the
   two copies disagree within a quarter.
2. **The dashboard is white-labelled.** A "read the docs" link in a reseller's product is our brand,
   on their domain, one click from their customer — the exact leak E03-5 exists to prevent. So the
   in-product help cannot be a link out; it has to be the help itself, rendered under their name.

## The decision

**One dependency-free content package, `packages/kb`, rendered by two apps.**

- Articles are authored as structured blocks (the same model as the legal/docs pages), with every
  language type-enforced: a missing translation is a typecheck error, not a silent English fallback.
- Prose says `{product}`, never a product name. The public site substitutes ours; the dashboard
  substitutes the tenant's, or a neutral noun on a white-label host with no name configured.
- Links use three schemes rather than URLs — `kb:` (another article), `app:` (a product screen) and
  `site:` (a public page) — resolved per surface. `site:` renders as plain text inside the app,
  so **there is no href to leak**: our pricing page cannot appear in a reseller's dashboard because
  the app never renders one.
- Each article declares an audience: `adminOnly`, `platformOnly` (withheld on a white-label host
  from everyone but a tenant admin — our plans and invoices are not a reseller's CUSTOMER's
  business, and are very much the reseller's own) and an `entitlement` gate.
  `isVisible` is the single predicate; the index, the article route and every contextual link use it,
  so a help icon is shown exactly when the page behind it is reachable.

**Two entry points, because size matters differently on the two surfaces.** The package root carries
types, categories, slugs, the gating predicate and `KB_META` — metadata and titles, ~15 KB. The
bodies live behind `@orbetra/kb/content`, which only the two lazily-loaded help routes import. A
dashboard page carrying six help links therefore ships no prose at all, and an operator who never
opens the help never downloads a word of it.

`KB_META` is generated from the articles and asserted identical to them by the package's own tests —
a generated file nobody checks is a file that goes stale.

## Why not the alternatives

**A hosted docs product (GitBook, Mintlify, Docusaurus).** Rejected on the white-label constraint
alone: a third-party docs host is a third-party domain, and there is no version of that which does
not tell a reseller's customer who really built their product. It also adds a subprocessor to the
DPA for the privilege.

**Markdown files rendered at build time.** Tempting, and it is what most products do. Rejected on
translation: four languages × fifty files with no type relationship between them is exactly how the
LT copy of an article silently keeps a paragraph the EN copy dropped. The block model makes a
missing document a compile error and lets a test assert that anchors, code blocks and table widths
match across languages — which they now do.

**Duplicating the content into apps/web.** One month to first divergence, and the divergence would
be invisible: nobody diffs a help article against another help article.

**Linking the dashboard at the public site.** This is what the DNS help did before this change, via
a `docsLink()` helper built from the deployment's platform domain. It was careful, and it was still
an outbound link to somebody else's brand from inside a reseller's admin. Replaced by in-app help
with the same anchors; the helper is gone.

## Consequences

- `packages/kb` joins the monorepo map. No runtime dependencies — it is data and pure functions.
- The public site gains `/learn` and `/learn/$slug`; the article chunk is ~148 KB gzipped and loads
  only on those routes. The site's main bundle grows by ~4 KB gzipped for the metadata used by the
  home page's knowledge-base band.
- The dashboard gains `/app/learn` and `/app/learn/$slug`, lazily loaded, plus a `HelpLink` used
  across the product and a `help` prop on `PageHeader`.
- Articles are prose in a repo, so they age. The package's tests catch structural rot (dead links,
  missing translations, drifting anchors, a `screen` that no route serves) but not stale facts. A
  feature change that contradicts an article is a change that should edit the article — the `screen`
  field is there so the relevant ones are findable from a route path.
- The brand test (`no app-visible article names the platform`) is the load-bearing one. It is why
  the prose is written the way it is, and why an article that must name us — plans, billing, the
  lapse ladder — is marked `platformOnly` instead.
