# herdr web ui Design System

Extracted from the shipped client (`src/styles.css`, `src/components/*`), not invented. The machine
copy of every token is the `:root` block in `src/styles.css`; every table below mirrors it value for
value. When a component needs a value that is not here, add it to both first.

## 1. Atmosphere & Identity

A warm terminal: an amber-phosphor console on lamp-lit graphite (dark) or ledger paper (light),
with chat-app clarity. Tonal surfaces and hairlines keep the chrome out of the way. There is ONE
chrome color, amber: selection, focus, the terminal cursor and the user's own action (Send, primary
buttons). Agent states carry the remaining saturated colors and none of them is amber. The user's
chat turns are neutral raised cards, so a long thread never turns into a wall of color. Dark is the
default, light follows the same hierarchy, and comfortable or compact density changes scale without
changing information architecture. A dark report look, a neutral charcoal one and Catppuccin are
opt-in palettes (Settings → Appearance → Palette); amber stays the default and the look before settings load.

The signature is the amber status rail: a 3px bar on the selected pane row (whose mark box also
takes an amber edge), the same amber on focus, the chosen lens glyph and the terminal cursor, tying
“what I am looking at” to “where I am typing.”

## 2. Color

### Palette

Only tokens overridden by `[data-theme="light"]` have a light value. Both columns are literal CSS.

| Role | Token | Dark | Light |
|------|-------|------|-------|
| Surface/base | `--bg` | `#12100e` | `#eeeae2` |
| Surface/panel | `--bg-panel` | `#181613` | `#faf8f3` |
| Surface/elevated | `--bg-elevated` | `#211e1a` | `#f2eee6` |
| Surface/hover | `--bg-hover` | `#2a2621` | `#e8e2d6` |
| Surface/input | `--bg-input` | `#1c1916` | `#fffdf9` |
| Border | `--border` | `#2d2924` | `#dcd4c6` |
| Border/strong | `--border-strong` | `#3e3830` | `#c5baa8` |
| Chat bubble edge | `--bubble-border` | `transparent` | `var(--border)` |
| Text/primary | `--text` | `#d8d0c3` | `#2a251f` |
| Text/dim | `--text-dim` | `#9b9183` | `#685e52` |
| Text/strong | `--text-strong` | `#f2ebdf` | `#16120d` |
| Accent | `--accent` | `#f0a830` | `#8c5000` |
| Accent/tint | `--accent-tint` | `rgba(240, 168, 48, 0.13)` | `rgba(140, 80, 0, 0.1)` |
| Primary | `--primary` | `#f0a830` | `#c57d12` |
| Primary/hover | `--primary-hover` | `#f6bb55` | `#d48c1f` |
| Primary/text | `--primary-text` | `#1b1407` | `#1b1407` |
| Primary/tint | `--primary-tint` | `rgba(240, 168, 48, 0.16)` | `rgba(197, 125, 18, 0.14)` |
| Status/idle | `--status-idle` | `#9b9183` | `#685e52` |
| Status/working | `--status-working` | `#6cb8d6` | `#155a72` |
| Status/blocked | `--status-blocked` | `#ff7b70` | `#a82323` |
| Status/done | `--status-done` | `#93c36b` | `#2f6317` |
| Working/tint | `--status-working-tint` | `rgba(108, 184, 214, 0.14)` | `rgba(21, 90, 114, 0.12)` |
| Blocked/tint | `--status-blocked-tint` | `rgba(255, 123, 112, 0.14)` | `rgba(168, 35, 35, 0.12)` |
| Done/tint | `--status-done-tint` | `rgba(147, 195, 107, 0.14)` | `rgba(47, 99, 23, 0.12)` |
| Danger/tint | `--danger-tint` | `rgba(255, 123, 112, 0.12)` | `rgba(168, 35, 35, 0.1)` |
| Danger/text | `--danger-text` | `#ffd9d4` | `#8f1d1d` |
| Notice | `--notice` | `#e8c55c` | `#7a5a00` |
| Overlay/scrim | `--scrim` | `rgba(8, 6, 4, 0.55)` | `rgba(40, 32, 22, 0.35)` |
| Drawer shadow | `--shadow-drawer` | `0 0 40px rgba(0, 0, 0, 0.6)` | `0 0 40px rgba(40, 32, 22, 0.22)` |
| Popover shadow | `--shadow-pop` | `0 16px 48px rgba(0, 0, 0, 0.55), 0 0 0 1px var(--border)` | `0 16px 48px rgba(40, 32, 22, 0.16), 0 0 0 1px var(--border)` |
| Card shadow | `--shadow-card` | `0 4px 16px rgba(0, 0, 0, 0.35)` | `0 4px 16px rgba(40, 32, 22, 0.07)` |

### Opt-in palettes

`settings.palette` (`amber` default, `report`, `charcoal`, `catppuccin`) is written as `data-palette`. The
tables above are amber, the base blocks; the three opt-in palettes override them in
`[data-theme][data-palette]` blocks of `src/styles.css`, which hold the complete values.
The amber dark colours are keyed on `:root, [data-theme="dark"]` and none of the blocks is
scoped to `<html>`, so any element that carries `data-theme` and `data-palette` itself takes
that palette's whole colour set: Settings → Appearance draws each palette's preview that way.

`--bubble-border` is the edge of the chat's user bubble. It is `transparent` where `--bg-elevated`
alone parts the bubble from `--bg`: dark amber, dark report and dark charcoal. It is `var(--border)`
where the two surfaces sit close: every light theme (the `[data-theme="light"]` block sets it for
all four palettes) and dark Catppuccin, whose elevated surface is darker than its canvas.

