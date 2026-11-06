# tools/brand

The app icon and splash are generated from code, so there is no design file to
lose and every size stays in step with every other.

```bash
python3 tools/brand/render.py apps/mobile/assets/brand /tmp/verso-brand-review.png
```

Writes the four files `app.json` points at, plus a review sheet showing the icon
at home-screen sizes, inside Android's three adaptive masks, on both splash
grounds, and as a themed monochrome icon.

Needs Pillow (`pip install pillow`). Icon and splash are **native** assets:
after regenerating, run `expo prebuild` and rebuild — a JS reload will not show
them. Rationale and usage rules: `docs/brand.md`.
