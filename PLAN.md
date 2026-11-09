# EarlyWeb: Plan & Architecture

_Name: EarlyWeb. License: MIT._
_Status: approved 2026-11-06. No code yet._

---

## 1. Vision

A **desktop app** that recreates the **broadband-era internet (about 2004–2010)** as a working "retro internet OS": glossy glass windows, a skinnable MP3 player with wild visualizations, a web browser that shows modern sites in an era style, customizable profile pages, Flash-era games. Every piece actually works.

- **Real apps:** a notepad that saves real files, a media player for your own MP3s, a web browser that loads modern sites in an era style.
- **An open platform:** apps run in sandboxed iframes and talk to the OS only through a documented postMessage API. Built-in apps get no special treatment. Third parties submit apps by PR.
- **No servers:** everything runs on the user's machine. The project is distributed and updated through GitHub Releases, and the app registry is a GitHub repo. Nothing costs money to host and there's nothing to abuse.
- **Original, not copied:** every theme, icon, sound and app name is an original lookalike. No Microsoft, AOL, MSN, MySpace, Disney/Club Penguin, Apple or Winamp names, logos, sounds, mascots or copyrighted music.

### Decisions

| Area            | Decision                                                                                                                                                                                                       |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Platform        | **Desktop-only** (Windows, macOS, Linux) via **Tauri v2**. Mobile is out of scope: a windowed OS doesn't work on a phone.                                                                                      |
| Languages       | **TypeScript for all UI** (shell + apps). **Rust for the native backend:** file system, page fetching/sanitizing, app install/serving, and later heavy modules (Ruffle, audio, emulators). Apps may ship WASM. |
| Servers         | **None.** No Cloudflare Workers, no proxy, no accounts.                                                                                                                                                        |
| Distribution    | GitHub Releases, built by GitHub Actions (`tauri-action`) for all three OSes, with auto-update through the Tauri updater plugin. Unsigned at first; buy OS code signing if the project takes off.              |
| App model       | Sandboxed iframes, postMessage API only, built-ins use the same API                                                                                                                                            |
| Storage         | Real files on disk under an EarlyWeb home folder (plus optional user-mounted folders such as their real Music folder), with the Rust backend enforcing access                                                  |
| Registry        | A GitHub repo, apps submitted by PR, built by CI, installed from GitHub Releases                                                                                                                               |
| Era / look      | Broadband era first, with an original Windows 7-style glass theme. Themes are a first-class system so other eras (a classic late-90s theme with a dial-up boot) can come later.                                |
| Shell framework | Preact + signals (see §3.2)                                                                                                                                                                                    |
| Messenger       | **Parked.** If it returns: peer-to-peer (Trystero) or an optional self-hostable relay (§7, "Later")                                                                                                            |
| Web demo        | Optional extra, not planned: the same shell can run as a static site with an in-browser storage backend and no browser app.                                                                                    |
| Rootstock OS    | Not used (it's a Claude Code workflow kit, not a browser-OS framework)                                                                                                                                         |

### Assumptions (correct me if any are wrong)

- The repo license is **MIT**. That keeps the option to borrow daedalOS (MIT) code and imposes nothing on app developers. Puter (AGPL-3.0) and FrogFind (GPL-3.0) are used **for ideas only, never code**.
- Development happens mostly in a normal browser tab (Vite) for fast iteration. The Tauri wrapper is thin, so the shell must not depend on Tauri APIs except through the backend interfaces in §3.

---

## 2. Prior art: what to borrow, how to differentiate

| Project                         | What it is                                                                                       | Borrow                                                                                                                                                                                                    | Differentiate                                                                                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Puter** (AGPL-3.0, ~44k★)     | A modern open-source "internet computer": cloud FS, app store, `puter.js` SDK, iframe apps       | **Ideas:** a single small SDK that apps import, apps running in iframes, an app store with permission prompts. **No code** (AGPL).                                                                        | Puter is a modern, cloud-hosted OS. EarlyWeb is a **nostalgia-first, local desktop app** with no accounts or servers, and its apps are era-specific.             |
| **daedalOS** (MIT, ~13k★)       | A polished desktop in the browser (React/Next): window manager, file system, many WASM emulators | **Ideas and, where useful, MIT code with attribution:** window drag/resize/snap behavior, z-order and focus handling, file associations, desktop icons, the performance work, integrating WASM emulators. | Its apps are in-process React components, not a platform. EarlyWeb's core is a **sandboxed third-party app API**: anyone can ship an app without forking the OS. |
| **Windows 93** (closed, parody) | A playful, absurd fake OS full of toys and jokes                                                 | **Tone:** personality matters more than fidelity. Easter eggs, small toys, sounds, humor in error messages.                                                                                               | Windows 93 is a parody and mostly non-functional. EarlyWeb is something you actually _use_: real files, a real browser, your real music.                         |
| **Protoweb**                    | A proxy serving restored archived sites to vintage hardware                                      | **Idea:** the web _as it was_ is part of the nostalgia. Later this becomes a "Time Machine" toggle in the browser via Wayback Machine snapshots (respecting archive.org rate limits and terms).           | Protoweb targets real old computers. EarlyWeb targets modern machines playing dress-up.                                                                          |
| **FrogFind** (GPL-3.0)          | A search engine and proxy that strips modern pages to basic HTML for vintage machines            | **Idea:** reader-mode extraction is the reliable way to make arbitrary modern sites render simply. A built-in search start page. **No code** (GPL).                                                       | EarlyWeb does the fetching locally (no server), restyles pages in the era's look and wraps it in a sandboxed app.                                                |

**The short version:** take daedalOS's window manager polish, Puter's platform shape, Windows 93's sense of fun and FrogFind's reader-mode trick. The differentiators are **(1) a real sandboxed app ecosystem**, **(2) broadband-era apps that work for real** and **(3) zero servers: download it from GitHub, it runs on your machine, it costs nobody anything.**

---

## 3. Architecture

### 3.1 Big picture

```
 ┌──────────────────────────── Tauri app (one native window) ─────────────────────────────┐
 │                                                                                        │
 │  SHELL (trusted, TypeScript/Preact) — served from the app's own origin                 │
 │   ├─ Window manager, taskbar, start menu, tray, themes                                 │
 │   ├─ App host: creates <iframe sandbox> per window, hands each one a MessagePort       │
 │   ├─ Broker: validates every call, checks permissions, routes to services              │
 │   ├─ Trusted UI: file open/save dialogs, permission prompts, message boxes             │
 │   └─ Backend client: the ONLY code that calls Tauri commands                           │
 │            ▲                                       ▲                                   │
 │            │ MessageChannel per app instance       │ Tauri IPC (shell origin only)     │
 │            ▼                                       ▼                                   │
 │  APPS (untrusted)                        RUST BACKEND (trusted)                        │
 │   <iframe sandbox="allow-scripts">        ├─ fs: path-jailed file ops, folder watch    │
 │   src = ewapp://<appId>/<version>/…       ├─ ewapp:// protocol: serves installed apps  │
 │   opaque origin, per-app CSP header       │    with per-app CSP from the manifest      │
 │   imports @earlyweb/sdk                   ├─ fetch: page fetch + lol_html sanitize     │
 │                                           ├─ apps: install/verify/uninstall from GitHub│
 │                                           └─ state: grants + settings (JSON/SQLite)    │
 └────────────────────────────────────────────────────────────────────────────────────────┘
       Updates & app packages come from GitHub Releases. No EarlyWeb servers exist.
```

**Two rules hold everything together:**

1. **Only the shell can talk to Rust.** Apps can't call Tauri at all. Every app request goes through the broker, which checks permissions and then asks Rust.
2. **The shell talks to Rust only through backend interfaces** (`FsBackend`, `FetchBackend`, `AppStore`). In browser dev mode (Vite), those interfaces are implemented with OPFS/IndexedDB and stubs, which keeps development fast and leaves the web demo option open.

### 3.2 Shell framework: why Preact

1. **Preact + @preact/signals (chosen).** Small, fast, familiar JSX, and signals map naturally onto window state. Apps are iframes, so the shell's framework never leaks into the app API: app authors can use React, Svelte, vanilla JS or WASM.
2. _Fork daedalOS:_ rejected. Its apps are in-process components, so making them sandboxed iframes would mean rewriting most of it.
3. _Vanilla TS + Web Components:_ rejected. You'd hand-roll the reactive state a window manager needs.
4. _A Rust UI (Leptos/Dioxus, or native egui/Iced):_ rejected.
   - The app ecosystem and the browser app need a webview and HTML anyway.
   - Rust-to-WASM UI renders to the same DOM, so it's no faster.
   - Recompiles take seconds instead of instant reloads.
   - The libraries this project needs (Readability, Butterchurn) are JS.

### 3.3 Repo structure (pnpm-workspaces monorepo + one Rust crate)

```
earlyweb/
├─ package.json, pnpm-workspace.yaml, tsconfig.base.json, biome.json
├─ packages/
│  ├─ protocol/     # Shared message types, manifest schema (valibot), error codes, protocol version
│  ├─ sdk/          # @earlyweb/sdk: what apps import. Depends only on protocol.
│  ├─ ui-kit/       # Optional era-styled CSS components for apps, driven by theme tokens (--ew-*)
│  ├─ shell/        # Preact app: window manager, taskbar, start menu, app host, broker, dialogs
│  ├─ backends/     # FsBackend/FetchBackend/AppStore interfaces + two impls: tauri/ and web/ (OPFS dev)
│  └─ themes/       # Theme packs: glass (M1), classic (later). Tokens + sprites + sounds.
├─ apps/
│  ├─ notepad/      # M1
│  ├─ explorer/     # M2
│  ├─ media-player/ # M2
│  └─ browser/      # M4
├─ src-tauri/       # Rust crate: main.rs, fs.rs, protocol.rs (ewapp://), fetch.rs, apps.rs,
│                   #   capabilities/ (Tauri permission config), tauri.conf.json
├─ tools/
│  └─ create-app/   # M3: `pnpm create earlyweb-app` template
├─ .github/workflows/  # ci.yml (lint/test), release.yml (tauri-action on tag)
└─ docs/            # App developer docs
```

The **registry** lives in a separate repo (`earlyweb-apps`), so third-party PRs never touch OS code.

### 3.4 Tooling

| Concern         | Tool                                                                                                                                                                                             | Why                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Package manager | pnpm workspaces                                                                                                                                                                                  | Fast, strict, good monorepo support. No Turborepo/Nx until builds get slow. |
| Front-end build | Vite (shell and each app are separate builds producing static output)                                                                                                                            | Each app's output is exactly what a third-party app would ship.             |
| Desktop         | Tauri v2 CLI, plus official plugins: `updater`, `dialog` (native folder picker for mounts), `shell` (open a link in the real browser)                                                            |                                                                             |
| Rust            | stable toolchain, `clippy`, `cargo test`. Crates: `lol_html` (sanitizing; the engine behind Cloudflare's HTMLRewriter), `reqwest` (fetch), `notify` (folder watch), `zip` + `sha2` (app install) |                                                                             |
| Lint/format     | Biome (TS), rustfmt + clippy (Rust)                                                                                                                                                              |                                                                             |
| Tests           | Vitest (protocol, broker, path logic), `cargo test` (path jail, sanitizer), Playwright against the Vite dev build (full UI flows)                                                                |                                                                             |
| Schemas         | valibot: validates manifests and every incoming app message                                                                                                                                      |                                                                             |
| Release         | GitHub Actions `tauri-action` on a version tag → installers for Windows (.msi/.exe), macOS (.dmg, universal) and Linux (.AppImage/.deb) on the Releases page, plus the updater manifest          |                                                                             |
| Versioning      | Changesets, from M3 when the SDK is published to npm                                                                                                                                             |                                                                             |

### 3.5 Window manager

- **State:** one signal-backed store of windows: `{ id, appId, instanceId, title, icon, x, y, w, h, z, state: 'normal'|'minimized'|'maximized', focused, notResponding }`. The taskbar, start menu and windows all render from it.
- **The whole OS lives inside one native window**, which goes fullscreen or borderless optionally. EarlyWeb's "windows" are DOM elements, not OS windows. This keeps the look identical on all three platforms.
- **Drag/resize:** Pointer Events with `setPointerCapture`, 8 resize handles, moves applied as `transform` during the drag and committed on pointerup, clamped so the title bar always stays reachable.
- **Iframe gotcha:** iframes swallow pointer events. During any drag or resize, the shell sets `pointer-events: none` on all iframes. This is the #1 window-manager bug in iframe desktops.
- **Focus:** a click inside an iframe doesn't reach the shell. The shell listens for `window` `blur` plus a check of `document.activeElement`, and the SDK also sends a `focus` ping on `pointerdown`.
- **Keyboard:** keys typed inside an app never reach the shell. A small set of OS shortcuts (switch window, show desktop) are forwarded by the SDK.
- **Era touches** (M2+): edge snapping, taskbar hover tooltips. Live window thumbnails are out of scope.
- **Session restore:** window layout and open apps are saved and restored on launch.
- **Not Responding:** the shell pings each app every few seconds. With no reply in about 5 s, the title gets "(Not Responding)" and an End Task button appears. This is era-accurate and also the defense against runaway apps.

### 3.6 Themes

- A theme pack is a folder: `theme.json` (name, author, era tag), `tokens.css` (CSS custom properties: `--ew-titlebar-bg`, `--ew-window-radius`, `--ew-glass-blur`, fonts, …), sprite sheets for window buttons, icons and the start orb, and optional sounds.
- **Window chrome reads only tokens and slots.** No theme-specific logic lives in the window manager, so community themes are just packs.
- **Apps get themed too:** on connect and on `theme.changed`, the SDK writes the theme tokens onto the app's `<html>` as CSS variables. Apps that use `@earlyweb/ui-kit` restyle automatically.
- **Glass effect:** `backdrop-filter: blur()` with a solid fallback and a "reduce transparency" setting. Linux's WebKitGTK webview is the slowest at this, so the setting may need to be on by default there.
- **M1 ships exactly one theme** (the original glass theme). The theme system's job in M1 is to keep the door open.

### 3.7 Virtual file system

**Layout as apps see it (POSIX-style virtual paths):**

```
/home/user/Desktop  Documents  Music  Pictures  Downloads   → real folders under the EarlyWeb home
/mnt/<name>/          # folders the user mounted (e.g. their real ~/Music), read-only by default
/apps/<appId>/        # each app's private data (always granted to that app)
/system/              # read-only: installed apps, themes, sounds
/tmp/                 # cleared on launch
```

**On desktop (the real product):**

- The **EarlyWeb home** is a real folder, by default `~/EarlyWeb/` (changeable in Settings). Files are ordinary files, so users can back them up, see them in their real file manager, or put the folder in Dropbox/Syncthing for free sync.
- **Mounts:** the user picks a real folder (e.g. their existing Music library) with the native folder picker. It appears under `/mnt/`, read-only unless they opt in. The media player plays it in place, with no copying.
- **The Rust `fs` module is the enforcement point:**
  - It maps virtual paths to real paths and **canonicalizes and jails them**, rejecting `..`, symlinks that escape the root, and absolute paths.
  - Every operation re-checks the grant passed from the broker.
  - This module gets the most `cargo test` coverage in the project.
- **Watch:** `notify` drives `fs.changed` events, so Explorer updates when files change outside EarlyWeb.
- **Big files:** `fs.read` returns bytes over Tauri's binary IPC, which the shell hands to the app as a `Blob`. For long media, a later optimization is a grant-scoped streaming URL with HTTP Range support, served by the Rust protocol handler.

**In browser dev mode / an optional web demo:** the `web` backend stores metadata in IndexedDB and file contents in OPFS, behind the same `FsBackend` interface.

**Access control (capabilities, not ambient paths):**

- An app always has full access to `/apps/<its id>/`.
- Anything else needs a **grant**. Grants come from:
  - **Trusted file dialogs** drawn by the shell (the "powerbox" pattern): the user picks a file, and the app receives a `FileRef` (an opaque id plus a display name) that is valid for that file only.
  - **Launch with a file** ("Open with", double-click in Explorer).
  - **Folder permissions declared in the manifest** (e.g. `fs.music:read`), shown at install and revocable.
- Grants are stored in the app's data directory and are revocable in Control Panel → Apps.

---

## 4. App API

### 4.1 Sandbox and transport

- **Serving apps:** Rust registers a custom URI scheme, `ewapp://`, that serves installed app files from disk: `ewapp://<appId>/<version>/index.html`. On Windows, Tauri maps custom schemes to `http://ewapp.localhost/…`. Either way, apps are on **a different origin from the shell**. Each response carries a **per-app CSP** built from the manifest:
  `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src <manifest.network hosts>; frame-ancestors <shell origin>`
  plus `Access-Control-Allow-Origin: *`, because module scripts loaded from an opaque origin are CORS requests.
- **Sandboxing:** each window hosts an `<iframe>` with **`sandbox="allow-scripts"`** and nothing else (apps use `os.dialog.message`, not `alert()`), plus an empty Permissions Policy (`allow=""`) by default. There is **no `allow-same-origin`**, so the app runs in an **opaque origin**: it can't touch the shell, any other app, or storage of its own.
- **No Tauri access for apps:** Tauri v2 capabilities are configured so commands are allowed **only for the shell's origin**. M1.5 includes an explicit test: a hostile app tries to reach Tauri IPC (globals, `ipc://` requests, postMessage tricks) and must fail every time. If Tauri injects anything into child frames, Tauri's _isolation pattern_ is the fallback.
- **Handshake:**
  1. On load, the SDK posts `{ ew: 'hello', protocol: 1 }` to `parent`.
  2. The shell accepts it only if `event.source` is the `contentWindow` of an iframe it created.
  3. The shell creates a `MessageChannel` and transfers one port with `{ ew: 'init', instanceId, launch, theme, permissions }`.
  4. From then on, all traffic goes over the private port.
- **Wire format** (validated with valibot on the shell side, always):

  ```ts
  // app → shell
  { t: 'call', id: 7, method: 'fs.writeText', params: { file: 'g_8f2a', text: 'hello' } }
  // shell → app
  { t: 'result', id: 7, ok: true, value: null }
  { t: 'result', id: 7, ok: false, error: { code: 'EPERM', message: 'No write access to this file' } }
  { t: 'event', name: 'theme.changed', data: { tokens: { /* … */ } } }
  ```
- **Error codes:** `EPERM`, `ENOENT`, `EEXIST`, `EINVAL`, `EQUOTA`, `ECANCELED` (the user cancelled a dialog), `ERATE`, `EUNSUPPORTED` (the method is unknown to this OS version).

### 4.2 Manifest (`earlyweb.json`, at the app root)

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/<org>/earlyweb/main/packages/protocol/manifest-1.schema.json",
  "manifestVersion": 1,
  "id": "org.earlyweb.notepad", // reverse-DNS, unique in the registry
  "name": "Notepad",
  "version": "0.1.0", // semver
  "description": "A plain text editor.",
  "author": { "name": "EarlyWeb", "url": "https://github.com/earlyweb" },
  "license": "MIT",
  "sdk": "^0.1.0", // SDK/protocol range the app was built against
  "entry": "index.html",
  "icons": { "16": "icons/16.png", "32": "icons/32.png", "48": "icons/48.png" },
  "window": {
    "width": 640,
    "height": 480,
    "minWidth": 240,
    "minHeight": 160,
    "resizable": true,
    "singleInstance": false
  },
  "permissions": [
    "fs.dialog", // may open trusted open/save dialogs
    "notifications"
  ],
  "network": [], // hosts for connect-src; empty = offline app
  "fileHandlers": [{ "extensions": [".txt", ".log", ".md", ".ini"], "mime": ["text/plain"] }],
  "category": "accessories" // start menu folder
}
```

### 4.3 Permissions

| Permission                                                                            | Grants                                                                   | Prompt                                  |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------- |
| _(implicit)_                                                                          | `/apps/<id>/`, window control, theme, message boxes                      | none                                    |
| `fs.dialog`                                                                           | Open trusted open/save dialogs. Access only to the files the user picks. | none (the user's pick _is_ the consent) |
| `fs.documents:read` / `:write` (same for `music`, `pictures`, `downloads`, `desktop`) | A whole EarlyWeb home folder                                             | at install                              |
| `fs.mounts:read`                                                                      | Folders the user mounted under `/mnt/` (e.g. a media library)            | at install                              |
| `fs.home:read` / `:write`                                                             | All of `/home/user` (file managers)                                      | at install, with a strong warning       |
| `notifications`                                                                       | Tray balloon notifications                                               | none (rate-limited)                     |
| `clipboard.write`                                                                     | Write the clipboard                                                      | none                                    |
| `clipboard.read`                                                                      | Read the clipboard                                                       | at first use                            |
| `net.fetch`                                                                           | Fetch and sanitize web pages through the Rust backend (the browser app)  | at install                              |
| `media.capture`                                                                       | Camera/mic                                                               | at first use                            |

Rules:

- **Checks happen in the broker on every call, and Rust re-checks file grants.** The manifest is a request, not a grant. Built-in apps declare permissions exactly like third-party apps.
- Permission prompts are **drawn by the shell and dim the whole desktop, including the taskbar.** An iframe can't draw outside its own rectangle, so apps can't spoof a system prompt.
- Everything is revocable in Control Panel → Apps.
- **WASM is not a permission.** `'wasm-unsafe-eval'` is in every app's CSP.
- **Network:** an app can only reach the hosts in its manifest's `network` list (enforced by CSP). The list is shown at install.

### 4.4 Lifecycle

```
install (from registry, or bundled) → appears in Start menu
launch(args)    shell creates window (hidden) + iframe
  hello/init    handshake; app receives launch args (e.g. a FileRef)
  os.ready()    app says its UI is ready → window shown (or after 3 s with a spinner)
running         events: focus, blur, minimize, restore, resize, theme.changed,
                file.open (singleInstance apps get new files here), ping
close request   shell sends beforeClose → app may return false (e.g. "Save changes?")
                → no answer within 10 s → shell offers "End Task"
closed          iframe removed; session-restore entry updated
```

### 4.5 SDK surface (v0, M1 scope in **bold**)

```ts
import { connect } from '@earlyweb/sdk';
const os = await connect();              // handshake; throws if not running inside EarlyWeb

os.launch                                // **{ file?: FileRef, args: string[] }**
os.ready(): Promise<void>                // **show my window**
os.on(event, handler) / os.off(...)      // **focus | blur | resize | theme.changed | file.open**

os.window.setTitle(t)                    // **
os.window.setSize(w, h) / close() / minimize()            // **
os.window.onBeforeClose(() => boolean | Promise<boolean>) // **

os.fs.readText(ref) / writeText(ref, s)  // ** ref = FileRef | app-private path ('/apps/self/…')
os.fs.read(ref): Blob / write(ref, Blob) // **
os.fs.list(dir) / stat / mkdir / remove / rename          // ** (within granted scopes)
os.fs.watch(dir, handler)

os.dialog.open({ filters, multiple }): FileRef[] | null   // **
os.dialog.save({ suggestedName, filters }): FileRef | null // **
os.dialog.message({ title, text, icon, buttons }): string  // ** era message box, returns button label

os.storage.get(key) / set(key, value)    // small JSON key-value in /apps/self/
os.notify({ title, body, icon })
os.theme.get()
os.clipboard.writeText(s) / readText()
os.shell.openExternal(url)               // open in the user's real browser (always asks)
// later: os.net.fetchPage (browser app), os.media (now playing)
```

The SDK is a thin typed wrapper over `call(method, params)`. Unknown methods return `EUNSUPPORTED`, so apps can feature-detect against older OS versions.

### 4.6 Example app: Notepad

`apps/notepad/index.html`:

```html
<!doctype html>
<link rel="stylesheet" href="./ui-kit.css">  <!-- bundled from @earlyweb/ui-kit at build time -->
<div class="ew-menubar"><button id="open">Open…</button><button id="save">Save</button></div>
<textarea id="editor" spellcheck="false"></textarea>
<script type="module" src="./main.js"></script>
```

`apps/notepad/src/main.ts`:

```ts
import { connect, type FileRef } from '@earlyweb/sdk';

const os = await connect();
const editor = document.querySelector<HTMLTextAreaElement>('#editor')!;
let current: FileRef | null = null;
let dirty = false;

const refreshTitle = () => os.window.setTitle(`${dirty ? '*' : ''}${current?.name ?? 'Untitled'} - Notepad`);

async function openFile(file: FileRef) {
  editor.value = await os.fs.readText(file);
  current = file;
  dirty = false;
  refreshTitle();
}

async function save(): Promise<boolean> {
  current ??= await os.dialog.save({
    suggestedName: 'Untitled.txt',
    filters: [{ name: 'Text Documents', extensions: ['.txt'] }],
  });
  if (!current) return false; // user cancelled
  await os.fs.writeText(current, editor.value);
  dirty = false;
  refreshTitle();
  return true;
}

editor.addEventListener('input', () => {
  if (!dirty) {
    dirty = true;
    refreshTitle();
  }
});
document.querySelector('#open')!.addEventListener('click', async () => {
  const [file] = (await os.dialog.open({ filters: [{ name: 'Text', extensions: ['.txt'] }] })) ?? [];
  if (file) await openFile(file);
});
document.querySelector('#save')!.addEventListener('click', save);
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 's') {
    e.preventDefault();
    save();
  }
});

