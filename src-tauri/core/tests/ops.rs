// File operations on real files. The first block ports every case in
// packages/backends/test/idb-fs.test.ts (same behavior, same error codes) under /home/user,
// because `/` itself is virtual here; the rest cover what only real files can get wrong.
use earlyweb_core::{FsError, Vfs};
use std::fs;
use std::path::PathBuf;
use tempfile::TempDir;

struct Fx {
    _tmp: TempDir,
    home: PathBuf,
    data: PathBuf,
    vfs: Vfs,
}

fn fx() -> Fx {
    let tmp = tempfile::tempdir().unwrap();
    let base = tmp.path().canonicalize().unwrap();
    let (home, data) = (base.join("home"), base.join("data"));
    let vfs = Vfs::new(home.clone(), data.clone()).unwrap();
    Fx {
        _tmp: tmp,
        home,
        data,
        vfs,
    }
}

fn code<T: std::fmt::Debug>(r: Result<T, FsError>) -> &'static str {
    r.expect_err("expected an error").code
}

fn names(v: &Vfs, dir: &str) -> Vec<String> {
    let mut out: Vec<String> = v
        .list(dir)
        .unwrap()
        .iter()
        .map(|s| format!("{}:{}", s.kind, s.name))
        .collect();
    out.sort();
    out
}

// ---- ported from idb-fs.test.ts ------------------------------------------------------

#[test]
fn write_then_read_and_stat() {
    let f = fx();
    f.vfs.write("/home/user/a.txt", b"hi").unwrap();
    assert_eq!(f.vfs.read("/home/user/a.txt").unwrap(), b"hi");
    let s = f.vfs.stat("/home/user/a.txt").unwrap().unwrap();
    assert_eq!(
        (s.path.as_str(), s.name.as_str(), s.kind, s.size),
        ("/home/user/a.txt", "a.txt", "file", 2)
    );
    assert!(
        s.mtime > 1.0e12,
        "mtime is ms since the epoch, got {}",
        s.mtime
    );
    assert_eq!(f.vfs.stat("/home/user/nope").unwrap(), None);
    assert_eq!(f.vfs.stat("/mnt/x").unwrap(), None);
}

#[test]
fn write_into_missing_parent_is_enoent() {
    let f = fx();
    assert_eq!(
        code(f.vfs.write("/home/user/missing/a.txt", b"x")),
        "ENOENT"
    );
}

#[test]
fn mkdir_creates_parents_and_is_idempotent() {
    let f = fx();
    f.vfs.mkdir("/home/user/x/y/z").unwrap();
    f.vfs.mkdir("/home/user/x/y/z").unwrap();
    assert_eq!(f.vfs.stat("/home/user/x/y").unwrap().unwrap().kind, "dir");
    assert_eq!(f.vfs.stat("/home/user/x/y/z").unwrap().unwrap().kind, "dir");
}

#[test]
fn mkdir_over_a_file_is_eexist() {
    let f = fx();
    f.vfs.write("/home/user/f", b"x").unwrap();
    assert_eq!(code(f.vfs.mkdir("/home/user/f")), "EEXIST");
    assert_eq!(code(f.vfs.mkdir("/home/user/f/sub")), "EEXIST");
}

#[test]
fn read_of_dir_is_einval_and_of_missing_is_enoent() {
    let f = fx();
    f.vfs.mkdir("/home/user/d").unwrap();
    assert_eq!(code(f.vfs.read("/home/user/d")), "EINVAL");
    assert_eq!(code(f.vfs.read("/home/user/nope")), "ENOENT");
}

#[test]
fn list_returns_direct_children() {
    let f = fx();
    f.vfs.mkdir("/home/user/x/y/z").unwrap();
    f.vfs.mkdir("/home/user/x/b").unwrap();
    f.vfs.write("/home/user/x/a.txt", b"1").unwrap();
    f.vfs.write("/home/user/x/Z.txt", b"1").unwrap();
    assert_eq!(
        names(&f.vfs, "/home/user/x"),
        ["dir:b", "dir:y", "file:Z.txt", "file:a.txt"]
    );
    let child = f.vfs.list("/home/user/x").unwrap();
    assert!(child.iter().any(|s| s.path == "/home/user/x/a.txt"));
    assert_eq!(code(f.vfs.list("/home/user/nope")), "ENOENT");
    assert_eq!(code(f.vfs.list("/home/user/x/a.txt")), "EINVAL");
}

#[test]
fn remove_removes_descendants() {
    let f = fx();
    f.vfs.mkdir("/home/user/x/y/z").unwrap();
    f.vfs.write("/home/user/x/y/f", b"1").unwrap();
    f.vfs.remove("/home/user/x").unwrap();
    for p in ["/home/user/x", "/home/user/x/y/z", "/home/user/x/y/f"] {
        assert_eq!(f.vfs.stat(p).unwrap(), None, "{p}");
    }
    assert_eq!(code(f.vfs.remove("/home/user/x")), "ENOENT");
}

