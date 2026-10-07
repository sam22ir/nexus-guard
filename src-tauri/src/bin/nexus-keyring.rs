use std::env;

// Shared with the desktop app: GitHub token parsing and refresh.
#[allow(dead_code)]
#[path = "../github_auth.rs"]
mod github_auth;
#[allow(dead_code)]
#[path = "../mcp_oauth.rs"]
mod mcp_oauth;

const SERVICE: &str = "com.nexusguard.app";

/// A provider is a lowercase service slug such as `supabase`, `github` or `linear`.
/// Each approval is stored by the desktop app under
/// `mcp:<provider>:<project-id>:<connection-id>`.
fn valid_provider(value: &str) -> bool {
    (2..=40).contains(&value.len()) && value.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

/// The keychain entry for `<provider> <project-id> <connection-id>`, or `None`
/// for an unknown provider or an id that could escape the key format.
fn keychain_key(args: &[String]) -> Option<String> {
    if args.len() != 3 || !valid_provider(&args[0]) || !valid_id(&args[1]) || !valid_id(&args[2]) {
        return None;
    }
    Some(format!("mcp:{}:{}:{}", args[0], args[1], args[2]))
}

/// GitHub access tokens last hours. Renew a nearly-expired one here, so a long
/// agent session keeps working, and save the new tokens back to the keychain.
/// Any problem falls back to the stored value, which then fails visibly upstream.
fn renewed_if_needed(provider: &str, key: &str, stored: String) -> String {
    if provider != "github" {
        return renewed_mcp(key, stored);
    }
    let Some(tokens) = github_auth::Tokens::from_json(&stored) else { return stored };
    if !tokens.needs_refresh(github_auth::now_secs()) {
        return stored;
    }
    let (Some(client_id), Some(refresh_token)) = (github_auth::client_id(), tokens.refresh_token.as_deref()) else { return stored };
    match github_auth::refresh(&client_id, refresh_token) {
        Ok(renewed) => {
            let json = renewed.to_json();
            let _ = keyring::Entry::new(SERVICE, key).and_then(|entry| entry.set_password(&json));
            json
        }
        Err(_) => stored,
    }
}

/// Any other service: renew a nearly-expired sign-in with the client Nexus registered for it.
fn renewed_mcp(key: &str, stored: String) -> String {
    let Some(tokens) = mcp_oauth::Tokens::from_json(&stored) else { return stored };
    if !tokens.needs_refresh(mcp_oauth::now_secs()) {
        return stored;
    }
    match mcp_oauth::refresh(&tokens) {
        Ok(renewed) => {
            let json = renewed.to_json();
            let _ = keyring::Entry::new(SERVICE, key).and_then(|entry| entry.set_password(&json));
            json
        }
        Err(_) => stored,
    }
}

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    let Some(key) = keychain_key(&args) else {
        eprintln!("Expected: nexus-keyring <supabase|github> <project-id> <connection-id>");
        std::process::exit(2);
    };
    match keyring::Entry::new(SERVICE, &key).and_then(|entry| entry.get_password()) {
        Ok(value) => print!("{}", renewed_if_needed(&args[0], &key, value)),
        Err(_) => {
            eprintln!("No saved approval for this connection.");
            std::process::exit(1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(items: &[&str]) -> Vec<String> {
        items.iter().map(|item| item.to_string()).collect()
    }

    #[test]
    fn reads_supabase_and_github_approvals_under_one_key_scheme() {
        assert_eq!(keychain_key(&args(&["supabase", "koupa", "koupa-sb"])).as_deref(), Some("mcp:supabase:koupa:koupa-sb"));
        assert_eq!(keychain_key(&args(&["github", "koupa", "koupa-gh"])).as_deref(), Some("mcp:github:koupa:koupa-gh"));
    }

    #[test]
    fn any_service_slug_works_but_nothing_that_could_escape_the_key() {
        assert_eq!(keychain_key(&args(&["linear", "koupa", "koupa-ln"])).as_deref(), Some("mcp:linear:koupa:koupa-ln"));
        assert_eq!(keychain_key(&args(&["hugging-face", "p", "c"])).as_deref(), Some("mcp:hugging-face:p:c"));
        assert_eq!(keychain_key(&args(&["Linear", "p", "c"])), None);
        assert_eq!(keychain_key(&args(&["a", "p", "c"])), None);
        assert_eq!(keychain_key(&args(&["li:near", "p", "c"])), None);
        assert_eq!(keychain_key(&args(&["", "p", "c"])), None);
    }

    #[test]
    fn refuses_unsafe_ids_and_wrong_argument_counts() {
        assert_eq!(keychain_key(&args(&["github", "koupa:other", "x"])), None);
        assert_eq!(keychain_key(&args(&["github", "koupa", "../x"])), None);
        assert_eq!(keychain_key(&args(&["github", "koupa"])), None);
    }
}
