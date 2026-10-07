//! GitHub sign-in for one user, shared by the desktop app and the
//! `nexus-keyring` helper (both include this file).
//!
//! Each person approves Nexus with their own GitHub account using the device
//! flow: Nexus shows a short code, they approve it on github.com. Only the
//! GitHub App's public client ID is needed. There is no client secret, and the
//! tokens stay in the user's own OS keychain.

use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

pub const DEVICE_CODE_URL: &str = "https://github.com/login/device/code";
pub const TOKEN_URL: &str = "https://github.com/login/oauth/access_token";
const DEVICE_GRANT: &str = "urn:ietf:params:oauth:grant-type:device_code";
/// Refresh this long before the access token actually expires.
const REFRESH_MARGIN_SECS: u64 = 120;

/// The public client ID of the Nexus GitHub App. A runtime
/// `NEXUS_GITHUB_CLIENT_ID` wins over one baked in at build time. `None` means
/// this build is not set up for GitHub.
pub fn client_id() -> Option<String> {
    std::env::var("NEXUS_GITHUB_CLIENT_ID")
        .ok()
        .or_else(|| option_env!("NEXUS_GITHUB_CLIENT_ID").map(str::to_string))
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// The Nexus GitHub App's public slug, used to link to its install page.
pub fn app_slug() -> Option<String> {
    std::env::var("NEXUS_GITHUB_APP_SLUG")
        .ok()
        .or_else(|| option_env!("NEXUS_GITHUB_APP_SLUG").map(str::to_string))
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

pub fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Tokens {
    pub access_token: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refresh_token: Option<String>,
    /// Unix seconds. `None` when the app's tokens do not expire.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<u64>,
}

impl Tokens {
    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_default()
    }
    pub fn from_json(raw: &str) -> Option<Tokens> {
        serde_json::from_str(raw).ok()
    }
    pub fn needs_refresh(&self, now: u64) -> bool {
        match (self.expires_at, &self.refresh_token) {
            (Some(at), Some(_)) => now + REFRESH_MARGIN_SECS >= at,
            _ => false,
        }
    }
}

#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct DeviceStart {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Debug, PartialEq)]
pub enum Poll {
    Pending,
    SlowDown,
    Expired,
    Denied,
    Done(Tokens),
}

#[derive(Deserialize)]
struct DeviceStartResponse {
    device_code: Option<String>,
    user_code: Option<String>,
    verification_uri: Option<String>,
    expires_in: Option<u64>,
    interval: Option<u64>,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: Option<String>,
    refresh_token: Option<String>,
    expires_in: Option<u64>,
    error: Option<String>,
}

pub fn parse_device_start(text: &str) -> Result<DeviceStart, String> {
    let parsed: DeviceStartResponse = serde_json::from_str(text).map_err(|_| "GitHub returned something unexpected. Try again in a moment.".to_string())?;
    match (parsed.device_code, parsed.user_code, parsed.verification_uri) {
        (Some(device_code), Some(user_code), Some(verification_uri)) => Ok(DeviceStart {
            device_code,
            user_code,
            verification_uri,
            expires_in: parsed.expires_in.unwrap_or(900),
            interval: parsed.interval.unwrap_or(5).max(1),
        }),
        _ => Err("GitHub did not start the sign-in. Check that device flow is turned on for the Nexus GitHub App.".to_string()),
    }
}

/// Turn a token-endpoint answer into a poll result. GitHub reports "not yet"
/// and "denied" as normal 200 answers with an `error` field.
pub fn parse_token_response(text: &str, now: u64) -> Result<Poll, String> {
    let parsed: TokenResponse = serde_json::from_str(text).map_err(|_| "GitHub returned something unexpected. Try again in a moment.".to_string())?;
    if let Some(token) = parsed.access_token.filter(|token| !token.is_empty()) {
        return Ok(Poll::Done(Tokens {
            access_token: token,
            refresh_token: parsed.refresh_token,
            expires_at: parsed.expires_in.map(|seconds| now + seconds),
        }));
    }
    match parsed.error.as_deref() {
        Some("authorization_pending") => Ok(Poll::Pending),
        Some("slow_down") => Ok(Poll::SlowDown),
        Some("expired_token") => Ok(Poll::Expired),
        Some("access_denied") => Ok(Poll::Denied),
        Some("incorrect_client_credentials") | Some("unauthorized_client") => Err("The Nexus GitHub App is not set up correctly. Check its client ID and that device flow is on.".to_string()),
        _ => Err("GitHub did not complete the sign-in. Try connecting again.".to_string()),
    }
}

fn post_form(url: &str, form: &[(&str, &str)]) -> Result<String, String> {
    ureq::post(url)
        .header("Accept", "application/json")
        .header("User-Agent", "Nexus-Guard")
        .send_form(form.iter().copied())
        .map_err(|_| "Could not reach GitHub. Check your network connection, then try again.".to_string())?
        .into_body()
        .read_to_string()
        .map_err(|_| "GitHub returned something unexpected. Try again in a moment.".to_string())
}

pub fn start(client_id: &str) -> Result<DeviceStart, String> {
    parse_device_start(&post_form(DEVICE_CODE_URL, &[("client_id", client_id)])?)
}

pub fn poll(client_id: &str, device_code: &str) -> Result<Poll, String> {
    let text = post_form(TOKEN_URL, &[("client_id", client_id), ("device_code", device_code), ("grant_type", DEVICE_GRANT)])?;
    parse_token_response(&text, now_secs())
}

/// Trade a refresh token for new tokens. Tokens from device flow need no client secret.
pub fn refresh(client_id: &str, refresh_token: &str) -> Result<Tokens, String> {
    let text = post_form(TOKEN_URL, &[("client_id", client_id), ("grant_type", "refresh_token"), ("refresh_token", refresh_token)])?;
    match parse_token_response(&text, now_secs())? {
        Poll::Done(mut tokens) => {
            // GitHub rotates the refresh token; keep the old one only if none came back.
            if tokens.refresh_token.is_none() {
                tokens.refresh_token = Some(refresh_token.to_string());
            }
            Ok(tokens)
        }
        _ => Err("GitHub did not renew the sign-in. Connect GitHub again.".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn device_start_needs_all_three_fields() {
        let ok = parse_device_start(r#"{"device_code":"d","user_code":"ABCD-1234","verification_uri":"https://github.com/login/device","expires_in":900,"interval":5}"#).unwrap();
        assert_eq!(ok.user_code, "ABCD-1234");
        assert_eq!(ok.interval, 5);
        assert!(parse_device_start(r#"{"error":"device_flow_disabled"}"#).is_err());
        assert!(parse_device_start("not json").is_err());
    }

    #[test]
    fn token_answers_map_to_poll_states() {
        assert_eq!(parse_token_response(r#"{"error":"authorization_pending"}"#, 0).unwrap(), Poll::Pending);
        assert_eq!(parse_token_response(r#"{"error":"slow_down"}"#, 0).unwrap(), Poll::SlowDown);
        assert_eq!(parse_token_response(r#"{"error":"expired_token"}"#, 0).unwrap(), Poll::Expired);
        assert_eq!(parse_token_response(r#"{"error":"access_denied"}"#, 0).unwrap(), Poll::Denied);
        assert!(parse_token_response(r#"{"error":"incorrect_client_credentials"}"#, 0).is_err());
        let done = parse_token_response(r#"{"access_token":"ghu_x","refresh_token":"ghr_y","expires_in":28800}"#, 1000).unwrap();
        assert_eq!(done, Poll::Done(Tokens { access_token: "ghu_x".into(), refresh_token: Some("ghr_y".into()), expires_at: Some(29800) }));
    }

    #[test]
    fn tokens_that_never_expire_have_no_deadline_and_no_refresh() {
        let done = parse_token_response(r#"{"access_token":"ghu_x"}"#, 1000).unwrap();
        let Poll::Done(tokens) = done else { panic!("expected tokens") };
        assert_eq!(tokens.expires_at, None);
        assert!(!tokens.needs_refresh(u64::MAX / 2));
    }

    #[test]
    fn refresh_happens_shortly_before_expiry_only_with_a_refresh_token() {
        let t = Tokens { access_token: "a".into(), refresh_token: Some("r".into()), expires_at: Some(10_000) };
        assert!(!t.needs_refresh(5_000));
        assert!(t.needs_refresh(9_900));
        assert!(t.needs_refresh(20_000));
        assert!(!Tokens { refresh_token: None, ..t }.needs_refresh(20_000));
    }

    #[test]
    fn stored_json_uses_the_field_names_the_server_reads() {
        let json = Tokens { access_token: "ghu_x".into(), refresh_token: Some("ghr_y".into()), expires_at: Some(5) }.to_json();
        assert!(json.contains("\"accessToken\":\"ghu_x\""));
        assert_eq!(Tokens::from_json(&json).unwrap().access_token, "ghu_x");
        assert!(Tokens::from_json("garbage").is_none());
    }
}
