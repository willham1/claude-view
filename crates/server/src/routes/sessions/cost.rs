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
            per_million(history_tokens, input_base * 1.25) // cache write
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

/// Read the last 512 KiB of a JSONL file and find the latest cache-write TTL.
fn read_tail_cache_ttl(path: &std::path::Path) -> Option<u32> {
    use std::io::{Read, Seek, SeekFrom};
    const TAIL_BYTES: u64 = 512 * 1024;
    let mut f = std::fs::File::open(path).ok()?;
    let len = f.metadata().ok()?.len();
    f.seek(SeekFrom::Start(len.saturating_sub(TAIL_BYTES)))
        .ok()?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf).ok()?;
    claude_view_core::cache_ttl::latest_cache_ttl_in_jsonl(&String::from_utf8_lossy(&buf))
}

#[cfg(test)]
mod tests {
    use super::read_tail_cache_ttl;

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
