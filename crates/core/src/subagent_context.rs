//! Per-sub-agent context-window usage, read from the sub-agent's own JSONL.
//!
//! Sub-agent transcripts live at
//! `~/.claude/projects/{project}/{sessionId}/subagents/agent-{agentId}.jsonl`.
//! Each assistant line carries the API `usage` of the request that produced it.
//! The context sent with a request is
//! `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`
//! (the same formula the main session's Context Window panel uses).

use std::collections::HashMap;

use serde::Serialize;

use crate::pricing::{calculate_cost, extract_usage_tokens, load_pricing, TokenUsage};

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
    /// Effort level of the latest request (`low` … `max`), from the
    /// top-level `effort` field Claude Code writes on each assistant line.
    /// `None` for transcripts written before Claude Code recorded it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub effort: Option<String>,
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
    /// Cost of the sub-agent's own requests at Anthropic list prices (USD),
    /// each request priced with its model's rates and its cache writes split
    /// by 5-minute / 1-hour lifetime. `None` when no request could be priced.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost_usd: Option<f64>,
    /// True when some requests used a model with no known price (their
    /// tokens are left out of `cost_usd`).
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub has_unpriced_usage: bool,
}

/// Price each request (model + usage) and sum. Returns (cost, any unpriced).
fn price_requests(requests: &[(Option<String>, TokenUsage)]) -> (Option<f64>, bool) {
    if requests.is_empty() {
        return (None, false);
    }
    let pricing = load_pricing();
    let mut total = 0.0;
    let mut priced_any = false;
    let mut unpriced = false;
    for (model, tokens) in requests {
        let cost = calculate_cost(tokens, model.as_deref(), &pricing);
        if cost.has_unpriced_usage || model.is_none() {
            unpriced = true;
        } else {
            priced_any = true;
            total += cost.total_usd;
        }
    }
    (priced_any.then_some(total), unpriced)
}

/// Summarise a sub-agent JSONL transcript. Lines that are not JSON, not
/// assistant lines, or carry no usage are skipped.
pub fn summarize_subagent_jsonl(agent_id: &str, text: &str) -> SubAgentContext {
    let mut out = SubAgentContext {
        agent_id: agent_id.to_string(),
        ..Default::default()
    };
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    // Usage per request for pricing. A response split over several lines
    // repeats its usage; the latest line of a message id wins.
    let mut requests: Vec<(Option<String>, TokenUsage)> = Vec::new();
    let mut request_index: HashMap<String, usize> = HashMap::new();

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
        let req_model = msg
            .get("model")
            .and_then(|x| x.as_str())
            .filter(|m| !m.starts_with('<'))
            .map(str::to_string);
        let req = (req_model, extract_usage_tokens(usage));
        match msg_id.as_ref().and_then(|id| request_index.get(id)) {
            Some(&i) => requests[i] = req,
            None => {
                if let Some(id) = &msg_id {
                    request_index.insert(id.clone(), requests.len());
                }
                requests.push(req);
            }
        }
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
        if let Some(e) = v
            .get("effort")
            .and_then(|x| x.as_str())
            .filter(|e| !e.is_empty())
        {
            out.effort = Some(e.to_string());
        }
        if let Some(ts) = v.get("timestamp").and_then(|x| x.as_str()) {
            if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(ts) {
                out.last_activity_at = Some(dt.timestamp());
            }
        }
    }
    let (cost, unpriced) = price_requests(&requests);
    out.cost_usd = cost;
    out.has_unpriced_usage = unpriced;
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

    fn priced(id: &str, model: &str, usage: &str) -> String {
        format!(
            r#"{{"type":"assistant","message":{{"id":"{id}","model":"{model}","content":[],"usage":{usage}}}}}"#
        )
    }

    #[test]
    fn cost_prices_each_request_with_its_model_and_cache_split() {
        // Made-up usage. Opus 5.5: $4 in / $20 out / $5 5m / $8 1h / $0.20 read.
        let r1 = r#"{"input_tokens":1000,"output_tokens":2000,"cache_read_input_tokens":0,"cache_creation_input_tokens":30000,"cache_creation":{"ephemeral_5m_input_tokens":10000,"ephemeral_1h_input_tokens":20000}}"#;
        // Same id again with a larger output count (streaming): latest wins.
        let r1b = r#"{"input_tokens":1000,"output_tokens":3000,"cache_read_input_tokens":0,"cache_creation_input_tokens":30000,"cache_creation":{"ephemeral_5m_input_tokens":10000,"ephemeral_1h_input_tokens":20000}}"#;
        // Haiku 5.5: $0.10 in / $0.50 out / $0.01 read.
        let r2 = r#"{"input_tokens":500,"output_tokens":1000,"cache_read_input_tokens":100000,"cache_creation_input_tokens":0}"#;
        let text = [
            priced("m1", "claude-opus-5-5", r1),
            priced("m1", "claude-opus-5-5", r1b),
            priced("m2", "claude-haiku-5-5", r2),
        ]
        .join("\n");
        let s = summarize_subagent_jsonl("a", &text);
        // m1: 1000*4 + 3000*20 + 10000*5 + 20000*8 = 274_000 µ$ = $0.274
        // m2: 500*0.1 + 1000*0.5 + 100000*0.01 = 1_550 µ$ = $0.00155
        let want = 0.274 + 0.00155;
        let got = s.cost_usd.expect("priced");
        assert!((got - want).abs() < 1e-9, "got {got}, want {want}");
        assert!(!s.has_unpriced_usage);
        assert_eq!(s.request_count, 2);
    }

    #[test]
    fn cost_is_none_for_unknown_model_and_flags_unpriced() {
        let u = r#"{"input_tokens":10,"output_tokens":10,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}"#;
        let s = summarize_subagent_jsonl("a", &priced("m1", "gpt-made-up", u));
        assert_eq!(s.cost_usd, None);
        assert!(s.has_unpriced_usage);
    }

    #[test]
    fn effort_is_from_the_latest_request() {
        let u = r#"{"input_tokens":10,"output_tokens":10,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}"#;
        let line = |id: &str, effort: Option<&str>| {
            let e = effort
                .map(|e| format!(r#""effort":"{e}","#))
                .unwrap_or_default();
            format!(
                r#"{{"type":"assistant",{e}"message":{{"id":"{id}","model":"claude-opus-5-5","content":[],"usage":{u}}}}}"#
            )
        };
        // Effort changes mid-run; a line without the field keeps the last one.
        let text = [
            line("m1", Some("high")),
            line("m2", Some("medium")),
            line("m3", None),
        ]
        .join("\n");
        let s = summarize_subagent_jsonl("a", &text);
        assert_eq!(s.effort.as_deref(), Some("medium"));
        assert_eq!(s.model.as_deref(), Some("claude-opus-5-5"));

        // A `<synthetic>` placeholder after a real reply (the common real-world
        // case: no effort field, zero usage) leaves model and effort unchanged.
        let synthetic = r#"{"type":"assistant","message":{"id":"s1","model":"<synthetic>","content":[],"usage":{"input_tokens":0,"output_tokens":0,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}"#;
        let text = [line("m1", Some("xhigh")), synthetic.to_string()].join("\n");
        let s = summarize_subagent_jsonl("a", &text);
        assert_eq!(s.effort.as_deref(), Some("xhigh"));
        assert_eq!(s.model.as_deref(), Some("claude-opus-5-5"));
        assert_eq!(s.request_count, 1);

        // Older transcripts have no effort field.
        let s = summarize_subagent_jsonl("a", &line("m1", None));
        assert!(s.effort.is_none());
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
