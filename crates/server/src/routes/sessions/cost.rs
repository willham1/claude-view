//! POST /api/estimate — Cost estimation for session resume.

use std::sync::Arc;

use axum::extract::State;
use axum::Json;

use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

use super::types::{CostEstimate, EstimateRequest};

/// POST /api/estimate — cost estimation (Rust-only, no sidecar).
#[utoipa::path(post, path = "/api/estimate", tag = "sessions",
    request_body = EstimateRequest,
    responses(
        (status = 200, description = "Cost estimate for resuming a session", body = CostEstimate),
        (status = 404, description = "Session not found"),
    )
)]
pub async fn estimate_cost(
    State(state): State<Arc<AppState>>,
    Json(req): Json<EstimateRequest>,
) -> ApiResult<Json<CostEstimate>> {
    let now = chrono::Utc::now().timestamp();

    // Look up session in DB
    let session = state
        .db
        .get_session_by_id(&req.session_id)
        .await
        .map_err(|e| ApiError::Internal(format!("DB error: {e}")))?
        .ok_or_else(|| ApiError::NotFound(format!("Session {} not found", req.session_id)))?;

    let model = req.model.unwrap_or_else(|| {
        session
            .primary_model
            .clone()
            .unwrap_or_else(|| "claude-sonnet-4-20250514".to_string())
    });

    let history_tokens = session.total_input_tokens.unwrap_or(0);
    let last_activity = session.modified_at; // epoch seconds

    // TTL of the session's latest cache write (1h or 5m); 5m when unknown.
    let cache_ttl = resolve_cache_ttl(&state, &req.session_id, &session.file_path).await;
    let cache_warm = claude_view_core::cache_ttl::is_cache_warm(last_activity, now, cache_ttl);

    // Look up model pricing
    let pricing = &*state.pricing;
    let model_pricing = claude_view_core::pricing::lookup_pricing(&model, pricing);

    let per_million =
        |tokens: u64, rate_per_m: f64| -> f64 { (tokens as f64 / 1_000_000.0) * rate_per_m };

    let secs_ago = now - last_activity;
    let (first_message_cost, per_message_cost, has_pricing, explanation) = if let Some(p) =
        model_pricing
    {
        let input_base = p.input_cost_per_token * 1_000_000.0;
        let first_message_cost = if cache_warm {
            per_million(history_tokens, input_base * 0.10) // cache read
        } else {
            // cache write, priced by the TTL in use (1h writes cost 2x, 5m 1.25x)
            per_million(
                history_tokens,
                input_base * cache_write_multiplier(cache_ttl),
            )
        };
        let per_message_cost = per_million(history_tokens, input_base * 0.10); // always cache read
        let explanation = if cache_warm {
            format!(
                "Cache is warm (last active {}s ago). First message: ${:.4} (cached). Each follow-up: ~${:.4}.",
                secs_ago, first_message_cost, per_message_cost,
            )
        } else {
            format!(
                "Cache is cold (last active {}m ago). First message: ${:.4} (cache warming). Follow-ups drop to ~${:.4} (cached).",
                secs_ago / 60, first_message_cost, per_message_cost,
            )
        };
        (
            Some(first_message_cost),
            Some(per_message_cost),
            true,
            explanation,
        )
    } else {
        (
            None,
            None,
            false,
            format!(
                "Model pricing not found for {} (last active {}s ago). Cost estimate unavailable without real pricing data.",
                model, secs_ago
            ),
        )
    };

    let project_name = if session.display_name.is_empty() {
        None
    } else {
        Some(session.display_name.clone())
    };

    Ok(Json(CostEstimate {
        session_id: req.session_id,
        history_tokens,
        cache_warm,
        first_message_cost,
        per_message_cost,
        has_pricing,
        model,
        explanation,
        session_title: session.longest_task_preview.clone(),
        project_name,
        turn_count: session.turn_count_api.unwrap_or(0).min(u32::MAX as u64) as u32,
        files_edited: session.files_edited_count,
        last_active_secs_ago: secs_ago,
    }))
}

