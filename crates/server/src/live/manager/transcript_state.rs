//! Agent state read from the transcript, for sessions no hook reports on.
//!
//! Upstream sets a live session's `agent_state` only from hook events. With
//! hooks off (`CLAUDE_VIEW_SKIP_HOOKS=1`, how this fork runs) a session found
//! through its `~/.claude/sessions/{pid}.json` kept the default state
//! ("unknown", Needs You) for its whole life, so every live session landed in
//! the Needs You column labelled "Unknown" and the Running column stayed empty.
//!
//! Until a hook reports on a session (`HookFields::agent_state_set_at` stays 0),
//! its state is derived from the transcript's tail, as startup recovery already
//! does, and refreshed on each transcript write and every 30 s. A main turn that
//! has ended while a background helper is still working counts as ongoing
//! ("delegating", Running column), not as waiting for the user.

use std::path::Path;
use std::time::UNIX_EPOCH;

use crate::live::state::{
    status_from_agent_state, AgentState, AgentStateGroup, LiveSession, SessionEvent, SessionStatus,
};

use super::accumulator::derive_tail_from_jsonl;
use super::LiveSessionManager;

/// A helper whose own transcript has not been written for this long is not
/// counted as running (it was stopped without handing back). Generous, since a
/// helper running one long command writes nothing until the command ends.
pub(super) const HELPER_STALE_SECS: i64 = 30 * 60;

/// A helper marked finished this recently still counts as running, to cover
/// the gap before its hand-back line reaches the main transcript. The 30 s
/// refresh settles the session if no line follows.
pub(super) const HANDBACK_GRACE_SECS: i64 = 10;

fn modified_secs(path: &Path) -> Option<i64> {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
}

/// Count the session's helpers still at work, from the
/// `{session}/subagents/agent-*.meta.json` files Claude Code writes beside the
/// transcript: a helper's meta gains `"finished": true` when it hands back.
/// Helpers whose transcript is missing or quiet for `HELPER_STALE_SECS` are
/// left out. `last_message_at`: when the lead's last message line was
/// written (unix seconds), if known; see the hand-back grace below.
pub(super) fn count_running_helpers(
    session_jsonl: &Path,
    now: i64,
    last_message_at: Option<i64>,
) -> usize {
    let dir = session_jsonl.with_extension("").join("subagents");
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return 0;
    };
    let mut running = 0;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(stem) = name
            .to_str()
            .and_then(|n| n.strip_suffix(".meta.json"))
            .filter(|s| s.starts_with("agent-"))
        else {
            continue;
        };
        let finished = std::fs::read_to_string(entry.path())
            .ok()
            .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
            .and_then(|v| v.get("finished").and_then(|f| f.as_bool()))
            .unwrap_or(false);
        if finished {
            // Claude Code marks the helper finished ~70 ms before its
            // hand-back line reaches the main transcript; a read in that gap
            // would show the lead idle (and chime). Keep counting it briefly,
            // but only while its hand-back is still due: the lead's last
            // message predates the finish. A lead that has written since
            // (e.g. ended the turn the hand-back started) is not waiting.
            let finished_at = modified_secs(&entry.path());
            let handback_due = match (finished_at, last_message_at) {
                (Some(f), Some(m)) => m < f,
                _ => true,
            };
            if handback_due && finished_at.is_some_and(|t| now - t <= HANDBACK_GRACE_SECS) {
                running += 1;
            }
            continue;
        }
        let written_at = modified_secs(&dir.join(format!("{stem}.jsonl")));
        if written_at.is_some_and(|t| now - t <= HELPER_STALE_SECS) {
            running += 1;
        }
    }
    running
}

/// What the transcript shows: the state of its last user/assistant line
/// (`None` if none was found near the end) and how many helpers are at work.
#[derive(Debug, Clone)]
pub(super) struct TranscriptReading {
    pub tail: Option<AgentState>,
    pub running_helpers: usize,
}

