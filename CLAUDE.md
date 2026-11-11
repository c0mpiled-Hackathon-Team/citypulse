@AGENTS.md

# CityPulse

AI triage for Taipei's 1999 citizen hotline. The team plan, roles and file ownership are in README.md.

## Conventions

- Next.js App Router + TypeScript + Tailwind. Source lives in `src/`.
- Shared types live in `src/lib/types.ts`. Don't change them without telling the team.
- Everything user-facing is in English. Taipei place names use street-sign romanization (Da'an, Xinyi).
  The AI accepts Mandarin input but always answers in English.
- The AI may only use categories from `src/data/categories.json`. Validate all LLM output with zod.
- LLM calls only in server code (`src/app/api/**`, `src/lib/**`). Provider is OpenAI-compatible,
  configured by `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`. No key → mock mode.
- Leaflet touches `window`, so map components must be client components loaded with
  `dynamic(..., { ssr: false })`.
- Each teammate owns their own files (see README). Stay inside yours.
- Never commit `.env.local` or keys.

## Commands

- `npm run dev`: http://localhost:3000
- `npm run build`: run before pushing
- `npm run lint`
