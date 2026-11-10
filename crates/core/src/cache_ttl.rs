//! Prompt-cache lifetime (TTL) helpers.
//!
//! Anthropic's prompt cache has two lifetimes: 5 minutes and 1 hour. Each
//! assistant `usage` record says which one a cache write used, via
//! `cache_creation.ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens`.
//! Claude Code commonly writes 1-hour entries, so a hard-coded 300 s TTL makes
//! warm caches look expired after five minutes.
//!
//! Rule used everywhere (live accumulator, rich-session accumulator, resume
//! cost estimate, and the web UI): the TTL is that of the session's latest
//! cache write. 1 hour when the latest write had 1h tokens, 5 minutes when it
//! had only 5m tokens, and the 5-minute default when no split was ever seen.
//! A cache read refreshes the lifetime of the entry it hit, so the countdown
//! still starts from the latest cache read or write (`last_cache_hit_at`).

/// Default prompt-cache TTL (5 minutes) used when no split is known.
pub const DEFAULT_CACHE_TTL_SECS: u32 = 300;
/// One-hour prompt-cache TTL.
pub const ONE_HOUR_CACHE_TTL_SECS: u32 = 3600;

/// TTL implied by one usage record's cache-write split.
///
/// Returns `None` when the record wrote nothing to the cache (so the caller
/// keeps the previously known TTL). A record that wrote both 5m and 1h
/// tokens reports 5m: that part of the cache expires first.
pub fn ttl_for_cache_write(creation_5m: Option<u64>, creation_1h: Option<u64>) -> Option<u32> {
    if creation_5m.unwrap_or(0) > 0 {
        Some(DEFAULT_CACHE_TTL_SECS)
    } else if creation_1h.unwrap_or(0) > 0 {
        Some(ONE_HOUR_CACHE_TTL_SECS)
    } else {
        None
    }
}

/// Effective TTL: the known one, or the 5-minute default.
pub fn effective_ttl(ttl: Option<u32>) -> u32 {
    ttl.filter(|t| *t > 0).unwrap_or(DEFAULT_CACHE_TTL_SECS)
}

/// Whether the cache is still warm `now` (unix seconds).
pub fn is_cache_warm(last_cache_hit_at: i64, now: i64, ttl: Option<u32>) -> bool {
    last_cache_hit_at > 0 && (now - last_cache_hit_at) < effective_ttl(ttl) as i64
}

/// Scan JSONL text from the end and return the TTL of the latest cache write.
///
/// Used where no accumulator is at hand (e.g. the resume cost estimate for a
/// session that is not live). Lines that are not JSON are skipped.
pub fn latest_cache_ttl_in_jsonl(text: &str) -> Option<u32> {
    for line in text.lines().rev() {
        if !line.contains("ephemeral_") {
            continue;
        }
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        let cc = v
            .get("message")
            .and_then(|m| m.get("usage"))
            .and_then(|u| u.get("cache_creation"));
        let Some(cc) = cc else { continue };
        let t5 = cc.get("ephemeral_5m_input_tokens").and_then(|x| x.as_u64());
        let t1 = cc.get("ephemeral_1h_input_tokens").and_then(|x| x.as_u64());
        if let Some(ttl) = ttl_for_cache_write(t5, t1) {
            return Some(ttl);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_hour_write_gives_one_hour() {
        assert_eq!(ttl_for_cache_write(Some(0), Some(1200)), Some(3600));
    }

    #[test]
    fn five_minute_write_gives_five_minutes() {
        assert_eq!(ttl_for_cache_write(Some(800), Some(0)), Some(300));
        assert_eq!(ttl_for_cache_write(Some(800), None), Some(300));
    }

    #[test]
    fn mixed_write_reports_the_shorter_ttl() {
        assert_eq!(ttl_for_cache_write(Some(100), Some(5000)), Some(300));
    }

    #[test]
    fn no_write_keeps_previous() {
        assert_eq!(ttl_for_cache_write(Some(0), Some(0)), None);
        assert_eq!(ttl_for_cache_write(None, None), None);
    }

    #[test]
    fn warm_window_follows_ttl() {
        let hit = 1_000_000;
        // 10 minutes later: cold under 5m, warm under 1h.
        assert!(!is_cache_warm(hit, hit + 600, Some(300)));
        assert!(is_cache_warm(hit, hit + 600, Some(3600)));
        assert!(!is_cache_warm(hit, hit + 600, None));
        assert!(!is_cache_warm(hit, hit + 3600, Some(3600)));
        assert!(!is_cache_warm(0, 10, Some(3600)));
    }

    #[test]
    fn jsonl_scan_uses_latest_write() {
        let text = concat!(
            r#"{"type":"assistant","message":{"usage":{"input_tokens":1,"cache_creation":{"ephemeral_5m_input_tokens":500,"ephemeral_1h_input_tokens":0}}}}"#,
            "\n",
            r#"{"type":"assistant","message":{"usage":{"input_tokens":1,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":900}}}}"#,
            "\n",
            r#"{"type":"assistant","message":{"usage":{"input_tokens":1,"cache_read_input_tokens":900,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":0}}}}"#,
            "\n",
            "not json\n",
        );
        assert_eq!(latest_cache_ttl_in_jsonl(text), Some(3600));
        assert_eq!(latest_cache_ttl_in_jsonl("{}\n"), None);
    }
}