- **Dark report** is a near-black blue-grey canvas with hairlines: `--bg` `#0a0d12`, panel and
  terminal `#0f1319`, text `#b4bdc9` / `#8792a3` / `#e8ecf2`. Primary (the user's action) is white
  `#e8ecf2` with `#0a0d12` text; accent is electric blue `#4c9aff`, kept for small marks. Agent
  states use meaning colors (working `#f5b544`, input `#ff6b7a`, done `#3ddc97`, idle `#8792a3`).
  Terminal cursor `#4c9aff`, selection `#1f3a66`. It has near-square corners (`--radius-sm/md/lg/xl/2xl`
  = `2/3/3/4/6px`) and no resting card shadow (`--shadow-card: none`).
- **Charcoal** is a neutral Ghostty-style dark: `--bg` `#0f0f0f`, panel and terminal `#171717`, text
  `#cbc7c0` / `#918c85` / `#f5f2ec`, accent and primary near-white `#e8e4dc` with `#171717` text,
  muted states (working `#c2a2af`, input `#e0877f`, done `#a7b789`, idle `#9a958e`), terminal cursor
  `#cbc7c0`, selection `#49443d`. It keeps amber's rounded corners and card shadow.
- In light both use plain paper (`--bg` `#f2f2f0`, panel `#fafaf9`, text `#242424`, primary ink
  `#242424` with `#fafaf9` text): report with a blue `#1f5fcc` accent and cursor, charcoal with an
  ink accent and cursor `#242424`.
- **Catppuccin** follows [catppuccin.com/palette](https://catppuccin.com/palette/), its style guide
  and its Zed port: Mocha in dark, Latte in light. In both the content (chat canvas `--bg`,
  terminal) is Base, the chrome (`--bg-panel`: sidebar, the header over it and on a phone, tabs) and elevated surfaces Mantle,
  dimmed text Subtext1, cursor Rosewater, selection Overlay2 at 25% over Base. Dark uses palette
  colors (only the primary hover `#d3b3f8`, Mauve lightened, and the tints are derived): Base
  `#1e1e2e`, Mantle `#181825`, input Crust, hover Surface0, text Text `#cdd6f4` / Subtext1 `#bac2de`,
  accent and primary Mauve `#cba6f7` with Crust text, states Blue / Maroon / Green, idle Subtext0
  (Maroon, not Red, keeps input AA on a hovered row), cursor `#f5e0dc`, selection `#3b3d4f`. Light
  keeps Latte's surfaces and text: Base `#eff1f5` (also input), Mantle `#e6e9ef`, hover Crust
  `#dce0e8` (the darkest surface Subtext1 stays AA on), idle Subtext1, cursor `#dc8a78`, selection
  `#d2d4dc`. Latte's accents are under 4.5:1 on these surfaces, so each keeps its hue and is darkened
  until it passes AA: Mauve `#712fc6` (primary hover is plain Latte Mauve `#8839ef`), Blue `#1750bf`,
  Red `#ac0c2f`, Green `#28651b`. It keeps amber's rounded corners.

### Terminal theme

xterm.js reads a JavaScript theme, so `src/lib/settings.ts` `terminalTheme()` mirrors these four
CSS tokens verbatim for each resolved theme and palette (`settings.test.ts` checks the match).

| Role | Token | Dark | Light | xterm key |
|------|-------|------|-------|-----------|
| Background | `--term-bg` | `#181613` | `#faf8f3` | `background` |
| Foreground | `--term-fg` | `#d8d0c3` | `#2a251f` | `foreground` |
| Cursor | `--term-cursor` | `#f0a830` | `#8c5000` | `cursor` |
| Selection | `--term-selection` | `#4a3d26` | `#f0d9ae` | `selectionBackground` |

### Syntax highlighting

Code in chat and in the file viewer is colored by `--syntax-*` tokens. Four follow the palette:
`--syntax-comment` is `--text-dim`, `--syntax-function` is `--accent`, `--syntax-inserted` is
`--status-done` and `--syntax-deleted` is `--status-blocked`. The other six are literals per block
(each at least 4.5:1 on `--bg-panel` and `--bg-elevated`); light charcoal uses the light report
column. Catppuccin follows Catppuccin's own mapping: keywords are mauve, so `--syntax-function` is
blue there instead of `--accent`, and Latte's colors are darkened to stay readable.

| Block | keyword | string | number | type | variable | meta |
|-------|---------|--------|--------|------|----------|------|
| Dark amber | `#e8875f` | `#a8c17c` | `#d6a0c9` | `#6cb8d6` | `#e0c08f` | `#b49dd6` |
| Light amber | `#a33a17` | `#4b6b18` | `#8a3f7a` | `#155a72` | `#7a5418` | `#5d4791` |
| Dark report | `#f78c6c` | `#3ddc97` | `#f5b544` | `#7fd4ff` | `#c9d1dc` | `#b392f0` |
| Light report and charcoal | `#b3261e` | `#22743a` | `#8a5300` | `#0b6e8a` | `#3b3b3b` | `#6f42c1` |
| Dark charcoal | `#d7a08a` | `#a7b789` | `#c2a2af` | `#9fb4c2` | `#dcd8d0` | `#b8a5c9` |
| Catppuccin Mocha | `#cba6f7` | `#a6e3a1` | `#fab387` | `#f9e2af` | `#f5e0dc` | `#f5c2e7` |
| Catppuccin Latte | `#712fc6` | `#2f7620` | `#b44201` | `#905c13` | `#4c4f69` | `#bc1d91` |

`--syntax-function` in Catppuccin: Mocha `#89b4fa`, Latte `#0b59f4`.

### File viewer

- `--notice` colors a note that the view is partial (a file cut short, code too long to color): the
  size in the header's meta line becomes `256 KB of 1.3 MB`, always beside a warning icon so the
  color is not the only sign. It is a warning yellow, at least 4.5:1 on
  `--bg`, `--bg-panel` and `--bg-elevated`: amber `#e8c55c` / `#7a5a00`, dark report `#f5b544`, light
  report and charcoal `#8a5300`, dark charcoal `#d9b26a`, Catppuccin Mocha `#f9e2af` (yellow), Latte
  `#8a5710`.
- `--line-number` colors the line numbers beside code: tertiary text, quieter than the code. It is
  `--text-dim`, except in Catppuccin, whose `--text-dim` (subtext1) is nearly `--text`: Mocha
  overlay2 `#9399b2` (5.8:1), Latte `#64677d` (subtext0 darkened to 4.9:1 on `--bg`).

### Rules
- Amber is the one chrome color. Accent (selected, focused, informational) and primary (the user's
  action: Send, primary buttons) are both amber; in light, accent is the darker text-safe ochre and
  primary the brighter fill carrying ink text. Agent states never use amber. The report palette
  keeps the same split, accent (blue) marks and primary (white, or ink on paper) acts, and there
  agent states never use blue.
- Agent state is always written as a label as well as colored. Unknown uses dim text and a dashed
  edge rather than inventing a fifth state color.
- Tints are named tokens; components do not introduce ad hoc translucent state colors.
- `theme: "system"` follows `prefers-color-scheme`; `src/lib/settings.ts` writes the resolved
  `data-theme`, `color-scheme`, and matching PWA `<meta name="theme-color">`.

## 3. Typography

### Scale

| Level | Token | Comfortable | Compact | Typical use |
|-------|-------|-------------|---------|-------------|
| Micro | `--fs-2xs` | `11px` | `10px` | Badges, hints, kbd |
| Meta | `--fs-xs` | `12px` | `11px` | Subtitles, field labels |
| Small | `--fs-sm` | `13px` | `12px` | Controls, row titles |
| Body | `--fs-md` | `14px` | `13px` | Body and dialog copy |
| Reading | `--fs-chat` | `15px` | `14px` | Chat prose, the user's bubble, live narration; the message box with a mouse |
| Large | `--fs-lg` | `16px` | `15px` | Header title, modal title |
| Title | `--fs-xl` | `18px` | `17px` | Markdown h1 |
| Display | `--fs-display` | `22px` | `21px` | The empty chat's greeting |
| Input | `--fs-input` | `16px` | `16px` | Mobile-safe text input |

| Token | Value | Usage |
|-------|-------|-------|
| `--font-ui` | `"Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans KR", "Malgun Gothic", sans-serif` | Chrome and chat prose |
| `--font-mono` | `"Symbols Nerd Font Mono", "JetBrains Mono Web", ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, "D2Coding", monospace` | Code, paths, keys, terminal-adjacent metadata |
| `--lh-tight` | `1.2` | Titles |
| `--lh-base` | `1.5` comfortable / `1.45` compact | Body copy |
| `--lh-code` | `1.6` | Code blocks; the message box with a mouse |
| `--lh-prose` | `1.65` | Chat prose and the user's bubble |
| `--fw-regular` | `400` | Body |
| `--fw-medium` | `500` | Controls |
| `--fw-semibold` | `600` | Labels and titles |
| `--fw-bold` | `700` | Brand |
| `--tracking-tight` | `-0.01em` | Brand and primary titles |
| `--tracking-display` | `-0.02em` | The display line |
| `--tracking-caps` | `0.06em` | Uppercase operational labels |

### Faces
- The app ships its typefaces (`src/fonts/`, licenses in `THIRD_PARTY_NOTICES.md`) and loads
  nothing from another host: it is served from the user's PC, often with no internet route.
  Both are `font-display: swap`.
- Pretendard Variable, the first name in `--font-ui`, is upstream's dynamic subset: 92 chunks
  split by `unicode-range`, so the browser fetches only those whose characters a page draws
  (measured on the demo's chat: three chunks, 90 KB, in English; eight more, 200 KB, with the
  interface and an answer in Korean). The service worker precaches none and keeps each one once
  fetched.
- What the chunks cover (their `unicode-range`s): Latin, all 11,172 Hangul syllables, hiragana
  and katakana, and 435 CJK ideographs. The type is therefore the same on every device for
  Latin and Korean only. Kanji and Chinese text fall through `--font-ui` to the device's sans-serif,
  so a Japanese line is kana in Pretendard beside kanji in the device's face, and Chinese is
  the device's face almost throughout. The app ships no Japanese or Chinese face.
- JetBrains Mono regular is the code face of the chat and the chrome, loaded under the family
  name `"JetBrains Mono Web"`. The name is the app's own so that the terminal never takes it:
  xterm's stack (`src/lib/fontFamily.ts`) names `"JetBrains Mono"`, sizes every cell from the
  first font that matches, and keeps meaning the copy installed on the device.
- Chat reading scale: prose, the user's bubble and live narration are `--fs-chat` on
  `--lh-prose`; `strong` is `--fw-semibold` in `--text-strong`; inline code and code file chips
  are `0.87em` of their line; a code block is `--fs-sm` on `--lh-code`; headings are h1 `--fs-xl`,
  h2 `--fs-lg`, h3 to h6 `--fs-chat`. Work heads, tool rows, settled narration, a compaction's summary and
  meta keep their sizes. The chat scales all of them by `--chat-scale` (`--chat-fs-body` is the scaled
  `--fs-chat`), so the Chat font size setting names the body size and the prose is one step above it.

### Settings
- `theme`: `dark`, `light`, or `system`; default `dark`.
- `palette`: `amber`, `report`, `charcoal` or `catppuccin`; default `amber`.
- `density`: `comfortable` or `compact`; default `comfortable`.
- Terminal font size is independent: default `13px`, clamped to `10–22px`.
- Terminal and chat font families are comma-separated lists, default empty. They go in front of the
  terminal's built-in fonts (after the bundled Symbols Nerd Font Mono, which only draws icons) and of
  `--font-ui` in the chat's prose (as `--font-chat`), never in place of them; code in the chat keeps
  `--font-mono`. A file viewer's Markdown preview takes the chat font size and family too. At most 200 characters, with `;`, `{`, `}`, `<`,
  `>`, `\` and control characters stripped and names with spaces quoted.
- Composer Enter behavior and folded thinking visibility are preferences, not typography tokens.
- File viewer: `wrapCode` (wrap long lines instead of scrolling sideways; default off),
  `textLoadLimit` (bytes of a text file loaded) and `highlightLimit` (characters highlighted), each
  256 KB or 1 MB with defaults 1 MB and 256 KB, and `markdownWidth`: `readable` (the chat
  lane, `--chat-w`, centered; default) or `full`.
- All settings share one sanitized `localStorage["herdr-web-ui:settings"]` record.

## 4. Spacing & Layout

### Base unit

All spacing derives from a 4px base.

| Token | Value | Usage |
|-------|-------|-------|
| `--space-1` | `4px` | Tight icon and control gaps |
| `--space-2` | `8px` | Row and menu gaps |
| `--space-3` | `12px` | Control padding |
| `--space-4` | `16px` | Section and modal padding |
| `--space-5` | `20px` | Wide modal padding |
| `--space-6` | `24px` | Card breathing room |
| `--space-8` | `32px` | Large separation |

### Radii

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-sm` | `6px` | Chips and inner controls |
| `--radius-md` | `8px` | Buttons, inputs, selected rows |
| `--radius-lg` | `12px` | Menus and chat surfaces |
| `--radius-xl` | `16px` | Modals and bottom sheets |
| `--radius-2xl` | `24px` | The composer's input card |
| `--radius-pill` | `999px` | Pills and dots |

### Sizes

Comfortable values are `:root`; the final column is the complete compact override set.

| Token | Comfortable | Compact | Usage |
|-------|-------------|---------|-------|
| `--header-h` | `52px` | `46px` | App header below `769px` |
| `--header-h-wide` | `46px` | — | App header from `769px`, in either density (`--header-h` takes this value there) |
| `--sidebar-w` | `320px` | `300px` | Sidebar/drawer |
| `--control-h` | `34px` | `32px` | Buttons and fields |
| `--touch-target` | `40px` | — | Coarse-pointer minimum |
| `--keybar-h` | `48px` | — | Terminal key bar |
| `--row-h` | `56px` | `44px` | Roster and palette rows |
| `--chip-h` | `20px` | `18px` | Badge/pill height |
| `--icon-size` | `18px` | — | Standard icon |
| `--mark-size` | `22px` | — | Brand mark |
| `--avatar-size` | `32px` | `26px` | Roster mark box |
| `--dot-size` | `7px` | — | Connection dot |
| `--rail-w` | `3px` | — | Selected-row rail |
| `--hairline` | `1px` | — | Borders |
| `--content-w` | `820px` | — | Dialog content |
| `--settings-w` | `1040px` | — | Settings window width (fixed: switching pages never resizes it) |
| `--settings-h` | `760px` | — | Settings window height |
| `--settings-nav-w` | `248px` | — | Settings navigation column |
| `--settings-content-w` | `640px` | — | Measure of a Settings page's groups |
| `--chat-w` | `--content-w`, then the pane's lane as one length | — | Chat lane: transcript, composer column, held list. Settings → Chat width: Narrow `--content-w`; Default follows the pane (min 820px, max `60rem` = 960px, 71% of the pane between; the px floor wins where 60rem is under it); Wide `72rem` (1152px); Full `100%` |
| `--palette-w` | `640px` | — | Command palette |
| `--palette-top` | `12vh` | — | Palette top offset |

### Focus and layers

| Token | Value | Usage |
|-------|-------|-------|
| `--ring` | `2px solid var(--accent)` | Global `:focus-visible` outline |
| `--ring-offset` | `2px` | Outline offset |
| `--z-banner` | `5` | Terminal banners |
| `--z-popover` | `10` | Composer completions, the Comment button and the comment popover |
| `--z-scrim` | `15` | Mobile drawer scrim |
| `--z-drawer` | `20` | Mobile drawer |
| `--z-modal` | `30` | Dialog and palette scrims |
| `--z-droplet` | `40` | In-app alert, over dialogs |

### In-app alert

One set for both themes: the card is island black wherever it shows.

| Token | Value | Usage |
|-------|-------|-------|
| `--droplet-bg` | `#000` | Drop, anchor and card |
| `--droplet-text` | `#f5f5f7` | Pane name |
| `--droplet-text-dim` | `rgba(245, 245, 247, 0.62)` | Ended detail, blank mark |
| `--droplet-blocked` | `#ff8a80` | Needs-input detail and dot |
| `--droplet-done` | `#9fd47a` | Finished detail and dot |
| `--droplet-mark-bg` | `rgba(255, 255, 255, 0.1)` | Agent mark disc |
| `--droplet-ring` | `rgba(255, 255, 255, 0.1)` | Card hairline |
| `--droplet-shadow` | `rgba(0, 0, 0, 0.35)` | Drop shadow under the liquid |

### Shell
- `.app` is a full-viewport column: `.app-header` over `.app-body`; the body is sidebar plus
  `.terminal-host`. While a phone's soft keyboard is up (`data-keyboard`), `--app-height` follows
  `visualViewport` so the keyboard does not cover input; otherwise the shell is `100dvh`, because an
  iPhone home screen app reports a visual viewport shorter than the screen without a keyboard.
- The header is one line at every width. Anatomy, left to right: mobile drawer toggle / desktop
  sidebar toggle and the command palette (`.header-side`); the flexible context, agent mark and
  title then the PC › workspace › folder crumb; segmented Chat/Terminal switch; the connection
  chip while the bridge is not live (herdr version in its tooltip), the offline pill, sign out and
  the More menu (`⋯`). Theme lives in Settings and the palette; the herdr version is also read
  in Settings.
- From `769px` the header is two zones. Over the sidebar, `.header-side` is the sidebar's own top
  row (toggle at its start, palette at its end) on `--bg-panel`, as wide as `--sidebar-w`, and the
  sidebar's seam runs to the top of the window. Over the pane, the header takes the pane's
  surface: under the chat lens `--bg` with no bottom rule, the transcript scrolling under a
  `--space-5` fade from `--bg`; under the terminal lens, with no pane, or with a pane herdr could
  not restore, `--term-bg` and the rule. A tab strip takes the same surface as the header over
  it from `769px` (`--strip-bg`: `--bg` under the chat lens, `--term-bg` otherwise, `--bg-panel`
  below `769px`) and keeps its hairline, under the chat the one line over the transcript (no
  fade under it). The update notice and a PC's action banner are drawn in the pane column, over
  the tab strip, never across the window: the sidebar and its top row stay one piece. With the
  sidebar collapsed the toggle and the palette sit in the one bar. Below `769px` the header is the `--bg-panel` bar with
  its rule: the installed app's `theme-color` matches it.
- The sidebar is fixed-width on desktop and a `<=768px` drawer. The desktop collapse removes its
  column; the drawer uses a scrim and keeps safe-area insets. On touch, a mostly horizontal swipe in
  from the left `24px` edge opens the drawer and a swipe to the left closes it (`56px` of travel).
- The terminal stack contains a positioned terminal surface, then composer or key bar. The xterm
  mount stays alive under the chat lens; changing views never creates a second connection.
- At `<=480px` the brand name, the offline pill and desktop-only control labels go, and the
  palette's button gives its room to the title: the palette is the More menu's first item there.
  Icons and selected context remain.

## 5. Components

### Button (`.btn`, `.icon-button`)
- `.btn` is a medium text control. Variants: neutral, `.btn-primary`, `.btn-secondary`,
  `.btn-tertiary`, `.btn-danger`, `.btn-ghost`. Primary uses `--primary`; danger uses danger
  tint plus blocked border, and keeps both a shade stronger under the pointer instead of the
  neutral hover grey; ghost removes fill/edge.
- A destructive action that is not what its dialog is for (Delete in the comment editor) is
  ghost; danger is for the confirmation.
- Three weights for a page's actions (Settings): at most one `.btn-primary` per page, the main
  action (Pair a device, Add PC); `.btn-secondary` for the others, an `--accent` outline and text
  on no fill that takes `--accent-tint` on hover (Send test, Save key, Check for updates, Add
  reply); `.btn-tertiary` for the least used, an underlined `--text-dim` text link that turns
  `--text-strong` on hover (Restore defaults, Reset all shortcuts, Remove key, links out).
- `.icon-button` is a square unlabeled visual control with mandatory `aria-label`; `.is-outlined`
  adds the border. Both families use `--control-h`, `--radius-md`, focus ring, hover and disabled.
- Coarse pointers grow controls to `--touch-target`.

### Segmented control (`.segmented`)
- One `aria-pressed="true"` option receives hover fill and strong text; the group itself is an
  elevated, bordered `--radius-md` track.
- Used for Chat/Terminal and for Settings choices of two to four short options (mode, density, chat width); on a phone a Settings one takes its row's width. It is not a generic tab list.

### Keyboard hint (`.kbd`)
- An inline mono keycap: `18px` high, strong bottom edge, `--radius-sm`, `--fs-2xs`.
- `Mod` resolves to `⌘` on Apple platforms and `Ctrl` elsewhere.

### Modal (`.modal*`)
- `.modal-scrim` centers an `aria-modal` dialog at `--z-modal`; `.modal` is a capped scrollable
  column with header, body and footer and `--shadow-pop`.
- At `<=640px`, it becomes a bottom sheet with top `--radius-xl` corners and safe-area padding.
- While a phone's keyboard is up (`data-keyboard`), the scrim is `--app-height` tall instead of the
  whole screen, so a sheet and its text field sit above the keyboard, and the sheet drops its
  safe-area padding.
- Escape, explicit close and scrim click close dialogs; first meaningful control receives focus.
- A confirm (`.confirm-dialog`, `alertdialog`, 420px) asks before something that cannot be undone:
  Cancel has the focus, Tab stays between the two buttons, the danger action sits at the right,
  and a failure shows inside it. A no gives the focus back to what opened it. A refusal the owner
  named (git refusing a dirty checkout) turns the action into its escalation (**Delete anyway**),
  with the refusal's words above it. Closing a repository workspace over open worktrees says so
  and closes the group, as herdr's `--group` does.

### Field (`.field`, `.input`, `.select`)
- Stacked uppercase label, optional hint and `--bg-input` field. Desktop fields use `--fs-sm`;
  small-screen fields retain `--fs-input` to avoid focus zoom.
- Focus names the edge with accent; errors use blocked/danger tokens and `role="alert"`.

### Menu / popover (`.menu*`)
- Bordered `--radius-lg` surface with `--shadow-pop`; rows use `--control-h`, `--radius-md`, icon,
  ellipsized main label and optional hint.
- Hover or `aria-selected` uses `--bg-hover`. Headings are dim uppercase micro labels.
- The sidebar's row menu (`.row-menu`) is a `.menu` drawn through a portal at fixed coordinates,
  under its `⋯` with right edges aligned, above it when the screen ends first, and over the drawer.
  A workspace row offers Rename workspace, Rename pane (the pane the row shows), New tab, New worktree,
  Open worktree…, then Close under a hairline (Close workspace when the workspace has several panes). A worktree workspace's row has no worktree items and ends in
  **Delete worktree checkout…** after Close. The
  danger item takes `--status-blocked`. At `<=640px` it is a `.modal` bottom sheet (`.row-sheet`):
  a grip, the row's name and place, 48px rows and a Cancel button; Tab stays among them. Escape, a press outside and
  focus leaving it close it (on a desktop a scroll or a resize too), and focus returns to the
  `⋯`. Arrow keys move between items. A row that leaves the roster takes its open menu with it.
- Close follows herdr's `ui.confirm_close`: a close takes the workspace with it, so it asks in a
  confirm first. After a confirmed close, focus lands on the header's workspace-list toggle.
- The tab strip's pane picker is the same menu: one item per pane of the tab, the agent's mark
  (or the shell glyph) and the pane's title, the open pane named in the strong colour
  (`aria-current`).

### Badge (`.badge`)
- Agent states read **READY**, **RUN**, **INPUT**, **DONE**; unknown reads **—**.
- Idle is elevated/dim; working, blocked and done use their own tint and text. RUN carries a small
  breathing dot before the word; the word itself never fades.
- The written label and unknown dashed edge keep color from being the only signal.

### Pill (`.pill`)
- Mono metadata at `--chip-h`. The **Needs you** count is one; offline is the one header pill and uses danger tokens.

### Sidebar roster row and footer
- No top bar. The sidebar opens with the plan panel (when Settings puts it there), **Needs you**
  and the PC groups. A workspace starts from the `+` on its PC's header, or from the **New workspace**
  button in the dashed **No workspaces yet** box of an empty PC. **Add PC** lives in Settings →
  Remote PCs and in the command palette. Search lives in the command palette, not the roster.
- One row per workspace, as herdr's Spaces sidebar: no workspace headers, numbers or folds. The
  row stands for the workspace through its *current pane*: the selected pane when it is in the
  workspace, else the pane last viewed there, else the one herdr has in front. Its mark, title
  and folder are that pane's; its state word is the roll-up of every pane in the workspace
  (blocked, then working, then done, then ready), as herdr rolls a workspace up. The other panes
  of a workspace are reached from the tab strip over the pane, the command palette and
  **Needs you**.
- Appearance's **Group sidebar by** is **Workspace** by default. **Folder** opts into the
  grouping below. The choice applies immediately and persists in the browser's existing Settings
  record; folder folds are remembered per PC and path.
- In folder mode, within each PC, panes with the same full cwd share a folder group, including panes from
  different workspaces. Trailing separators and Windows slash styles are normalized; case and
  symlinks are not resolved. Unknown cwd stays with its workspace rather than merging unrelated sessions.
  A workspace whose panes sit in two folders has a row in each, opening the pane in that folder.
- Every folder has a caret, folder glyph, basename, full-path subtitle and pane count, even for
  one pane. Its indented contents use the existing spacing and border tokens. Folder folds are
  remembered per PC and path; opening a pane unfolds its folder, but status updates do not.
- Folder order follows the first workspace in server order; workspace handles still reorder
  workspaces, not filesystem directories. Workspace names and rename actions remain inside the group.
- Every row is two lines: agent/shell mark, then the editable title alone on line one (full
  width), and the state word followed by the row's place on line two. Mark boxes are neutral;
  the selected row gets the amber rail and an amber-edged mark box. The row carries the
  workspace's reorder handle in its left gutter (drag, or `Alt+↑/↓` on the handle) and ends in
  one `⋯` (`.row-menu-toggle`: shown on hover, focus, selection and while its menu is open;
  always on touch) that opens the row menu. Inline server failures stay beside their row. In the
  By workspace view a repository's workspace moves past the next or previous group as one, with its
  worktrees, and a worktree moves among its siblings only.
- A title that is a working directory written out (`/home/me/dev/api`, `~/dev/api`, `C:\work\api`)
  shows as its last folder, here, in the header, the palette and every alert; the full path stays
  in the row's tooltip. Line two names what is not already said: by workspace, the workspace and
  the folder, each only when the title or the other does not already say it; under a folder
  header, the workspace. The palette, which has no header, names the workspace and the folder,
  once when they are the same.
- A PC group header is caret, monitor, name, “Host” for the local machine, a state dot
  (done = connected, working pulse = connecting/reconnecting, blocked = error), then a `+` that
  starts a session on that PC (disabled while it is offline) and, for an SSH PC, its manage
  button. Connected says
  nothing more; every other state is written under the name, with the server's error clamped to
  two lines and complete in the tooltip.
- In the By workspace view, a repository's worktree workspaces (`workspace.worktree.is_linked_worktree`)
  sit under the row of the workspace on its main checkout, packed behind a hairline
  (`.worktree-children`), as herdr's Spaces sidebar keeps them; a worktree whose repository
  workspace is not open stays at the top level.
- Footer holds the contextual **Install app** action and Settings with the plan meters beside it.
  It carries no product name or version: the running versions are read in Settings.

### Plan meters (`.usage*`)
- Beside Settings, one button holding up to four chips (three and `+N` past that), one per
  account in the user's order: provider mark, mono `--fs-2xs` percent of the limit chosen in
  Settings, the plan's week or its session (used, or left when Settings says so), and a 2px bar on a `--border-strong` track
  filled to that percent. From 80% used the percent and bar take `--status-blocked`; amber stays
  chrome. A chip whose numbers are stale or missing dims. An account hidden in Settings is
  left out of the strip and the popover; with every account hidden, neither shows.
- The button opens a popover above the footer (`--shadow-pop`, `--radius-lg`), as wide as the
  footer and scrolling when it outgrows the sidebar: per account its mark, name and plan pill with
  the email or login right-aligned and ellipsized, then one row per limit (label, reset time, right-aligned percent) over a 4px bar. A problem
  note is dim, red for an expired sign-in or a failed request.

### New workspace dialog
- Agent select comes from `GET /api/agents`; shell-only is always available. Directory defaults to
  the selected pane cwd and name is an optional workspace label.
- Submit calls `POST /api/workspace/create`; the server performs `workspace.create` and, when an
  agent was chosen, `agent.start` in its root pane. Pending and partial agent-start failure are
  explicit before the created pane opens.
- As **New tab** (from a row's `⋯` menu, the header's More menu, the strip's `+` or the palette),
  the same dialog is titled `New tab · <workspace>`, shows the workspace's folder as a fact in a
  dashed box (`.new-session-folder`: a worktree's checkout, else the folder of the pane in front)
  instead of asking for one, and its name is the tab's (optional; the placeholder is the number
  herdr gives it). Submit calls `POST /api/tab/create` with the same agent launch.

### Tab strip (`.tab-strip`)
- herdr's tab row, over the pane: shown once the selected pane's workspace has more than one
  pane (a second tab, or a tab split in the TUI), never for a lone pane. One `role="tab"` per tab
  in herdr's order, named by its label, or **Tab n** while herdr still names it by its number;
  a 7px dot before the name in the state's colour for working, blocked and done. The open tab
  (the selected pane's) is underlined 2px in `--accent` and in the strong colour; the others are
  dim. Arrow keys move between tabs. A tab opens the pane last viewed in it, else the one herdr
  has focused there, else its first; a tab with several panes has a chevron beside its name that
  opens a pane picker (the row menu). The strip ends in a `+` that opens the New tab dialog.
  The open tab is scrolled into view when the selection comes from elsewhere (the sidebar, the
  palette, an alert), and the `+` stays at the strip's end while the tabs scroll under it.
- A tab is renamed and closed on the strip, as herdr's prefix+shift+t and prefix+shift+x. With
  a mouse: a 20px `x` (`.tab-strip-close`) after the name, visible on the open tab and on the
  one under the pointer or the focus, its place kept in every tab so widths do not move; a
  double-click on the name swaps it for a field (`.tab-strip-rename`: Enter saves, Escape and a
  blur leave the name, an empty field changes nothing because herdr would keep the empty name);
  a right-click opens the tab's menu under its left edge; the middle button closes. With keys
  on a focused tab: F2 and Delete. On a touch screen there is no `x`: the open tab carries the
  chevron, and the menu is the bottom sheet. The menu lists the tab's panes when it has
  several, then **Rename tab**, then **Close tab** in the danger colour under a hairline.
- A close is immediate, as herdr's, and the tab beside it opens. It asks first (the confirm
  dialog) only when it costs more than the tab: an agent in it is working or blocked, or it is
  the workspace's last tab, which takes the workspace with it. A refusal shows in the dialog, or
  as a line of `--status-blocked` text at the strip's end for six seconds.
- The underline runs under the whole tab (`.tab-strip-item.is-active`), its `x` included. A tab
  herdr names itself reads **Tab n** by its place in the row: herdr relabels it when a tab
  before it closes.
- `--control-h` tall on a hairline over `--bg-panel`, scrolling sideways without a scrollbar;
  touch grows the buttons to `--touch-target`, and puts the pane picker beside its tab's name
  instead of pulling it over the name's padding. The same strip on a phone.

### Worktree dialog (`.worktree-modal`)
- From a workspace row's menu, as herdr's prefix+shift+g: **New worktree** asks for the branch
  (required), where to start from (HEAD when empty, ignored for a branch that exists) and a
  name, then checks the branch out under herdr's worktree folder and opens it as a
  workspace grouped with the repository's; its pane is selected. **Open worktree…** lists the
  repository's other checkouts as rows (branch, mono path, an **Already open** pill), and a row
  opens or returns to that workspace. herdr's own words explain a refusal, inside the dialog.
- The branch arrives filled in as herdr's own form fills it (`worktree/brave-valley-07f8`:
  adjective, noun, four hex digits) and selected, so typing replaces it. The name is the branch
  with its slashes as dashes and follows the branch until it is typed over.
- **Agent** is the New workspace dialog's picker, under the name: the agent last started, Shell
  for none. It starts in the checkout's pane once the checkout is made. One that fails to start
  leaves the worktree there: the dialog says why, locks its fields, and its button reads **Open**.

### Header context and connection
- A selected pane shows agent mark + title (`--fs-md`), then on the same line the crumb
  PC › workspace › folder (`--fs-xs`, `--text-dim`). The folder shows as its last name, and only
  when the title, the PC or the workspace does not already say it (`lib/headerCrumb.ts`). The
  title may shorten with an ellipsis; the crumb never does: when it does not fit whole beside the
  whole title it is not drawn, and the title has the row. The full path is in the context's
  tooltip and at the top of the More menu. With no selection, the brand fills the context slot.
- The More menu (`.header-more-button`, the `RowMenu` popover, a bottom sheet at `<=640px`) opens
  with the location on two lines, "PC › workspace" then the full path in mono, and holds **New
  tab** (the selected pane's workspace), **Browse files** and **Alerts**, each under the condition
  its own button had; at `<=480px` **Command palette** is its first item. The Alerts item says
  this device's state in words after its label ("On in the app", "On in this tab", "On, pushed to
  this device", "Off on this device") and switches it: it is a `menuitemcheckbox` with
  `aria-checked` in the popover and a button with `aria-pressed` in the sheet. While alerts are off on this device the
  More button carries a `--dot-size` `--accent` dot and its name says "alerts are off": the dot
  marks the state that needs a look, never "on".
- The segmented Chat/Terminal view switch lives in the header. There is no floating view-toggle pill.
- Connection is one quiet chip, drawn only while the bridge is not live: a pulsing dot plus the
  written reconnecting/disconnected state. Below `900px` it keeps only its dot; the word stays as
  its accessible text and in its tooltip. While live the chip takes no room and stays in the
  document as a `role="status"` a screen reader can read (`.conn-live`; never `display: none`).

### Chat turn (`.chat-turn`)
- The chat lens is a centered `--chat-w` transcript over the still-attached terminal surface.
  At the Default chat width the lane follows the pane: min 820px, max 60rem (960px at a 16px
  root), 71% of the pane (`.terminal-stack`) between. `PaneTerminal` measures the pane and writes
  the lane on the document as one length, so a file viewer's Markdown preview over the app has it
  too, `min(max(820px, 60rem), <the pane's share>px)` (`chatLaneLength`,
  `lib/settings.ts`); `--chat-w` never holds that percentage, because each column would resolve
  it against its own box and they would differ by their gutters.
  The ceiling is in rem because Wide is (`72rem`), and it stays `60rem` inside the length, so
  Default is never wider than Wide at a root font of 11.4px and up, also when that size changes
  while the page is open (under 11.4px the 820px floor is itself wider than Wide's 72rem). The
  floor stays in px (`--content-w` is px); under a 13.67px root, where 60rem is less than 820px, the
  floor wins and Default is the same lane as Narrow.
  Structured Claude/omp transcripts fall back to ANSI-stripped pane scrollback when unavailable.
- The register is Codex / gajae-code-app: a quiet document. User turns are right-aligned neutral
  cards (`--bg-elevated`, a `--bubble-border` edge, `--radius-lg` on all four corners, ≤80% wide,
  no avatar or name). Assistant turns have no header: the answer is plain prose.
- Space separates exchanges, not a rule: the transcript's gap is `--space-3`, so an answer sits
  close under its prompt, and a user turn that follows an assistant turn takes `--space-5` more.
  The one rule of an exchange is the hairline under its folded work block.
- Meta (time, copy) fades in on hover or focus and takes no click or tap while unseen; with any
  coarse pointer (a phone, or a touch screen beside a mouse) it is always visible. With a mouse and no touch screen (`(hover: hover) and
  (pointer: fine) and (not (any-pointer: coarse))`): from 481px a user turn's time and copy sit
  beside its bubble, and an answer has one copy glyph (it copies Markdown) with a **Plain text**
  text button in the regular weight beside it. Otherwise the answer keeps two labelled buttons,
  glyph + MD and glyph + TXT; where the primary pointer is coarse each is a `--touch-target` target on a
  one-line row, as is a user turn's copy, and a skill list under a user turn clears that target.
- Markdown supports headings, lists (a task item `- [x]` / `- [ ]` shows a checked or empty box in
  place of its bullet, not clickable), links, quotes, tables, inline/fenced code and code-copy
  actions. Fenced code is syntax-highlighted by role (`--syntax-*`) up to 100 KB.
  A link keeps `--accent` and a file chip reads in `--text-strong` with a dotted underline; both
  underlines are `--text-dim` at rest and both take the accent on hover and focus-visible.
  Code blocks are `--radius-lg` and never scroll inside: one longer than 30 lines opens at its
  first 20 behind **Show all N lines**. On touch a block has a header strip (language, copy);
  with a mouse and no touch screen the strip becomes a corner control over the block's top right,
  shown on hover or focus-within (no transition under reduced motion).
  A table fills the reply's width; its cells, file paths included, break between words only, so a
  column is never narrower than its longest word, and a table without room scrolls sideways in
  its own box.
  Thinking renders as a folded block only when **Show thinking** is enabled.
- Block comments (`BlockComments.css`, `CommentPopover.css`): a comment is made by selecting text in
  a final reply, and only so: there is no button on a part, no hover state and no tap that chooses a
  part. A selection in one part (a paragraph, heading, list item, code block, table, display
  formula, a whole blockquote) is the comment's text; several selections in one part are several
  comments. A selection that runs over several parts (paragraphs, list items, a heading and the
  paragraph after it) is still ONE comment: all of it is quoted (the parts' text, one line break
  between them) and highlighted, and its bubble hangs under the part where the selection ends. An
  end on a rule, or at the very start of the next part (a triple click), ends at the part before. A
  user message, a live reply and a work block's narration take none, and a selection that starts
  outside a reply is not a comment. There is no keyboard-only way to comment besides the browser's
  caret browsing (F7), a decision made for this feature.
- The Comment button (`.comment-selection`, in `ChatView`): once a selection ends (a mouse button
  released, a touch handle let go, the keyboard's selection keys) a `.btn` pill with a
  `MessageSquarePlus` icon and **Comment** (`--bg-elevated`, `--fs-sm`, `--radius-pill`,
  `--shadow-card`, `--z-popover`) floats where the user's attention is. It sits in the scrolling
  view, so it scrolls with the text, stays `--space-2` inside the view's sides, and flips to the
  other side of the line only where its own has no room.
  - With a mouse or a pen it waits for the button to be released, is centred on the release's x and
    sits `--space-2` above the selection's line under the release's y (the nearest line when the
    release is between lines, or outside the text).
  - On a touch screen it is `--touch-target` tall and 28px *below* the selection's last line, clear
    of the selection handles and of the system menu, which sits above.
  - A selection made with the keyboard (no release) puts it over the last line, centred on its
    right end, `--space-2` above it. A selection that changes (the keyboard extends it) takes this
    rule too; the same text reached otherwise (a reflow, the keyboard over a blank or a rule) keeps
    the release's place while the release's y is still on a line of the selection (a touch release
    always).

  The lines are those of the whole selection, measured on its text only (not on the boxes of whole
  parts, the bubbles, a code block's header or its controls): a drag over several parts puts the
  button on the line the pointer let go on, in the last, or above or below the selection's last
  line. It does not move while the selection stays the same (a new release that changes the
  selection places it again). A press on it keeps the selection, and its own label cannot be
  selected. It goes when the selection collapses, leaves the reply or an editor opens, and stays
  hidden while the popover is open.
- The text of every comment is highlighted for as long as the comment exists (CSS Custom Highlight,
  `lib/commentHighlight.ts`), as a reviewer marks text in a document: `::highlight(block-comment)`
  is `--accent` at 18% over transparent with a 2px `--accent` underline (the thickness is a
  declaration of its own, so a browser that ignores it inside a highlight keeps the rest). It is
  translucent, so a code block's, table's or blockquote's own fill shows through, in every theme.
  - A comment on a whole part (stored by an earlier version) highlights all of that part's text.
  - A spanning comment gets one range per part it covers: the first from where the selection
    starts, the parts in between whole, the last up to where it ends. There is never one range
    across parts, so the bubbles between them are not painted. A formula is highlighted whole, its
    glyphs included.
  - Nothing is drawn beside the text: no bar, no rail, no tint on the part. A commented part looks
    as an uncommented one.
  - Where the browser lacks the API there is no highlight, and the bubbles still show. A selection
    in a code block that is still folded is highlighted only while it lies in the visible head.
- Stronger: `::highlight(block-comment-active)` (the comment whose bubble the pointer is over or the
  keyboard focus is on; a focus left by a click does not count), `block-comment-current` (the
  composer's walk) and `block-comment-pending` (the selection a comment is being written on, below)
  are each `--accent` at 20%, painted over the base 18%, so together about 35%. The current one is
  painted over the active and the pending one.
- One speech bubble per comment hangs under its part (under the last part a spanning selection
  reaches), in reading order: the text's order, not the order the comments were written in, and a
  spanning comment sorts by where it starts. The part and its bubbles read as one group, the part's
  usual bottom margin below the last. The bubble is a `<button>` (`cursor: pointer`), a small card:
  `--bg-elevated` fill, a `--hairline` `--border` edge (`--border-strong` under a pointer that
  hovers), `--radius-md`, padding `--space-1` `--space-2`, `--fs-sm` at `--lh-base`, the comment in
  `--text` clamped to two lines, `fit-content` wide up to 80% of the part, with a 14px
  `MessageSquare` in `--text-dim` (`--accent` on hover and focus-visible). The text it is on is the
  highlight, so the bubble shows no excerpt. Its accessible name keeps it, "Comment on “excerpt”:
  text" (the excerpt cut at 32 characters; a comment on a whole part has its text as its name), and
  its title is "Edit comment". A click or tap edits the comment. One layout at every width. On a
  coarse pointer the bubble (about 30px tall) gets a `--touch-target` tap area: a transparent
  `::after` centred on it, so its look and its tail (`::before`) do not change.
- The bubble's tail points up at where the highlight ends: a square of `--tail-size` (`--space-2`)
  turned 45° on the bubble's top edge, in the bubble's fill with the bubble's border on its two
  outer sides. It is placed by script (`lib/commentHighlight.ts`, whenever the highlights are
  rebuilt and whenever the transcript's size changes):
  - The bubble is moved right (a relative offset, so it is never narrowed) until its tail sits at
    the x where the highlight's last line ends (a formula by its glyphs); a comment on a whole
    part, or one whose text is not found, puts it `--space-3` after the part's text start. The
    bubble stays inside the part's width.
  - The tail stays `--radius-md` + `--tail-size` in from either side of the bubble, so it is never
    on a rounded corner; a bubble narrower than that gets it in its middle.
  - Several bubbles of one part stack, each placed on its own. The tail rises over the bubble's
    edge by `--tail-rise` (`--tail-size` × 0.71), so the group's top margin and the gap between two
    bubbles are `--space-1` + `--tail-rise`: the visible gap is a little more than `--space-1`, and
    a tail never cuts into the bubble or the text above it.
  - The tail does not follow a horizontal scroll of a wide table inside its part: the text
    scrolls, the bubble stays.
- The current comment: when the composer's context bar walks to a bubble (below), that bubble is
  `is-current` until the next step, a click or tap anywhere else (a touch scroll or a scrollbar
  drag is not one), or Escape; one at a time. Its border is `--accent`, its tail's too, and its
  icon, with a `--dur-fast` `--ease-out` transition (one shot, no animation); its text takes the
  current highlight. The walk goes in the order the bubbles stand in the chat. The chat scrolls so
  that the comment's text and its bubble are in the view's middle together; when both are taller
  than the view, the bubble's bottom goes to the view's bottom, so the bubble the walk focuses is
  always on screen. The bubble takes the keyboard focus (without scrolling): Enter edits the
  comment, a screen reader reads it. The bar sits after the whole chat in the tab order, so Escape,
  pressed with the focus on the current bubble, ends the mark and returns the focus to the bar's
  walk button: Enter there walks on.
- The comment editor has two forms, chosen when it opens by `(pointer: fine)` and not
  `(pointer: coarse), (max-width: 768px)` (the query of the phone layout in `styles.css`):
  - **Popover** (`CommentPopover.tsx`, `.comment-popover`): a small card in the scrolling chat
    view, so it scrolls with the text, on `--bg-elevated` with a `--hairline` `--border` edge,
    `--radius-lg`, `--shadow-card`, padding and gap `--space-2`, `--fs-sm`, `--z-popover`. It is
    `min(360px, 100% − 2 × --space-2)` wide, and it shows no quote: the selection stays visible as
    a highlight. For a new comment it opens where the Comment button was (its top-left at the
    button's), for an existing one 4px under the bubble, left-aligned with it. It is placed inside
    the view (`--space-2` from its sides) and goes above its anchor where there is no room below.
    It follows its anchor when the text above rewraps or grows, and grows away from the anchor
    while typing.
  - Its field is the modal's: it grows from one line to four, takes the focus with the caret at
    the end, and scrolls after that. The footer reads **Delete** (ghost, on the left, only for an
    existing comment, no confirmation), then **Cancel** and **Save** (primary) on the right, the
    app's `.btn` at `--control-h` − `--space-2` tall with `--space-2` of side padding.
  - `role="dialog"` named **Comment**, not modal: no scrim and no inert page. Tab cycles inside it,
    and Escape works only while the focus is in it. Cmd/Ctrl+Enter or **Save** saves, a blank
    comment deletes, an unchanged one only closes.
  - A press outside closes it only while its text is exactly what it opened with; with something
    typed it stays, and so does the text, and a press on a bubble then only puts the focus back in
    its field. A press on the bubble an untouched popover opened from closes it (a toggle). A
    press on the chat's own scrollbar is scrolling and does not close it; one in the chat's padding
    does. Only
    one popover is open per chat; two panes can each hold one, when one of them holds text.
  - The focus returns to the bubble after an edit, and to the pane's composer after a new or a
    deleted comment (the popover is for a mouse or a pen), only if the popover still had the focus or nothing had: it never takes it
    from where the user went (another pane's composer, the terminal).
  - For a new comment the field takes the browser's selection away, so the selected text shows
    as `block-comment-pending` (over the base highlight, the same segments a saved comment gets,
    several parts included) until the comment is saved or given up.
  - **Modal** (`CommentEditor.tsx`, a 560px `.modal`; a bottom sheet at 640px and below): for a
    coarse pointer or a window of 768px or less, and for a comment whose part is not in the chat
    (reached from the composer's walk). It quotes what was selected as plain text, exactly, line
    breaks kept, on `--bg` with a `--border-strong` rail, as the message will carry it (a comment
    on a whole part quotes the part, drawn). The quote is context, so it has no controls: no copy
    button, no fold (**Show all N lines**), no link or file chip, no frame on a code box or a table
    (a `--hairline` between table rows stays), and nothing in it is a Tab stop. It is as tall as
    its text, with no scrolling frame of its own: the dialog grows to its limit (`.modal`, 720px;
    92% as a sheet) and its body scrolls past that. Under it
    the same field and the same buttons, **Delete**, **Cancel** and **Save**; the dialog's title
    says what it is (**Comment**). There is no pending highlight: the quote is the context. On
    close the focus goes back to the bubble that opened it; where that is gone (a deleted
    comment), a pointer that hovers gets this pane's composer, and on a touch screen
    (`(pointer: coarse)`) a deleted comment lets the focus go, so no keyboard rises unasked.
  - Saving a new comment lets the selection go; editing one leaves whatever is selected.
- Auto-follow stops when the reader scrolls up; later output raises a **New messages** pill.
- An empty chat is greeted from the composer (`.composer-greeting`, below), only where the agent's
  conversation was read and holds no turn. A chat still loading, one whose read failed, an agent
  whose transcript could not be read and a pane with no recognized agent keep their own lines
  (`Loading conversation…`, the error, the terminal-output fallback, `No conversation yet — say
  something below`), as does an agent that is working or asking. A history read again after it
  changed is loading, not empty. The server answers the terminal-output fallback for an agent
  that has not written its transcript yet (a new Claude Code or Codex pane before its first
  message), so those are not greeted; an omo session not yet written answers an empty
  conversation and is.

### Work block (`.work-block`, `.work-row`)
- One per assistant turn: a `▸ Worked for 7s · 1 edit · 2 commands` header (duration = next turn's
  timestamp minus this one's; "Working…" in `--status-working` behind a breathing dot while the agent runs;
  "Needs you", the sidebar's words, in `--text-dim` behind a still `--status-blocked` dot while the
  agent is blocked, by the pane's status and not by whether a prompt card was parsed) over
  one-line rows on the header's own left edge, which is the prose edge too (the hover plate
  overhangs it by `--space-1`).
- A row is caret + verb + object: `▸ Read src/metrics.ts`, `▸ Edited src/pages/Reports.tsx`,
  `▸ Ran pnpm test`. The caret is always shown; there is no per-tool icon and no separator. The
  verb (Read, Edited, Wrote, Ran; `lib/toolVerbs.ts`, by exact tool id) is in the interface face,
  `--fs-sm`, `--text-dim`; the object is mono `--fs-xs`. A tool the table does not know, a call
  with no object, or a call summed up by something other than its own command or path (omp's
  `intent`: `bash Checking ports`) keeps its id in mono `--text` in the verb's place. A failed row
  turns the verb or id `--status-blocked` and adds the word "failed": after the object under a
  verb (`▸ Ran pnpm test [failed]`), after the id otherwise.
- A row expands to the typed input (command, diff, file, checklist, raw) and an Output pane. Under
  a verb the tool's own id (`exec`, `Bash`, `apply_patch`) is the first line of that detail
  (`.work-row-tool`, mono, dim) and the row's title.
- Mid-work narration sits between rows. While the turn runs it is the agent's voice: answer prose
  (`--text`, `--fs-chat` on `--lh-prose`) on the prose edge. Once the turn settles it is a quiet
  row again: `--text-dim`, `--fs-sm`.
- Only the running turn's block is open (working or blocked). A settled turn folds to its header
  with a hairline under it, and the header reads as a footnote: `--text-dim`, regular weight (the
  live one keeps medium weight and its state color). The answer is outside the fold. A settled
  turn stays open when its work holds text the answer does not end on: text with no answer at all
  (an action or Codex commentary came last) or text recorded after the answer, so the agent's
  words are never behind the fold. A block the reader opened or folded stays as they left it, and
  so does one they focused or clicked inside: the fold at the end of a turn never takes the rows
  from under them.
- The header is one line: the counts (`.work-block-summary`) take the width the title and the
  failure count leave and end in an ellipsis. `· 1 failed` (`.work-block-failed`) is its own item
  and is never cut, because the fold hides the failed row; at the largest chat type on the
  narrowest phone the title wraps to a second line instead.
- An OmO or omp `task` row opens to the tasks it starts (`.chat-task-calls`): each summary in
  `--text`, the agent as a hairline mono pill, the prompt in the bounded mono input box.

### Background tasks ended (`.chat-task-results`)
- Where OmO reports background tasks that ended, the transcript shows one `--bg-elevated` card
  (hairline edge, `--radius-lg`) on the prose column: a dim `--fs-xs` line with the layers icon,
  "2 background tasks ended" and the time, then one hairline-separated row per task.
- A row is the status icon (`--status-done` check, `--status-blocked` x, dim slash for
  cancelled), the task's summary (`--fs-sm`, medium) over a dim `--fs-xs` meta line (agent ·
  model · duration · turns · tool calls · tokens), and the status word at the right in the
  icon's color, with the skill caret. Opened, the task's answer renders as Markdown, indented to
  the title, bounded to 60vh.

### Prompt card (`.prompt-card`)
- Appears in chat while the agent is blocked and the visible pane contains a supported Claude, omp,
  omo or codex question, approval or plan menu.
- Placement: docked on the composer's column, directly above the input card, on the card's width
  and gutter (`--chat-w`). It is not part of the transcript and does not scroll with it. The
  stack from the top is transcript, held messages (folded to their caption while a card is
  open), prompt card, input card; PaneTerminal owns that order (`.prompt-dock`) and ChatView,
  which owns the prompt, renders the card into it. The dock is an `aria-live="polite"` region, as
  the transcript's log was for the card. It stays rendered while it is empty (zero height, never
  `display: none`): a live region that appears together with its content is not announced.
- Type: the card follows Settings → Chat font size and Chat font, as the transcript does. The dock
  scales the `--fs-*` tokens by `--chat-scale` and sets `--font-chat`; the reference text, the
  keycaps and the step numbers stay `--font-mono`. The height limit does not scale.
- Look: `--bg-elevated`, a `--border-strong` hairline, `--radius-xl`, no shadow. The title is
  the card's one red (`--status-blocked`, `--fs-sm`, semibold); the "input needed" badge is read
  by assistive tech and not drawn. The question is prose in `--text-strong`. Reference text (the
  command of an approval, a plan, a diff: the prompt's `body`) is the card's one mono box
  (`--bg`, `--fs-xs`); a question in words is never set in mono.
- Height: at most the larger of 60% of the app's height (`--app-height`, so a phone's keyboard
  counts) and six touch rows (`240px`), at every width. Only the reference text gives way: six
  lines at rest, two at the least (one for a one-line command), scrolling in itself with a fade
  on its fold. The header, step chips, question, hint, options, custom answer and confirm row
  never shrink. A card still taller than its limit scrolls as a whole with a fade at its bottom
  edge, and the confirm row of a typed pick stays pinned on that edge. The card's scroll is
  contained (`overscroll-behavior: contain`), so a drag past its top is never the page's
  pull-to-refresh.
- The confirm row is kept short, since it is pinned over the options: its question
  (`Send 2. <label>?`) shows two lines at most and scrolls in itself, whatever the label's
  length, and Confirm and Cancel are one group on one line, beside the question when there is
  room and under it when there is not.
- Each prompt that appears has a card of its own: the next prompt opens at its top with nothing
  picked or typed, also when it asks the same question again. An answer that comes back after
  its card is gone (the next prompt is showing, or another pane is open) changes nothing on
  screen.
- The composer keeps the resize grip's hit strip (`--composer-grip-h`) for itself under the card,
  as it does under the held messages: the grip never lies over the card's last row.
- A form of several questions (omo) shows a row of step chips (`.prompt-card-steps`) under the
  header: a chip per question, pill-shaped, mono number or a check once answered (`--accent`), the
  one asked now with an `--accent` border, `--accent-tint` fill and a `--primary` number. The title
  then reads `Question 1 of 2`; the review after the last question keeps the chips, all checked.
- Single options submit immediately; multi-select exposes checks plus Submit; supported custom input
  has its own labelled field. The prompt id names what the prompt says and which asking of it this is; an answer to another prompt, or to an earlier asking of the same one, is rejected with `prompt_changed`.
- Options are flat full-width rows (`.prompt-card-option`), not boxes in the box: the menu's
  number as a keycap (mono, `--fs-2xs`, a `--border-strong` outline; the option's name keeps
  `1.`), the label, its description under it in `--text-dim`. All rows weigh the same: none is
  filled, outlined or put first as a default, since herdr has no ground to recommend one. Hover
  and focus fill a row `--bg-hover`; a checked or typed pick gets `--accent-tint` + an `--accent`
  border and keycap. A `(Recommended)` suffix, the agent's own mark, renders as a tag. On a
  coarse pointer a row is `--touch-target` tall.
- While a card that takes typed answers is open the message box's placeholder says how:
  `Type 1–3 to choose…`, or `Type 1–3 or your own reply…` when the card has a custom answer.
  Enter in an empty box answers nothing. A typed pick of an approval, plan or menu waits for
  Confirm in the card. After an answer pressed in the card with the keyboard or the mouse, focus
  moves to the message box, unless the user moved it somewhere else while the answer was on its
  way or the card is gone. A tap or a pen never moves it there (that would raise the on-screen
  keyboard). The press itself says what made it, not the device: a key or a mouse hands the focus
  on with a coarse pointer too (a tablet with a keyboard), and a tap does not on a touch-screen
  laptop with a fine pointer. Only a press that does not say what made it is read by the device's
  pointer, and stays out of the message box where that is coarse.
- `POST /api/pane/prompt/answer` translates the chosen answer into the agent's navigation keys and
  sends them through herdr `pane.send_keys` / text input. The card never fabricates a chat reply.

### Composer (`.composer`)
- Chat mode is ONE surface: the stack, the transcript and the composer region all sit on `--bg`,
  and the composer column equals the transcript column (`--chat-w`, same `--space-4` gutter,
  `--space-3` at `480px` and below).
  The input box is a card: `--bg-elevated`, hairline border, `--radius-2xl`, `--shadow-card`
  (the only other card on this surface is the prompt card docked over it, while an agent asks);
  focus turns its border `--accent` (no inner outline). Above it the completion popover and the
  background-task list; inside, the image strip is its own row at the top, then the auto-growing
  message box as a row of its own at the card's full width, then ONE row of controls under it:
  on the left the add button (lucide `Plus`, named "Attach files"), the mic when voice input is
  on, and the background-task chip; on the right the status content, Queue when it applies, and
  ONE round button.
- Empty chat (`.composer-greeting`): one line on the composer's column, directly over it,
  `What should <agent> do in <folder>?` in `--text-strong`, `--fs-display`, `--fw-semibold`, `--tracking-display`, centred,
  and under it `PC · full path` in `--text-dim`, `--fs-sm`. Both wrap anywhere. While dictation's
  recording pill is open over the composer the greeting is hidden (its box stays). No suggestion
  chips or starter prompts. The greeting is out of the flow, so it takes no row from the terminal
  surface. In a mouse-driven window from `769px` the composer is moved up (a transform, nothing
  else changes size) so the greeting and the input card sit at the pane's vertical centre; a
  phone keeps the composer docked with the greeting above it. The first message sent removes the
  greeting and the composer is back at the bottom at once: it snaps, with no animation. Held
  messages keep the composer docked. Once a message went out, the greeting stays away for that
  pane until the conversation shows a turn or becomes another history: another lens, another
  pane or a failed read does not bring it back. A stack too short for the composer and the
  greeting leaves the greeting out (`.is-out`, hidden and `aria-hidden`) and the chat shows its
  own empty line. While the composer is lifted, the completion menu's height is capped to the
  room over the input card, where it scrolls. On a coarse pointer the greeting takes no touch:
  a tap or drag on it reaches the chat under it, which puts the keyboard away.
- The round button (`.composer-action`, a `--touch-target` circle, `44px` on a coarse pointer) is
  Send or Stop in the same place at the same size, so only the glyph changes: Send is `--primary`
  with lucide `ArrowUp`; Stop is `--text-strong` with a `--bg` square, and turns
  `--status-blocked` on hover and focus. Not connected, Stop is disabled and loses its fill
  (`--border-strong` outline, `--text-dim` glyph).
- The status content (`.composer-status`, `role="status"`) sits between the two control groups,
  pushed to the button's side. It draws, at `--fs-xs`: the model pill, `DONE`, and the uploading
  or reconnecting sentence in `--text-dim`. The background-task chip is a button in the left controls;
  its count is repeated here as `.visually-hidden` text, so a change is still announced. The agent's written name, its separator, the state words
  `READY` / `RUN` / `INPUT` and the sentence `Reasoning high` stay in it for assistive tech only
  (`.visually-hidden`): the header names the pane, and the state is told by Stop, the live row
  and the prompt card. `DONE` alone is drawn, before the pill, in `--status-done` caps: nothing
  else in the chat says a turn ended and was not seen yet, and on a phone the sidebar's label is
  in a closed drawer.
- The model pill (`.composer-pill`) holds the agent mark, the model, the reasoning level and the
  context ring in one quiet surface: `--bg-hover` fill, `--radius-pill`, `--control-h` tall,
  `--space-3` inline padding, `--space-2` between its parts. The model is in `--text` at
  `--fw-medium`; the level follows a middle dot in `--text-dim`, as the agent's own words with
  only the first letter drawn as a capital (`::first-letter`, the text is not rewritten); a pane
  that records no level draws no dot and no dash, only the name. On the
  fill the ring's track is `--border-strong`; a ring left bare on the card keeps `--border`. It is display only: a `span` with no role, no
  focus, no hover or pressed state, no pointer cursor and no chevron; the ring inside it is the
  one thing to press. The `title` of the model is the id as received, and the level's is its
  sentence; behind a name the id is also repeated as `.visually-hidden` text, since a touch
  cannot reach a title. A pane that names no model draws no pill: the mark and the ring stand
  alone, with a dim `Model —` and the level between them if the pane records only a level.
- The model is drawn by name only where its id is one `modelLabel` (`src/lib/modelName.ts`) can
  name for certain, from the vendor's own regular naming and matched whole:
  `claude-<family>-<major>[-<minor>]`, also behind `anthropic/`, is `<Family> <major>.<minor>`
  (`Opus 5.5`, `Sonnet 5`); `gpt-<version>` is `GPT-<version>` and `gpt-<version>-sol` is `GPT-<version>-Sol`, as
  Codex's own status line writes it; `glm-<version>` is `GLM-<version>`. A name is never guessed. The rule is the
  vendor's id syntax, not a list of released versions, so a new model needs no change and a
  well-formed id of a version that does not exist is named too. Any other id — a dated snapshot, another tier or
  product suffix, another provider's prefix, another vendor, a spelling that is not the vendor's
  canonical one (a leading zero as in `claude-sonnet-5-05`, uppercase, a stray separator or
  space) — is drawn exactly as received in
  `--font-mono` at regular weight (`.composer-model.is-id`), so it reads as an identifier and no
  suffix is dropped.
- What does not fit the row gives way in this order: the task chip's words (icon and count below
  a `640px` card — the card's own width, `composerStatusCompact`, not the window's); then the
  model label, decided from the measured row and not from a width (`composerModelDraw`), so the
  mic, a long model id, the language and the opened context text all count: the row is measured
  again when that text opens or closes. While Queue is showing, a label that does not
  fit steps out whole — the mark, the model and the level are read, not drawn, and are back once
  the draft is sent, held or cleared — so Queue keeps its word and no name is cut mid-word. The
  pill goes with its label: the ring then stands alone, with no empty pill around it. On a
  `390px` phone, beside the task chip, the ring and Queue, that is the case for every named model
  with a level, so there the pill is out for as long as Queue shows; a label short enough to
  fit (a short id with no level) stays drawn.
  Without Queue the level steps out whole first, never drawn in part; a name still too long is
  ellipsized inside the pill as the last resort, then the opened context text. The context ring
  is never cut. Over a sentence that took a line of its own the pill is `--chip-h` tall, so the
  card does not grow.
- Queue is drawn only while the agent works, the bridge is live and the box holds a draft or a
  file still uploading (`composerQueueShown`): with an empty box Stop is the one resting control,
  also when an attachment tile is left in it without its mention, since only the text is sent. The rule
  reads the draft, not `:disabled`, so the pill stays in place, disabled, while a file uploads
  or the message is on its way. It is a `--primary-tint` pill; its `--primary` outline is drawn
  in light themes only, where the tint alone does not separate it from the card. Pressing it is
  the only thing that holds a message. When a pressed Queue leaves with its draft, its focus goes
  to the message box (a touch press moves no focus, so no keyboard is raised). The placeholder is
  just `Message <agent>…`. The message is typed at `--fs-chat` on `--lh-code` with a mouse
  (`(hover: hover) and (pointer: fine)`) and at `--fs-input` otherwise.
- Block comments waiting for the next message are shown where they were written, as inline cards
  under their part in the chat. The composer holds them as one context bar, a row between the
  attachment strip and the message (rows: attachments, comments, message, controls; the DOM is in
  the same order), in the grammar of a "Replying to…" bar (`.composer-comments-bar`). Nothing of
  them shows above the card (no pill, no row), the control row and status content are exactly as
  without comments, and the attachment strip stays the files' alone, as on `main`. The row takes
  no space when there are no comments.
  - Place: a box in the card's content column, the "reply preview" of messaging apps, with no rail.
    Its left and right edges line up with the attachment tiles' and the message's text (`--space-5`
    in from the card's inner edges, `--space-4` on a phone, under 480px), `--space-2` below the
    strip, or `--space-3` from the card's top (the strip's own top padding) when no file is attached.
  - Look: `--radius-lg`, filled with `--bg-hover` (always, subtle). The message below gives up part
    of its top padding while the bar is there (`--space-2`, and its minimum height shrinks by the
    same amount), so its first line is `--space-2` under the box. The field's own box is that much
    shorter; the space under its text is not: the controls row and the first line's distance to it
    stay as they are, so nothing below the bar moves when it comes or goes.
  - Inside, with `--space-1` above, below and at the right and `--space-3` before the icon: a 14px
    `MessageSquare`, the sentence in `--fs-sm` on one line (it ellipsizes, the X stays), and an X
    icon button tucked into the right padding. The box is one line, `--control-h` tall
    (`--touch-target` on a coarse pointer), in both states.
  - Under a pointer that hovers, the whole box takes a slightly stronger fill (`--bg-hover` mixed
    6% with `--text`) and the walk button has none of its own (no box in a box); the X and Undo
    take a stronger one (12%). Focus rings are the app's `:focus-visible` ring on the walk button,
    the X and Undo; the box clips nothing.

  Two looks, told by words and not only colour:
  - **Goes with the next send** (`is-going`): `--accent` icon, the sentence `3 comments on
    the reply` ("1 comment on the reply") in `--text`.
  - **Waits** (`is-waiting`: a command, an answer to an open question, no agent): `--text-dim` icon
    and sentence, which says `3 comments waiting`; the reason ("Comments stay
    here: they are not sent with a command" and its siblings) is in the button's name and title.

  The sentence is one button: a tap walks the chat to the next bubble of this pane's own chat
  (several panes can be mounted), round again, and makes it the current comment (above), one stop
  per bubble, so a part with three comments is three stops. Its name is the sentence (while waiting,
  with the reason after it), and its title adds "Go to the next comment". The button fills the box's
  full height (it takes the box's padding as negative margin, as the X does), so a tap anywhere in
  the box's height lands on it: `--touch-target` tall on a coarse pointer. A comment whose part is
  not in the chat (older history not loaded, a reply that changed) is a stop of its own that opens
  its editor (the modal), so the bar reaches every comment it counts. The bar counts every stored
  comment, and comments stored for a pane outlive a reload.

  The X is a button of its own, "Remove all comments": it drops every comment of the pane at once
  and clears the current mark. A confirmation would add a step to every removal that was meant and
  is clicked through by habit, so the removal is undone instead (an undo costs nothing when it was
  meant): the box turns, **in its own place and at its height**, into the undo bar:
  `Comments removed: 3` in `--text` and a text button **Undo**, no X, and the focus moves to Undo,
  which is described by that sentence, so a screen reader reads "Undo, Comments removed: 3". A tap
  on Undo restores the comments as they were (one written on the same block meanwhile wins) and
  the focus goes back to the walk button. The undo bar goes when the message is sent, a new comment
  is written, the pane changes or after 10 seconds; if it has the focus then, the message box takes
  it on a pointer that hovers, and on a touch screen (`(pointer: coarse)`) the focus is only let
  go, so no keyboard rises unasked. Send and Queue carry no badge: the number of comments *this*
  send takes is in their name and tooltip ("Send message · Comments to send: 3"), and none is named
  while the comments wait.
- Not connected, the sentence `Reconnecting… message held here, never queued` is said once and
  whole: it is the placeholder while the box is empty and moves into the status content once
  there is a draft (`composerStatusHint`), on a phone too. A sentence there (this one, or
  `Uploading file…`) is never ellipsized: where it does not fit beside the model it takes a line
  of its own under it, without its leading dot, and wraps there; its `title` repeats it. Only
  the sentence takes a line: the mark, the model, the level and the ring stay one row over it
  (`.composer-status-meta`), where the label gives way exactly as it does with no sentence. The
  status content is then left-aligned, beside the add button. Add and Stop are disabled and
  Queue is not drawn. With a draft, the reconnecting sentence is said instead of
  `Uploading file…`, never both: the attachment's own tile says it is uploading.
- The resize grip is a short bar on the card's top edge. On a fine pointer (`(hover: hover) and
  (pointer: fine) and (not (any-pointer: coarse))`) the bar is drawn while the card is hovered,
  while it is dragged, on its own keyboard focus, and while a manual height is set; on any coarse
  pointer it is always drawn. Its hit area lies above the card (`--composer-grip-h`), and the
  composer keeps that strip free after the held-message list and after a prompt card.
- The stack over the input card, on its column, is written once (PaneTerminal): held messages,
  then the prompt card (see Prompt card), then the input card.
- Held messages (`.composer-queue`) are quiet rows on the input card's column, above it: the
  card's width and gutter at every window width, no tint and no box. One `--border` hairline
  above the group, then one caption line in `--text-dim` at `--fs-xs` (a clock and the sentence
  `Held until the agent is ready`, plus `· 2 messages` from two; a translation too long for a
  phone's column takes a second line, it is never cut), then a row per message: its text, still
  a box to edit (transparent until focused, up to four lines, two at `480px` and below),
  `Send now` and `Discard`. A message queued with comments keeps them as a snapshot taken when
  Queue was pressed: the row shows and edits only what was typed, and before `Send now` sits the
  comment chip in its going state (`--accent-tint`, `--accent` icon, the count; a `role="img"`
  that only informs, named "Comments with this message: n", centred on the row's own height). A
  message of comments alone shows `Comments only` in `--text-dim` in its empty box, and `Send now`
  stays enabled. `Send now` composes the comments and the typed text at that moment, as the
  composer does, and a message over the length limit is not sent: the row says "Too long to send.
  Shorten the message or remove comments." `Discard` drops the message with its comments.
  A message with comments, sent from here or from the box, goes agent-only; the server refuses it
  with `agent_only_busy` while a Codex is busy with its own queued questions, so it is never typed
  into them, and the message and its comments stay. Hairlines between rows run the column's width; every line of text starts `--space-3`
  in. The list, not the group, has the height limit (two and a half rows, then it scrolls), and it
  gives way before the caption does. "Queued messages (n)" and each row's "Message n" stay for
  assistive tech only (`.visually-hidden`).
- When the agent is ready the sentence becomes `Held message — review and send`, in `--text`, and
  the `--accent` goes on the clock and on the outline of `Send now`; the hairline stays `--border`.
  Nothing is sent without that button.
- While a prompt card is open, or in a short phone window (`480px` wide and `600px` tall or
  less, as a media query: Android's keyboard shrinks the window to that, iOS Safari's does not),
  the rows fold into the caption, which becomes a disclosure button (`aria-expanded`, a chevron,
  `--touch-target` tall on touch) and counts a single message too. The rows stay mounted and one
  tap opens them. A list that is ready, a row being edited and a row with an error are never
  folded away; while a row's error holds the rows open the caption is plain text, not a button.
  When the button goes, focus on it moves to the list, unless it went because the pane changed.
- At `480px` and below a held row is its text, `Send now` and a `--touch-target` X whose name is
  still `Discard`.
- `/` completions come from `GET /api/pane/commands` and group built-in, user and project commands;
  `@` completions query `GET /api/pane/files`. Arrow keys navigate, Enter/Tab accepts, Escape closes.
- Paste, picker or drag/drop accepts up to four png/jpeg/gif/webp files per action. Each gets a local
  preview, uploads through `POST /api/pane/image`, and inserts a removable editable `@path` mention.
- While a phone's keyboard is up, a tap on the transcript or a drag down it (`32px`) puts the
  keyboard away. Each only blurs the field, so the draft stays. The prompt card, which can stand
  where the transcript was on a short screen, does the same: a tap on its text (never on an
  option, a box or its field), or a drag down it once the card and its reference text are
  scrolled to their top.
- On a touch screen, picking a pane (drawer, palette, notification) or switching its lens never
  raises the keyboard: the user reads first, and a tap on the message box or the grid raises it.
  A desktop's picked pane takes typing at once.
- Enter sends and Shift+Enter breaks by default; with **Enter sends** off, Mod+Enter sends. IME Enter
  is ignored. While working, Stop sends Escape and Queue stores the next message.

### Voice input
- A mic button sits beside the add button in the composer and beside Send in the terminal input line; it
  fills with `--accent` while recording. Dictated text is inserted at the caret, never sent.
- The recording pill shows Cancel, a **Recording** label, the level bars, a mono timer and Done.
  Amber only; `--danger` stays for errors.

### Command palette
- `Mod+Shift+K` opens a top-offset `--palette-w` dialog searching panes and actions. Recent panes
  lead an empty query; arrows cycle, Enter activates and Escape closes.
- Actions cover new workspace, lens/sidebar/theme, settings, notifications, lock and refresh, with
  `.kbd` hints where a global shortcut exists.

### Settings dialog
- A fixed-size window (`--settings-w` × `--settings-h`, capped by the screen) over the app, which
  stays in view behind the scrim, so an appearance change shows at once. `--bg` with a
  `--settings-nav-w` navigation column on `--bg-panel` and a hairline between them. Mounted only
  while open: each opening starts from its page, and each page asks the server for what it shows
  when it mounts.
- Navigation (`.settings-nav`): the title, the search field (`.settings-search`, a `/` keycap;
  `/` moves there from anywhere not editable), then three groups of pages, each a dim semibold
  `--fs-xs` heading over 36px items (lucide glyph and name, `--fs-sm`): **This device** (Appearance,
  Terminal, Chat, Voice input, Notifications, File viewer, Keyboard shortcuts), **Server & connections** (Phone &
  devices, Remote PCs, Plan usage) and **herdr web ui** (About & updates). Items are 2px apart, so a
  hovered item's fill never touches the open one's. The open page's item (`aria-current="page"`)
  takes `--bg-hover`, a `--rail-w` `--accent` rail on its left edge and an `--accent` glyph, as
  the selected pane row. A footer line, a `--status-done` check and **Changes save automatically**.
- The page (`.settings-content`): a header with the page's name (`--fs-display`, semibold), one
  dim line under it and the close button, over a scrolling body whose groups keep to
  `--settings-content-w`.
- A page is groups (`settings/SettingsUi.tsx`). A group (`.settings-group`) is a sentence-case
  `--fs-md` semibold title, an optional one-line intro in `--text-dim`, then one card
  (`.settings-card`: `--bg-panel`, hairline `--border`, `--radius-lg`) of rows parted by
  hairlines (the card's `--border` showing through a 1px gap, so a hidden row takes its line with
  it), then the group's own buttons under the card. `--space-8` between groups, less inside them.
  A row (`.settings-row`, `--row-h` at least) is the label (`--fs-md`, medium, `--text-strong`)
  with an optional short description (`--fs-sm`, `--text-dim`) on the left and its control on the
  right; a stacked row (`.is-stack`) puts the control under them at the row's width (fields,
  lists, tiles, radios). Notes and errors (`.settings-note`) go under the row's line.
- Controls: the switch (`.settings-toggle`, `role="switch"`): a 44×26 pill in a 48×40 target,
  `--bg-input` with a `--border-strong` edge and a `--text-dim` thumb when off, solid
  `--primary` with a `--primary-text` thumb when on. The stepper (`.settings-stepper`): −, the
  value in mono, + on one bordered `--bg-input` field. Segmented controls are the primitive. A few
  choices that need a line each are radios (`.settings-radio`, the checked one `--accent-tint`
  with an `--accent` edge). A tag (`.settings-tag`) is a `--chip-h` pill after a label: a state
  (`--status-done` on its tint for On, Connected, Up to date), or **Saved on the server PC** with a
  monitor glyph on what the server keeps for every device (the OpenAI key, the bridge switch).
- Search: while the field has text every page is drawn at once and only the rows that match stay;
  a group or page left without one hides (`:has()`), each page's name heads its groups in
  `--accent`, intros hide, and the header reads **Search results** / **Across all sections**.
  A row matches when each word is in its label, its description, its group's or page's title (in
  the language shown) or its English keywords. Controls work in the results. Nothing found reads
  **No settings match “…”.** Escape clears a search first, and closes Settings after that.
- The open page is in the address: `#settings/<page>` (`lib/settingsSearch.ts`) opens Settings
  on it, at load or typed into an open tab; switching pages rewrites it (`history.replaceState`)
  and closing removes it. The update line's **Details** opens About & updates.
- Focus: a keyboard starts in the search; a touch screen focuses nothing that raises its keyboard.
  While Settings is up, focus that lands in the app under it (a terminal attaching, a Tab past the
  last control) comes back; a menu or a confirm Settings opens keeps it.
- Phones (`<=640px`): the whole screen, as a phone's own settings. First the list: each page a
  56px row in its group's card (glyph, name, and under it its current values in one dim line, such
  as **Dark · Catppuccin · Comfortable** or **13 px · JetBrains Mono**, where they are known without
  asking the server; a chevron). A tap opens the page, whose header has **All settings** (back),
  the name and close. Segmented controls and selects take the row's width; palette tiles go two
  by two. While searching, the field stays at the top and the results take the list's place.
- Appearance: Mode (Dark / Light / System), Palette as four radio tiles, each a small picture of
  the app drawn with that palette's own tokens (the tile's preview carries `data-theme` and
  `data-palette`), Density, Group sidebar by (Workspace / Folder) and Language (a select: System
  with the language it resolves to, then each by its own name).
- Terminal: a preview in the terminal's colours, font and size; font size `10–22px`; font family;
  Typing (Automatic: the input line on a touch screen, direct typing with a mouse and keyboard /
  Input line / Direct typing); wheel scroll speed; the key bar's extra keys.
- Chat: Panes open in; Show thinking, Width on large screens (Narrow 820px / Default, following the
  pane / Wide 1152px / Full, the pane less its gutters), chat font size and family; Enter sends
  (its description names the Mod+Enter keys as keycaps) and the suggested prompt chip; quick
  replies: a switch, then one field per reply with move up, move down and remove, Add reply and
  Restore defaults.
- A font family is a text field saved when it is left, on Enter or when the field unmounts (the
  dialog closing, another page or a search taking its place), not per keystroke.
- Voice input: the mic button; Speech recognition (what recognizes the speech now and where the
  audio goes, the OpenAI key with Save key and Remove key); tidying, while the mic button is on.
- Notifications: this device's push state with Send test (and **Turn alerts on again** when it
  needs it), what to be told about, and the in-app banner and sound.
- File viewer: Wrap long lines and Markdown width (Default / Full width), then Large files: Load
  text files up to and Highlight syntax up to (256 KB / 1 MB each).
- Keyboard shortcuts: one row per shortcut with its key select (Default, Off, any free
  Mod+Shift+key), Dictate's fixed keycaps, and Reset all shortcuts.
- Phone & devices: the address a phone can open (or the step still missing), Keep screen on,
  Install as an app (installed, promptable or the browser's steps), then Paired devices: how this
  browser got in, a row per device with a `⋯` menu (the row menu: Rename, Revoke after a
  confirm), the pairing code with its QR code and link while one is out, and **Pair a device**.
- Remote PCs: a row per PC (Host for this one, its state as a tag, its SSH address or error);
  an SSH PC's `⋯` holds its sidebar group's manage actions (Rename, Connect / Disconnect,
  Reconnect / setup, Update bridge…, Remove PC after a confirm). **Add PC** under them opens the
  PC setup dialog and closes Settings behind it, never waiting for the server's settings; when
  that dialog closes, focus lands on the header's workspace-list toggle. Bridges holds the server's
  bridge auto-update switch, once the server has answered.
- Plan usage: Show plan limits, then (when on) Meters show (Used / Remaining) and Limit shown
  (Weekly / Session), and Accounts: a row per account (mark, name, dim ellipsized email, then
  move up, move down in fixed columns and a show switch; a move that cannot happen keeps its
  column but is not shown). A hidden account's row fades; it stays listed so it can be shown again.
- About & updates: a row for herdr web ui and one for herdr, then Star on GitHub and Website. The
  running versions are always written, since the sidebar carries none: **Running vX.Y.Z
  (commit)**, the server's version and commit, or the client's own build version before the
  server answers and where it names neither. While the server runs another version than this tab
  was built from (updated, not yet reloaded), a note names the tab's own. The herdr row reads
  **Running herdr X.Y.Z**; where herdr cannot be updated from here (Windows, an older server) the
  row is that line alone, from the health check.

### Terminal host, key bar and drawer
- xterm has `scrollback: 0`; wheel/touch gestures reach herdr's alternate-screen scrollback. The
  mount clips its own gutter and hides the unused xterm scrollbar.
- Terminal banners stack top-right for ended, reconnecting, observe and held-draft review states.
- The mobile key bar is Esc, Tab, one-shot Ctrl, arrows and `^C`; it never steals xterm focus.
- The mobile drawer slides over a scrim. Closed visibility removes its controls from the tab order.

### In-app alert
- While the app is on screen, a pane that needs input, finishes a turn (by the device's Finished
  choice) or ends drops a card from the top edge: a black drop falls from above the safe area,
  spreads into the card, and its text shows. It hangs from `env(safe-area-inset-top)` only, so a
  Dynamic Island, a notch and a desktop window take the same path; no device is guessed.
- In the phone layout (768px and under) the card is one line, 44px high and as wide as its text
  (340px at most): the pane's name, then what happened. A long name is cut short, what happened is
  not, and the dot is left out. Wider than that it is the two-line card, 64px high.
- One at a time; a newer one folds the current one away first. Tap opens the pane; a drag or flick
  up puts it away; it leaves by itself 3.6s after its text shows, and waits while touched.
- Not for the pane already open, and not while the app is hidden (system notifications cover that).
- Reduced motion: it fades in and out where it rests, without falling or spreading.

### Token gate
- A centered password card replaces the entire shell while authentication is required. It has a real
  label, autofocused field, primary Unlock button and linked alert text.
- Success mounts the shell; Lock unsubscribes push, deletes auth and returns to the gate.

### Role (no control surface)
- `interact` types and resizes; `observe` does neither. The server enforces both and the WS protocol
  carries `role` / `role-ack`.
- The app connects as `interact` and exposes no role switch. An observe acknowledgement still gates
  local input, adopts server geometry and displays the view-only banner.

## 6. Motion & Interaction

### Timing

| Type | Token | Value | Usage |
|------|-------|-------|-------|
| Micro | `--dur-fast` | `120ms` | Hover, active, toggle and control state |
| Standard | `--dur-base` | `180ms` | Drawer slide; reserved dialog timing token |
| Pulse | `--dur-pulse` | `1600ms` | Working and reconnecting dots (trough opacity 0.35; text never pulses) |
| Easing | `--ease-out` | `cubic-bezier(0.2, 0, 0, 1)` | Finite transitions |
| Pulse easing | `--ease-pulse` | `steps(2, jump-none)` | Endless working and reconnecting dots; avoids drawing every display refresh |
| Spring easing | `--ease-spring` | `cubic-bezier(0.32, 0.72, 0, 1)` | Voice recording pill enter (180ms, scale 0.96->1 + opacity, from the mic button) and exit (120ms) |

### Rules
- Only state changes move: hover/press, the drawer, settings switches, working and reconnecting.
- Dialogs and their scrims snap open and closed; they have no entrance or exit animation. On mobile,
  their static layout changes to a bottom sheet.
- The voice recording waveform is the one surface allowed to draw every frame: only while
  recording, driven by the live microphone level, transform-only (`scaleY` on 7 bars). The pill is
  a state change, not a dialog, so the snap rule above does not apply to it.
- `prefers-reduced-motion: reduce` removes pulses, drawer/control transitions, smooth chat scrolling
  and settings toggle motion. State remains legible without animation.
- Under reduced motion the voice pill swaps its bars for one level bar updated at 4 Hz and drops
  the ring and the morph; the **Recording** label and the timer stay.

## 7. Depth & Surface

### Strategy

**Tonal shift + hairline, with shadow reserved for overlays.** Resting shell surfaces have no shadow.

| Type | Value | Usage |
|------|-------|-------|
| Hairline | `var(--hairline) solid var(--border)` | Shell, fields, controls |
| Strong edge | `var(--border-strong)` | Hover/focus separation |
| Dashed edge | `var(--hairline) dashed var(--border)` | Unknown/empty states |
| Tonal lift | `--bg-elevated` on `--bg-panel` | Selection, chips, tracks |
| Tinted lift | Named tint over an opaque surface | Primary and agent states |
| Drawer shadow | `--shadow-drawer` | Mobile drawer |
| Overlay shadow | `--shadow-pop` | Menus, palette and modal cards |
| Card shadow | `--shadow-card` | The composer's input box — the one resting card in chat mode |

## 8. Accessibility Constraints & Accepted Debt

### Constraints
- WCAG 2.2 AA is the target; do not document numeric contrast without measuring both shipped themes
  and every actual backing surface.
- Global `:focus-visible` uses `--ring`; interactive controls remain keyboard reachable except the
  touch key bar, which intentionally preserves terminal focus and has hardware-key equivalents.
- Icon-only controls carry `aria-label`; toggles expose `aria-pressed` or `role="switch"`; selected
  pane exposes `aria-current`; dialogs expose `role="dialog"` and `aria-modal`.
- Status, loading and composer progress use `role="status"`; failures use `role="alert"`. Agent state
  is text plus color, and unknown adds a dashed edge.
- Touch targets grow to `--touch-target`; fields stay `--fs-input` where mobile zoom is a risk.
- `prefers-reduced-motion` is honored. Lucide/inline SVG decoration is hidden from assistive tech.
- Global shortcuts use the convention **Mod+Shift+key**: Mod is Command on Apple platforms and Ctrl
  elsewhere. The settings table is the discoverable source of the complete mapping.
- `document.title` is `<pane title> · herdr` while selected, otherwise `herdr web ui`.

### Accepted debt

| Item | Location | Why accepted | Exit |
|------|----------|--------------|------|
| Terminal content accessibility relies on xterm defaults | `PaneTerminal.tsx` | Screen-reader mode changes terminal DOM and input behavior | Decide with herdr TUI owners |
| Drawer has no focus trap | `.sidebar.is-open` | Closed state leaves the tab order, but open-state trapping is not implemented | Add a shared focus utility |
| Modal focus is initialized, not fully trapped | Dialog components | Escape/scrim/close work; tab containment is not shared | Add the same focus utility |
| Terminal colors exist in CSS and JavaScript | `styles.css`, `settings.ts` | xterm consumes a JS theme | Keep `terminalTheme()` verbatim with `--term-*` |
