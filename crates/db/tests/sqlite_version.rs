//! FORK: guard for RUSTSEC-2026-0459 (CVE-2026-119375, fixed in SQLite 3.54.0).
//!
//! The fork links SQLite from Homebrew instead of the copy bundled in libsqlite3-sys 0.30.1
//! (see `.cargo/config.toml` and FORK.md). cargo-deny can only see the libsqlite3-sys version, so
//! deny.toml ignores the advisory; this test is what keeps that honest. It fails if the SQLite
//! actually linked into the binaries (shared by rusqlite and sqlx) is older than the fix, e.g.
//! after a revert to `bundled` or a build against an old system library.

const FIXED_IN: i32 = 3_054_000; // SQLite 3.54.0

#[test]
fn linked_sqlite_has_the_cve_2026_119375_fix() {
    let linked = rusqlite::version_number();
    assert!(
        linked >= FIXED_IN,
        "linked SQLite is {} ({}), older than 3.54.0; build against Homebrew's sqlite (see FORK.md)",
        rusqlite::version(),
        linked
    );
}

#[test]
fn sqlx_and_rusqlite_use_the_same_sqlite() {
    let rt = tokio::runtime::Builder::new_current_thread().build().unwrap();
    let via_sqlx: String = rt.block_on(async {
        use sqlx::Connection;
        let mut conn = sqlx::SqliteConnection::connect("sqlite::memory:").await.unwrap();
        sqlx::query_scalar("select sqlite_version()")
            .fetch_one(&mut conn)
            .await
            .unwrap()
    });
    assert_eq!(via_sqlx, rusqlite::version());
}
