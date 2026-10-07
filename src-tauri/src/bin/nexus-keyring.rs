use std::env;

const SERVICE: &str = "com.nexusguard.app";

/// Providers whose approvals the Nexus server may read back. Each is stored by
/// the desktop app under `mcp:<provider>:<project-id>:<connection-id>`.
const PROVIDERS: [&str; 2] = ["supabase", "github"];

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
    if args.len() != 3 || !PROVIDERS.contains(&args[0].as_str()) || !valid_id(&args[1]) || !valid_id(&args[2]) {
        return None;
    }
    Some(format!("mcp:{}:{}:{}", args[0], args[1], args[2]))
}

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    let Some(key) = keychain_key(&args) else {
        eprintln!("Expected: nexus-keyring <supabase|github> <project-id> <connection-id>");
        std::process::exit(2);
    };
    match keyring::Entry::new(SERVICE, &key).and_then(|entry| entry.get_password()) {
        Ok(value) => print!("{value}"),
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
    fn refuses_other_providers_and_unsafe_ids() {
        assert_eq!(keychain_key(&args(&["stripe", "koupa", "x"])), None);
        assert_eq!(keychain_key(&args(&["github", "koupa:other", "x"])), None);
        assert_eq!(keychain_key(&args(&["github", "koupa", "../x"])), None);
        assert_eq!(keychain_key(&args(&["github", "koupa"])), None);
    }
}
