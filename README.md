# EarlyWeb

A desktop environment with sandboxed apps, in the spirit of the broadband-era internet.
Work in progress.

## Install

Download the file for your system from the
[latest release](https://github.com/tboskkk/earlyweb/releases/latest):

| System  | File                                                     |
| ------- | -------------------------------------------------------- |
| Windows | `EarlyWeb_<version>_x64-setup.exe` (or `.msi`)           |
| macOS   | `EarlyWeb_<version>_universal.dmg`                       |
| Linux   | `EarlyWeb_<version>_amd64.AppImage` (or `.deb` / `.rpm`) |

EarlyWeb isn't signed with a paid developer certificate yet, so your system will warn you
the first time. You only need to do this once:

- **Windows:** when SmartScreen says "Windows protected your PC", click **More info**, then
  **Run anyway**.
- **macOS:** open the `.dmg` and drag EarlyWeb to Applications. The first time, right-click
  EarlyWeb and choose **Open**, then **Open** again. If macOS still refuses, go to
  **System Settings → Privacy & Security** and click **Open Anyway**.
- **Linux (AppImage):** make it executable, then run it:

  ```sh
  chmod +x EarlyWeb_*.AppImage
  ./EarlyWeb_*.AppImage
  ```

### Where your files live

Everything you save in EarlyWeb is a normal file in the `EarlyWeb` folder in your home
folder (`~/EarlyWeb` on macOS and Linux, `C:\Users\<you>\EarlyWeb` on Windows), with
`Documents`, `Pictures`, `Music`, `Downloads` and `Desktop` inside. You can open, back up
or sync them like any other files. Uninstalling EarlyWeb leaves them where they are.

### Updates

EarlyWeb checks for a new version when it starts. When one is ready it asks you; choose
**Restart Now** to install it, or **Later** to keep working. Updates are signed, and
EarlyWeb refuses any update whose signature doesn't match.

## Development

    pnpm install
    pnpm test
    pnpm dev           # the shell in a browser, apps from a local server
    pnpm tauri dev     # the desktop app
    pnpm e2e:tauri     # the desktop IPC self-test
