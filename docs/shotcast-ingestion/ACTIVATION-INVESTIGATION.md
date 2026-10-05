# Manual activation investigation — pending authenticated UI confirmation

Only Take 2 is modified. Main and donor status are unchanged. No commit/push, navigation, provider, scoring, geometry or prepared package changes.

## Runtime evidence

No server was listening on localhost:3001 at investigation start. Started the normal Take 2 `npm run dev -- --port 3001`, without snapshot environment overrides.

- The same-origin prepared endpoint on3001 resolves Southwind R2026027 / Henley34098 / R1/H1, with assets registered under relative URLs. No runtime 3000 origin is hardcoded.
- Fresh real upstream PGA responses, decoded by the unchanged current provider, match every prepared Henley and Brennan endpoint. Event/player identity and capability validation have not been relaxed. This is a provider diagnostic, not authenticated browser acceptance.
- Real database SELECTs show the current111 Golf league's unarchived slates167/164/163/162: TOUR Championship, BMW Championship, FedEx St. Jude, Wyndham. All are locked; all fantasy games_in_progress are0.
- The unchanged GolfHomeSummary therefore selects latestCompletedSlate167. GolfLivePage always requests `/api/home-summary?sport=golf&view=live`; it supplies no historical slate override or tournament picker.
- A real current-provider request for TOUR Championship / Henley / R1/H1 resolves R2026060, player34098, course688 imagery. `/api/golf/shotcast-3d-dev?event=R2026060&player=34098&round=1&hole=1` returns HTTP200 with JSON null. Only packages for R2026027/Henley and R2026013/Brennan exist. This is a correctly unsupported preparation context, not a port failure.

Normal current111 Live thus cannot be assumed to display the Southwind fixture just because the golfer/round/hole numbers match. Rendering Southwind for TOUR Championship would violate event/course validation.

## Why earlier validation was insufficient

The historical test server supplied only slate163 or162; browser interception replaced `/api/golf/hole-replay` with preserved normalized PGA data and bypassed route reconciliation. The existing current Live page/components and the real development asset endpoint/renderer were exercised, but the normal database selection and real replay-route response were not. Historical success cannot be reported as normal manual-session parity. The original report now explicitly records that correction.

## Diagnostics added

Development visualization slot DOM attributes expose `data-shotcast-context` and `data-shotcast-reason`: missing preparation, endpoint mismatch, unsupported capability, asset/setup failure, waiting for first frame or ready3D. The renderer returns its failure stage (terrain, green, imagery, WebGL initialization or scene setup). No visible debug UI or diagnostic console spam was introduced. Fallback and all identity checks are unchanged.

## Remaining dependency

The agent's normal browser has no authenticated session and cannot open a field/golfer. The user has been asked for normal login access and their displayed tournament. Final real UI reproduction has not occurred; no activation fix or Henley/Brennan real UI success is claimed yet. User-session diagnostic attributes can confirm the exact condition without sharing credentials.

Focused tests16/16, changed-module lint, TypeScript and diff checks pass. Investigation evidence is ignored under tmp/shotcast-activation/. The normal server remains running on3001 for inspection.

## Follow-up: current Scores / Scheffler

The user confirmed the Live tournament mismatch and selected historical FedEx St. Jude in current Scores. Real upstream Scheffler R1/H1 resolved R2026027/player46046/course513, but the original preparation was tied to Henley native.bin. Course/player separation is now implemented; see COURSE-PLAYER-SEPARATION.md. Identity-only GET queries no longer prepare a player replay: the existing slot submits the current static replay subset via POST. Historical diagnostic GET-null results do not describe current POST eligibility. Normal authenticated Scores acceptance remains explicitly separate from engineering harness results.
