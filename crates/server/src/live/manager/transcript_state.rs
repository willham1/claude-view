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

use super::accumulator::derive_agent_state_from_jsonl;
use super::LiveSessionManager;

/// A helper whose own transcript has not been written for this long is not
/// counted as running (it was stopped without handing back). Generous, since a
/// helper running one long command writes nothing until the command ends.
pub(super) const HELPER_STALE_SECS: i64 = 30 * 60;

/// Count the session's helpers still at work, from the
/// `{session}/subagents/agent-*.meta.json` files Claude Code writes beside the
/// transcript: a helper's meta gains `"finished": true` when it hands back.
/// Helpers whose transcript is missing or quiet for `HELPER_STALE_SECS` are
/// left out.
pub(super) fn count_running_helpers(session_jsonl: &Path, now: i64) -> usize {
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
            continue;
        }
        let written_at = std::fs::metadata(dir.join(format!("{stem}.jsonl")))
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64);
        if written_at.is_some_and(|t| now - t <= HELPER_STALE_SECS) {
            running += 1;
        }
    }
    running
}

/// Combine the transcript tail's state with the running-helper count.
pub(super) fn transcript_agent_state(
    tail: Option<AgentState>,
    running_helpers: usize,
) -> AgentState {
    let tail = tail.unwrap_or_else(|| AgentState {
        group: AgentStateGroup::NeedsYou,
        state: "idle".into(),
        label: "Waiting for your next prompt".into(),
        context: None,
    });
    if tail.group == AgentStateGroup::NeedsYou && running_helpers > 0 {
        return AgentState {
            group: AgentStateGroup::Autonomous,
            state: "delegating".into(),
            label: if running_helpers == 1 {
                "Waiting on a background helper".into()
            } else {
                format!("Waiting on {running_helpers} background helpers")
            },
            context: None,
        };
    }
    tail
}

/// Whether the session's state should come from its transcript: live, and no
/// hook has reported on it.
pub(super) fn wants_transcript_state(session: &LiveSession) -> bool {
    session.status != SessionStatus::Done
        && session.hook.agent_state_set_at == 0
        && !session.jsonl.file_path.is_empty()
}

/// Apply a transcript-derived state. Returns true if anything changed.
pub(super) fn apply_transcript_state(session: &mut LiveSession, derived: AgentState) -> bool {
    if !wants_transcript_state(session) {
        return false;
    }
    let current = &session.hook.agent_state;
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
pub(super) async fn derive_transcript_state(path: &Path) -> AgentState {
    let tail = derive_agent_state_from_jsonl(path).await;
    let path = path.to_path_buf();
    let now = super::helpers::unix_now();
    let helpers = tokio::task::spawn_blocking(move || count_running_helpers(&path, now))
        .await
        .unwrap_or(0);
    transcript_agent_state(tail, helpers)
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
            if !apply_transcript_state(s, derived) {
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

    fn write_helper(dir: &Path, id: &str, meta: &str) {
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(dir.join(format!("agent-{id}.meta.json")), meta).unwrap();
        std::fs::write(dir.join(format!("agent-{id}.jsonl")), "{}\n").unwrap();
    }

    fn now() -> i64 {
        super::super::helpers::unix_now()
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
        assert_eq!(count_running_helpers(&jsonl, now()), 1);
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
            count_running_helpers(&jsonl, now() + HELPER_STALE_SECS + 60),
            0
        );
        assert_eq!(count_running_helpers(&jsonl, now()), 1);
    }

    #[test]
    fn no_subagents_folder_means_none_running() {
        let tmp = tempfile::tempdir().unwrap();
        assert_eq!(
            count_running_helpers(&tmp.path().join("sess.jsonl"), now()),
            0
        );
    }

    #[test]
    fn ended_turn_with_running_helper_is_ongoing() {
        let idle = AgentState {
            group: AgentStateGroup::NeedsYou,
            state: "idle".into(),
            label: "Waiting for your next prompt".into(),
            context: None,
        };
        let s = transcript_agent_state(Some(idle.clone()), 1);
        assert_eq!(s.group, AgentStateGroup::Autonomous);
        assert_eq!(s.state, "delegating");
        assert_eq!(s.label, "Waiting on a background helper");
        assert_eq!(
            transcript_agent_state(Some(idle.clone()), 3).label,
            "Waiting on 3 background helpers"
        );
        // No helper: stays waiting for the user.
        assert_eq!(
            transcript_agent_state(Some(idle), 0).group,
            AgentStateGroup::NeedsYou
        );
        // Empty transcript: idle, not "unknown".
        assert_eq!(transcript_agent_state(None, 0).state, "idle");
    }

    #[test]
    fn active_turn_keeps_its_own_state() {
        let acting = AgentState {
            group: AgentStateGroup::Autonomous,
            state: "acting".into(),
            label: "Using Bash".into(),
            context: None,
        };
        assert_eq!(transcript_agent_state(Some(acting), 2).label, "Using Bash");
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

        let derived = derive_transcript_state(&jsonl).await;
        assert_eq!(derived.group, AgentStateGroup::Autonomous);
        assert_eq!(derived.state, "delegating");

        // Once the helper hands back, the session waits for the user again.
        write_helper(&sub, "a2", r#"{"agentType":"builder","finished":true}"#);
        let derived = derive_transcript_state(&jsonl).await;
        assert_eq!(derived.group, AgentStateGroup::NeedsYou);
        assert_eq!(derived.state, "idle");
    }

    #[test]
    fn apply_replaces_unknown_default_and_sets_status() {
        let mut s = session_with("/tmp/x.jsonl");
        assert_eq!(s.hook.agent_state.state, "unknown");
        let derived = transcript_agent_state(None, 1);
        assert!(apply_transcript_state(&mut s, derived.clone()));
        assert_eq!(s.hook.agent_state.group, AgentStateGroup::Autonomous);
        assert_eq!(s.status, SessionStatus::Working);
        assert_eq!(s.hook.current_activity, "Waiting on a background helper");
        // Same state again: no change reported.
        assert!(!apply_transcript_state(&mut s, derived));
        // Turn ended, no helper: Needs You, paused.
        assert!(apply_transcript_state(
            &mut s,
            transcript_agent_state(None, 0)
        ));
        assert_eq!(s.status, SessionStatus::Paused);
    }

    #[test]
    fn apply_leaves_hook_reported_and_closed_sessions_alone() {
        let mut hooked = session_with("/tmp/x.jsonl");
        hooked.hook.agent_state_set_at = 42;
        assert!(!apply_transcript_state(
            &mut hooked,
            transcript_agent_state(None, 1)
        ));
        assert_eq!(hooked.hook.agent_state.state, "unknown");

        let mut done = session_with("/tmp/x.jsonl");
        done.status = SessionStatus::Done;
        assert!(!apply_transcript_state(
            &mut done,
            transcript_agent_state(None, 1)
        ));

        let mut no_file = session_with("");
        assert!(!apply_transcript_state(
            &mut no_file,
            transcript_agent_state(None, 1)
        ));
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
        let (manager, mut rx, _snap) = super::super::reaper::tests::make_test_manager().await;
        manager
            .sessions
            .write()
            .await
            .insert("s1".into(), session_with(jsonl.to_str().unwrap()));

        manager.refresh_all_transcript_states().await;

        let s = manager.sessions.read().await.get("s1").cloned().unwrap();
        assert_eq!(s.hook.agent_state.state, "delegating");
        assert_eq!(s.hook.agent_state.group, AgentStateGroup::Autonomous);
        assert!(matches!(
            rx.try_recv(),
            Ok(SessionEvent::SessionUpsert { .. })
        ));
    }
}
