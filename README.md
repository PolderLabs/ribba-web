# ribba-web

⚠️ **Een merge naar `main` is in deze repo meteen een deploy naar productie**
(`mijn.ribba.app`). Er zit geen handmatige releasestap tussen.

## Mergen

```bash
node scripts/wacht-op-checks.mjs <pr-nummer>   # exit 0 = mergen mag
gh pr merge <pr-nummer> --merge --delete-branch
```

Géén `--admin` — die wordt geweigerd. Sinds 25 aug 2026 heeft `main` twee
verplichte checks:

| check | wat hij dekt |
|---|---|
| `CI Gate` | hangt aan `Tests`, `Typecheck` en `Build`; groen zodra alle drie slagen |
| `Vercel` | de preview-build — faalt hij, dan zou de productiedeploy breken |

`enforce_admins` staat aan, dus ook de eigenaar komt er niet omheen.

**Waarom dit er is.** Tot 25 aug 2026 draaide er in deze repo niets
automatisch: de tests, `tsc --noEmit` en `next build` liepen alleen met de hand,
en `main` was helemaal niet beschermd. Op diezelfde dag landde PR #77 met een
gebroken testsuite zonder dat iets het opmerkte.

**Waarom `--admin` niet meer werkt, en dat expres.** Wachten op checks met een
zelfgeschreven lus ging op 24 en 25 augustus drie keer mis: vlak na
`gh pr create` bestaan er nog nul checks, en "geen pending" is dan waar. Het
script hierboven wacht daarom éérst tot alle verwachte checks er *zijn*.

**Calamiteitenroute.** Is het een webdeploy-regressie, gebruik dan Vercel's
rollback naar de vorige productiedeploy — dat is sneller en vereist geen merge.
Alleen als een codefix naar `main` moet én CI zelf de blocker is: branch-
bescherming bewust tijdelijk aanpassen en daarna meteen terugzetten.

---

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