os.on('file.open', ({ file }) => openFile(file));
os.window.onBeforeClose(async () => {
  if (!dirty) return true;
  const choice = await os.dialog.message({
    title: 'Notepad',
    icon: 'warning',
    text: `Do you want to save changes to ${current?.name ?? 'Untitled'}?`,
    buttons: ['Save', "Don't Save", 'Cancel'],
  });
  if (choice === 'Cancel') return false;
  return choice === 'Save' ? save() : true;
});

if (os.launch.file) await openFile(os.launch.file);
refreshTitle();
await os.ready();
```

This one small app exercises the handshake, launch args, trusted dialogs, FileRef grants, the VFS, window title, the close lifecycle and theming (through ui-kit), which is the whole M1 surface.

---

## 5. App registry (M3)

- A separate repo, `earlyweb-apps`. Each app is a folder: `apps/<appId>/` containing `earlyweb.json` plus a **source repo URL and commit SHA**, not prebuilt files.
- **CI on every PR:**
  1. Validate the manifest against the schema.
  2. Check id uniqueness and that the version was bumped.
  3. Build from the pinned source commit in a clean container.
  4. Size limits.
  5. Post a **permission and network diff** comment ("this update adds `fs.home:write` and `api.example.com`").
  6. Run a smoke test: the app loads in a headless shell (the Vite dev build) and calls `ready()`.
- A human reviews any new permissions. On merge, CI attaches the built app as a `.zip` to a **GitHub Release** of the registry repo and updates `index.json` (id, version, download URL, **SHA-256**, permissions).
- The shell's App Store reads `index.json` from GitHub. Rust downloads the zip, **verifies the SHA-256**, extracts it to the app data directory and registers the app.
- A **blocklist** in `index.json` lets one PR kill a malicious app for everyone on their next launch.

---

## 6. Risks and mitigations

### 6.1 App sandbox security (highest technical risk)

On desktop, a sandbox escape means access to the user's real machine, not just a browser tab.

- **Layer 1, the webview sandbox:** opaque-origin iframes (no `allow-same-origin`), served from the `ewapp://` origin with a strict per-app CSP and an empty Permissions Policy, with no `allow-top-navigation` or `allow-popups`.
- **Layer 2, no native access for apps:** Tauri capabilities scoped to the shell origin only, plus the M1.5 hostile-app IPC test.
- **Layer 3, the broker:** every message is schema-validated, every call permission-checked, every method rate-limited. It passes only cloned data and opaque `FileRef` ids.
- **Layer 4, Rust:**
  - Path jailing and grant re-checks in `fs`.
  - `fetch` refuses localhost, private/link-local IP ranges and non-http(s) schemes, so an app can't probe the user's router or LAN.
  - The extract step in `apps` refuses zip entries with `..` or absolute paths (zip-slip).
