//! GET /api/sessions/:id/subagents/context — context-window usage per sub-agent.
//!
//! Reads every `agent-*.jsonl` under the session's `subagents/` directory and
//! returns, per sub-agent, the context size of its first request, its latest
//! request and its largest request. Works without hooks: it uses only the
//! transcripts Claude Code writes.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::SystemTime;

use axum::extract::{Path as AxumPath, Query, State};
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

/// Query for [`get_subagent_costs`]: comma-separated parent session IDs.
#[derive(Debug, serde::Deserialize)]
pub struct SubAgentCostsQuery {
    #[serde(default)]
    pub ids: String,
}

/// Cost of one sub-agent, from its own transcript (a slim [`SubAgentContext`]).
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubAgentCost {
    pub agent_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_use_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost_usd: Option<f64>,
}

impl From<&SubAgentContext> for SubAgentCost {
    fn from(c: &SubAgentContext) -> Self {
        Self {
            agent_id: c.agent_id.clone(),
            tool_use_id: c.tool_use_id.clone(),
            cost_usd: c.cost_usd,
        }
    }
}

/// Most session IDs one request may ask for.
const MAX_COST_IDS: usize = 200;

/// GET /api/sessions/subagents/costs?ids=a,b,c — per sub-agent cost for many
/// sessions at once, so the Live Monitor's cards can show each session's total
/// (main session plus helpers) with one request. Uses the same per-file cache
/// as the context endpoint: a poll re-parses only transcripts that grew.
/// Sessions that cannot be found are left out.
#[utoipa::path(get, path = "/api/sessions/subagents/costs", tag = "sessions",
    params(("ids" = String, Query, description = "Comma-separated parent session IDs")),
    responses(
        (status = 200, description = "Per sub-agent cost, keyed by session ID", body = serde_json::Value),
    )
)]
pub async fn get_subagent_costs(
    State(state): State<Arc<AppState>>,
    Query(q): Query<SubAgentCostsQuery>,
) -> ApiResult<Json<HashMap<String, Vec<SubAgentCost>>>> {
    let mut paths = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for id in q.ids.split(',').map(str::trim) {
        if id.is_empty() || !seen.insert(id) || seen.len() > MAX_COST_IDS {
            continue;
        }
        if let Ok(p) = resolve_session_file_path(&state, id).await {
            paths.push((id.to_string(), p));
        }
    }
    let out = tokio::task::spawn_blocking(move || {
        paths
            .into_iter()
            .map(|(id, p)| {
                let costs = collect_subagent_context(&p)
                    .iter()
                    .map(SubAgentCost::from)
                    .collect();
                (id, costs)
            })
            .collect::<HashMap<_, _>>()
    })
    .await
    .map_err(|e| ApiError::Internal(format!("join error: {e}")))?;
    Ok(Json(out))
}

/// Per-file summary cache keyed by path; an entry is reused while the file's
/// size and modification time are unchanged, so a poll only re-parses
/// transcripts that grew.
pub(crate) type ContextCache = Mutex<HashMap<PathBuf, (u64, Option<SystemTime>, SubAgentContext)>>;

/// Entries kept before the cache is cleared (bounds memory across sessions).
const MAX_CACHE_ENTRIES: usize = 5000;

fn global_cache() -> &'static ContextCache {
    static CACHE: OnceLock<ContextCache> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Summarise every sub-agent transcript next to `parent_jsonl`.
pub(crate) fn collect_subagent_context(parent_jsonl: &Path) -> Vec<SubAgentContext> {
    collect_subagent_context_cached(parent_jsonl, global_cache())
}

/// Same as [`collect_subagent_context`], with an explicit cache (for tests).
pub(crate) fn collect_subagent_context_cached(
    parent_jsonl: &Path,
    cache: &ContextCache,
) -> Vec<SubAgentContext> {
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
        let path = entry.path();
        let Ok(md) = entry.metadata() else { continue };
        let (size, mtime) = (md.len(), md.modified().ok());
        if let Ok(map) = cache.lock() {
            if let Some((s, m, ctx)) = map.get(&path) {
                if *s == size && *m == mtime {
                    out.push(ctx.clone());
                    continue;
                }
            }
        }
        let Ok(bytes) = std::fs::read(&path) else {
            continue;
        };
        let mut ctx = summarize_subagent_jsonl(agent_id, &String::from_utf8_lossy(&bytes));
        if let Ok(meta) = std::fs::read_to_string(dir.join(format!("agent-{agent_id}.meta.json"))) {
            ctx.tool_use_id = tool_use_id_from_meta(&meta);
        }
        if let Ok(mut map) = cache.lock() {
            if map.len() >= MAX_CACHE_ENTRIES {
                map.clear();
            }
            map.insert(path, (size, mtime, ctx.clone()));
        }
        out.push(ctx);
    }
    out.sort_by(|a, b| a.agent_id.cmp(&b.agent_id));
    out
}

#[cfg(test)]
mod tests {
    use super::{collect_subagent_context, collect_subagent_context_cached, ContextCache};

    fn line(id: &str, create: u64) -> String {
        format!(
            r#"{{"type":"assistant","message":{{"id":"{id}","usage":{{"input_tokens":1,"cache_read_input_tokens":0,"cache_creation_input_tokens":{create}}}}}}}"#
        )
    }

    #[test]
    fn unchanged_file_is_served_from_cache_and_changed_file_is_reparsed() {
        let tmp = tempfile::tempdir().unwrap();
        let parent = tmp.path().join("s.jsonl");
        std::fs::write(&parent, "").unwrap();
        let sub = tmp.path().join("s").join("subagents");
        std::fs::create_dir_all(&sub).unwrap();
        let f = sub.join("agent-c1.jsonl");
        std::fs::write(&f, format!("{}\n", line("m1", 1000))).unwrap();
        let mtime = std::fs::metadata(&f).unwrap().modified().unwrap();

        let cache = ContextCache::default();
        assert_eq!(
            collect_subagent_context_cached(&parent, &cache)[0].peak_context_tokens,
            1001
        );

        // Same size and mtime, different content: the cached summary is reused.
        std::fs::write(&f, format!("{}\n", line("m1", 2000))).unwrap();
        std::fs::File::options()
            .write(true)
            .open(&f)
            .unwrap()
            .set_modified(mtime)
            .unwrap();
        assert_eq!(
            collect_subagent_context_cached(&parent, &cache)[0].peak_context_tokens,
            1001
        );

        // The file grows: it is parsed again.
        std::fs::write(&f, format!("{}\n{}\n", line("m1", 2000), line("m2", 3000))).unwrap();
        let got = collect_subagent_context_cached(&parent, &cache);
        assert_eq!(got[0].peak_context_tokens, 3001);
        assert_eq!(got[0].request_count, 2);
    }

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
