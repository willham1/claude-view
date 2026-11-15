//! Sub-agent spawn, completion, progress, and notification tracking.

use std::collections::HashMap;

use claude_view_core::pricing::{calculate_cost, ModelPricing, TokenUsage};
use claude_view_core::subagent::{
    apply_task_notification_once, resume_agent, SubAgentInfo, SubAgentStatus,
};

use super::super::accumulator::SessionAccumulator;
use super::super::helpers::parse_timestamp_to_unix;

pub(super) fn process_sub_agents(
    line: &claude_view_core::live_parser::LiveLine,
    acc: &mut SessionAccumulator,
    last_activity_at: i64,
    pricing: &HashMap<String, ModelPricing>,
) {
    // Sub-agent spawn tracking
    for spawn in &line.sub_agent_spawns {
        if spawn.team_name.is_some() {
            continue;
        }
        if acc
            .sub_agents
            .iter()
            .any(|a| a.tool_use_id == spawn.tool_use_id)
        {
            continue;
        }
        let started_at = line
            .timestamp
            .as_deref()
            .and_then(parse_timestamp_to_unix)
            .unwrap_or(last_activity_at);
        acc.sub_agents.push(SubAgentInfo {
            tool_use_id: spawn.tool_use_id.clone(),
            agent_id: None,
            agent_type: spawn.agent_type.clone(),
            description: spawn.description.clone(),
            status: SubAgentStatus::Running,
            started_at,
            completed_at: None,
            duration_ms: None,
            tool_use_count: None,
            model: spawn.model.clone(),
            input_tokens: None,
            output_tokens: None,
            cache_read_tokens: None,
            cache_creation_tokens: None,
            cost_usd: None,
            current_activity: None,
            error_reason: None,
        });
    }

    // Sub-agent completion tracking
    if let Some(ref result) = line.sub_agent_result {
        if let Some(agent) = acc
            .sub_agents
            .iter_mut()
            .find(|a| a.tool_use_id == result.tool_use_id)
        {
            let terminal_status = match result.status.as_str() {
                "completed" => Some(SubAgentStatus::Complete),
                "async_launched" | "teammate_spawned" | "queued" => None,
                _ => Some(SubAgentStatus::Error),
            };

            agent.agent_id = result.agent_id.clone();

            if let Some(status) = terminal_status {
                agent.status = status;
                if status == SubAgentStatus::Error {
                    agent.error_reason = Some(result.status.clone());
                }
                agent.completed_at = line.timestamp.as_deref().and_then(parse_timestamp_to_unix);
                agent.duration_ms = result.total_duration_ms;
                agent.tool_use_count = result.total_tool_use_count;
                agent.current_activity = None;
                agent.input_tokens = result.usage_input_tokens;
                agent.output_tokens = result.usage_output_tokens;
                agent.cache_read_tokens = result.usage_cache_read_tokens;
                agent.cache_creation_tokens = result.usage_cache_creation_tokens;
                if result.model.is_some() {
                    agent.model = result.model.clone();
                }
                let pricing_model = agent.model.as_deref().or(acc.model.as_deref());
                if let Some(model) = pricing_model {
                    // Threads nested cache_creation.{5m,1h} breakdown through so
                    // 1hr-caching costs are charged at the 1hr rate.
                    let sub_tokens = TokenUsage {
                        input_tokens: result.usage_input_tokens.unwrap_or(0),
                        output_tokens: result.usage_output_tokens.unwrap_or(0),
                        cache_read_tokens: result.usage_cache_read_tokens.unwrap_or(0),
                        cache_creation_tokens: result.usage_cache_creation_tokens.unwrap_or(0),
                        cache_creation_5m_tokens: result
                            .usage_cache_creation_5m_tokens
                            .unwrap_or(0),
                        cache_creation_1hr_tokens: result
                            .usage_cache_creation_1hr_tokens
                            .unwrap_or(0),
                        total_tokens: 0,
                    };
                    let sub_cost = calculate_cost(&sub_tokens, Some(model), pricing);
                    if sub_cost.total_usd > 0.0 {
                        agent.cost_usd = Some(sub_cost.total_usd);
                    }
                }
            }
        }
    }

    // Sub-agent progress tracking
    if let Some(ref progress) = line.sub_agent_progress {
        if let Some(agent) = acc
            .sub_agents
            .iter_mut()
            .find(|a| a.tool_use_id == progress.parent_tool_use_id)
        {
            if agent.agent_id.is_none() {
                agent.agent_id = Some(progress.agent_id.clone());
            }
            if agent.status == SubAgentStatus::Running {
                agent.current_activity = progress.current_tool.clone();
            }
        }
    }

    // Background agent completion via <task-notification>
    if let Some(ref notif) = line.sub_agent_notification {
        apply_task_notification_once(
            &mut acc.sub_agents,
            &mut acc.applied_notices,
            notif,
            line.timestamp.as_deref().and_then(parse_timestamp_to_unix),
        );
    }

    // A SendMessage resumed a helper that had handed back: working again.
    if let Some(ref id) = line.resumed_agent_id {
        resume_agent(&mut acc.sub_agents, id);
    }
}