- **UI spoofing:** permission prompts and file dialogs are shell-drawn and dim the whole screen including the taskbar.
- **Supply chain:** the registry builds from pinned source, shows permission diffs, verifies hashes, and has a blocklist kill switch.
- **Resource abuse:** the Not Responding detector and End Task. These can't be fully prevented, only contained.

### 6.2 Sites breaking in the browser app

Most modern sites are JS-rendered and look empty without scripts. Treat this as expected, not as a bug.

- **Split the work:**
  - Rust `fetch` downloads the page with its own cookie-less client and runs it through `lol_html`. This strips scripts, inline handlers, iframes, objects and forms, rewrites links to stay in the browser app, and routes images through the same fetcher.
  - The browser app then does layout simplification with Mozilla Readability (Apache-2.0) inside its own sandbox and renders the result in an era page template, in a scripts-off frame.
- **Reader mode by default**, with a "Classic view" toggle that shows the sanitized original.
- **Graceful failure:** if extraction yields almost nothing, show an era-style page ("This page uses technology from the future") with an "Open in your real browser" button.
- A **curated "Cool Sites" start page**, a **"Report broken site" link** (a pre-filled GitHub issue), and a **fixture test suite** (saved HTML of ~20 sites run through the sanitizer and extractor in CI).
- **Fetch etiquette:** an honest User-Agent (`EarlyWeb/x (+https://github.com/<org>/earlyweb)`), response size and time caps, and an on-disk cache. Because each user fetches from their own IP, there's no central proxy to abuse or bill.
- **Time Machine mode** (later): Wayback Machine snapshots of 2004–2010 sites, which render beautifully without modern JS.

