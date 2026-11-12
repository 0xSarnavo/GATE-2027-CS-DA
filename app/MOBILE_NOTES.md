# Mobile merge notes

## Done

- Resolved `web/src/styles.css` by keeping master's foundations, declutter, and copy/search rules alongside the WIP's mobile, calendar, navigation, and update styles. No conflict markers remain in the file.
- Hardened phone layout for 412×915 and 384×832: calendar cells fit the narrower grid; fixed tab and action bars keep bottom space even when Android reports a zero safe area; viewport sizing uses `dvh`; the keyboard hides tabs and lifts fixed controls; key sizes use `rem` for text zoom. Desktop pages and headers share an 840 px content width, including Learn's chapter tabs and cards.
- Finished history navigation: header and concept back use in-app history with logical parents for deep links; question routes retain their origin; tab switches replace their history entry. Back closes registered sheets, the video player, and the question lightbox first. A running test presents a leave confirmation. Added navigation tests.
- Stamped each build with package version, UTC build time, and Git hash through Vite; the same build id is written to `dist/changelog.json`. Safe screens apply waiting updates silently, while active questions and tests show the update card. “Later” is remembered for that build. After updating, a small toast opens the changelog. Updated the changelog entry.
- Completed the planner calendar for October 2026 through February 2027: phase tint, progress rings, mock and exam markers, today's outline, day agenda actions with undo, and a weekly agenda with goals. It uses the existing `/api/plan` endpoints and is linked from Plan and Today.
- Added animation support for hollow points, square boxes, circular point moves, and translucent circles, including scene schema, validation, and tests.

## Verification and limits

- `bun run build` and `bun test` pass. The animation schema parses as JSON. `git diff --check` reports no whitespace errors.
- A live 412×915 / 384×832 screenshot check remains unverified: the local Vite preview cannot bind `127.0.0.1:5173` in this sandbox (`EPERM`).
- The merge resolution is present in the working file, but `git add web/src/styles.css` cannot update this worktree's Git index because its index is outside the writable workspace (`Operation not permitted`). Git therefore still reports `UU` for that file. Stage the resolved file when the worktree index is writable. No commit was made.