#[cfg(test)]
mod tests {
    //! Lines shaped like a real lead transcript (Claude Code, Nov 2026): a
    //! background helper's hand-back arrives as queued-command lines, and a
    //! SendMessage can resume it afterwards.
    use super::*;
    use claude_view_core::live_parser::{parse_single_line, TailFinders};

    const NOTICE: &str = r#"<task-notification>\n<task-id>a5ac2a04b0b24c9a8</task-id>\n<tool-use-id>toolu_012ds</tool-use-id>\n<status>completed</status>\n<summary>Agent \"Build RW8b\" finished</summary>\n</task-notification>"#;

    fn feed(acc: &mut SessionAccumulator, raw: &str) {
        let line = parse_single_line(raw.as_bytes(), &TailFinders::new());
        process_sub_agents(&line, acc, 0, &HashMap::new());
    }

    fn spawn_and_launch(acc: &mut SessionAccumulator) {
        feed(
            acc,
            r#"{"type":"assistant","timestamp":"2026-11-15T06:00:00.000Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_012ds","name":"Agent","input":{"description":"Build RW8b","subagent_type":"builder","prompt":"go","run_in_background":true}}]}}"#,
        );
        feed(
            acc,
            r#"{"type":"user","timestamp":"2026-11-15T06:00:01.000Z","message":{"role":"user","content":[{"tool_use_id":"toolu_012ds","type":"tool_result","content":[{"type":"text","text":"Async agent launched successfully."}]}]},"toolUseResult":{"isAsync":true,"status":"async_launched","agentId":"a5ac2a04b0b24c9a8","description":"Build RW8b"}}"#,
        );
        assert_eq!(acc.sub_agents.len(), 1);
        assert_eq!(acc.sub_agents[0].status, SubAgentStatus::Running);
    }

    fn queued(ts: &str, op: &str, notice: &str) -> String {
        format!(
            r#"{{"type":"queue-operation","operation":"{op}","timestamp":"{ts}","sessionId":"s1","content":"{notice}"}}"#
        )
    }

    #[test]
    fn queued_hand_back_marks_helper_complete_at_first_copy() {
        let mut acc = SessionAccumulator::new();
        spawn_and_launch(&mut acc);

        feed(
            &mut acc,
            &queued("2026-11-15T06:19:46.000Z", "enqueue", NOTICE),
        );
        feed(
            &mut acc,
            &queued("2026-11-15T06:19:47.000Z", "remove", NOTICE),
        );
        feed(
            &mut acc,
            &format!(
                r#"{{"type":"attachment","timestamp":"2026-11-15T06:19:48.000Z","attachment":{{"type":"queued_command","prompt":"{NOTICE}"}}}}"#
            ),
        );

        let a = &acc.sub_agents[0];
        assert_eq!(a.status, SubAgentStatus::Complete);
        assert_eq!(
            a.completed_at,
            parse_timestamp_to_unix("2026-11-15T06:19:46.000Z")
        );
        assert_eq!(a.error_reason, None);
    }