### 6.3 Other risks

| Risk                                                                      | Mitigation                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Scope creep** (the real killer for a solo dev with another big project) | One milestone at a time. Each milestone has a written definition of done. Anything not in it goes to `IDEAS.md`.                                                                                                                                                                               |
| **Unsigned installers scare users**                                       | Start unsigned and document the one-time "Open anyway" step per OS in the README. macOS builds get ad-hoc signed by Tauri (required on Apple Silicon). Buy Windows signing (Azure Trusted Signing, about $10/mo) and an Apple Developer account ($99/yr) when downloads justify it.            |
| **Auto-update hijack**                                                    | Tauri's updater verifies updates with its own signing key (free, separate from OS code signing). The private key lives only in GitHub Actions secrets, with a backup kept offline. Updates are served only from GitHub Releases.                                                               |
| **Webview differences** (WebView2 / WKWebView / WebKitGTK)                | CI builds all three. Run the Playwright suite in Chromium and WebKit engines. A "reduce transparency" fallback for weak Linux GPUs. Linux is supported at "best effort" until there are Linux contributors.                                                                                    |
| **Data loss**                                                             | Files are real files in a normal folder, so users' normal backups cover them. Never delete; "Recycle Bin" moves files to `~/EarlyWeb/.trash`.                                                                                                                                                  |
| **Breaking the app API after people build on it**                         | `protocol` and `manifestVersion` from day 1. `EUNSUPPORTED` for feature detection. SDK semver. Breaking changes only on a major version, with a deprecation window.                                                                                                                            |
| **IP / branding**                                                         | A written lookalike policy in `CONTRIBUTING.md`: original icons and sounds, generic names ("Media Player", "Explorer", "Space"), no mascots that evoke specific brands. Flash games only if open-licensed or user-supplied. Butterchurn/MilkDrop preset packs only if clearly redistributable. |
| **Profile pages = XSS** (the MySpace "Samy" worm)                         | Profiles render in scripts-off sandboxed frames. User CSS is sanitized (no external `url()`, no `@import`, no `expression`).                                                                                                                                                                   |

