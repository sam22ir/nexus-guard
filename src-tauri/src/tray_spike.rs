// Nexus Guard — tray quick-approve SPIKE (NOT WIRED).
//
// Scope: this file is intentionally standalone. It is NOT referenced from
// `lib.rs` / `main.rs` so parallel tracks keep building. `cargo check` must
// pass with zero changes to the existing build.
//
// What this file proves:
//   1. The quick-approve data model (project + env + plain summary,
//      view-details link, expiry) compiles against the deps this repo
//      already has (serde only — no new plugins required for the model).
//   2. The expire=deny rule is pure logic and unit-tested here.
//   3. The OS tray + notification wiring is a COMMENTED sketch below
//      (section 4). It names the exact Cargo / capability additions needed
//      so a future track can wire it without guessing.
//
// Reference (read-only): `src/App.tsx` vault popup pattern uses HeroUI
// `Modal.Backdrop > Modal.Container > Modal.Dialog > Header/Body` with an
// `onClose` -> `setModal(null)` close path, and `invoke("...")` Tauri
// commands with camelCase args. The quick-approve popup should mirror that
// pattern (title = project+env, body = plain summary, explicit approve/deny,
// close == deny on expiry).

use serde::{Deserialize, Serialize};

/// Default expiry for a quick-approve request (Notion §6: expire=deny).
pub const QUICK_APPROVE_TTL_SECS: u64 = 60;

/// Minimal quick-approve payload. Plain summary only — never secrets.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct QuickApproveRequest {
    /// Stable request id (audit key).
    pub id: String,
    /// Display project name, e.g. "Koupa".
    pub project: String,
    /// Environment, e.g. "production" | "development".
    pub environment: String,
    /// One plain-language sentence, e.g. "Agent asks to list Supabase tables".
    pub summary: String,
    /// Deep link / route for view-details, e.g. "nexus://approvals/<id>".
    pub details_url: String,
    /// Unix epoch seconds when the request was issued.
    pub issued_at_secs: u64,
    /// TTL in seconds (defaults to [`QUICK_APPROVE_TTL_SECS`]).
    pub ttl_secs: u64,
}

impl QuickApproveRequest {
    pub fn new(
        id: impl Into<String>,
        project: impl Into<String>,
        environment: impl Into<String>,
        summary: impl Into<String>,
        details_url: impl Into<String>,
        issued_at_secs: u64,
    ) -> Self {
        Self {
            id: id.into(),
            project: project.into(),
            environment: environment.into(),
            summary: summary.into(),
            details_url: details_url.into(),
            issued_at_secs,
            ttl_secs: QUICK_APPROVE_TTL_SECS,
        }
    }

    /// Seconds remaining at `now_secs`, saturating at 0.
    pub fn remaining_secs(&self, now_secs: u64) -> u64 {
        let deadline = self.issued_at_secs.saturating_add(self.ttl_secs);
        deadline.saturating_sub(now_secs)
    }

    /// True once the deadline has passed. Expired == denied (Notion §6).
    pub fn is_expired(&self, now_secs: u64) -> bool {
        self.remaining_secs(now_secs) == 0
    }

    /// Title line for the popup / notification: project + env only.
    pub fn title_line(&self) -> String {
        format!("{} · {}", self.project, self.environment)
    }
}

/// Server-side verdict on timeout. The ONLY legal outcome of expiry is deny,
/// and it must be audited — never silently dropped.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TimeoutVerdict {
    Deny,
}

pub fn resolve_on_timeout(request: &QuickApproveRequest, now_secs: u64) -> Option<TimeoutVerdict> {
    if request.is_expired(now_secs) {
        Some(TimeoutVerdict::Deny)
    } else {
        None
    }
}

#[cfg(test)]
mod spike_tests {
    use super::*;

    fn fixture() -> QuickApproveRequest {
        QuickApproveRequest::new(
            "req-1",
            "Koupa",
            "development",
            "Agent asks to list Supabase tables on koupa-development.",
            "nexus://approvals/req-1",
            1_000,
        )
    }

