//! GET /api/sessions/:id/subagents/context — context-window usage per sub-agent.
//!
//! Reads every `agent-*.jsonl` under the session's `subagents/` directory and
//! returns, per sub-agent, the context size of its first request, its latest
//! request and its largest request. Works without hooks: it uses only the
//! transcripts Claude Code writes.

use std::path::Path;
use std::sync::Arc;

use axum::extract::{Path as AxumPath, State};
use axum::Json;

use claude_view_core::subagent_context::{
    summarize_subagent_jsonl, tool_use_id_from_meta, SubAgentContext,
};

use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

use super::helpers::resolve_session_file_path;

/// GET /api/sessions/:id/subagents/context
#[utoipa::path(get, path = "/api/sessions/{id}/subagents/context", tag = "sessions",
    params(("id" = String, Path, description = "Parent session ID")),
    responses(
        (status = 200, description = "Context-window usage per sub-agent", body = serde_json::Value),
        (status = 404, description = "Session not found"),
    )
)]
pub async fn get_subagent_context(
    State(state): State<Arc<AppState>>,
    AxumPath(session_id): AxumPath<String>,
) -> ApiResult<Json<Vec<SubAgentContext>>> {
    let parent_path = resolve_session_file_path(&state, &session_id).await?;
    let list = tokio::task::spawn_blocking(move || collect_subagent_context(&parent_path))
        .await
        .map_err(|e| ApiError::Internal(format!("join error: {e}")))?;
    Ok(Json(list))
}

/// Summarise every sub-agent transcript next to `parent_jsonl`.
pub(crate) fn collect_subagent_context(parent_jsonl: &Path) -> Vec<SubAgentContext> {
    let parent_dir = parent_jsonl.parent().unwrap_or(Path::new("."));
    let Some(stem) = parent_jsonl.file_stem().and_then(|s| s.to_str()) else {
        return Vec::new();
    };
    let dir = parent_dir.join(stem).join("subagents");
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };

    let mut out = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        let Some(agent_id) = name
            .strip_prefix("agent-")
            .and_then(|s| s.strip_suffix(".jsonl"))
        else {
            continue;
        };
        if agent_id.is_empty() || !agent_id.chars().all(|c| c.is_ascii_alphanumeric()) {
            continue;
        }
        let Ok(bytes) = std::fs::read(entry.path()) else {
            continue;
        };
        let mut ctx = summarize_subagent_jsonl(agent_id, &String::from_utf8_lossy(&bytes));
        if let Ok(meta) = std::fs::read_to_string(dir.join(format!("agent-{agent_id}.meta.json"))) {
            ctx.tool_use_id = tool_use_id_from_meta(&meta);
        }
        out.push(ctx);
    }
    out.sort_by(|a, b| a.agent_id.cmp(&b.agent_id));
    out
}

#[cfg(test)]
mod tests {
    use super::collect_subagent_context;

    #[test]
    fn collects_each_agent_with_meta() {
        let tmp = tempfile::tempdir().unwrap();
        let parent = tmp.path().join("sess-1.jsonl");
        std::fs::write(&parent, "").unwrap();
        let sub = tmp.path().join("sess-1").join("subagents");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(
            sub.join("agent-a1.jsonl"),
            concat!(
                r#"{"type":"assistant","timestamp":"2026-01-01T00:00:00Z","message":{"id":"m1","usage":{"input_tokens":10,"cache_read_input_tokens":0,"cache_creation_input_tokens":1000}}}"#,
                "\n",
                r#"{"type":"assistant","timestamp":"2026-01-01T00:00:05Z","message":{"id":"m2","usage":{"input_tokens":5,"cache_read_input_tokens":1010,"cache_creation_input_tokens":3000}}}"#,
                "\n"
            ),
        )
        .unwrap();
        std::fs::write(sub.join("agent-a1.meta.json"), r#"{"toolUseId":"toolu_x"}"#).unwrap();
        std::fs::write(sub.join("agent-b2.jsonl"), "").unwrap();
        std::fs::write(sub.join("agent-b2.prefix.json"), "{}").unwrap();
        std::fs::write(sub.join("notes.txt"), "ignored").unwrap();

        let got = collect_subagent_context(&parent);
        assert_eq!(got.len(), 2);
        assert_eq!(got[0].agent_id, "a1");
        assert_eq!(got[0].tool_use_id.as_deref(), Some("toolu_x"));
        assert_eq!(got[0].start_context_tokens, 1010);
        assert_eq!(got[0].current_context_tokens, 4015);
        assert_eq!(got[0].peak_context_tokens, 4015);
        assert_eq!(got[0].request_count, 2);
        assert_eq!(got[1].agent_id, "b2");
        assert_eq!(got[1].request_count, 0);
    }

    #[test]
    fn missing_subagents_dir_is_empty() {
        let tmp = tempfile::tempdir().unwrap();
        let parent = tmp.path().join("lonely.jsonl");
        std::fs::write(&parent, "").unwrap();
        assert!(collect_subagent_context(&parent).is_empty());
    }
}