#[test]
fn rename_moves_descendants() {
    let f = fx();
    f.vfs.mkdir("/home/user/x/y/z").unwrap();
    f.vfs.write("/home/user/x/y/f", b"hey").unwrap();
    f.vfs.rename("/home/user/x", "/home/user/w").unwrap();
    assert_eq!(f.vfs.stat("/home/user/w/y/z").unwrap().unwrap().kind, "dir");
    assert_eq!(f.vfs.read("/home/user/w/y/f").unwrap(), b"hey");
    assert_eq!(f.vfs.stat("/home/user/x").unwrap(), None);
}

#[test]
fn rename_onto_existing_path_is_eexist() {
    let f = fx();
    f.vfs.mkdir("/home/user/x").unwrap();
    f.vfs.mkdir("/home/user/w").unwrap();
    assert_eq!(code(f.vfs.rename("/home/user/x", "/home/user/w")), "EEXIST");
    // A file must not be silently replaced either (a plain rename(2) would).
    f.vfs.write("/home/user/a", b"1").unwrap();
    f.vfs.write("/home/user/b", b"2").unwrap();
    assert_eq!(code(f.vfs.rename("/home/user/a", "/home/user/b")), "EEXIST");
    assert_eq!(f.vfs.read("/home/user/b").unwrap(), b"2");
}

#[test]
fn rename_into_itself_is_refused() {
    let f = fx();
    f.vfs.mkdir("/home/user/x").unwrap();
    assert_eq!(code(f.vfs.rename("/home/user/x", "/home/user/x")), "EEXIST");
    assert_eq!(
        code(f.vfs.rename("/home/user/x", "/home/user/x/y")),
        "EINVAL"
    );
}

#[test]
fn a_new_vfs_on_the_same_dirs_sees_the_file() {
    let f = fx();
    f.vfs.write("/home/user/p.txt", b"persist").unwrap();
    let again = Vfs::new(f.home.clone(), f.data.clone()).unwrap();
    assert_eq!(again.read("/home/user/p.txt").unwrap(), b"persist");
}

// ---- virtual nodes -------------------------------------------------------------------

#[test]
fn stat_and_list_virtual_nodes() {
    let f = fx();
    assert_eq!(f.vfs.stat("/").unwrap().unwrap().kind, "dir");
    assert_eq!(f.vfs.stat("/home").unwrap().unwrap().kind, "dir");
    assert_eq!(
        names(&f.vfs, "/"),
        ["dir:apps", "dir:home", "dir:system", "dir:tmp"]
    );
    assert_eq!(names(&f.vfs, "/home"), ["dir:user"]);
    assert_eq!(f.vfs.stat("/").unwrap().unwrap().name, "");
}

#[test]
fn virtual_nodes_cannot_be_changed() {
    let f = fx();
    for p in ["/", "/home"] {
        assert_eq!(code(f.vfs.write(p, b"x")), "EINVAL", "write {p}");
        assert_eq!(code(f.vfs.remove(p)), "EINVAL", "remove {p}");
        assert_eq!(
            code(f.vfs.rename(p, "/home/user/x")),
            "EINVAL",
            "rename {p}"
        );
        assert_eq!(
            code(f.vfs.rename("/home/user/x", p)),
            "EINVAL",
            "rename to {p}"
        );
    }
    f.vfs.mkdir("/home").unwrap(); // already exists, so idempotent
}

#[test]
fn cannot_remove_home_root_but_tmp_can_be_recreated() {
    let f = fx();
    assert_eq!(code(f.vfs.remove("/home/user")), "EINVAL");
    assert!(f.home.is_dir());
    // ensureHome does exactly this to /tmp on every launch.
    f.vfs.mkdir("/tmp").unwrap();
    f.vfs.write("/tmp/x", b"1").unwrap();
    f.vfs.remove("/tmp").unwrap();
    assert_eq!(f.vfs.stat("/tmp").unwrap(), None);
    f.vfs.mkdir("/tmp").unwrap();
    assert_eq!(f.vfs.stat("/tmp").unwrap().unwrap().kind, "dir");
    assert_eq!(code(f.vfs.rename("/tmp", "/home/user/t")), "EINVAL");
}

// ---- what only real files can get wrong ----------------------------------------------

