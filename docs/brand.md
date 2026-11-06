# Brand

## The mark

A round label peeled back at one edge, showing its reverse.

*Verso* is the back of a printed page — the name means "read the back", because
the ingredient panel is on the back of the pack. The mark says the same thing as
a picture: peel back the label to see what is underneath. That is the product.

It is drawn from code in `tools/brand/render.py`. There is no design file.

## What was rejected, and why

**A dog-eared page with text lines.** The first draft. A portrait rounded
rectangle with a folded corner and horizontal lines is the most overused glyph
in iconography — Docs, Notes, every PDF. At 29px it said "file", not "food".

**A two-tone V**, one arm the front of the page and one its back. The most
legible option at every size — but a white V on a blue square is Venmo's icon,
and being mistaken for a payments app on a home screen is a real cost.

## Palette

| Role | Hex | Where |
|---|---|---|
| Field | `#2E3F91` | icon background, light splash, adaptive background |
| Label face | `#F3F4F0` | the disc |
| Verso | `#C6CCEA` | the peeled flap — the reverse of the label |
| Shadow | `#141A26` | under the flap only, blurred |
| Dark splash | `#141B3D` | so launching at night is not a bright blue flash |

Ultramarine is deliberate: the category is orange and green (Yuka, Fig, Olive).
The field is the same `accent` the app already uses, so the icon and the UI are
one system rather than two.

## No wordmark in the icon or splash

The OS prints the app name under the icon, so an icon wordmark is duplication.

The fonts on a Mac — New York, SF, Avenir — are licensed for Apple platforms
only, so none can be baked into a logo that also ships on Android. Where the
name appears in the app it is set in the system font (SF Pro / Roboto), which
also covers Devanagari. See the font constraint in project memory before
reaching for a custom face: most editorial pairings render Hindi as tofu.

## Usage

- **Always on the field or a dark ground.** On paper the label face disappears
  into the background and only the flap is left.
- **Clear space:** half the disc's radius on every side.
- **Minimum size:** 29px — checked, still reads as a disc with a lifted edge.
- **Do not** rotate the peel, recolour the flap, or remove the shadow; the flap
  only reads as the *back* of the label because it is a different tone with
  depth beneath it.

## Files

| File | Notes |
|---|---|
| `icon.png` | 1024², RGB. **No alpha** — App Store Connect rejects icons with transparency. |
| `adaptive-foreground.png` | Scaled to 0.92 so it stays inside Android's 66dp safe circle under every OEM mask. |
| `adaptive-monochrome.png` | Alpha only; Android 13+ themed icons discard colour and tint the shape. |
| `splash-mark.png` | Transparent; `expo-splash-screen` scales it to `imageWidth` (168pt). |

These are **native** assets. After changing them, run `expo prebuild` and
rebuild — a JS reload will not pick them up.
