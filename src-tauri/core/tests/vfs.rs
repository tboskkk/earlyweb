use earlyweb_core::{FsError, Node, Vfs};
use std::fs;
use std::path::PathBuf;
use tempfile::TempDir;

struct Fixture {
    _tmp: TempDir,
    home: PathBuf,
    data: PathBuf,
    vfs: Vfs,
}

fn fixture() -> Fixture {
    let tmp = tempfile::tempdir().unwrap();
    // Canonical up front: on macOS the temp dir sits behind a /var -> /private/var symlink.
    let base = tmp.path().canonicalize().unwrap();
    let home = base.join("home");
    let data = base.join("data");
    let vfs = Vfs::new(home.clone(), data.clone()).unwrap();
    Fixture {
        _tmp: tmp,
        home,
        data,
        vfs,
    }
}

fn real(node: Node) -> (PathBuf, PathBuf, bool) {
    match node {
        Node::Real {
            root,
            path,
            is_root,
        } => (root, path, is_root),
        Node::Virtual(_) => panic!("expected a real node"),
    }
}

fn err_of(r: Result<Node, FsError>) -> FsError {
    r.expect_err("expected an error")
}

#[test]
fn normalizes_like_js() {
    let f = fixture();
    let (_, path, _) = real(f.vfs.resolve("/home/user/./Documents//a.txt").unwrap());
    assert_eq!(path, f.home.join("Documents").join("a.txt"));
    // `..` consumes segments exactly like normalizePath: this collapses to `/x`, which is
    // simply not a mapped root.
    assert_eq!(err_of(f.vfs.resolve("/home/user/../../x")).code, "ENOENT");
    // A `..` with nothing left to pop escapes the root and is refused.
    assert_eq!(err_of(f.vfs.resolve("/../x")).code, "EINVAL");
    assert_eq!(
        err_of(f.vfs.resolve("/home/user/../../../x")).code,
        "EINVAL"
    );
    assert_eq!(err_of(f.vfs.resolve("a.txt")).code, "EINVAL");
    assert_eq!(err_of(f.vfs.resolve("")).code, "EINVAL");
    // `..` that stays inside the tree is fine, as in normalizePath.
    let (_, path, _) = real(f.vfs.resolve("/home/user/a/../b").unwrap());
    assert_eq!(path, f.home.join("b"));
}

#[test]
fn maps_roots() {
    let f = fixture();
    match f.vfs.resolve("/").unwrap() {
        Node::Virtual(kids) => assert_eq!(kids, ["apps", "home", "system", "tmp"]),
        Node::Real { .. } => panic!("/ is virtual"),
    }
    match f.vfs.resolve("/home").unwrap() {
        Node::Virtual(kids) => assert_eq!(kids, ["user"]),
        Node::Real { .. } => panic!("/home is virtual"),
    }
    let (root, path, is_root) = real(f.vfs.resolve("/home/user").unwrap());
    assert_eq!(
        (root.as_path(), path.as_path(), is_root),
        (f.home.as_path(), f.home.as_path(), true)
    );

    let (_, path, is_root) = real(f.vfs.resolve("/home/user/Desktop/x").unwrap());
    assert_eq!(path, f.home.join("Desktop").join("x"));
    assert!(!is_root);

    for (v, sub) in [("/apps", "apps"), ("/system", "system"), ("/tmp", "tmp")] {
        let (root, path, is_root) = real(f.vfs.resolve(v).unwrap());
        assert_eq!(root, f.data.join(sub), "{v} root");
        assert_eq!(path, f.data.join(sub), "{v} path");
        assert!(is_root, "{v} is its root");
        let (_, deep, is_root) = real(f.vfs.resolve(&format!("{v}/org.x.y/data.json")).unwrap());
        assert_eq!(deep, f.data.join(sub).join("org.x.y").join("data.json"));
        assert!(!is_root);
    }

    for p in ["/mnt/x", "/etc", "/home/other", "/mnt"] {
        assert_eq!(err_of(f.vfs.resolve(p)).code, "ENOENT", "{p}");
    }
}

#[test]
fn segment_rules() {
    let f = fixture();
    let long = format!("/home/user/{}", "a".repeat(256));
    let bad = [
        "/home/user/con.txt",
        "/home/user/Lpt9",
        "/home/user/NUL",
        "/home/user/com1.tar.gz",
        "/home/user/a:b",
        "/home/user/a*b",
        "/home/user/a?b",
        "/home/user/a\"b",
        "/home/user/a<b",
        "/home/user/a>b",
        "/home/user/a|b",
        "/home/user/a\\b",
        "/home/user/name.",
        "/home/user/name ",
        "/home/user/bell\u{7}",
        &long,
        // The rules apply to every segment, not just the last, and under every root.
        "/home/user/con/x.txt",
        "/apps/a:b/x",
    ];
    for p in bad {
        let e = err_of(f.vfs.resolve(p));
        assert_eq!(e.code, "EINVAL", "{p:?} should be EINVAL");
        assert!(
            !e.message.is_empty(),
            "{p:?} needs a message naming the rule"
        );
    }
    assert!(err_of(f.vfs.resolve("/home/user/a:b"))
        .message
        .contains(':'));
    assert!(err_of(f.vfs.resolve("/home/user/con.txt"))
        .message
        .to_lowercase()
        .contains("reserved"));
    assert!(err_of(f.vfs.resolve("/home/user/name."))
        .message
        .contains("end"));

    // 255 bytes is the limit; the same length in multi-byte chars is over it.
    let ok_255 = format!("/home/user/{}", "a".repeat(255));
    assert!(f.vfs.resolve(&ok_255).is_ok());
    let multibyte = format!("/home/user/{}", "é".repeat(128)); // 256 bytes
    assert_eq!(err_of(f.vfs.resolve(&multibyte)).code, "EINVAL");

    for p in [
        "/home/user/console.txt",
        "/home/user/.hidden",
        "/home/user/ünïcødé.txt",
        "/home/user/com10.txt",
        "/home/user/a b.txt",
    ] {
        assert!(f.vfs.resolve(p).is_ok(), "{p:?} should be accepted");
    }
}