#[test]
fn write_is_atomic_and_temp_hidden() {
    let f = fx();
    f.vfs.write("/home/user/a.txt", b"old").unwrap();
    // A leftover from a crash during an earlier save.
    fs::write(f.home.join(".~ew-123.tmp"), "half written").unwrap();
    f.vfs.write("/home/user/a.txt", b"new").unwrap();
    assert_eq!(f.vfs.read("/home/user/a.txt").unwrap(), b"new");
    assert_eq!(names(&f.vfs, "/home/user"), ["file:a.txt"]);
    // On disk only the file and the stray leftover remain: our own temp file is gone.
    let mut on_disk: Vec<String> = fs::read_dir(&f.home)
        .unwrap()
        .map(|e| e.unwrap().file_name().into_string().unwrap())
        .collect();
    on_disk.sort();
    assert_eq!(on_disk, [".~ew-123.tmp", "a.txt"]);
}

#[test]
fn temp_prefix_is_reserved_for_the_writer() {
    let f = fx();
    assert_eq!(code(f.vfs.write("/home/user/.~ew-x.tmp", b"x")), "EINVAL");
    assert_eq!(code(f.vfs.mkdir("/home/user/.~ew-dir")), "EINVAL");
}

#[test]
fn write_over_a_folder_or_under_a_file_is_einval() {
    let f = fx();
    f.vfs.mkdir("/home/user/d").unwrap();
    f.vfs.write("/home/user/f", b"x").unwrap();
    assert_eq!(code(f.vfs.write("/home/user/d", b"x")), "EINVAL");
    assert_eq!(code(f.vfs.write("/home/user/f/x", b"x")), "EINVAL");
    assert_eq!(code(f.vfs.write("/home/user", b"x")), "EINVAL");
}

#[test]
fn case_only_rename() {
    let f = fx();
    f.vfs.write("/home/user/a.txt", b"x").unwrap();
    f.vfs
        .rename("/home/user/a.txt", "/home/user/A.txt")
        .unwrap();
    assert_eq!(names(&f.vfs, "/home/user"), ["file:A.txt"]);
    assert_eq!(f.vfs.read("/home/user/A.txt").unwrap(), b"x");
}

#[test]
fn big_file_roundtrip() {
    let f = fx();
    let data: Vec<u8> = (0..10 * 1024 * 1024).map(|i| (i % 251) as u8).collect();
    f.vfs.write("/home/user/big.bin", &data).unwrap();
    assert_eq!(
        f.vfs.stat("/home/user/big.bin").unwrap().unwrap().size,
        data.len() as u64
    );
    assert!(f.vfs.read("/home/user/big.bin").unwrap() == data);
}

#[cfg(unix)]
#[test]
fn list_skips_escaping_symlink() {
    use std::os::unix::fs::symlink;
    let f = fx();
    f.vfs.mkdir("/home/user/Documents").unwrap();
    let docs = f.home.join("Documents");
    symlink("/etc", docs.join("escape")).unwrap();
    symlink("/etc/definitely-not-here", docs.join("dangling")).unwrap();
    fs::write(docs.join("a:b"), "made outside EarlyWeb").unwrap();
    f.vfs.write("/home/user/Documents/ok.txt", b"1").unwrap();
    assert_eq!(names(&f.vfs, "/home/user/Documents"), ["file:ok.txt"]);
    assert_eq!(
        code(f.vfs.read("/home/user/Documents/escape/passwd")),
        "EPERM"
    );
    assert_eq!(code(f.vfs.stat("/home/user/Documents/escape")), "EPERM");
}

#[cfg(unix)]
#[test]
fn removing_a_symlink_removes_the_link_not_its_target() {
    use std::os::unix::fs::symlink;
    let f = fx();
    f.vfs.mkdir("/home/user/Music").unwrap();
    f.vfs.write("/home/user/Music/song.mp3", b"la").unwrap();
    f.vfs.mkdir("/home/user/Documents").unwrap();
    symlink(f.home.join("Music"), f.home.join("Documents/m")).unwrap();
    f.vfs.remove("/home/user/Documents/m").unwrap();
    assert_eq!(f.vfs.stat("/home/user/Documents/m").unwrap(), None);
    assert_eq!(f.vfs.read("/home/user/Music/song.mp3").unwrap(), b"la");
}

#[cfg(unix)]
#[test]
fn writing_through_an_inside_symlink_keeps_the_link() {
    use std::os::unix::fs::symlink;
    let f = fx();
    f.vfs.write("/home/user/real.txt", b"old").unwrap();
    symlink(f.home.join("real.txt"), f.home.join("link.txt")).unwrap();
    f.vfs.write("/home/user/link.txt", b"new").unwrap();
    assert_eq!(f.vfs.read("/home/user/real.txt").unwrap(), b"new");
    assert!(fs::symlink_metadata(f.home.join("link.txt"))
        .unwrap()
        .is_symlink());
}