---

## 7. Roadmap

Sizes assume roughly one weekend ≈ 10–12 focused hours.

### M1: "It boots" (about 4 weekends, in a browser tab) ← the first milestone

The goal is a desktop shell where Notepad, built _only_ on the public SDK, saves files that survive a reload. It runs on the Vite dev server with the `web` backend, so there's no Rust yet.

| Weekend | Deliverable                                                                                                                                                                                                                                                                                                              |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1       | Monorepo scaffold (pnpm, Vite, TS, Biome, Vitest). Shell desktop with the window manager: open/close/focus/z-order, drag, resize (8 handles), minimize/maximize, taskbar with window buttons, start menu listing apps, clock. Glass theme tokens v0. A dummy iframe app on a second origin (`127.0.0.1` vs `localhost`). |
| 2       | `protocol` + `sdk`: the hello/init handshake over MessageChannel, call/result/event, valibot validation. Broker with manifest loading and per-call permission checks. Window lifecycle (`ready`, `beforeClose`, ping/Not Responding). Unit tests including a "hostile app" test.                                         |
| 3       | The `FsBackend` interface plus the `web` implementation (OPFS + IndexedDB), home folder layout, `FileRef` grants. Shell-drawn Open/Save dialogs. `dialog.message`.                                                                                                                                                       |
| 4       | Notepad (the code in §4.6) plus `ui-kit` basics. Session restore. One Playwright test: boot → Notepad → type → save → reload → reopen → text is there.                                                                                                                                                                   |

