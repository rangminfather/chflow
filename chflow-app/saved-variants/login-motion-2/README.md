# Login Motion 2 Saved Variant

Aliases:
- 로그인모션2
- 로그인 페이지전환2
- 로그인 화면 2

Purpose:
- Saved preview of the dandelion login splash concept.
- This is not applied to the live login transition by default.
- Use this only when the user asks to restore or review one of the aliases above.

Contents:
- `page.tsx`: full snapshot of the splash page implementation with repeat preview support.
- `public/launch-dandelion-sprites/`: transparent dandelion head and seed sprite PNG assets.

Preview behavior in the snapshot:
- `/` plays once and routes as the app normally does.
- `/?splashPreview=1` disables routing and replays the animation every 2.6 seconds.

Restore notes:
- Copy `page.tsx` to `app/page.tsx`.
- Copy `public/launch-dandelion-sprites/` to `public/launch-dandelion-sprites/`.
- Then run `npx eslint app/page.tsx` and preview `http://localhost:3000/?splashPreview=1`.