/// Combine the transcript reading with the session's current state. `None` =
/// keep the current state: no user/assistant line was found (e.g. a burst of
/// bookkeeping lines while the model works), so the transcript can't tell.
/// Only the "unknown" default is then replaced, by idle.
pub(super) fn transcript_agent_state(
    reading: &TranscriptReading,
    current: &AgentState,
) -> Option<AgentState> {
    let tail = match &reading.tail {
        Some(t) => t.clone(),
        None if current.state == "unknown" => AgentState {
            group: AgentStateGroup::NeedsYou,
            state: "idle".into(),
            label: "Waiting for your next prompt".into(),
            context: None,
        },
        None => return None,
    };
    let running_helpers = reading.running_helpers;
    // Only a turn that has simply ended counts as delegating: a question, a
    // plan for review or an interrupt still waits for the user.
    if tail.state == "idle" && running_helpers > 0 {
        return Some(AgentState {
            group: AgentStateGroup::Autonomous,
            state: "delegating".into(),
            label: if running_helpers == 1 {
                "Waiting on a background helper".into()
            } else {
                format!("Waiting on {running_helpers} background helpers")
            },
            context: None,
        });
    }
    Some(tail)
}

/// Whether the session's state should come from its transcript: live, and no
/// hook has reported on it.
pub(super) fn wants_transcript_state(session: &LiveSession) -> bool {
    session.status != SessionStatus::Done
        && session.hook.agent_state_set_at == 0
        && !session.jsonl.file_path.is_empty()
}

/// Apply a transcript reading. Returns true if anything changed.
pub(super) fn apply_transcript_state(
    session: &mut LiveSession,
    reading: &TranscriptReading,
) -> bool {
    if !wants_transcript_state(session) {
        return false;
    }
    let current = &session.hook.agent_state;
    let Some(derived) = transcript_agent_state(reading, current) else {
        return false;
    };
    if current.group == derived.group
        && current.state == derived.state
        && current.label == derived.label
    {
        return false;
    }
    session.status = status_from_agent_state(&derived);
    session.hook.current_activity = derived.label.clone();
    session.hook.agent_state = derived;
    true
}

/// Read the transcript at `path` and work out the session's state.
pub(super) async fn derive_transcript_state(path: &Path) -> TranscriptReading {
    let found = derive_tail_from_jsonl(path).await;
    let last_message_at = found.as_ref().and_then(|(_, at)| *at);
    let tail = found.map(|(state, _)| state);
    let path = path.to_path_buf();
    let now = super::helpers::unix_now();
    let running_helpers =
        tokio::task::spawn_blocking(move || count_running_helpers(&path, now, last_message_at))
            .await
            .unwrap_or(0);
    TranscriptReading {
        tail,
        running_helpers,
    }
}

impl LiveSessionManager {
    /// Refresh the transcript-derived state of one session (by map key) and
    /// broadcast it if it changed. No-op for sessions a hook reports on.
    pub(super) async fn refresh_transcript_state(&self, map_key: &str) {
        let path = {
            let sessions = self.sessions.read().await;
            match sessions.get(map_key) {
                Some(s) if wants_transcript_state(s) => s.jsonl.file_path.clone(),
                _ => return,
            }
        };
        let derived = derive_transcript_state(Path::new(&path)).await;
        let snapshot = {
            let mut sessions = self.sessions.write().await;
            let Some(s) = sessions.get_mut(map_key) else {
                return;
            };
            if !apply_transcript_state(s, &derived) {
                return;
            }
            s.clone()
        };
        let _ = self
            .tx
            .send(SessionEvent::SessionUpsert { session: snapshot });
    }

