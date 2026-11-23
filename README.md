# Appraiser Sketch

**A free, open-source floor sketch and ANSI Z765 area calculator for residential appraisers.**

Draw the house from your field notes, get gross living area and the other area totals measured to ANSI Z765, and print a sketch exhibit for the report. It runs entirely in your browser: there is no account, no subscription, and nothing is sent anywhere.

![Appraiser Sketch in light and dark themes, drawing a first floor with a 45° bay, clipped corners, a curved wall and interior walls, plus a garage, screened porch and deck, with the GLA area table](docs/screenshot-split.png)

<sub>Light and dark themes. Full size: [light](docs/screenshot.png) · [dark](docs/screenshot-dark.png)</sub>

**Use it now:** https://longtrailappraisal.github.io/appraiser-sketch (nothing to install)

> **Status: early release (0.1).** The drawing, area math and print page work and are covered by automated tests. It is built and used by a Vermont certified residential appraiser, but you are responsible for checking every figure before it goes in a report. See [Status](#status).

## Features

- **Fast keyboard entry.** Type walls the way you write them in the field (`R40 U24 L16 U12 L24 D36`) and watch the sketch draw as you type. Length first works too (`40R 24U 16L`), and the two can be mixed. Or use the arrow keys: type a length and press an arrow to make that wall (`30` then ↑ gives `U30`), then keep pressing arrows along it to fine-tune it 1" at a time (Shift: 1') before Enter moves on. A picked corner moves with the arrow keys too. Feet-inches or decimal feet.
- **ANSI Z765 area math.** Finished and unfinished, above and below grade, garages and amenities, each grouped the way a report needs. Stairs, ceiling zones, sloped ceilings (enter the knee wall height and where the slope meets the ceiling; the 5' and 7' lines are worked out) and openings count the way the standard says. Walkout and split-level lower levels can be marked partly below grade. You can turn ANSI off for private work, and the print and totals then say so.
- **Multiple areas and structures.** A dwelling, ADU, detached garage, barn, shed and outbuildings, each with its own floors.
- **Templates and presets.** Rectangle, L, bump-out, 45° bay, bow window, garage and deck shapes. Presets for the next floor, basement, finished attic, garage, carport, porch, deck, patio and breezeway.
- **Interior walls for a floor plan.** Click them in (they snap to corners and walls and stay square or at 45°) or type them like an outline. They never change the area.
- **Stairs.** Straight, landing, L, winder and U, drawn as symbols and counted on the floor above.
- **Mouse editing.** Drag walls, corners and areas with snapping to corners and to a grid. Full undo and redo.
- **Print / PDF and PNG.** A report header, the sketch fitted to the page, and an area table with totals. Totals can also be copied to paste into your report software.
- **For report.** Saves the totals and the drawing as one `.areas.json` file next to the sketch, for report programs to read. Format: [`docs/REPORT_EXPORT.md`](docs/REPORT_EXPORT.md).
- **Your files, your computer.** Sketches are ordinary `.sketch.json` files you save in the job's workfile folder. A draft is kept automatically in case the browser closes.
- Light, dark and automatic themes.

## Quick start

1. Open https://longtrailappraisal.github.io/appraiser-sketch in Chrome or Edge. Other browsers work too, but there each save is a download instead of saving back to the same file.
2. Type the first floor's walls into the walls box, for example `R40 U24 L16 U12 L24 D36`, and end with `CL` to close the outline.
3. Use **+ Area** to add the next floor, basement, garage or deck, and **Labels** to name the rooms.
4. **Print / PDF** (or Ctrl+P) for the exhibit; **Save** (Ctrl+S) to keep the sketch.

## Entering walls

| Type | Meaning |
| --- | --- |
| `R40 U24 L16 U12 L24 D36` | L-shaped first floor, 1,248 sf |
| `R24'6" U30 L24'6" D30` | Feet-inches |
| `R4 DR2.83 R4 UR2.83 R4` | 45° bay (lengths along the wall) |
| `R10U5` | One diagonal wall: run 10, rise 5 |
| `A30:12` | 12' at 30° |
| `R10'6+4'6` | Lengths added as measured: 15' (take a piece off with `+-`: `R20'6+-10'`). With spaces, a `+` or `-` on its own does the same: `R10 6 - 3 6` is 7' |
| `R10 6` | 10'6": a space can stand for the foot mark, and the inch mark is never needed (`R10 6-1/2`, or `10 6R` length first) |
| `10'6R45`, `R45:10'6`, `R10'6 45` or `R10 6 45` | 10'6" turned 45° to the right of the wall just drawn (`L` turns left; with `U` or `D`, or as the first wall, the angle is clockwise from that direction). After a space, degrees need a complete length first: `R10 0 45` or `R10' 45` for a whole 10' |
| `R20^3` | Arc bulging 3' outward |
| `CL` | Close back to the start |

You can also type straight onto the drawing: a length then an arrow key makes a wall (`30` then ↑ gives `U30`). Arrow keys then lengthen or shorten that wall one step (1", or 0.1' in decimal feet; Shift: 1') until Enter moves on to the next wall. Backspace removes the last wall, and `A` closes the outline. A direction on its own then Enter (`L` Enter), or just an arrow key with no length typed, runs the wall until it lines up with the next corner already drawn; Enter again carries it on to the corner after that (corners of other areas count too), so you can square up to an earlier wall without adding up the runs. The walls box can sit under the drawing, above it, on either side, or float over it: pick from the small list beside it (floating: drag it by the word Walls).

## Working on the drawing

**Moving around**

| Action | How |
| --- | --- |
| Pan | Drag empty space |
| Zoom | Mouse wheel |
| Fit everything in view | F, or **Fit** |
| Auto fit on/off (keeps the sketch centred as you draw) | C, or **Auto fit** in the toolbar. Zooming or panning by hand turns it off. |

**Areas, walls and corners**

| Action | How |
| --- | --- |
| Move an area | Drag it. It snaps to other areas' corners or the grid; hold Alt for free movement. Its stairs, ceiling zones and labels move with it. |
| Slide a wall in or out | Select the area, then drag the wall. It stays square, in whole inches. |
| Move a corner | Drag it (snaps to other corners and lines up with neighbours), or click it and use the arrow keys (1"; Shift: 1'). |
| Delete a wall | Click a corner and choose **Delete wall** to redraw from there. |
| Start an empty area somewhere | Click the drawing where its start point should go. |
| Copy an outline | **Copy as** on the Area panel (exactly, or as basement, next floor, garage…), with its stairs, ceiling zones and interior walls. **Copy walls from** starts an empty area from another area's outline. |

Corner angles show on the selected area, with square corners in grey (Show › Angles turns them off). The walls text is rewritten to match every mouse edit.

**Interior walls**

Select the area and press **+ Interior wall**. Click where the wall starts, then each corner: points snap to corners, along walls and to the grid, and each wall stays square or at 45° and stops right on the wall it meets (hold Alt for none of that). Instead of clicking corners you can type the wall after the start point (`U12 R8`, or a length and an arrow key). Double-click ends a wall and lets you start the next; Enter or Esc stops drawing. Dragging still pans.

Click a wall to select it: drag it to move it, drag its round handles to move an end or a bend in any direction (they snap to corners and walls and line up square with the next corner), Backspace removes its last segment and Delete removes it. Interior walls move and copy with their area, print with the sketch, and never change any area figure.

**Stairs**

For any other shape, pick **Built from steps** as the type and say how the stair is walked: `2u sq r8` is 2 steps up, a square landing and 8 steps right; `rad 3rise` is a 90° corner of 3 pie-shaped steps (`rad 180` goes right round); `6u sq r sq d6` is a U. The arrow, Landing and Winders buttons under the box add the pieces for you, and plain words work (`2 steps up, square landing, 8 to the right`). Right-click a stair for its type, arrow, rotate, copy and delete.

Click a stair to select it, then drag it or its round handles (flight lengths, width). T rotates it. **Copy to** on the Stairs panel copies it to another floor at the same spot, pointing down from above or up from below.

**Labels and dimensions**

- Pick a room name from **Labels** (Rooms, Garages & outbuildings, Decks, porches & patios) or type your own and save it to **My labels**. It is placed in the selected area; drag it into place, edit it, or press Delete.
- Drag an area's label to move it; double-click puts it back.
- Click a wall dimension or label and press Delete to hide just that one (double-click hides a dimension at once). The Area panel brings them back.

**Structures**

Each structure is named after its type (Dwelling, ADU, Detached garage, Barn, Shed, Outbuilding), numbered if repeated, until you type your own name.

**Right-click** an area, in the list or on the drawing, for the things you do most: rename, set its type, level, grade, ceiling and finish, duplicate, close or open the outline, add a stair, ceiling zone or interior walls, delete. Right-click a structure's name or the empty drawing for theirs.

**Keyboard shortcuts:** Ctrl+Z undo · Ctrl+Y redo · Ctrl+S save · Ctrl+O open · Ctrl+P print · F fit · C auto fit · T rotate stair · Delete remove selected label, dimension or interior wall · Enter / Esc stop drawing interior walls.

## Settings

There is nothing to configure in files. Everything is on screen:

- **⚙ Settings** (top right): theme, lengths (feet-inches or decimal feet), what the mouse snaps to (1" or 0.1', 6", 1', or corners only), and export/import of My labels.
- **Show** (toolbar): dimensions, labels, grid, corner angles, Auto fit.
- **ANSI Z765** (toolbar): on by default.

Sidebar panels collapse when you click their heading, and the browser remembers which are closed.

## Where your work is kept

- **Sketches** are files you save wherever you like with Save or Ctrl+S.
- **Settings, My labels and the recovery draft** are kept by your browser for that web address. In a different browser, or at a different address, they start empty. To move My labels, export them from ⚙ Settings and import them on the other side.

Nothing is uploaded. The app has no server.

## Running it on your own computer

You only need this if you want to work offline from a copy or change the code. You need [Node.js](https://nodejs.org) 22.12 or newer (or 20.19+) and [Git](https://git-scm.com):

```
git clone https://github.com/longtrailappraisal/appraiser-sketch.git
cd appraiser-sketch
npm install
npm run dev
```

The app opens at http://localhost:5179. Leave the terminal open while you work; Ctrl+C stops it. To update later, run `git pull` and `npm install` in that folder.

The local copy always uses port 5179, because the browser keeps your settings, labels and draft per address. If that port is taken on your computer, change the two `port` numbers in `vite.config.ts`.

## Status

Version 0.1. Working today: everything listed under [Features](#features). Still to come: doors and windows, per-wall dimension control and remembering the workfile folder. The full design and roadmap are in [`docs/SPEC.md`](docs/SPEC.md).

Bug reports and suggestions from appraisers are welcome. Please [open an issue](https://github.com/longtrailappraisal/appraiser-sketch/issues), and **never attach a real client's sketch or address**. Make up an example that shows the problem.

## Development

```
npm run dev        # the app, reloading as you edit
npm test           # tests (Vitest)
npm run typecheck
npm run build      # static site in dist/
npm run preview    # serve the built site at http://localhost:5179
```

- `src/geometry/`: pure TypeScript with no DOM (units, vectors, path, ANSI rules, model)
- `src/app/`: the screen (store with undo, SVG renderer, files, main)
- `src/export/`: print page and paste-ready text
- `test/`: tests

`.github/workflows/pages.yml` runs the typecheck and tests on every push to `main` and publishes the site to GitHub Pages.

## License

[MIT](LICENSE). Free to use, change and share, with no warranty. Area figures are the appraiser's responsibility to verify.
