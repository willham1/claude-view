//! Per-sub-agent context-window usage, read from the sub-agent's own JSONL.
//!
//! Sub-agent transcripts live at
//! `~/.claude/projects/{project}/{sessionId}/subagents/agent-{agentId}.jsonl`.
//! Each assistant line carries the API `usage` of the request that produced it.
//! The context sent with a request is
//! `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`
//! (the same formula the main session's Context Window panel uses).

use serde::Serialize;

/// Context-window figures for one sub-agent.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubAgentContext {
    /// Agent ID from the `agent-{id}.jsonl` filename.
    pub agent_id: String,
    /// `toolUseId` of the spawning Agent/Task call (from `agent-{id}.meta.json`).
    /// Lets the UI match a running sub-agent before its agentId is known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_use_id: Option<String>,
    /// Model of the latest request.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// Number of distinct API requests (by `message.id`).
    pub request_count: u32,
    /// Context size of the first request (system prompt + task brief).
    pub start_context_tokens: u64,
    /// Context size of the latest request.
    pub current_context_tokens: u64,
    /// Largest context size of any request.
    pub peak_context_tokens: u64,
    /// Unix seconds of the latest assistant line with usage.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_activity_at: Option<i64>,
}

/// Summarise a sub-agent JSONL transcript. Lines that are not JSON, not
/// assistant lines, or carry no usage are skipped.
pub fn summarize_subagent_jsonl(agent_id: &str, text: &str) -> SubAgentContext {
    let mut out = SubAgentContext {
        agent_id: agent_id.to_string(),
        ..Default::default()
    };
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    for line in text.lines() {
        if !line.contains("\"usage\"") {
            continue;
        }
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        if v.get("type").and_then(|t| t.as_str()) != Some("assistant") {
            continue;
        }
        let Some(msg) = v.get("message") else {
            continue;
        };
        let Some(usage) = msg.get("usage") else {
            continue;
        };
        let n = |k: &str| usage.get(k).and_then(|x| x.as_u64()).unwrap_or(0);
        let ctx =
            n("input_tokens") + n("cache_read_input_tokens") + n("cache_creation_input_tokens");
        if ctx == 0 {
            continue;
        }

        // One API response may be split over several lines (one per content
        // block); they repeat the same usage. Count each message id once.
        let msg_id = msg.get("id").and_then(|x| x.as_str()).map(str::to_string);
        let is_new = match &msg_id {
            Some(id) => seen.insert(id.clone()),
            None => true,
        };
        if is_new {
            if out.request_count == 0 {
                out.start_context_tokens = ctx;
            }
            out.request_count += 1;
        }

        out.current_context_tokens = ctx;
        out.peak_context_tokens = out.peak_context_tokens.max(ctx);
        if let Some(m) = msg.get("model").and_then(|x| x.as_str()) {
            if !m.starts_with('<') {
                out.model = Some(m.to_string());
            }
        }
        if let Some(ts) = v.get("timestamp").and_then(|x| x.as_str()) {
            if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(ts) {
                out.last_activity_at = Some(dt.timestamp());
            }
        }
    }
    out
}

/// Read `toolUseId` from a sub-agent's `agent-{id}.meta.json` content.
pub fn tool_use_id_from_meta(meta_json: &str) -> Option<String> {
    serde_json::from_str::<serde_json::Value>(meta_json)
        .ok()?
        .get("toolUseId")?
        .as_str()
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn asst(id: &str, ts: &str, input: u64, read: u64, create: u64) -> String {
        format!(
            r#"{{"type":"assistant","timestamp":"{ts}","message":{{"id":"{id}","model":"claude-test-1","role":"assistant","content":[],"usage":{{"input_tokens":{input},"output_tokens":7,"cache_read_input_tokens":{read},"cache_creation_input_tokens":{create}}}}}}}"#
        )
    }

    #[test]
    fn start_current_and_peak() {
        let text = [
            r#"{"type":"user","message":{"role":"user","content":"do the thing"}}"#.to_string(),
            asst("m1", "2026-01-01T00:00:00Z", 2, 4000, 5000),
            // same response split over two lines: counted once
            asst("m1", "2026-01-01T00:00:00Z", 2, 4000, 5000),
            asst("m2", "2026-01-01T00:00:10Z", 1, 9000, 31000),
            asst("m3", "2026-01-01T00:00:20Z", 1, 20000, 500),
            "garbage".to_string(),
        ]
        .join("\n");
        let s = summarize_subagent_jsonl("abc", &text);
        assert_eq!(s.agent_id, "abc");
        assert_eq!(s.request_count, 3);
        assert_eq!(s.start_context_tokens, 9002);
        assert_eq!(s.peak_context_tokens, 40001);
        assert_eq!(s.current_context_tokens, 20501);
        assert_eq!(s.model.as_deref(), Some("claude-test-1"));
        assert_eq!(s.last_activity_at, Some(1767225620));
    }

    #[test]
    fn empty_transcript_is_zero() {
        let s = summarize_subagent_jsonl("x", "");
        assert_eq!(s.request_count, 0);
        assert_eq!(s.start_context_tokens, 0);
        assert_eq!(s.peak_context_tokens, 0);
        assert!(s.model.is_none());
    }

    #[test]
    fn meta_tool_use_id() {
        assert_eq!(
            tool_use_id_from_meta(r#"{"agentType":"general","toolUseId":"toolu_123"}"#),
            Some("toolu_123".to_string())
        );
        assert_eq!(tool_use_id_from_meta("not json"), None);
    }
}
