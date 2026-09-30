use std::env;

const SERVICE: &str = "com.nexusguard.app";

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    if args.len() != 3 || args[0] != "supabase" || !valid_id(&args[1]) || !valid_id(&args[2]) {
        eprintln!("Expected: nexus-keyring supabase <project-id> <connection-id>");
        std::process::exit(2);
    }
    let key = format!("mcp:supabase:{}:{}", args[1], args[2]);
    match keyring::Entry::new(SERVICE, &key).and_then(|entry| entry.get_password()) {
        Ok(value) => print!("{value}"),
        Err(_) => {
            eprintln!("No saved approval for this connection.");
            std::process::exit(1);
        }
    }
}