    #[test]
    fn attachment_alone_marks_helper_failed() {
        let mut acc = SessionAccumulator::new();
        spawn_and_launch(&mut acc);
        let failed = NOTICE.replace("completed", "killed");
        feed(
            &mut acc,
            &format!(
                r#"{{"type":"attachment","timestamp":"2026-11-15T06:19:48.000Z","attachment":{{"type":"queued_command","prompt":"{failed}"}}}}"#
            ),
        );
        assert_eq!(acc.sub_agents[0].status, SubAgentStatus::Error);
        assert_eq!(acc.sub_agents[0].error_reason.as_deref(), Some("killed"));
    }

    #[test]
    fn resumed_helper_runs_again_until_its_next_hand_back() {
        let mut acc = SessionAccumulator::new();
        spawn_and_launch(&mut acc);
        feed(
            &mut acc,
            &queued("2026-11-15T06:19:46.000Z", "enqueue", NOTICE),
        );
        assert_eq!(acc.sub_agents[0].status, SubAgentStatus::Complete);

        // Lead sends findings; Claude Code resumes the helper.
        feed(
            &mut acc,
            r#"{"type":"user","timestamp":"2026-11-15T06:30:45.000Z","message":{"role":"user","content":[{"tool_use_id":"toolu_send1","type":"tool_result","content":[{"type":"text","text":"{\"success\":true}"}]}]},"toolUseResult":{"success":true,"message":"Resuming agent a5ac2a0","resumedAgentId":"a5ac2a04b0b24c9a8","revivedAgentId":"a5ac2a04b0b24c9a8"}}"#,
        );
        let a = &acc.sub_agents[0];
        assert_eq!(a.status, SubAgentStatus::Running);
        assert_eq!(a.completed_at, None);

        // The old hand-back's remove and attachment copies, written after the
        // resume, must not finish the resumed helper.
        feed(
            &mut acc,
            &queued("2026-11-15T06:30:46.000Z", "remove", NOTICE),
        );
        feed(
            &mut acc,
            &format!(
                r#"{{"type":"attachment","timestamp":"2026-11-15T06:30:46.500Z","attachment":{{"type":"queued_command","prompt":"{NOTICE}"}}}}"#
            ),
        );
        assert_eq!(acc.sub_agents[0].status, SubAgentStatus::Running);

        // Waiting on its own background work is not a hand-back.
        let waiting = NOTICE.replace("finished", "is waiting on its own background work");
        feed(
            &mut acc,
            &queued("2026-11-15T06:40:00.000Z", "enqueue", &waiting),
        );
        assert_eq!(acc.sub_agents[0].status, SubAgentStatus::Running);

        // A fresh hand-back carries a new result, so its text differs.
        let second = NOTICE.replace("</summary>", "</summary>\\n<result>Ready: PR #1</result>");
        feed(
            &mut acc,
            &queued("2026-11-15T06:50:00.000Z", "enqueue", &second),
        );
        let a = &acc.sub_agents[0];
        assert_eq!(a.status, SubAgentStatus::Complete);
        assert_eq!(
            a.completed_at,
            parse_timestamp_to_unix("2026-11-15T06:50:00.000Z")
        );
    }

    #[test]
    fn notice_for_a_background_command_changes_no_helper() {
        let mut acc = SessionAccumulator::new();
        spawn_and_launch(&mut acc);
        let bash = NOTICE.replace("a5ac2a04b0b24c9a8", "b9ehe4d60");
        feed(
            &mut acc,
            &queued("2026-11-15T06:19:46.000Z", "enqueue", &bash),
        );
        assert_eq!(acc.sub_agents[0].status, SubAgentStatus::Running);
    }
}
