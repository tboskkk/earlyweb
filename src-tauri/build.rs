fn main() {
    // Every app command must be listed here; tauri-build then generates an
    // `allow-<command>` permission for it, which capabilities/shell.json grants to the
    // shell's window only. Commands not granted there cannot be invoked at all.
    const COMMANDS: &[&str] = &[
        "fs_stat",
        "fs_list",
        "fs_read",
        "fs_write",
        "fs_mkdir",
        "fs_remove",
        "fs_rename",
        "kv_get",
        "kv_set",
        "kv_delete",
        "update_install",
        // Self-test commands: listed and granted always, registered only with the `e2e`
        // feature (src/lib.rs), so a release build has no handler for them.
        "e2e_canary",
        "e2e_report",
    ];
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to run tauri-build");
}
