use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::RngExt;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::{Duration, Instant};
use url::form_urlencoded;

const MCP_RESOURCE: &str = "https://mcp.supabase.com/mcp";
const AUTHORIZATION_ENDPOINT: &str = "https://api.supabase.com/v1/oauth/authorize";
const TOKEN_ENDPOINT: &str = "https://api.supabase.com/v1/oauth/token";
const REGISTRATION_ENDPOINT: &str = "https://api.supabase.com/platform/oauth/apps/register";
const SCOPES: &str = "organizations:read projects:read database:read";
const SERVICE: &str = "com.nexusguard.app";

#[derive(Debug, Deserialize)]
struct RegistrationResponse {
    client_id: String,
    client_secret: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    scope: Option<String>,
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

fn random_token() -> String {
    let bytes: [u8; 32] = rand::rng().random();
    URL_SAFE_NO_PAD.encode(bytes)
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.len() != 2 || !valid_id(&args[0]) || !valid_id(&args[1]) {
        eprintln!("Expected: nexus-oauth <project-id> <connection-id>");
        std::process::exit(2);
    }
    let (project_id, connection_id) = (args[0].clone(), args[1].clone());
    if let Err(error) = run(&project_id, &connection_id) {
        eprintln!("OAuth failed: {error}");
        std::process::exit(1);
    }
}

fn run(project_id: &str, connection_id: &str) -> Result<(), String> {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|error| format!("could not start local callback: {error}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|error| format!("callback setup failed: {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}/oauth/callback");

    let body = serde_json::json!({
        "client_name": "Nexus Guard",
        "redirect_uris": [redirect_uri],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
        "scope": SCOPES
    });
    let response = ureq::post(REGISTRATION_ENDPOINT)
        .header("Accept", "application/json")
        .send_json(body)
        .map_err(|error| format!("Supabase could not register Nexus: {error}"))?;
    let text = response
        .into_body()
        .read_to_string()
        .map_err(|error| format!("unreadable registration response: {error}"))?;
    let registration: RegistrationResponse = serde_json::from_str(&text)
        .map_err(|error| format!("invalid registration response: {error}"))?;

    let state = random_token();
    let verifier = random_token();
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let mut query = form_urlencoded::Serializer::new(String::new());
    query.append_pair("response_type", "code");
    query.append_pair("client_id", &registration.client_id);
    query.append_pair("redirect_uri", &redirect_uri);
    query.append_pair("resource", MCP_RESOURCE);
    query.append_pair("code_challenge", &challenge);
    query.append_pair("code_challenge_method", "S256");
    query.append_pair("state", &state);
    query.append_pair("scope", SCOPES);
    let authorization_url = format!("{AUTHORIZATION_ENDPOINT}?{}", query.finish());

    println!("OPEN THIS URL IN YOUR BROWSER:\n{authorization_url}\n");
    println!("Waiting for browser approval (up to 5 minutes)...");
    // Best-effort auto-open; user said they will click.
    let _ = std::process::Command::new("xdg-open")
        .arg(&authorization_url)
        .spawn();

    let deadline = Instant::now() + Duration::from_secs(300);
    while Instant::now() < deadline {
        match listener.accept() {
            Ok((mut stream, _)) => {
                stream
                    .set_nonblocking(false)
                    .map_err(|error| format!("callback read failed: {error}"))?;
                stream
                    .set_read_timeout(Some(Duration::from_secs(15)))
                    .map_err(|error| format!("callback read failed: {error}"))?;
                let mut request = [0u8; 8192];
                let size = stream
                    .read(&mut request)
                    .map_err(|error| format!("callback read failed: {error}"))?;
                let request = String::from_utf8_lossy(&request[..size]);
                let first_line = request.lines().next().unwrap_or("");
                let path = first_line
                    .strip_prefix("GET ")
                    .and_then(|line| line.split_whitespace().next())
                    .ok_or_else(|| "invalid callback request".to_string())?;
                let parsed = url::Url::parse(&format!("http://localhost{path}"))
                    .map_err(|error| format!("invalid callback URL: {error}"))?;
                let returned_state = parsed
                    .query_pairs()
                    .find(|(key, _)| key == "state")
                    .map(|(_, value)| value.into_owned());
                let code = parsed
                    .query_pairs()
                    .find(|(key, _)| key == "code")
                    .map(|(_, value)| value.into_owned());
                let error = parsed
                    .query_pairs()
                    .find(|(key, _)| key == "error")
                    .map(|(_, value)| value.into_owned());

                if returned_state.as_deref() != Some(state.as_str()) {
                    respond(&mut stream, "Nexus Guard could not connect");
                    return Err("state mismatch".to_string());
                }
                if let Some(error) = error {
                    respond(&mut stream, "Nexus Guard could not connect");
                    return Err(format!("Supabase denied access: {error}"));
                }
                let code = code.ok_or_else(|| "no authorization code returned".to_string())?;
                let form = [
                    ("grant_type", "authorization_code"),
                    ("code", code.as_str()),
                    ("client_id", registration.client_id.as_str()),
                    ("redirect_uri", redirect_uri.as_str()),
                    ("code_verifier", verifier.as_str()),
                ];
                let mut token_request =
                    ureq::post(TOKEN_ENDPOINT).header("Accept", "application/json");
                if let Some(secret) = &registration.client_secret {
                    let credentials = base64::engine::general_purpose::STANDARD
                        .encode(format!("{}:{}", registration.client_id, secret));
                    token_request =
                        token_request.header("Authorization", &format!("Basic {credentials}"));
                }
                let token_response = token_request.send_form(form).map_err(|error| {
                    format!("Supabase could not finish the authorization: {error}")
                })?;
                let token_text = token_response.into_body().read_to_string().map_err(|error| {
                    format!("unreadable token response: {error}")
                })?;
                let tokens: TokenResponse = serde_json::from_str(&token_text)
                    .map_err(|error| format!("invalid token response: {error}"))?;
                let stored = serde_json::json!({
                    "accessToken": tokens.access_token,
                    "refreshToken": tokens.refresh_token,
                    "scope": tokens.scope,
                });
                let key = format!("mcp:supabase:{project_id}:{connection_id}");
                let entry = keyring::Entry::new(SERVICE, &key)
                    .map_err(|error| format!("keychain unavailable: {error}"))?;
                entry
                    .set_password(&stored.to_string())
                    .map_err(|error| format!("keychain save failed: {error}"))?;
                respond(&mut stream, "Nexus Guard is connected");
                println!("Saved approval for {project_id}/{connection_id} in system keychain.");
                return Ok(());
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(200));
            }
            Err(error) => return Err(format!("callback failed: {error}")),
        }
    }
    Err("timed out waiting for browser approval".to_string())
}

fn respond(stream: &mut std::net::TcpStream, message: &str) {
    let body = format!(
        "<!doctype html><html><body style=\"font-family: sans-serif; padding: 3rem\"><h2>{message}</h2><p>You can return to Nexus Guard.</p></body></html>"
    );
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes());
}