/// Cache TTL of the session's latest cache write: from the live accumulator
/// when the session is live, else from the tail of its JSONL file.
async fn resolve_cache_ttl(state: &AppState, session_id: &str, file_path: &str) -> Option<u32> {
    {
        let map = state.live_sessions.read().await;
        if let Some(ttl) = map.get(session_id).and_then(|s| s.jsonl.cache_ttl_seconds) {
            return Some(ttl);
        }
    }
    if file_path.is_empty() {
        return None;
    }
    let path = std::path::PathBuf::from(file_path);
    tokio::task::spawn_blocking(move || read_tail_cache_ttl(&path))
        .await
        .ok()
        .flatten()
}

/// Cache-write price multiplier on the base input rate for a TTL:
/// 2x for the 1-hour cache, 1.25x for the 5-minute cache (and when unknown).
fn cache_write_multiplier(ttl: Option<u32>) -> f64 {
    if claude_view_core::cache_ttl::effective_ttl(ttl)
        >= claude_view_core::cache_ttl::ONE_HOUR_CACHE_TTL_SECS
    {
        2.0
    } else {
        1.25
    }
}

/// Bytes read first from the end of the file.
const TAIL_BYTES: u64 = 512 * 1024;
/// Upper bound on how far back the second, wider read goes.
const MAX_SCAN_BYTES: u64 = 64 * 1024 * 1024;

/// Find the latest cache-write TTL in a JSONL file: first in the last
/// 512 KiB, then (if none found there) in up to the last 64 MiB.
fn read_tail_cache_ttl(path: &std::path::Path) -> Option<u32> {
    read_tail_cache_ttl_with(path, TAIL_BYTES, MAX_SCAN_BYTES)
}

fn read_tail_cache_ttl_with(path: &std::path::Path, tail: u64, max: u64) -> Option<u32> {
    use std::io::{Read, Seek, SeekFrom};
    let mut f = std::fs::File::open(path).ok()?;
    let len = f.metadata().ok()?.len();
    let mut scan = |bytes: u64| -> Option<u32> {
        f.seek(SeekFrom::Start(len.saturating_sub(bytes))).ok()?;
        let mut buf = Vec::new();
        f.read_to_end(&mut buf).ok()?;
        claude_view_core::cache_ttl::latest_cache_ttl_in_jsonl(&String::from_utf8_lossy(&buf))
    };
    if let Some(ttl) = scan(tail) {
        return Some(ttl);
    }
    if len > tail {
        return scan(len.min(max));
    }
    None
}

#[cfg(test)]
mod tests {
    use super::{cache_write_multiplier, read_tail_cache_ttl, read_tail_cache_ttl_with};

    #[test]
    fn cold_write_is_priced_by_ttl() {
        assert_eq!(cache_write_multiplier(Some(3600)), 2.0);
        assert_eq!(cache_write_multiplier(Some(300)), 1.25);
        assert_eq!(cache_write_multiplier(None), 1.25);
    }

    #[test]
    fn scan_reads_further_back_when_tail_has_no_write() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("long.jsonl");
        let mut text = String::from(
            r#"{"type":"assistant","message":{"usage":{"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":42}}}}"#,
        );
        text.push('\n');
        for _ in 0..200 {
            text.push_str(r#"{"type":"user","message":{"content":"filler line without usage"}}"#);
            text.push('\n');
        }
        std::fs::write(&p, &text).unwrap();
        // A 1 KiB tail sees only filler; the wider read finds the 1h write.
        assert_eq!(read_tail_cache_ttl_with(&p, 1024, 1 << 20), Some(3600));
        // With the wider read capped below the write, it is not found.
        assert_eq!(read_tail_cache_ttl_with(&p, 1024, 2048), None);
    }

    #[test]
    fn tail_scan_reads_one_hour_ttl_from_file() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("s.jsonl");
        std::fs::write(
            &p,
            concat!(
                r#"{"type":"assistant","message":{"usage":{"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":42}}}}"#,
                "\n"
            ),
        )
        .unwrap();
        assert_eq!(read_tail_cache_ttl(&p), Some(3600));
        assert_eq!(read_tail_cache_ttl(&dir.path().join("missing.jsonl")), None);
    }
}