**Definition of done for M1:**

- Notepad has no imports except `@earlyweb/sdk`.
- The Playwright test passes in Chromium and WebKit.
- The hostile-app test proves an app without `fs.dialog` can't read anything outside `/apps/<id>/`.

**Explicitly not in M1:** Tauri, Rust, Explorer, desktop icons, sounds, snapping, a second theme, the browser, the registry.

### M1.5: "In a box" (about 2–3 weekends)

- Tauri v2 wrapper around the shell, and the `tauri` implementation of `FsBackend` (Rust `fs` module with the path jail plus `cargo test`).
- The `ewapp://` protocol handler serving bundled apps with per-app CSP. Capabilities restricted to the shell origin. **The hostile-app IPC test.**
- `release.yml`: push tag `v0.1.0` → GitHub Actions builds Windows/macOS/Linux installers → GitHub Release. The updater plugin is wired up with its signing key in secrets.
- **Done when:** you can download the installer from the Releases page on a clean machine, write in Notepad, find the file in `~/EarlyWeb/Documents` with your real file manager, and get auto-updated to `v0.1.1`.

### M2: "My stuff" (about 4–6 weekends)

- **Media Player:**
  - Play MP3s from the EarlyWeb Music folder or a **mounted real music folder** (in place, no copying), with a playlist and ID3 tags.
  - **Two era skins:** a compact skinnable one (the Winamp feel) and a full "library + now playing" one (the classic Windows Media Player feel).
  - **The wild visualizations are a headline feature, not a nice-to-have.** They run full-window and fullscreen, with a "next visualization" button and auto-cycling:
    - **Our own originals** built on a Web Audio `AnalyserNode` plus Canvas/WebGL: bars, scopes, and kaleidoscopic "ambience"-style trippy fields.
    - **MilkDrop-style presets via Butterchurn** (an MIT-licensed WebGL port of MilkDrop). Check each preset pack's license before bundling.
    - A pluggable visualization API, so community apps can ship visualizer packs (and WASM ones).
  - Mini mode and tray controls.
