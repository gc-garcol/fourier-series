# Browser verification: Fourier app (9 samples)

## Method
- Headless Google Chrome driven by `puppeteer-core` (installed in `/tmp/fv2`, removed afterwards), viewport 1100x800.
- URL: `file:///Users/miamia/Documents/fourier/index.html`.
- Control: `<select id="sample-select">` with options `heart, star, moon, balloon, icecream, apple, cherry, cat, dog` (labels: Heart, Star, Half moon, Balloon, Ice cream, Apple, Cherry, Cat, Dog). Each sample was triggered by setting the select value and dispatching `change`.
- After 800 ms the `#status` text and its `error` class were read. Then `#n-range` was set to its `max` with `input` and `change` events dispatched, and after 13 s (one full 12 s period at 1x) the status was read again and `#stage` was screenshotted.
- Console warnings/errors, page errors and failed requests were collected for the whole session.

## Console
- No console errors or warnings, no page errors, no failed requests (collected list was empty).
- Startup: `#sample-select` = Heart, status `N = 200 (max 704) · M = 704 resampled points · 704 traced contour points`, no `error` class. The startup screenshot shows the heart outline being traced.

## Per-sample results

Status line is the one read after setting N to max. N is kept across sample switches (clamped to the new max), so the status right after loading can already show a larger N; this is expected.

| Sample | Exact status line (N = max) | M | Status | Visual verdict at N = max |
|---|---|---|---|---|
| Heart (startup default) | `N = 704 (max 704) · M = 704 resampled points · 704 traced contour points` | 704 | PASS | Recognizable heart: two lobes, centre cleft, bottom point. |
| Star | `N = 698 (max 698) · M = 698 resampled points · 698 traced contour points` | 698 | PASS | Clean 5-point star, all points and inner corners crisp. |
| Half moon | `N = 685 (max 685) · M = 685 resampled points · 685 traced contour points` | 685 | PASS | Crescent with two pointed tips, reads as a half moon. |
| Balloon | `N = 646 (max 646) · M = 646 resampled points · 646 traced contour points` | 646 | PASS | Oval balloon, triangular knot, wavy string. Recognizable. |
| Ice cream | `N = 554 (max 554) · M = 554 resampled points · 554 traced contour points` | 554 | PASS | Small top scoop, wider lower scoop with a rim, pointed cone. Recognizable. |
| Apple | `N = 741 (max 741) · M = 741 resampled points · 741 traced contour points` | 741 | PASS | Wide two-lobed body with bottom dimple, stem and leaf. Recognizable. Body is fairly squat and the top has no dimple around the stem; minor. |
| Cherry | `N = 1024 (max 1024) · M = 1024 resampled points · 1074 traced contour points` | 1024 | PASS | Two round cherries, curved stems joined at the top, leaf. Recognizable. |
| Cat | `N = 933 (max 933) · M = 933 resampled points · 933 traced contour points` | 933 | PASS | Sitting cat: two pointed ears, head, pinched neck, round body, curled tail. Recognizable. |
| Dog | `N = 1024 (max 1024) · M = 1024 resampled points · 1251 traced contour points` | 1024 | PASS (minor visual note) | Four-legged body, upright tail, head and snout on the left. Reads as a quadruped/dog. Weakest part is the head: the ear is a flat cap-like shape with a boxy notch at the neck, and the legs are plain rectangles. |

Checks for every sample: status is the success form, no `error` class, starts with `N =`; M is in the hundreds (554 to 1024), not tiny; N moved to max (704, 698, 685, 646, 554, 741, 1024, 933, 1024).

## Overall: PASS

All 9 samples load, produce a success status with a healthy M, and render a recognizable silhouette at max N. No console errors.

Optional polish (not blocking): Dog head/ear shape; Apple top dimple.