    /// Refresh every session that gets its state from its transcript.
    pub(super) async fn refresh_all_transcript_states(&self) {
        let keys: Vec<String> = {
            let sessions = self.sessions.read().await;
            sessions
                .iter()
                .filter(|(_, s)| wants_transcript_state(s))
                .map(|(k, _)| k.clone())
                .collect()
        };
        for key in keys {
            self.refresh_transcript_state(&key).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::live::state::{HookFields, JsonlFields, StatuslineFields};
    use std::io::Write;

    fn session_with(file_path: &str) -> LiveSession {
        LiveSession {
            id: "s1".into(),
            status: SessionStatus::Working,
            started_at: None,
            closed_at: None,
            control: None,
            model: None,
            model_display_name: None,
            model_set_at: 0,
            context_window_tokens: 0,
            statusline: StatuslineFields::default(),
            hook: HookFields::default(),
            jsonl: JsonlFields {
                file_path: file_path.into(),
                ..JsonlFields::default()
            },
            session_kind: None,
            entrypoint: None,
            ownership: None,
            pending_interaction: None,
        }
    }

    /// Main transcript ending like the reported session: the lead's turn ended
    /// (end_turn), then the stop-hook summary and title lines.
    fn write_ended_turn(path: &Path) {
        let mut f = std::fs::File::create(path).unwrap();
        writeln!(f, r#"{{"type":"assistant","message":{{"role":"assistant","content":[{{"type":"text","text":"I'll be woken when the builder reports."}}],"stop_reason":"end_turn"}}}}"#).unwrap();
        writeln!(f, r#"{{"type":"system","subtype":"stop_hook_summary","timestamp":"2026-11-15T08:26:12.581Z"}}"#).unwrap();
        writeln!(f, r#"{{"type":"custom-title","customTitle":"Lead"}}"#).unwrap();
    }

    /// Writes a helper's meta and transcript. A finished meta is dated a
    /// minute back (past the hand-back grace) unless `fresh_finish`.
    fn write_helper_at(dir: &Path, id: &str, meta: &str, fresh_finish: bool) {
        std::fs::create_dir_all(dir).unwrap();
        let meta_path = dir.join(format!("agent-{id}.meta.json"));
        std::fs::write(&meta_path, meta).unwrap();
        std::fs::write(dir.join(format!("agent-{id}.jsonl")), "{}\n").unwrap();
        if meta.contains("\"finished\":true") && !fresh_finish {
            let past = std::time::SystemTime::now() - std::time::Duration::from_secs(60);
            std::fs::File::options()
                .write(true)
                .open(&meta_path)
                .unwrap()
                .set_modified(past)
                .unwrap();
        }
    }

    fn write_helper(dir: &Path, id: &str, meta: &str) {
        write_helper_at(dir, id, meta, false);
    }

    fn now() -> i64 {
        super::super::helpers::unix_now()
    }

    #[test]
    fn just_finished_helper_counts_during_handback_grace() {
        let tmp = tempfile::tempdir().unwrap();
        let jsonl = tmp.path().join("sess.jsonl");
        let sub = tmp.path().join("sess").join("subagents");
        write_helper_at(
            &sub,
            "a1",
            r#"{"agentType":"builder","finished":true}"#,
            true,
        );
        // Lead's last message older than the finish: hand-back still due.
        assert_eq!(count_running_helpers(&jsonl, now(), Some(now() - 30)), 1);
        assert_eq!(count_running_helpers(&jsonl, now(), None), 1);
        assert_eq!(
            count_running_helpers(&jsonl, now() + HANDBACK_GRACE_SECS + 2, None),
            0
        );
        // Lead wrote after the finish (ended the hand-back turn): not waiting.
        assert_eq!(count_running_helpers(&jsonl, now(), Some(now() + 1)), 0);
    }

    /// The lead ends its turn within seconds of a helper finishing (the turn
    /// the hand-back started): Needs You at once, not "Waiting on a
    /// background helper" until the next 30 s refresh.
    #[tokio::test]
    async fn turn_ended_after_helper_finished_is_not_delegating() {
        let tmp = tempfile::tempdir().unwrap();
        let jsonl = tmp.path().join("sess.jsonl");
        let sub = tmp.path().join("sess").join("subagents");
        write_helper_at(
            &sub,
            "a1",
            r#"{"agentType":"builder","finished":true}"#,
            true,
        );
        let later = chrono::Utc::now() + chrono::Duration::seconds(2);
        let ts = later.to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let mut f = std::fs::File::create(&jsonl).unwrap();
        writeln!(f, r#"{{"type":"assistant","timestamp":"{ts}","message":{{"role":"assistant","content":[{{"type":"text","text":"Merged."}}],"stop_reason":"end_turn"}}}}"#).unwrap();
        f.flush().unwrap();

        let r = derive_transcript_state(&jsonl).await;
        assert_eq!(r.running_helpers, 0);
        let s = transcript_agent_state(&r, &unknown()).unwrap();
        assert_eq!(s.group, AgentStateGroup::NeedsYou);
        assert_eq!(s.state, "idle");
    }

    /// Order Claude Code writes a hand-back in (seen 3 times in the reported
    /// session): enqueue line, meta `finished`, dequeue, then the hand-back
    /// user line ~70 ms later. A transcript write handled in that gap must
    /// not drop the lead into Needs You.
    #[tokio::test]
    async fn handback_gap_does_not_drop_lead_into_needs_you() {
        let tmp = tempfile::tempdir().unwrap();
        let jsonl = tmp.path().join("sess.jsonl");
        write_ended_turn(&jsonl);
        let sub = tmp.path().join("sess").join("subagents");
        write_helper(&sub, "a1", r#"{"agentType":"builder"}"#);
        let (manager, _rx) = manager_with_session(&jsonl).await;
        manager.process_jsonl_update(&jsonl).await;
        let group = |m: &std::sync::Arc<LiveSessionManager>| {
            let m = m.clone();
            async move {
                m.sessions
                    .read()
                    .await
                    .get("sess")
                    .unwrap()
                    .hook
                    .agent_state
                    .group
                    .clone()
            }
        };
        assert_eq!(group(&manager).await, AgentStateGroup::Autonomous);

        let mut f = std::fs::OpenOptions::new()
            .append(true)
            .open(&jsonl)
            .unwrap();
        writeln!(f, r#"{{"type":"queue-operation","operation":"enqueue","content":"<agent-message from=\"a1\">"}}"#).unwrap();
        f.flush().unwrap();
        write_helper_at(
            &sub,
            "a1",
            r#"{"agentType":"builder","finished":true}"#,
            true,
        );
        writeln!(f, r#"{{"type":"queue-operation","operation":"dequeue"}}"#).unwrap();
        f.flush().unwrap();
        manager.process_jsonl_update(&jsonl).await;
        assert_eq!(group(&manager).await, AgentStateGroup::Autonomous);

        // The hand-back line starts the lead's next turn.
        writeln!(f, r#"{{"type":"user","message":{{"role":"user","content":"Another Claude session sent a message:\n<agent-message from=\"a1\">done</agent-message>"}}}}"#).unwrap();
        f.flush().unwrap();
        manager.process_jsonl_update(&jsonl).await;
        assert_eq!(group(&manager).await, AgentStateGroup::Autonomous);
    }

    #[test]
    fn counts_only_unfinished_helpers() {
        let tmp = tempfile::tempdir().unwrap();
        let jsonl = tmp.path().join("sess.jsonl");
        let sub = tmp.path().join("sess").join("subagents");
        write_helper(&sub, "a1", r#"{"agentType":"builder","finished":true}"#);
        write_helper(&sub, "a2", r#"{"agentType":"reviewer","finished":true}"#);
        write_helper(
            &sub,
            "a3",
            r#"{"agentType":"builder","requestShape":"background"}"#,
        );
        // Not a helper meta file: ignored.
        std::fs::write(sub.join("agent-a3.prefix.json"), "{}").unwrap();
        assert_eq!(count_running_helpers(&jsonl, now(), None), 1);
    }

    #[test]
    fn helper_quiet_too_long_or_without_transcript_is_not_running() {
        let tmp = tempfile::tempdir().unwrap();
        let jsonl = tmp.path().join("sess.jsonl");
        let sub = tmp.path().join("sess").join("subagents");
        write_helper(&sub, "a1", r#"{"agentType":"builder"}"#);
        std::fs::write(sub.join("agent-a2.meta.json"), r#"{"agentType":"builder"}"#).unwrap();
        // a1's transcript was written "now"; seen from HELPER_STALE_SECS + 60 later it is stale.
        assert_eq!(
            count_running_helpers(&jsonl, now() + HELPER_STALE_SECS + 60, None),
            0
        );
        assert_eq!(count_running_helpers(&jsonl, now(), None), 1);
    }

    #[test]
    fn no_subagents_folder_means_none_running() {
        let tmp = tempfile::tempdir().unwrap();
        assert_eq!(
            count_running_helpers(&tmp.path().join("sess.jsonl"), now(), None),
            0
        );
    }

    fn state(group: AgentStateGroup, state: &str, label: &str) -> AgentState {
        AgentState {
            group,
            state: state.into(),
            label: label.into(),
            context: None,
        }
    }

    fn idle() -> AgentState {
        state(
            AgentStateGroup::NeedsYou,
            "idle",
            "Waiting for your next prompt",
        )
    }

    fn reading(tail: Option<AgentState>, running_helpers: usize) -> TranscriptReading {
        TranscriptReading {
            tail,
            running_helpers,
        }
    }

    fn unknown() -> AgentState {
        HookFields::default().agent_state
    }

    /// Bookkeeping lines current Claude Code writes between a tool result and
    /// the next reply (shapes from a real transcript, contents cut down).
    fn write_bookkeeping_burst(f: &mut std::fs::File, n: usize) {
        let kinds = [
            r#"{"type":"attachment","attachment":{"type":"queued_command","prompt":"x"}}"#,
            r#"{"type":"queue-operation","operation":"enqueue","content":"x"}"#,
            r#"{"type":"api-request-blob","hash":"ab","message":{"role":"system","content":[{"type":"text","text":"x"}]}}"#,
            r#"{"type":"api-request","timestamp":"2026-11-15T08:25:50.680Z"}"#,
            r#"{"type":"last-prompt","lastPrompt":"x"}"#,
            r#"{"type":"custom-title","customTitle":"Lead"}"#,
            r#"{"type":"agent-name","agentName":"lead"}"#,
        ];
        for i in 0..n {
            writeln!(f, "{}", kinds[i % kinds.len()]).unwrap();
        }
    }

    #[test]
    fn ended_turn_with_running_helper_is_ongoing() {
        let s = transcript_agent_state(&reading(Some(idle()), 1), &unknown()).unwrap();
        assert_eq!(s.group, AgentStateGroup::Autonomous);
        assert_eq!(s.state, "delegating");
        assert_eq!(s.label, "Waiting on a background helper");
        assert_eq!(
            transcript_agent_state(&reading(Some(idle()), 3), &unknown())
                .unwrap()
                .label,
            "Waiting on 3 background helpers"
        );
        // No helper: stays waiting for the user.
        assert_eq!(
            transcript_agent_state(&reading(Some(idle()), 0), &unknown())
                .unwrap()
                .group,
            AgentStateGroup::NeedsYou
        );
    }

    #[test]
    fn question_plan_or_interrupt_wait_for_user_even_with_helper() {
        for st in ["awaiting_input", "awaiting_approval", "interrupted"] {
            let tail = state(AgentStateGroup::NeedsYou, st, "x");
            let s = transcript_agent_state(&reading(Some(tail), 2), &unknown()).unwrap();
            assert_eq!(s.group, AgentStateGroup::NeedsYou, "{st}");
            assert_eq!(s.state, st);
        }
    }

    #[test]
    fn no_message_line_keeps_current_state() {
        let acting = state(AgentStateGroup::Autonomous, "acting", "Using Bash");
        assert!(transcript_agent_state(&reading(None, 0), &acting).is_none());
        // Only the "unknown" default is replaced, by idle (or delegating).
        assert_eq!(
            transcript_agent_state(&reading(None, 0), &unknown())
                .unwrap()
                .state,
            "idle"
        );
        assert_eq!(
            transcript_agent_state(&reading(None, 1), &unknown())
                .unwrap()
                .state,
            "delegating"
        );
    }

    #[test]
    fn active_turn_keeps_its_own_state() {
        let acting = state(AgentStateGroup::Autonomous, "acting", "Using Bash");
        assert_eq!(
            transcript_agent_state(&reading(Some(acting), 2), &unknown())
                .unwrap()
                .label,
            "Using Bash"
        );
    }

    #[test]
    fn tail_lines_map_question_plan_and_interrupt_to_needs_you() {
        use super::super::accumulator::agent_state_from_tail_lines;
        let ask = r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"AskUserQuestion","input":{}}],"stop_reason":"tool_use"}}"#;
        let plan = r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"t2","name":"ExitPlanMode","input":{}}],"stop_reason":"tool_use"}}"#;
        // Real shape of an interrupt line (audiobookapp transcript, 2026-11-07).
        let interrupt = r#"{"type":"user","message":{"role":"user","content":[{"type":"text","text":"[Request interrupted by user]"}]}}"#;
        // Real shape: a text block, not a tool_result.
        let interrupt_tool = r#"{"type":"user","message":{"role":"user","content":[{"type":"text","text":"[Request interrupted by user for tool use]"}]}}"#;
        let bash = r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"t4","name":"Bash","input":{}}],"stop_reason":"tool_use"}}"#;

        let get = |l: &str| agent_state_from_tail_lines(&[l.to_string()]).unwrap();
        assert_eq!(get(ask).group, AgentStateGroup::NeedsYou);
        assert_eq!(get(ask).state, "awaiting_input");
        assert_eq!(get(plan).group, AgentStateGroup::NeedsYou);
        assert_eq!(get(plan).state, "awaiting_approval");
        assert_eq!(get(interrupt).group, AgentStateGroup::NeedsYou);
        assert_eq!(get(interrupt).state, "interrupted");
        assert_eq!(get(interrupt_tool).state, "interrupted");
        // Any other tool (a permission prompt can't be told apart): acting.
        assert_eq!(get(bash).group, AgentStateGroup::Autonomous);
        assert_eq!(get(bash).label, "Using Bash");
    }

    /// Local slash commands get no reply from the model: still waiting.
    /// Shapes from real transcripts (/context in a desktop-app session,
    /// /compact), contents cut down.
    #[test]
    fn local_slash_commands_read_as_waiting() {
        use super::super::accumulator::agent_state_from_tail_lines;
        let caveat = r#"{"type":"user","isMeta":true,"message":{"role":"user","content":"<local-command-caveat>The command below was run directly in Claude Code</local-command-caveat>"}}"#;
        let context_cmd = r#"{"type":"user","message":{"role":"user","content":"<command-name>/context</command-name>\n            <command-message>context</command-message>\n            <command-args></command-args>"}}"#;
        let context_out = r#"{"type":"system","subtype":"local_command","content":"<local-command-stdout>## Context Usage</local-command-stdout>","level":"info"}"#;
        let title = r#"{"type":"custom-title","customTitle":"Boop"}"#;
        let compact_cmd = r#"{"type":"user","message":{"role":"user","content":"<command-name>/compact</command-name>\n            <command-message>compact</command-message>"}}"#;
        let compact_out = r#"{"type":"user","message":{"role":"user","content":"<local-command-stdout>Compacted </local-command-stdout>"}}"#;
        let lines = |ls: &[&str]| ls.iter().map(|s| s.to_string()).collect::<Vec<_>>();

        let s = agent_state_from_tail_lines(&lines(&[caveat, context_cmd, context_out, title]))
            .unwrap();
        assert_eq!(s.group, AgentStateGroup::NeedsYou);
        assert_eq!(s.state, "idle");
        let s = agent_state_from_tail_lines(&lines(&[caveat, compact_cmd, compact_out])).unwrap();
        assert_eq!(s.group, AgentStateGroup::NeedsYou);
        // A prompt command (skill) also writes <command-name> but gets a reply:
        // without the local_command output it reads as working.
        let s = agent_state_from_tail_lines(&lines(&[context_cmd])).unwrap();
        assert_eq!(s.group, AgentStateGroup::Autonomous);
    }

    /// Tool output that prints a local command's output or the interrupt
    /// phrase is still a tool result: the turn goes on. (Real case: a Bash
    /// result printing another transcript's /context output, 2026-11-06.)
    #[test]
    fn tool_result_text_is_not_read_as_local_command_or_interrupt() {
        use super::super::accumulator::agent_state_from_tail_lines;
        let printed_context = r##"{"type":"user","message":{"role":"user","content":[{"tool_use_id":"t1","type":"tool_result","content":"<local-command-stdout>## Context Usage\n","is_error":false}]}}"##;
        let printed_blocks = r#"{"type":"user","message":{"role":"user","content":[{"tool_use_id":"t2","type":"tool_result","content":[{"type":"text","text":"[Request interrupted by user]"}]}]}}"#;
        for line in [printed_context, printed_blocks] {
            let s = agent_state_from_tail_lines(&[line.to_string()]).unwrap();
            assert_eq!(s.group, AgentStateGroup::Autonomous, "{line}");
            assert_eq!(s.state, "thinking");
        }
    }

    #[test]
    fn line_quoting_the_interrupt_phrase_is_not_an_interrupt() {
        use super::super::accumulator::agent_state_from_tail_lines;
        // A hand-back that quotes the phrase (real case, 2026-11-15 09:31Z).
        let quoting = r#"{"type":"user","message":{"role":"user","content":"Another Claude session sent a message:\nit showed \"[Request interrupted by user]\" in the log"}}"#;
        let s = agent_state_from_tail_lines(&[quoting.to_string()]).unwrap();
        assert_eq!(s.group, AgentStateGroup::Autonomous);
        assert_eq!(s.state, "thinking");
    }

    #[tokio::test]
    async fn long_bookkeeping_burst_after_tool_result_still_reads_as_working() {
        let tmp = tempfile::tempdir().unwrap();
        let jsonl = tmp.path().join("sess.jsonl");
        let mut f = std::fs::File::create(&jsonl).unwrap();
        writeln!(f, r#"{{"type":"assistant","message":{{"role":"assistant","content":[{{"type":"tool_use","id":"x","name":"Bash","input":{{}}}}],"stop_reason":"tool_use"}}}}"#).unwrap();
        writeln!(f, r#"{{"type":"user","message":{{"role":"user","content":[{{"type":"tool_result","tool_use_id":"x","content":"ok"}}]}}}}"#).unwrap();
        write_bookkeeping_burst(&mut f, 25);
        f.flush().unwrap();

        let r = derive_transcript_state(&jsonl).await;
        let tail = r.tail.expect("reads back past the burst");
        assert_eq!(tail.group, AgentStateGroup::Autonomous);
        assert_eq!(tail.state, "thinking");
    }

    #[tokio::test]
    async fn reported_session_shape_derives_delegating() {
        let tmp = tempfile::tempdir().unwrap();
        let jsonl = tmp.path().join("sess.jsonl");
        write_ended_turn(&jsonl);
        let sub = tmp.path().join("sess").join("subagents");
        write_helper(&sub, "a1", r#"{"agentType":"reviewer","finished":true}"#);
        write_helper(
            &sub,
            "a2",
            r#"{"agentType":"builder","requestShape":"background"}"#,
        );

        let r = derive_transcript_state(&jsonl).await;
        let derived = transcript_agent_state(&r, &unknown()).unwrap();
        assert_eq!(derived.group, AgentStateGroup::Autonomous);
        assert_eq!(derived.state, "delegating");

        // Once the helper hands back, the session waits for the user again.
        write_helper(&sub, "a2", r#"{"agentType":"builder","finished":true}"#);
        let r = derive_transcript_state(&jsonl).await;
        let derived = transcript_agent_state(&r, &unknown()).unwrap();
        assert_eq!(derived.group, AgentStateGroup::NeedsYou);
        assert_eq!(derived.state, "idle");
    }

    #[test]
    fn apply_replaces_unknown_default_and_sets_status() {
        let mut s = session_with("/tmp/x.jsonl");
        assert_eq!(s.hook.agent_state.state, "unknown");
        let r = reading(None, 1);
        assert!(apply_transcript_state(&mut s, &r));
        assert_eq!(s.hook.agent_state.group, AgentStateGroup::Autonomous);
        assert_eq!(s.status, SessionStatus::Working);
        assert_eq!(s.hook.current_activity, "Waiting on a background helper");
        // Same state again: no change reported.
        assert!(!apply_transcript_state(&mut s, &r));
        // Turn ended, no helper: Needs You, paused.
        assert!(apply_transcript_state(&mut s, &reading(Some(idle()), 0)));
        assert_eq!(s.status, SessionStatus::Paused);
        // No message line found: keep what we had.
        assert!(!apply_transcript_state(&mut s, &reading(None, 0)));
        assert_eq!(s.hook.agent_state.state, "idle");
    }

    #[test]
    fn apply_leaves_hook_reported_and_closed_sessions_alone() {
        let mut hooked = session_with("/tmp/x.jsonl");
        hooked.hook.agent_state_set_at = 42;
        assert!(!apply_transcript_state(&mut hooked, &reading(None, 1)));
        assert_eq!(hooked.hook.agent_state.state, "unknown");

        let mut done = session_with("/tmp/x.jsonl");
        done.status = SessionStatus::Done;
        assert!(!apply_transcript_state(&mut done, &reading(None, 1)));

        let mut no_file = session_with("");
        assert!(!apply_transcript_state(&mut no_file, &reading(None, 1)));
    }

    async fn manager_with_session(
        jsonl: &Path,
    ) -> (
        std::sync::Arc<LiveSessionManager>,
        tokio::sync::broadcast::Receiver<SessionEvent>,
    ) {
        let (manager, rx, _snap) = super::super::reaper::tests::make_test_manager().await;
        let id = jsonl.file_stem().unwrap().to_str().unwrap().to_string();
        let mut s = session_with(jsonl.to_str().unwrap());
        s.id = id.clone();
        manager.sessions.write().await.insert(id, s);
        (manager, rx)
    }

    #[tokio::test]
    async fn refresh_updates_and_broadcasts_hookless_session() {
        let tmp = tempfile::tempdir().unwrap();
        let jsonl = tmp.path().join("sess.jsonl");
        write_ended_turn(&jsonl);
        write_helper(
            &tmp.path().join("sess").join("subagents"),
            "a1",
            r#"{"agentType":"builder"}"#,
        );
        let (manager, mut rx) = manager_with_session(&jsonl).await;

        manager.refresh_all_transcript_states().await;

        let s = manager.sessions.read().await.get("sess").cloned().unwrap();
        assert_eq!(s.hook.agent_state.state, "delegating");
        assert_eq!(s.hook.agent_state.group, AgentStateGroup::Autonomous);
        assert!(matches!(
            rx.try_recv(),
            Ok(SessionEvent::SessionUpsert { .. })
        ));
    }

    /// The main path: each transcript write (`process_jsonl_update`) re-reads
    /// the state. Writes: a tool result (working), a long bookkeeping burst
    /// (still working, no flip to Needs You), then the reply ending the turn.
    #[tokio::test]
    async fn transcript_writes_update_hookless_session_without_flapping() {
        let tmp = tempfile::tempdir().unwrap();
        let jsonl = tmp.path().join("sess.jsonl");
        let mut f = std::fs::File::create(&jsonl).unwrap();
        writeln!(f, r#"{{"type":"user","message":{{"role":"user","content":[{{"type":"tool_result","tool_use_id":"x","content":"ok"}}]}}}}"#).unwrap();
        f.flush().unwrap();
        let (manager, _rx) = manager_with_session(&jsonl).await;
        let state_now = || async {
            manager
                .sessions
                .read()
                .await
                .get("sess")
                .unwrap()
                .hook
                .agent_state
                .clone()
        };

        manager.process_jsonl_update(&jsonl).await;
        let s = state_now().await;
        assert_eq!(s.group, AgentStateGroup::Autonomous);
        assert_eq!(s.state, "thinking");

        write_bookkeeping_burst(&mut f, 25);
        f.flush().unwrap();
        manager.process_jsonl_update(&jsonl).await;
        assert_eq!(state_now().await.group, AgentStateGroup::Autonomous);

        writeln!(f, r#"{{"type":"assistant","message":{{"role":"assistant","content":[{{"type":"text","text":"Done."}}],"stop_reason":"end_turn"}}}}"#).unwrap();
        f.flush().unwrap();
        manager.process_jsonl_update(&jsonl).await;
        let s = state_now().await;
        assert_eq!(s.group, AgentStateGroup::NeedsYou);
        assert_eq!(s.state, "idle");
    }
}