- **Explorer:** an icon/list view, desktop icons, file associations ("Open with"), Recycle Bin, drag and drop, mounting folders.
- **Polish:** startup and event sounds, window snapping, Control Panel (theme, mounts, app permissions).

### M3: "Open the platform" (about 3–4 weekends)

Start this before the bigger apps. A solo dev benefits more from early contributors than from shipping another app alone.

- Publish `@earlyweb/sdk` 0.x to npm, plus `pnpm create earlyweb-app` and the docs in `docs/` (published with GitHub Pages, which is free and static).
- The `earlyweb-apps` registry repo with CI (§5), and the App Store app plus Rust install/verify/uninstall.
- A "good first apps" list for contributors: Minesweeper-style game, Paint, Sticky Notes, Calculator, a screensaver.

### M4: "The Browser" (about 4–6 weekends)

- Rust `fetch` with `lol_html` sanitizing, plus the browser app: reader mode, Classic view, era page template, Favorites stored as files in the VFS, history, the "Cool Sites" start page.
- Then Time Machine mode (Wayback).

### Later: pick by interest

- **Arcade:** Ruffle (Rust/WASM) for open-licensed/user-supplied Flash-era games.
- **Space profiles:** MySpace-style customizable profile pages with sanitized CSS, Top Friends and a profile song. With no servers, a profile is a page you **export as a static site to GitHub Pages or Neocities**, which is very on-era (GeoCities energy). Other users' profiles are viewed through the browser app.
- **Mail:** an Outlook Express-style client for the user's _own_ email account (IMAP/SMTP in Rust). It needs no EarlyWeb server.
- **Themes:** a classic late-90s theme with the dial-up connect sequence as its boot flavor, and community themes.
- **Messenger (parked):** if it comes back, start peer-to-peer with Trystero (MIT; WebRTC matchmaking over public BitTorrent/Nostr relays) for buddy-to-buddy chat, with nudges, personal messages and "now playing." Accept that offline messages and some connections won't work without a relay. A small self-hostable relay is the upgrade path. Safety: buddies by mutual add only, no public rooms.
- **Web demo:** the same shell as a static site with the `web` backend and no browser app, as a "try before you download" link.

---

## 8. Open questions (none block M1)

1. **When to pay for code signing:** at the first public release, or after N downloads.
2. **GitHub org name** (needed before M1.5's first release). Run a trademark/availability check on "EarlyWeb" at the same time.

_Resolved 2026-11-06:_ the name is **EarlyWeb**; the license is **MIT** for the whole repo.