#[cfg(unix)]
#[test]
fn escaping_symlink_is_eperm() {
    use std::os::unix::fs::symlink;
    let f = fixture();
    fs::create_dir_all(f.home.join("Documents")).unwrap();
    fs::create_dir_all(f.home.join("Music")).unwrap();
    let outside = tempfile::tempdir().unwrap();
    fs::write(outside.path().join("passwd"), "secret").unwrap();

    symlink(outside.path(), f.home.join("Documents/link")).unwrap();
    assert_eq!(
        err_of(f.vfs.resolve("/home/user/Documents/link/passwd")).code,
        "EPERM"
    );
    assert_eq!(
        err_of(f.vfs.resolve("/home/user/Documents/link")).code,
        "EPERM"
    );
    // A new file below the escaping link is just as outside.
    assert_eq!(
        err_of(f.vfs.resolve("/home/user/Documents/link/new.txt")).code,
        "EPERM"
    );

    // A dangling link whose target is outside is also refused, not treated as "missing".
    symlink(
        "/etc/definitely-not-here",
        f.home.join("Documents/dangling"),
    )
    .unwrap();
    assert_eq!(
        err_of(f.vfs.resolve("/home/user/Documents/dangling")).code,
        "EPERM"
    );

    // A symlink that stays inside the home is fine.
    symlink(f.home.join("Music"), f.home.join("Documents/ok")).unwrap();
    assert!(f.vfs.resolve("/home/user/Documents/ok").is_ok());
}

#[cfg(unix)]
#[test]
fn symlinked_root_is_followed_once_at_startup() {
    use std::os::unix::fs::symlink;
    // A user whose ~/EarlyWeb is itself a symlink (e.g. to another drive) must still work.
    let tmp = tempfile::tempdir().unwrap();
    let real_home = tmp.path().join("real-home");
    fs::create_dir(&real_home).unwrap();
    let link_home = tmp.path().join("EarlyWeb");
    symlink(&real_home, &link_home).unwrap();
    let vfs = Vfs::new(link_home, tmp.path().join("data")).unwrap();
    let (root, path, _) = real(vfs.resolve("/home/user/Documents/a.txt").unwrap());
    assert!(path.starts_with(&root));
    assert_eq!(root, real_home.canonicalize().unwrap());
}

#[test]
fn existing_home_is_kept() {
    let tmp = tempfile::tempdir().unwrap();
    let home = tmp.path().join("EarlyWeb");
    fs::create_dir_all(home.join("Documents")).unwrap();
    fs::write(home.join("Documents/old.txt"), "keep me").unwrap();
    Vfs::new(home.clone(), tmp.path().join("data")).unwrap();
    assert_eq!(
        fs::read_to_string(home.join("Documents/old.txt")).unwrap(),
        "keep me"
    );
}

#[test]
fn home_is_file_errors() {
    let tmp = tempfile::tempdir().unwrap();
    let home = tmp.path().join("EarlyWeb");
    fs::write(&home, "i am a file").unwrap();
    let e = Vfs::new(home.clone(), tmp.path().join("data"))
        .err()
        .expect("must fail");
    assert_eq!(e.code, "EINVAL");
    assert!(e.message.contains("is not a folder"), "{}", e.message);
    assert!(e.message.contains(home.to_str().unwrap()), "{}", e.message);
    assert_eq!(fs::read_to_string(&home).unwrap(), "i am a file");

    // Same for the data dir.
    let data = tmp.path().join("data-file");
    fs::write(&data, "x").unwrap();
    let e = Vfs::new(tmp.path().join("fresh-home"), data)
        .err()
        .expect("must fail");
    assert_eq!(e.code, "EINVAL");
}

#[test]
fn io_errors_map_to_protocol_codes() {
    use std::io::{Error, ErrorKind};
    let cases = [
        (ErrorKind::NotFound, "ENOENT"),
        (ErrorKind::AlreadyExists, "EEXIST"),
        (ErrorKind::PermissionDenied, "EPERM"),
        (ErrorKind::StorageFull, "EQUOTA"),
        (ErrorKind::InvalidData, "EINVAL"),
    ];
    for (kind, code) in cases {
        assert_eq!(
            FsError::from(Error::new(kind, "boom")).code,
            code,
            "{kind:?}"
        );
    }
    let e = FsError::from(Error::new(ErrorKind::InvalidData, "boom"));
    assert!(e.message.contains("boom"));
}

#[test]
fn error_serializes_as_code_and_message() {
    let e = FsError {
        code: "EPERM",
        message: "nope".into(),
    };
    assert_eq!(
        serde_json::to_string(&e).unwrap(),
        r#"{"code":"EPERM","message":"nope"}"#
    );
}
