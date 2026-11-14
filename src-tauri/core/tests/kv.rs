use earlyweb_core::Kv;
use serde_json::json;
use std::fs;

fn store() -> (tempfile::TempDir, Kv) {
    let tmp = tempfile::tempdir().unwrap();
    let kv = Kv::new(tmp.path().join("state")).unwrap();
    (tmp, kv)
}

#[test]
fn roundtrip() {
    let (_tmp, kv) = store();
    let v = json!({"windows": [{"id": 1, "app": "notes"}], "n": 2.5, "ok": true});
    kv.set("session", &v).unwrap();
    assert_eq!(kv.get("session").unwrap(), Some(v));
    kv.delete("session").unwrap();
    assert_eq!(kv.get("session").unwrap(), None);
    kv.delete("session").unwrap();
    kv.delete("never-set").unwrap();
}

#[test]
fn rejects_bad_keys() {
    let (_tmp, kv) = store();
    let long = "a".repeat(65);
    for key in [
        "../x",
        "a/b",
        ".hidden",
        "",
        long.as_str(),
        "a\\b",
        "con",
        "é",
    ] {
        assert_eq!(kv.get(key).unwrap_err().code, "EINVAL", "get {key:?}");
        assert_eq!(
            kv.set(key, &json!(1)).unwrap_err().code,
            "EINVAL",
            "set {key:?}"
        );
        assert_eq!(kv.delete(key).unwrap_err().code, "EINVAL", "delete {key:?}");
    }
    // The longest allowed key and the allowed punctuation are fine.
    let max = "b".repeat(64);
    kv.set(&max, &json!(1)).unwrap();
    kv.set("_a.b-c", &json!(2)).unwrap();
    assert_eq!(kv.get("_a.b-c").unwrap(), Some(json!(2)));
}

#[test]
fn corrupt_value_reads_as_none() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("state");
    let kv = Kv::new(dir.clone()).unwrap();
    fs::write(dir.join("session.json"), "{\"trunc").unwrap();
    assert_eq!(kv.get("session").unwrap(), None);
    // A corrupt value can be overwritten normally.
    kv.set("session", &json!([1])).unwrap();
    assert_eq!(kv.get("session").unwrap(), Some(json!([1])));
}

#[test]
fn persists_across_instances() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("state");
    Kv::new(dir.clone())
        .unwrap()
        .set("perms", &json!({"notes": ["fs"]}))
        .unwrap();
    let again = Kv::new(dir.clone()).unwrap();
    assert_eq!(again.get("perms").unwrap(), Some(json!({"notes": ["fs"]})));
    // Only the value file is left behind: no temp files.
    let names: Vec<_> = fs::read_dir(&dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().into_string().unwrap())
        .collect();
    assert_eq!(names, ["perms.json"]);
}

#[test]
fn new_fails_when_dir_is_a_file() {
    let tmp = tempfile::tempdir().unwrap();
    let file = tmp.path().join("state");
    fs::write(&file, "x").unwrap();
    assert_eq!(Kv::new(file).unwrap_err().code, "EINVAL");
}