    #[test]
    fn title_shows_project_and_env() {
        assert_eq!(fixture().title_line(), "Koupa · development");
    }

    #[test]
    fn expiry_is_deny_not_drop() {
        let req = fixture();
        assert_eq!(resolve_on_timeout(&req, 1_000 + 59), None);
        assert_eq!(
            resolve_on_timeout(&req, 1_000 + 60),
            Some(TimeoutVerdict::Deny)
        );
    }

    #[test]
    fn summary_carries_no_secret_markers() {
        let req = fixture();
        for marker in ["sk-", "sb_secret", "accessToken", "refreshToken"] {
            assert!(
                !req.summary.contains(marker),
                "summary must stay plain-language"
            );
        }
    }
}

// ---------------------------------------------------------------------------
// 4. WIRED SKETCH (COMMENTED — do not uncomment until the deps below land).
// ---------------------------------------------------------------------------
//
// Required additions before wiring:
//
//   Cargo.toml:
//     tauri = { version = "2", features = ["tray-icon"] }
//     tauri-plugin-notification = "2"
//
//   src-tauri/capabilities/default.json permissions +=
//     [ "notification:default", "notification:allow-notify",
//       "notification:allow-request-permission" ]
//
//   lib.rs run():
//     .plugin(tauri_plugin_notification::init())
//     .setup(|app| { crate::tray_spike::setup_quick_approve_tray(app)?; Ok(()) })
//     .on_tray_icon_event(|app, event| crate::tray_spike::on_tray_event(app, event))
//
// Sketch (Tauri 2 API, verify against docs at wiring time):
//
// ```ignore
// use tauri::{tray::{MouseButton, TrayIconBuilder, TrayIconEvent}, App, Manager};
// use tauri_plugin_notification::NotificationExt;
//
// pub fn setup_quick_approve_tray(app: &mut App) -> tauri::Result<()> {
//     // Tray icon alone is NOT the approval channel (Notion §6 open risk):
//     // GNOME/KDE/Wayland may hide it. The OS notification below is required.
//     let _tray = TrayIconBuilder::with_id("nexus-quick-approve")
//         .icon(app.default_window_icon().cloned().expect("app icon"))
//         .tooltip("Nexus Guard — no pending approvals")
//         .menu_on_left_click(false)
//         .build(app)?;
//     Ok(())
// }
//
// pub fn notify_quick_approve(app: &App, req: &QuickApproveRequest) -> tauri::Result<()> {
//     // Actionable OS notification: title = project+env, body = plain summary.
//     // Clicking it must focus the app on the view-details route (req.details_url),
//     // never approve inline: approval happens only in the popup / Home pending list.
//     app.notification()
//         .builder()
//         .title(req.title_line())
//         .body(format!("{} — expires in {}s (expires = denied).", req.summary, req.ttl_secs))
//         .show()?;
//     // Also update the tray tooltip to "N pending" — cosmetic only.
//     Ok(())
// }
//
// pub fn on_tray_event(app: &App, event: TrayIconEvent) {
//     // Left click (where the DE delivers it) => show main window + navigate to
//     // the pending-approval view. No approve/deny from the tray menu itself:
//     // verdicts require the full popup context (summary + details link + timer).
//     if let TrayIconEvent::Click { button: MouseButton::Left, .. } = event {
//         if let Some(window) = app.get_webview_window("main") {
//             let _ = window.show();
//             let _ = window.set_focus();
//             let _ = window.emit("nexus:open-pending-approvals", ());
//         }
//     }
// }
// ```
//
// Expire=deny timer (server-side, not in this file): the authority that
// created the request owns a 60s deadline; on timeout it records
// `{ decision: "deny", reason: "expired" }` to the audit log and emits
// `nexus:approval-expired`. The frontend timer is display-only.
