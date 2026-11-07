# CLAUDE.md

Funqtion Hub: the business apps of DJ duo Team Funqtion (Gijs & Coen), built as one React/TypeScript/Vite app with local-first storage (Dexie) and a Tauri shell for the Windows exe.

**Read `docs/HANDOFF.md` first.** It lists the decisions, open items and conventions that are not in the original prompts. Then read `docs/ARCHITECTURE.md` and the plan of the app you're touching (`docs/*/PLAN.md`).

Checks before a PR: `npm run typecheck && npm test && npm run build`, and `cargo check` in `src-tauri` when the Rust or Tauri config changes.
