use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::RngExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::env;
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream, ToSocketAddrs};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};
use url::form_urlencoded;

mod github_auth;

const MCP_RESOURCE: &str = "https://mcp.supabase.com/mcp";
const AUTHORIZATION_ENDPOINT: &str = "https://api.supabase.com/v1/oauth/authorize";
const TOKEN_ENDPOINT: &str = "https://api.supabase.com/v1/oauth/token";
const REGISTRATION_ENDPOINT: &str = "https://api.supabase.com/platform/oauth/apps/register";
const SCOPES: &str = "organizations:read projects:read database:read";

#[derive(Clone, Default)]
struct OAuthManager(Arc<Mutex<OAuthInner>>);

#[derive(Default)]
struct OAuthInner {
    pending: Option<PendingOAuth>,
    result: Option<OAuthResult>,
}

#[derive(Clone)]
struct PendingOAuth {
    state: String,
    verifier: String,
    client_id: String,
    client_secret: Option<String>,
    redirect_uri: String,
}

#[derive(Debug, Clone, Serialize)]
struct OAuthStart {
    authorization_url: String,
    redirect_uri: String,
}

#[derive(Debug, Clone, Serialize)]
struct OAuthResult {
    success: bool,
    access_token: Option<String>,
    refresh_token: Option<String>,
    scope: Option<String>,
    error: Option<String>,
}

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

fn random_token() -> String {
    let bytes: [u8; 32] = rand::rng().random();
    URL_SAFE_NO_PAD.encode(bytes)
}

fn register_client(redirect_uri: &str) -> Result<RegistrationResponse, String> {
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
        .map_err(|_| "Supabase did not complete the sign-in. Try connecting again.".to_string())?;
    let text = response.into_body().read_to_string().map_err(|_| {
        "Supabase returned something unexpected. Try again in a moment.".to_string()
    })?;
    serde_json::from_str(&text)
        .map_err(|_| "Supabase returned something unexpected. Try again in a moment.".to_string())
}

fn exchange_code(pending: &PendingOAuth, code: &str) -> Result<OAuthResult, String> {
    let form = [
        ("grant_type", "authorization_code"),
        ("code", code),
        ("client_id", pending.client_id.as_str()),
        ("redirect_uri", pending.redirect_uri.as_str()),
        ("code_verifier", pending.verifier.as_str()),
    ];
    let mut request = ureq::post(TOKEN_ENDPOINT).header("Accept", "application/json");
    if let Some(secret) = &pending.client_secret {
        let credentials = base64::engine::general_purpose::STANDARD
            .encode(format!("{}:{}", pending.client_id, secret));
        request = request.header("Authorization", &format!("Basic {credentials}"));
    }
    let response = request
        .send_form(form)
        .map_err(|_| "Supabase did not complete the sign-in. Try connecting again.".to_string())?;
    let text = response
        .into_body()
        .read_to_string()
        .map_err(|_| "Supabase returned something unexpected. Try again in a moment.".to_string())?;
    let tokens: TokenResponse = serde_json::from_str(&text)
        .map_err(|_| "Supabase returned something unexpected. Try again in a moment.".to_string())?;
    Ok(OAuthResult {
        success: true,
        access_token: Some(tokens.access_token),
        refresh_token: tokens.refresh_token,
        scope: tokens.scope,
        error: None,
    })
}

fn callback_response(stream: &mut TcpStream, message: &str) {
    let body = format!(
        "<!doctype html><html><body style=\"font-family: sans-serif; padding: 3rem\"><h2>{message}</h2><p>You can return to Nexus Guard.</p></body></html>"
    );
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(), body
    );
    let _ = stream.write_all(response.as_bytes());
}

fn listen_for_callback(listener: TcpListener, manager: OAuthManager, pending: PendingOAuth) {
    let Ok((mut stream, _)) = listener.accept() else {
        return;
    };
    let mut request = [0u8; 8192];
    let Ok(size) = stream.read(&mut request) else {
        return;
    };
    let request = String::from_utf8_lossy(&request[..size]);
    let Some(first_line) = request.lines().next() else {
        return;
    };
    let Some(path) = first_line
        .strip_prefix("GET ")
        .and_then(|line| line.split_whitespace().next())
    else {
        return;
    };
    let parsed = url::Url::parse(&format!("http://localhost{path}"));
    let Ok(parsed) = parsed else { return };
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

    let result = if returned_state.as_deref() != Some(pending.state.as_str()) {
        OAuthResult {
            success: false,
            access_token: None,
            refresh_token: None,
            scope: None,
            error: Some("The sign-in reply did not match this request. Try connecting again.".to_string()),
        }
    } else if error.is_some() {
        OAuthResult {
            success: false,
            access_token: None,
            refresh_token: None,
            scope: None,
            error: Some("Supabase did not complete the sign-in. Try connecting again.".to_string()),
        }
    } else if let Some(code) = code {
        match exchange_code(&pending, &code) {
            Ok(result) => result,
            Err(error) => OAuthResult {
                success: false,
                access_token: None,
                refresh_token: None,
                scope: None,
                error: Some(error),
            },
        }
    } else {
        OAuthResult {
            success: false,
            access_token: None,
            refresh_token: None,
            scope: None,
            error: Some("Supabase did not complete the sign-in. Try connecting again.".to_string()),
        }
    };

    callback_response(
        &mut stream,
        if result.success {
            "Nexus Guard is connected"
        } else {
            "Nexus Guard could not connect"
        },
    );
    if let Ok(mut inner) = manager.0.lock() {
        inner.pending = None;
        inner.result = Some(result);
    }
}

#[tauri::command]
fn start_supabase_mcp_oauth(state: tauri::State<'_, OAuthManager>) -> Result<OAuthStart, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|_| {
        "Nexus could not open its local sign-in page. Close anything using that port and try again."
            .to_string()
    })?;
    let port = listener
        .local_addr()
        .map_err(|_| {
            "Nexus could not open its local sign-in page. Close anything using that port and try again."
                .to_string()
        })?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}/oauth/callback");
    let registration = register_client(&redirect_uri)?;
    let state_token = random_token();
    let verifier = random_token();
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let pending = PendingOAuth {
        state: state_token.clone(),
        verifier,
        client_id: registration.client_id.clone(),
        client_secret: registration.client_secret,
        redirect_uri: redirect_uri.clone(),
    };
    let mut query = form_urlencoded::Serializer::new(String::new());
    query.append_pair("response_type", "code");
    query.append_pair("client_id", &registration.client_id);
    query.append_pair("redirect_uri", &redirect_uri);
    query.append_pair("resource", MCP_RESOURCE);
    query.append_pair("code_challenge", &challenge);
    query.append_pair("code_challenge_method", "S256");
    query.append_pair("state", &state_token);
    query.append_pair("scope", SCOPES);
    let authorization_url = format!("{AUTHORIZATION_ENDPOINT}?{}", query.finish());

    let manager = state.inner().clone();
    if let Ok(mut inner) = manager.0.lock() {
        inner.pending = Some(pending.clone());
        inner.result = None;
    }
    thread::spawn(move || listen_for_callback(listener, manager, pending));
    Ok(OAuthStart {
        authorization_url,
        redirect_uri,
    })
}

#[tauri::command]
fn poll_supabase_mcp_oauth(state: tauri::State<'_, OAuthManager>) -> Option<OAuthResult> {
    state.inner().0.lock().ok()?.result.take()
}

fn expand_workspace_path(value: &str) -> PathBuf {
    if value == "~" {
        return env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(value));
    }
    if let Some(rest) = value.strip_prefix("~/") {
        if let Some(home) = env::var_os("HOME") {
            return PathBuf::from(home).join(rest);
        }
    }
    PathBuf::from(value)
}

/// Canonical `.nexus/project.json` shape (paper: manifest canonical).
/// `{ project, project_id?, environment, connections: { <provider>: { account, resource, connection_id, project_ref, method, status } } }`
/// with `account`+`accountId` dual-written (mirrors the `target`/`resource`
/// dual-write) and `target`+`resource` dual-written. Example:
/// ```json
/// {
///   "project": "Koupa",
///   "project_id": "koupa",
///   "environment": "development",
///   "version": 1,
///   "connections": {
///     "supabase": {
///       "connection_id": "koupa-supabase",
///       "account": "personal-supabase",
///       "accountId": "personal-supabase",
///       "resource": "koupa-development",
///       "target": "koupa-development",
///       "environment": "development",
///       "method": "mcp",
///       "status": "connected"
///     }
///   }
/// }
/// ```
/// Legacy files with `{ target }`-only entries still read: `resource` falls
/// back to `target` on inspect, and `account` is `None` until re-saved.
/// `serviceOverride`/`tagOverride`/`defaultOverride` are accepted and
/// persisted passthrough (stored on the connection entry; the server
/// ignores them per Guard-deferred) so the UI can round-trip them.
/// Every overwrite backs up the previous file to
/// `project.json.bak.<unix_nanos>` (empty backup when no file yet) and
/// writes atomically via tmp+rename.
/// UI note: `account` and `accountId` are the same value under two keys;
/// either side is accepted on read, both are written.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn write_nexus_project_file(
    workspace_path: String,
    project_id: String,
    project_name: String,
    provider: String,
    target: String,
    project_ref: Option<String>,
    connection_id: String,
    method: String,
    status: String,
    environment: Option<String>,
    repo: Option<String>,
    branch: Option<String>,
    account: Option<String>,
    account_id: Option<String>,
    service_override: Option<String>,
    tag_override: Option<String>,
    default_override: Option<String>,
) -> Result<String, String> {
    if project_id.is_empty()
        || project_id.len() > 128
        || !project_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err("The project ID is invalid. Use letters, numbers, - or _.".to_string());
    }
    if connection_id.is_empty()
        || connection_id.len() > 128
        || !connection_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err("The connection ID is invalid. Use letters, numbers, - or _.".to_string());
    }

    let workspace = expand_workspace_path(&workspace_path);
    let workspace = fs::canonicalize(&workspace)
        .map_err(|_| "Nexus could not open that folder. Check the path still exists and try again.".to_string())?;
    if !workspace.is_dir() {
        return Err("The project path is not a folder. Choose a folder and try again.".to_string());
    }
    let nexus_dir = workspace.join(".nexus");
    fs::create_dir_all(&nexus_dir)
        .map_err(|_| "Nexus could not create the .nexus folder. Check the folder is writable and try again.".to_string())?;
    let manifest_path = nexus_dir.join("project.json");
    let mut manifest = if manifest_path.exists() {
        let raw = fs::read_to_string(&manifest_path)
            .map_err(|_| "Nexus could not read the project file. Check the path still exists and try again.".to_string())?;
        serde_json::from_str::<serde_json::Value>(&raw)
            .map_err(|_| "The Nexus project file is damaged. Remove .nexus/project.json and save the connection again to recreate it.".to_string())?
    } else {
        serde_json::json!({})
    };
    let object = manifest
        .as_object_mut()
        .ok_or_else(|| "The Nexus project file is damaged. Remove .nexus/project.json and save the connection again to recreate it.".to_string())?;
    object.insert(
        "project".to_string(),
        serde_json::Value::String(project_name),
    );
    object.insert(
        "project_id".to_string(),
        serde_json::Value::String(project_id),
    );
    // Notion §7: environment is part of project identity. Default preserves old files.
    if let Some(environment) = environment.filter(|value| !value.is_empty()) {
        object.insert(
            "environment".to_string(),
            serde_json::Value::String(environment.clone()),
        );
    } else if !object.contains_key("environment") {
        object.insert(
            "environment".to_string(),
            serde_json::Value::String("development".to_string()),
        );
    }
    let stored_environment = object
        .get("environment")
        .and_then(|value| value.as_str())
        .unwrap_or("development")
        .to_string();
    // Notion §7: declared Git identity for resolver cross-checks. Empty means unenforced.
    for (key, value) in [("repo", repo), ("branch", branch)] {
        if let Some(identity) = value.filter(|text| !text.trim().is_empty()) {
            object.insert(key.to_string(), serde_json::Value::String(identity));
        }
    }
    // Manifest schema version. Always 1 for files Nexus writes; readers
    // must not assume its absence means anything older than v1.
    object.insert("version".to_string(), serde_json::Value::Number(1.into()));
    let connections = object
        .entry("connections")
        .or_insert_with(|| serde_json::json!({}));
    let connections = connections
        .as_object_mut()
        .ok_or_else(|| "The Nexus project file is damaged. Remove .nexus/project.json and save the connection again to recreate it.".to_string())?;
    let provider_key = provider.to_lowercase();
    let existing_entry = connections
        .get(&provider_key)
        .and_then(|entry| entry.as_object())
        .cloned()
        .unwrap_or_default();
    let mut connection = serde_json::Map::new();
    connection.insert(
        "connection_id".to_string(),
        serde_json::Value::String(connection_id),
    );
    connection.insert("target".to_string(), serde_json::Value::String(target.clone()));
    // Paper canonical: target+resource dual-write (same value under two keys).
    connection.insert("resource".to_string(), serde_json::Value::String(target));
    // Paper canonical: account+accountId dual-write (mirrors target/resource).
    // Either input side is accepted; new value wins, otherwise preserve the
    // existing entry's account (any alias side) so re-saves without an
    // account do not strip it. Legacy {target-only} entries omit both.
    let existing_account = existing_entry
        .get("account")
        .or_else(|| existing_entry.get("accountId"))
        .or_else(|| existing_entry.get("account_id"))
        .and_then(|value| value.as_str())
        .map(str::to_string);
    if let Some(account) = account
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            account_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })
        .or(existing_account)
    {
        connection.insert("account".to_string(), serde_json::Value::String(account.clone()));
        connection.insert("accountId".to_string(), serde_json::Value::String(account));
    }
    connection.insert(
        "environment".to_string(),
        serde_json::Value::String(stored_environment),
    );
    connection.insert("method".to_string(), serde_json::Value::String(method));
    connection.insert("status".to_string(), serde_json::Value::String(status));
    if let Some(project_ref) = project_ref.filter(|value| !value.is_empty()) {
        connection.insert(
            "project_ref".to_string(),
            serde_json::Value::String(project_ref),
        );
    }
    // Override passthrough: stored on the connection entry, ignored by the
    // server per Guard-deferred. New non-empty value wins; otherwise preserve
    // the existing entry's value so re-saves do not strip it.
    for (key, incoming) in [
        ("serviceOverride", service_override),
        ("tagOverride", tag_override),
        ("defaultOverride", default_override),
    ] {
        let preserved = existing_entry
            .get(key)
            .and_then(|value| value.as_str())
            .map(str::to_string);
        if let Some(value) = incoming
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .or(preserved)
        {
            connection.insert(key.to_string(), serde_json::Value::String(value));
        }
    }
    connections.insert(
        provider.to_lowercase(),
        serde_json::Value::Object(connection),
    );

    let output = serde_json::to_string_pretty(&manifest)
        .map_err(|_| "Nexus could not save the project file. Check the folder is writable and try again.".to_string())?
        + "\n";
    // Back up the previous manifest before overwrite (.bak.<unix_nanos>);
    // empty backup when no file yet. Atomic tmp+rename so a crash cannot
    // leave a half-written project.json behind.
    let _ = backup_config_file(&manifest_path);
    let temporary = nexus_dir.join("project.json.tmp");
    fs::write(&temporary, output)
        .map_err(|_| "Nexus could not save the project file. Check the folder is writable and try again.".to_string())?;
    fs::rename(&temporary, &manifest_path)
        .map_err(|_| "Nexus could not save the project file. Check the folder is writable and try again.".to_string())?;
    Ok(manifest_path.to_string_lossy().into_owned())
}

/// Register a Nexus project folder without any service connection yet.
/// For the Add Project flow: writes (or upgrades) `.nexus/project.json`
/// with `{ project, project_id, environment, version: 1, connections: {} }`
/// and leaves existing connections untouched when the file already exists.
/// Same SAFE_ID validation, canonicalize, backup (.bak.<unix_nanos>) and
/// atomic tmp+rename as `write_nexus_project_file`.
#[tauri::command]
fn register_nexus_project(
    workspace_path: String,
    project_id: String,
    project_name: String,
    environment: Option<String>,
    repo: Option<String>,
    branch: Option<String>,
) -> Result<String, String> {
    if project_id.is_empty()
        || project_id.len() > 128
        || !project_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err("The project ID is invalid. Use letters, numbers, - or _.".to_string());
    }
    if project_name.trim().is_empty() {
        return Err("The project name is invalid. Enter a name and try again.".to_string());
    }
    let workspace = expand_workspace_path(&workspace_path);
    let workspace = fs::canonicalize(&workspace)
        .map_err(|_| "Nexus could not open that folder. Check the path still exists and try again.".to_string())?;
    if !workspace.is_dir() {
        return Err("The project path is not a folder. Choose a folder and try again.".to_string());
    }
    let nexus_dir = workspace.join(".nexus");
    fs::create_dir_all(&nexus_dir)
        .map_err(|_| "Nexus could not create the .nexus folder. Check the folder is writable and try again.".to_string())?;
    let manifest_path = nexus_dir.join("project.json");
    let mut manifest = if manifest_path.exists() {
        let raw = fs::read_to_string(&manifest_path)
            .map_err(|_| "Nexus could not read the project file. Check the path still exists and try again.".to_string())?;
        serde_json::from_str::<serde_json::Value>(&raw)
            .map_err(|_| "The Nexus project file is damaged. Remove .nexus/project.json and save the connection again to recreate it.".to_string())?
    } else {
        serde_json::json!({})
    };
    let object = manifest
        .as_object_mut()
        .ok_or_else(|| "The Nexus project file is damaged. Remove .nexus/project.json and save the connection again to recreate it.".to_string())?;
    object.insert(
        "project".to_string(),
        serde_json::Value::String(project_name),
    );
    object.insert(
        "project_id".to_string(),
        serde_json::Value::String(project_id),
    );
    if let Some(environment) = environment.filter(|value| !value.is_empty()) {
        object.insert(
            "environment".to_string(),
            serde_json::Value::String(environment),
        );
    } else if !object.contains_key("environment") {
        object.insert(
            "environment".to_string(),
            serde_json::Value::String("development".to_string()),
        );
    }
    for (key, value) in [("repo", repo), ("branch", branch)] {
        if let Some(identity) = value.filter(|text| !text.trim().is_empty()) {
            object.insert(key.to_string(), serde_json::Value::String(identity));
        }
    }
    object.insert("version".to_string(), serde_json::Value::Number(1.into()));
    if object.get("connections").and_then(|v| v.as_object()).is_none() {
        object.insert("connections".to_string(), serde_json::json!({}));
    }
    let output = serde_json::to_string_pretty(&manifest)
        .map_err(|_| "Nexus could not save the project file. Check the folder is writable and try again.".to_string())?
        + "\n";
    let _ = backup_config_file(&manifest_path);
    let temporary = nexus_dir.join("project.json.tmp");
    fs::write(&temporary, output)
        .map_err(|_| "Nexus could not save the project file. Check the folder is writable and try again.".to_string())?;
    fs::rename(&temporary, &manifest_path)
        .map_err(|_| "Nexus could not save the project file. Check the folder is writable and try again.".to_string())?;
    Ok(manifest_path.to_string_lossy().into_owned())
}

const KEYRING_SERVICE: &str = "com.nexusguard.app";
const VAULT_PASSWORD_ENTRY: &str = "vault-password-verifier";

fn keyring_entry(key: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, key)
        .map_err(|_| "The system keychain is unavailable. Unlock it (or sign in to the computer) and try again.".to_string())
}

fn password_verifier(password: &str) -> String {
    base64::engine::general_purpose::STANDARD.encode(sha2::Sha256::digest(password.as_bytes()))
}

fn vault_state_path() -> PathBuf {
    if let Ok(explicit) = env::var("NEXUS_VAULT_STATE_FILE") {
        if !explicit.trim().is_empty() {
            return PathBuf::from(explicit);
        }
    }
    if let Ok(runtime) = env::var("XDG_RUNTIME_DIR") {
        if !runtime.trim().is_empty() {
            return PathBuf::from(runtime).join("nexus-guard-vault-state.json");
        }
    }
    if let Ok(home) = env::var("HOME") {
        if !home.trim().is_empty() {
            return PathBuf::from(home).join(".config/nexus-guard/vault-state.json");
        }
    }
    env::temp_dir().join("nexus-guard-vault-state.json")
}

fn write_vault_state_at(path: &std::path::Path, locked: bool) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|_| "Nexus could not save the vault lock state.".to_string())?;
    }
    let temporary = path.with_extension(format!("json.tmp-{}", std::process::id()));
    let payload = serde_json::json!({
        "locked": locked,
        "updatedAt": format!("{}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()),
    });
    fs::write(&temporary, serde_json::to_vec(&payload).map_err(|_| "Nexus could not save the vault lock state.".to_string())?)
        .map_err(|_| "Nexus could not save the vault lock state.".to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&temporary, fs::Permissions::from_mode(0o600));
    }
    fs::rename(&temporary, path).map_err(|_| "Nexus could not save the vault lock state.".to_string())?;
    Ok(())
}

fn write_vault_state(locked: bool) -> Result<(), String> {
    write_vault_state_at(&vault_state_path(), locked)
}

fn vault_is_unlocked() -> bool {
    fs::read_to_string(vault_state_path())
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .and_then(|value| value.get("locked").and_then(|locked| locked.as_bool()))
        .map(|locked| !locked)
        .unwrap_or(false)
}

fn ensure_vault_unlocked_for_key(key: &str) -> Result<(), String> {
    // MCP approvals are saved immediately after an explicit browser approval.
    // Typed publishable keys remain gated by the vault lock.
    if key.starts_with("mcp:") || vault_is_unlocked() {
        return Ok(());
    }
    Err("Unlock the Nexus vault before reading or changing typed keys.".to_string())
}

fn is_missing_key(error: &keyring::Error) -> bool {
    let message = error.to_string().to_lowercase();
    message.contains("no entry")
        || message.contains("noentry")
        || message.contains("not found")
        || message.contains("credential not found")
        || message.contains("no matching credential")
}

#[tauri::command]
fn vault_unlock(password: String) -> Result<bool, String> {
    if password.len() < 12 {
        return Err("Use a vault password with at least 12 characters.".to_string());
    }
    let entry = keyring_entry(VAULT_PASSWORD_ENTRY)?;
    let verifier = password_verifier(&password);
    let unlocked = match entry.get_password() {
        Ok(saved) => saved == verifier,
        Err(error) if is_missing_key(&error) => {
            entry.set_password(&verifier).map_err(|_| {
                "The system keychain is unavailable. Unlock it (or sign in to the computer) and try again.".to_string()
            })?;
            true
        }
        Err(_) => return Err("The system keychain is unavailable. Unlock it (or sign in to the computer) and try again.".to_string()),
    };
    if unlocked {
        write_vault_state(false)?;
    }
    Ok(unlocked)
}

#[tauri::command]
fn vault_lock() -> Result<(), String> {
    write_vault_state(true)
}

#[tauri::command]
fn vault_save_secret(key: String, value: String) -> Result<(), String> {
    ensure_vault_unlocked_for_key(&key)?;
    keyring_entry(&key)?
        .set_password(&value)
        .map_err(|_| "The system keychain is unavailable. Unlock it (or sign in to the computer) and try again.".to_string())
}

#[tauri::command]
fn vault_has_secret(key: String) -> Result<bool, String> {
    ensure_vault_unlocked_for_key(&key)?;
    match keyring_entry(&key)?.get_password() {
        Ok(_) => Ok(true),
        Err(error) if is_missing_key(&error) => Ok(false),
        Err(_) => Err("The system keychain is unavailable. Unlock it (or sign in to the computer) and try again.".to_string()),
    }
}

#[tauri::command]
fn vault_delete_secret(key: String) -> Result<(), String> {
    ensure_vault_unlocked_for_key(&key)?;
    let entry = keyring_entry(&key)?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(error) if is_missing_key(&error) => Ok(()),
        Err(_) => Err(
            "The system keychain is unavailable. Unlock it (or sign in to the computer) and try again.".to_string(),
        ),
    }
}

#[tauri::command]
fn read_audit_log(workspace_path: String, limit: Option<usize>) -> Result<Vec<AuditEntry>, String> {
    let workspace = expand_workspace_path(&workspace_path);
    let log_path = workspace.join(".nexus").join("audit.log");
    let raw =
        fs::read_to_string(&log_path).map_err(|_| "No audit log here yet.".to_string())?;
    let limit = limit.unwrap_or(50).clamp(1, 500);
    let mut entries: Vec<AuditEntry> = raw
        .lines()
        .rev()
        .take(limit)
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() {
                return None;
            }
            serde_json::from_str(line).ok()
        })
        .collect();
    entries.reverse();
    Ok(entries)
}

#[derive(Debug, Serialize, Deserialize)]
struct AuditEntry {
    ts: Option<String>,
    session: Option<String>,
    /// Which agent made the call. The MCP bridge stamps this on every line
    /// (`mcp/nexus-server.mjs`); without the field here serde would drop it and
    /// the UI could never name the agent behind a decision.
    agent: Option<String>,
    project: Option<String>,
    project_id: Option<String>,
    environment: Option<String>,
    provider: Option<String>,
    resource: Option<String>,
    operation: Option<String>,
    decision: Option<String>,
    reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SupabaseApiProject {
    id: String,
    name: String,
    region: Option<String>,
    organization_id: Option<String>,
}

#[derive(Debug, Serialize)]
struct SupabaseProjectSummary {
    #[serde(rename = "ref")]
    project_ref: String,
    name: String,
    region: Option<String>,
    organization_id: Option<String>,
    /// The organization's display name, so the account can be named after it.
    organization_name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SupabaseApiOrganization {
    id: String,
    name: String,
}

/// Organization names by id. A convenience for naming the account; any failure
/// just means the account gets a generic name.
fn supabase_organization_names(access_token: &str) -> std::collections::HashMap<String, String> {
    let fetched = ureq::get("https://api.supabase.com/v1/organizations")
        .header("Accept", "application/json")
        .header("Authorization", &format!("Bearer {}", access_token))
        .call()
        .ok()
        .and_then(|response| response.into_body().read_to_string().ok())
        .and_then(|text| serde_json::from_str::<Vec<SupabaseApiOrganization>>(&text).ok());
    fetched.unwrap_or_default().into_iter().map(|org| (org.id, org.name)).collect()
}

/// List the signed-in user's Supabase projects so the desktop app can offer a
/// picker after browser approval. The caller holds the OAuth access token only
/// for this call; Nexus never stores it outside the vault.
#[tauri::command]
fn supabase_list_projects(access_token: String) -> Result<Vec<SupabaseProjectSummary>, String> {
    let access_token = access_token.trim().to_string();
    if access_token.is_empty() {
        return Err("Supabase sign-in is missing. Reconnect the service in Connections.".to_string());
    }
    let response = ureq::get("https://api.supabase.com/v1/projects")
        .header("Accept", "application/json")
        .header("Authorization", &format!("Bearer {}", access_token))
        .call()
        .map_err(|_| "Supabase did not return a project list. Check your network, then try again.".to_string())?;
    let text = response
        .into_body()
        .read_to_string()
        .map_err(|_| "Supabase returned something unexpected. Try again in a moment.".to_string())?;
    let projects: Vec<SupabaseApiProject> = serde_json::from_str(&text)
        .map_err(|_| "Supabase returned something unexpected. Try again in a moment.".to_string())?;
    let organizations = supabase_organization_names(&access_token);
    Ok(projects
        .into_iter()
        .map(|project| SupabaseProjectSummary {
            project_ref: project.id,
            name: project.name,
            region: project.region,
            organization_name: project.organization_id.as_ref().and_then(|id| organizations.get(id).cloned()),
            organization_id: project.organization_id,
        })
        .collect())
}

#[derive(Debug, Serialize, Clone)]
struct DetectedAgent {
    id: String,
    name: String,
    found: bool,
    detail: String,
    nexus_config: String,
    http_reachable: bool,
    unmanaged: Vec<UnmanagedMcpEntry>,
}

/// One MCP entry that does not match the Nexus HTTP URL.
/// `kind` is always `"found,unmanaged"`: Nexus saw it but cannot promise
/// it saw or stopped anything through it. Unknown entries are never
/// silently re-routed; import/remove both need UI confirmation.
#[derive(Debug, Serialize, Clone)]
struct UnmanagedMcpEntry {
    source: String,
    name: String,
    kind: String,
}

/// Nexus HTTP URL agents register with their own CLI.
/// `NEXUS_HTTP_PORT` (default 3939) matches `mcp/nexus-http-server.mjs`.
fn default_nexus_http_url() -> String {
    let port = env::var("NEXUS_HTTP_PORT")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "3939".to_string());
    format!("http://127.0.0.1:{port}/mcp")
}

/// The workspace header name the HTTP bridge reads (`mcp/nexus-http-server.mjs`).
const NEXUS_WORKSPACE_HEADER: &str = "X-Nexus-Workspace";

/// Bind one Nexus HTTP URL to one project by carrying the workspace in the URL
/// query. The bridge refuses any request that names no workspace, so a single
/// global registration is not enough: each project's agent config points at the
/// same server with its own workspace. The query form works for every agent,
/// including ones with no custom-header support; agents that do support headers
/// also get `X-Nexus-Workspace` (see `nexus_workspace_headers`), which the
/// bridge prefers.
fn nexus_http_url_for_workspace(http_url: &str, workspace: &std::path::Path) -> String {
    let workspace = workspace.to_string_lossy();
    match url::Url::parse(http_url) {
        Ok(mut parsed) => {
            // Replace any stale workspace rather than appending a second one.
            let kept: Vec<(String, String)> = parsed
                .query_pairs()
                .filter(|(key, _)| key != "workspace")
                .map(|(key, value)| (key.into_owned(), value.into_owned()))
                .collect();
            {
                let mut query = parsed.query_pairs_mut();
                query.clear();
                for (key, value) in &kept {
                    query.append_pair(key, value);
                }
                query.append_pair("workspace", workspace.as_ref());
            }
            // `query_pairs_mut` can leave a trailing `?` when nothing was kept.
            if parsed.query() == Some("") {
                parsed.set_query(None);
            }
            parsed.to_string()
        }
        // Not parseable as a URL: callers validate the scheme, so keep it usable.
        Err(_) => format!(
            "{http_url}{}workspace={}",
            if http_url.contains('?') { "&" } else { "?" },
            url::form_urlencoded::byte_serialize(workspace.as_bytes()).collect::<String>(),
        ),
    }
}

/// The header form of the same binding, for agent configs that support headers.
fn nexus_workspace_headers(workspace: &std::path::Path) -> serde_json::Value {
    serde_json::json!({ NEXUS_WORKSPACE_HEADER: workspace.to_string_lossy() })
}

fn nexus_http_port(http_url: &str) -> String {
    if let Ok(parsed) = url::Url::parse(http_url) {
        if let Some(port) = parsed.port() {
            return port.to_string();
        }
    }
    env::var("NEXUS_HTTP_PORT")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "3939".to_string())
}

/// CLI-first health probe: `GET /healthz` on the Nexus HTTP server.
/// Plain `TcpStream` on purpose (no new dependency); short timeouts, and
/// every parse/connect/read failure is `false`. Never panics.
fn probe_http_agent(url: &str) -> bool {
    let parsed = match url::Url::parse(url) {
        Ok(parsed) => parsed,
        Err(_) => return false,
    };
    if parsed.scheme() != "http" {
        return false;
    }
    let host = parsed.host_str().unwrap_or("");
    if host.is_empty() {
        return false;
    }
    let port = parsed.port().unwrap_or(80);
    let timeout = std::time::Duration::from_millis(700);
    let addrs: Vec<std::net::SocketAddr> = match format!("{host}:{port}").to_socket_addrs() {
        Ok(addrs) => addrs.collect(),
        Err(_) => return false,
    };
    let mut connected = None;
    for addr in addrs {
        match TcpStream::connect_timeout(&addr, timeout) {
            Ok(candidate) => {
                connected = Some(candidate);
                break;
            }
            Err(_) => continue,
        }
    }
    let mut stream = match connected {
        Some(stream) => stream,
        None => return false,
    };
    if stream.set_read_timeout(Some(timeout)).is_err()
        || stream.set_write_timeout(Some(timeout)).is_err()
    {
        return false;
    }
    let request = format!("GET /healthz HTTP/1.0\r\nHost: {host}\r\nConnection: close\r\n\r\n");
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let mut response = Vec::with_capacity(512);
    let mut chunk = [0u8; 1024];
    loop {
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(size) => {
                response.extend_from_slice(&chunk[..size]);
                if response.len() > 4096 {
                    break;
                }
            }
            Err(_) => break,
        }
    }
    match String::from_utf8_lossy(&response).lines().next() {
        Some(status) => status.contains(" 200 "),
        None => false,
    }
}

/// Paper classification: an entry counts as Nexus-managed only when it is an
/// HTTP URL on the Nexus port AND bound to a workspace (URL `workspace=`
/// query or the `X-Nexus-Workspace` header). A stale stdio entry that runs
/// `nexus-server.mjs` / `nexus-http-server.mjs` via `command` is explicitly
/// NOT managed anymore — it is `found,unmanaged` so the UI can offer
/// import (adopt onto Nexus HTTP) or remove, both with confirmation.
/// Unknown entries are never silently re-routed and stay `found,unmanaged`.
fn entry_is_nexus_managed(name: &str, raw: &str, port: &str) -> bool {
    let _ = name;
    let lowered = raw.to_lowercase();
    // Stale stdio fallback: never managed, even under the `nexus` name.
    // These entries bypass the single HTTP instance and must be surfaced
    // as unmanaged so the user can confirm import/remove.
    if lowered.contains("nexus-server.mjs") || lowered.contains("nexus-http-server.mjs") {
        // Exception: a JSON string that merely mentions the file in a URL?
        // No — any entry that shells out to the bridge script is stdio.
        // An HTTP `url` entry never contains `.mjs`, so this is safe.
        return false;
    }
    let on_nexus_port = lowered.contains(&format!("127.0.0.1:{port}"))
        || lowered.contains(&format!("localhost:{port}"));
    if !on_nexus_port {
        return false;
    }
    let bound = lowered.contains("workspace=")
        || lowered.contains("x-nexus-workspace");
    // Must look like an HTTP entry (has a url) — a bare name match is not
    // enough, otherwise a stale stdio `nexus` entry would count as managed.
    let is_http_entry = lowered.contains("http://") || lowered.contains("https://");
    on_nexus_port && bound && is_http_entry
}

fn unmanaged_in_json_servers(
    source: &str,
    servers: &serde_json::Map<String, serde_json::Value>,
    port: &str,
) -> Vec<UnmanagedMcpEntry> {
    let mut names: Vec<&String> = servers.keys().collect();
    names.sort();
    let mut out = Vec::new();
    for name in names {
        let raw = servers
            .get(name)
            .map(|value| value.to_string())
            .unwrap_or_default();
        if entry_is_nexus_managed(name, &raw, port) {
            continue;
        }
        out.push(UnmanagedMcpEntry {
            source: source.to_string(),
            name: (*name).clone(),
            kind: "found,unmanaged".to_string(),
        });
    }
    out
}

/// Scan one global JSON agent config for direct (non-Nexus) MCP entries.
/// `nested` selects `mcp.servers` (opencode-style) over `mcpServers`.
/// Missing file or invalid JSON means "nothing seen", never an error.
fn scan_global_json_mcp(relative: &str, nested: bool, port: &str) -> Vec<UnmanagedMcpEntry> {
    let Some(home) = env::var_os("HOME") else {
        return Vec::new();
    };
    let path = PathBuf::from(home).join(relative);
    let raw = match fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(_) => return Vec::new(),
    };
    let document: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(document) => document,
        Err(_) => return Vec::new(),
    };
    let servers = if nested {
        document
            .get("mcp")
            .and_then(|mcp| mcp.get("servers"))
            .and_then(|servers| servers.as_object())
    } else {
        document
            .get("mcpServers")
            .and_then(|servers| servers.as_object())
    };
    match servers {
        Some(servers) => unmanaged_in_json_servers(&format!("~/{relative}"), servers, port),
        None => Vec::new(),
    }
}

/// Block-based Codex classifier shared by the global and project scans.
/// Each `[mcp_servers.<name>]` header's following lines form the entry body,
/// classified by `entry_is_nexus_managed`. A stale stdio `[mcp_servers.nexus]`
/// block (command/nexus-server.mjs) is unmanaged, not skipped.
fn codex_unmanaged_in_text(source: &str, raw: &str, port: &str) -> Vec<UnmanagedMcpEntry> {
    let mut sections: Vec<(String, String)> = Vec::new();
    let mut current: Option<(String, String)> = None;
    for line in raw.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("[mcp_servers.") {
            if let Some(name) = rest.strip_suffix(']') {
                if let Some((prev_name, prev_body)) = current.take() {
                    sections.push((prev_name, prev_body));
                }
                current = Some((name.trim().trim_matches('"').to_string(), String::new()));
                continue;
            }
        }
        if let Some((_, body)) = current.as_mut() {
            body.push_str(line);
            body.push('\n');
        }
    }
    if let Some((prev_name, prev_body)) = current.take() {
        sections.push((prev_name, prev_body));
    }
    let mut out = Vec::new();
    for (name, body) in sections {
        if name.is_empty() {
            continue;
        }
        if entry_is_nexus_managed(&name, &body, port) {
            continue;
        }
        if !out.iter().any(|entry: &UnmanagedMcpEntry| entry.name == name) {
            out.push(UnmanagedMcpEntry {
                source: source.to_string(),
                name,
                kind: "found,unmanaged".to_string(),
            });
        }
    }
    out
}

/// Scan the global Codex TOML for `[mcp_servers.<name>]` blocks that are
/// not Nexus. Line-based on purpose: no TOML dependency for one scan.
fn scan_global_codex_toml(port: &str) -> Vec<UnmanagedMcpEntry> {
    let Some(home) = env::var_os("HOME") else {
        return Vec::new();
    };
    let path = PathBuf::from(home).join(".codex/config.toml");
    let raw = match fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(_) => return Vec::new(),
    };
    codex_unmanaged_in_text("~/.codex/config.toml", &raw, port)
}

/// Scan one project-level JSON agent config (`mcpServers` or opencode-style
/// `mcp.servers`) for direct (non-Nexus) entries. Missing file or invalid
/// JSON means "nothing seen", never an error.
fn scan_project_json_mcp(
    workspace: &std::path::Path,
    file: &str,
    nested: bool,
    port: &str,
) -> Vec<UnmanagedMcpEntry> {
    let raw = match fs::read_to_string(workspace.join(file)) {
        Ok(raw) => raw,
        Err(_) => return Vec::new(),
    };
    let document: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(document) => document,
        Err(_) => return Vec::new(),
    };
    let servers = if nested {
        document
            .get("mcp")
            .and_then(|mcp| mcp.get("servers"))
            .and_then(|servers| servers.as_object())
    } else {
        document
            .get("mcpServers")
            .and_then(|servers| servers.as_object())
    };
    match servers {
        Some(servers) => unmanaged_in_json_servers(file, servers, port),
        None => Vec::new(),
    }
}

fn unmanaged_for_agent(agent_id: &str, port: &str) -> Vec<UnmanagedMcpEntry> {
    match agent_id {
        "claude" => scan_global_json_mcp(".claude.json", false, port),
        "opencode" => scan_global_json_mcp(".config/opencode/opencode.json", true, port),
        "codex" => scan_global_codex_toml(port),
        "cursor" => scan_global_json_mcp(".cursor/mcp.json", false, port),
        "windsurf" => scan_global_json_mcp(".codeium/windsurf/mcp_config.json", false, port),
        "gemini" => scan_global_json_mcp(".gemini/settings.json", false, port),
        // Aider has no MCP client (no MCP config to scan): it can only use
        // Nexus via shell, so there is nothing to import/remove. [] is
        // correct, not a missing scan.
        _ => Vec::new(),
    }
}

/// Project-level unmanaged scan for the Import/Remove flow: reads the
/// workspace-bound configs Nexus actually writes (`.mcp.json`,
/// `opencode.json`, `.codex/config.toml`) and returns entries that are
/// `found,unmanaged`. Read-only; changes nothing. Unknown entries stay
/// `found,unmanaged` — import/remove both need UI confirmation and are
/// never applied silently.
#[tauri::command]
fn scan_project_mcp(workspace_path: String) -> Result<Vec<UnmanagedMcpEntry>, String> {
    let workspace = expand_workspace_path(&workspace_path);
    let workspace = fs::canonicalize(&workspace)
        .map_err(|_| "Nexus could not open that folder. Check the path still exists and try again.".to_string())?;
    if !workspace.is_dir() {
        return Err("The project path is not a folder. Choose a folder and try again.".to_string());
    }
    let http_url = default_nexus_http_url();
    let port = nexus_http_port(&http_url);
    let mut out = Vec::new();
    out.extend(scan_project_json_mcp(&workspace, ".mcp.json", false, &port));
    out.extend(scan_project_json_mcp(&workspace, "opencode.json", true, &port));
    if let Ok(raw) = fs::read_to_string(workspace.join(".codex").join("config.toml")) {
        out.extend(codex_unmanaged_in_text(".codex/config.toml", &raw, &port));
    }
    out.sort_by(|a, b| (&a.source, &a.name).cmp(&(&b.source, &b.name)));
    Ok(out)
}

fn executable_in_path(name: &str) -> bool {
    let Some(path_var) = env::var_os("PATH") else {
        return false;
    };
    env::split_paths(&path_var).any(|dir| {
        let candidate = dir.join(name);
        candidate.is_file()
    })
}

/// Detect installed coding agents by CLI presence and known config paths.
/// Detection is not routing: an agent only goes through Nexus when its own MCP
/// config points at the Nexus bridge for that project folder.
#[derive(Debug, Serialize)]
struct ConnectionSummary {
    provider: String,
    account: Option<String>,
    resource: Option<String>,
    target: Option<String>,
}

#[derive(Debug, Serialize)]
struct FolderInspection {
    exists: bool,
    is_dir: bool,
    git_remote: Option<String>,
    git_branch: Option<String>,
    nexus_project: Option<String>,
    nexus_project_id: Option<String>,
    nexus_environment: Option<String>,
    nexus_connections: Vec<ConnectionSummary>,
}

/// Inspect a project folder for the Add Project flow: existence, Git identity,
/// and any existing Nexus registration. Read-only; changes nothing.
#[tauri::command]
fn inspect_project_folder(workspace_path: String) -> Result<FolderInspection, String> {
    let expanded = expand_workspace_path(&workspace_path);
    let canonical = fs::canonicalize(&expanded);
    let (exists, is_dir, root) = match canonical {
        Ok(path) => {
            let is_dir = path.is_dir();
            (true, is_dir, Some(path))
        }
        Err(_) => (false, false, None),
    };
    let mut git_remote = None;
    let mut git_branch = None;
    if is_dir {
        if let Some(root) = &root {
            git_remote = std::process::Command::new("git")
                .args(["remote", "get-url", "origin"])
                .current_dir(root)
                .output()
                .ok()
                .and_then(|output| {
                    if output.status.success() {
                        let remote = String::from_utf8_lossy(&output.stdout).trim().to_string();
                        if remote.is_empty() { None } else { Some(remote) }
                    } else {
                        None
                    }
                });
            git_branch = std::process::Command::new("git")
                .args(["branch", "--show-current"])
                .current_dir(root)
                .output()
                .ok()
                .and_then(|output| {
                    if output.status.success() {
                        let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
                        if branch.is_empty() { None } else { Some(branch) }
                    } else {
                        None
                    }
                });
        }
    }
    let manifest: Option<serde_json::Value> = root
        .as_ref()
        .map(|root| root.join(".nexus").join("project.json"))
        .filter(|manifest| manifest.is_file())
        .and_then(|manifest| fs::read_to_string(manifest).ok())
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok());
    let nexus_project = manifest
        .as_ref()
        .and_then(|manifest| manifest.get("project"))
        .and_then(|value| value.as_str())
        .map(str::to_string);
    let nexus_project_id = manifest
        .as_ref()
        .and_then(|manifest| manifest.get("project_id"))
        .and_then(|value| value.as_str())
        .map(str::to_string);
    let nexus_environment = manifest
        .as_ref()
        .and_then(|manifest| manifest.get("environment"))
        .and_then(|value| value.as_str())
        .map(str::to_string);
    // Canonical account+resource summary per service. Legacy {target-only}
    // entries still read: resource falls back to target, account is None.
    // Also accepts the accountId/account_id alias sides on read.
    let nexus_connections = manifest
        .as_ref()
        .and_then(|manifest| manifest.get("connections"))
        .and_then(|value| value.as_object())
        .map(|connections| {
            let mut summary: Vec<ConnectionSummary> = connections
                .iter()
                .map(|(provider, entry)| {
                    let target = entry
                        .get("target")
                        .or_else(|| entry.get("resource"))
                        .and_then(|value| value.as_str())
                        .map(str::to_string);
                    let resource = entry
                        .get("resource")
                        .or_else(|| entry.get("target"))
                        .and_then(|value| value.as_str())
                        .map(str::to_string);
                    let account = entry
                        .get("account")
                        .or_else(|| entry.get("accountId"))
                        .or_else(|| entry.get("account_id"))
                        .and_then(|value| value.as_str())
                        .map(str::to_string);
                    ConnectionSummary {
                        provider: provider.clone(),
                        account,
                        resource,
                        target,
                    }
                })
                .collect();
            summary.sort_by(|a, b| a.provider.cmp(&b.provider));
            summary
        })
        .unwrap_or_default();
    Ok(FolderInspection {
        exists,
        is_dir,
        git_remote,
        git_branch,
        nexus_project,
        nexus_project_id,
        nexus_environment,
        nexus_connections,
    })
}

/// Create a project folder (and parents) for the Add Project flow.
#[tauri::command]
fn create_project_folder(workspace_path: String) -> Result<String, String> {
    let expanded = expand_workspace_path(&workspace_path);
    fs::create_dir_all(&expanded)
        .map_err(|_| "Nexus could not create that folder. Check the folder is writable and try again.".to_string())?;
    let canonical = fs::canonicalize(&expanded)
        .map_err(|_| "Nexus could not open that folder. Check the path still exists and try again.".to_string())?;
    if !canonical.is_dir() {
        return Err("The project path is not a folder. Choose a folder and try again.".to_string());
    }
    Ok(canonical.to_string_lossy().into_owned())
}

/// OS user name for the sidebar profile. Never a credential.
#[tauri::command]
fn current_user() -> String {
    env::var("USER")
        .or_else(|_| env::var("USERNAME"))
        .or_else(|_| env::var("LOGNAME"))
        .map(|name| name.trim().to_string())
        .ok()
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "Local".to_string())
}

#[derive(Debug, Serialize)]
struct SupabaseVerify {
    name: String,
    status: Option<String>,
    region: Option<String>,
}

fn valid_token_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

/// Live guarded read: fetch the Supabase project behind a saved MCP approval
/// using the vault token, and return only safe metadata. The token never
/// leaves the backend or appears in output.
#[tauri::command]
fn verify_supabase_connection(
    project_id: String,
    connection_id: String,
    project_ref: String,
) -> Result<SupabaseVerify, String> {
    if !(valid_token_id(&project_id) && valid_token_id(&connection_id) && valid_token_id(&project_ref)) {
        return Err("Unknown connection.".to_string());
    }
    let key = format!("mcp:supabase:{project_id}:{connection_id}");
    let raw = keyring_entry(&key)?
        .get_password()
        .map_err(|_| "No saved approval for this connection. Reconnect it first.".to_string())?;
    let value: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|_| "The saved approval is unreadable. Reconnect it first.".to_string())?;
    let token = value
        .get("accessToken")
        .and_then(|token| token.as_str())
        .filter(|token| !token.trim().is_empty())
        .ok_or_else(|| "The saved approval is unreadable. Reconnect it first.".to_string())?;
    let url = format!("https://api.supabase.com/v1/projects/{project_ref}");
    let response = ureq::get(&url)
        .header("Accept", "application/json")
        .header("Authorization", &format!("Bearer {}", token.trim()))
        .call()
        .map_err(|error| match error {
            ureq::Error::StatusCode(401) | ureq::Error::StatusCode(403) => {
                "Supabase rejected the saved approval (expired or revoked). Reconnect Supabase in Connections, then re-check.".to_string()
            }
            ureq::Error::StatusCode(status) => {
                format!("Supabase returned status {status}. Re-check the approval in Connections, then try again.")
            }
            _ => "Supabase is unreachable. Check your network connection, then re-check.".to_string(),
        })?;
    let text = response
        .into_body()
        .read_to_string()
        .map_err(|error| format!("Supabase returned an unreadable answer: {error}"))?;
    let project: serde_json::Value = serde_json::from_str(&text)
        .map_err(|error| format!("Supabase returned an invalid answer: {error}"))?;
    Ok(SupabaseVerify {
        name: project
            .get("name")
            .and_then(|name| name.as_str())
            .unwrap_or("Supabase project")
            .to_string(),
        status: project.get("status").and_then(|value| value.as_str()).map(str::to_string),
        region: project.get("region").and_then(|value| value.as_str()).map(str::to_string),
    })
}

#[derive(Debug, Serialize)]
struct AgentSetupTest {
    step: String,
    ok: bool,
    detail: String,
}

fn agent_config_path(workspace: &std::path::Path, agent_id: &str) -> Option<PathBuf> {
    match agent_id {
        "claude" | "pi" => Some(workspace.join(".mcp.json")),
        "opencode" => Some(workspace.join("opencode.json")),
        "codex" => Some(workspace.join(".codex").join("config.toml")),
        _ => None,
    }
}

fn find_node_binary() -> String {
    let exe = if cfg!(windows) { "node.exe" } else { "node" };
    if let Some(path_var) = env::var_os("PATH") {
        for dir in env::split_paths(&path_var) {
            let candidate = dir.join(exe);
            if candidate.is_file() {
                return candidate.to_string_lossy().into_owned();
            }
        }
    }
    // GUI apps rarely inherit the shell's PATH, so look where version managers
    // and installers put Node. Managers with many versions: newest wins.
    let mut fixed: Vec<PathBuf> = Vec::new();
    let mut managed: Vec<PathBuf> = Vec::new();
    if let Some(home) = env::var_os("HOME").or_else(|| env::var_os("USERPROFILE")).map(PathBuf::from) {
        managed.push(home.join(".nvm").join("versions").join("node"));
        managed.push(home.join(".local").join("share").join("fnm").join("node-versions"));
        managed.push(home.join("Library").join("Application Support").join("fnm").join("node-versions"));
        fixed.push(home.join(".volta").join("bin").join(exe));
        fixed.push(home.join(".asdf").join("shims").join(exe));
    }
    for dir in ["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin"] {
        fixed.push(PathBuf::from(dir).join(exe));
    }
    for var in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(base) = env::var_os(var) {
            fixed.push(PathBuf::from(base).join("nodejs").join(exe));
        }
    }
    if let Some(found) = fixed.into_iter().find(|path| path.is_file()) {
        return found.to_string_lossy().into_owned();
    }
    for root in managed {
        if let Ok(entries) = fs::read_dir(&root) {
            let mut versions: Vec<(Vec<u32>, PathBuf)> = entries
                .filter_map(|entry| entry.ok().map(|entry| entry.path()))
                .filter_map(|dir| {
                    let binary = [dir.join("bin").join(exe), dir.join("installation").join("bin").join(exe), dir.join("installation").join(exe)]
                        .into_iter()
                        .find(|candidate| candidate.is_file())?;
                    let name = dir.file_name()?.to_string_lossy().into_owned();
                    let parts = name.trim_start_matches('v').split('.').map(|part| part.parse().unwrap_or(0)).collect();
                    Some((parts, binary))
                })
                .collect();
            versions.sort();
            if let Some((_, newest)) = versions.pop() {
                return newest.to_string_lossy().into_owned();
            }
        }
    }
    "node".to_string()
}

/// Major version of a Node binary (`v20.11.1` -> 20), or `None` when it will not run.
fn node_major_version(binary: &str) -> Option<u32> {
    let output = std::process::Command::new(binary).arg("--version").output().ok()?;
    if !output.status.success() {
        return None;
    }
    parse_node_major(&String::from_utf8_lossy(&output.stdout))
}

fn parse_node_major(version: &str) -> Option<u32> {
    version.trim().trim_start_matches('v').split('.').next()?.parse().ok()
}

/// The oldest Node major the bundled server supports.
const MIN_NODE_MAJOR: u32 = 20;

/// The `nexus-keyring` helper the app installs next to its own executable. The
/// server reads approvals through it; a source checkout falls back to the
/// server's built-in debug path.
fn bundled_keyring_binary() -> Option<PathBuf> {
    let dir = env::current_exe().ok()?.parent()?.to_path_buf();
    let candidate = dir.join(if cfg!(windows) { "nexus-keyring.exe" } else { "nexus-keyring" });
    candidate.is_file().then_some(candidate)
}

/// Write the agent's project MCP config so that agent routes through Nexus.
/// Paper: single HTTP instance, no per-agent stdio. This writes ONE
/// canonical HTTP entry named `nexus`, bound to this project's workspace by
/// both the `?workspace=` URL query and the `X-Nexus-Workspace` header (the
/// bridge refuses a request that names neither).
/// CLI-first: agents with an HTTP transport can instead be registered with
/// their own CLI (`claude mcp add --transport http nexus <http_url>`,
/// `codex mcp add nexus --url <http_url>`) run inside this project; this
/// writer is the file-edit fallback. File-edit fallback needs UI
/// confirm/diff/backup + a live test after writing: this command backs up
/// (`<config>.bak.<nanos>`, `""` when new), writes atomically (tmp+rename),
/// returns `{ path, backup, diff }` for the UI to show, and the UI should
/// then call `test_agent_setup`.
/// A stale stdio `nexus` entry (command/nexus-server.mjs) is overwritten
/// with the HTTP entry; a legacy `nexus-http` duplicate is removed so there
/// is exactly one Nexus entry. `bridge_path`/`keyring_path`/`node_path` are
/// legacy ignored (kept as `Option` only so older callers still invoke);
/// no bridge script, keyring helper, or node binary is required or read.
/// `http_url` defaults to `http://127.0.0.1:<NEXUS_HTTP_PORT>/mcp`.
#[tauri::command]
fn connect_agent_to_project(
    workspace_path: String,
    agent_id: String,
    bridge_path: Option<String>,
    keyring_path: Option<String>,
    node_path: Option<String>,
    http_url: Option<String>,
) -> Result<AgentConfigEdit, String> {
    let _ = bridge_path;
    let _ = keyring_path;
    let _ = node_path;
    let workspace = expand_workspace_path(&workspace_path);
    let workspace = fs::canonicalize(&workspace)
        .map_err(|_| "Nexus could not open that folder. Check the path still exists and try again.".to_string())?;
    if !workspace.is_dir() {
        return Err("The project path is not a folder. Choose a folder and try again.".to_string());
    }
    let config_path = agent_config_path(&workspace, agent_id.as_str())
        .ok_or_else(|| "Unknown agent. Choose Codex, Claude Code, Pi, or OpenCode.".to_string())?;
    let http_url = http_url
        .map(|url| url.trim().to_string())
        .filter(|url| !url.is_empty())
        .unwrap_or_else(default_nexus_http_url);
    if !http_url.starts_with("http://") && !http_url.starts_with("https://") {
        return Err("That Nexus URL is invalid. Use an http:// or https:// address.".to_string());
    }
    let bound_url = nexus_http_url_for_workspace(&http_url, &workspace);
    let headers = nexus_workspace_headers(&workspace);
    if agent_id == "codex" {
        if let Some(parent) = config_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|_| "Nexus could not create the agent config folder. Check the folder is writable and try again.".to_string())?;
        }
        let existing = fs::read_to_string(&config_path).unwrap_or_default();
        // HTTP-only: a canonical `nexus` block is `url = "<bound>"`.
        // Already canonical (bound to THIS workspace) -> no-op. A stale
        // stdio block (command/nexus-server.mjs) or a block bound to another
        // workspace is replaced below.
        if existing.contains("[mcp_servers.nexus]")
            && existing.contains(&format!("url = \"{bound_url}\""))
        {
            return Ok(AgentConfigEdit {
                path: config_path.to_string_lossy().into_owned(),
                backup: String::new(),
                diff: "nexus is already in the Codex config; nothing changed.".to_string(),
            });
        }
        let existed = config_path.is_file();
        // Back up before any overwrite so a bad write can be restored.
        let backup = backup_config_file(&config_path)?;
        // Strip any stale `nexus`/`nexus-http` blocks (stdio fallback or a
        // URL bound to another workspace), then append the canonical block.
        let stripped = strip_codex_nexus_blocks(&existing);
        let mut output = stripped;
        if !output.is_empty() && !output.ends_with('\n') {
            output.push('\n');
        }
        // The URL carries this project's workspace: the server refuses a
        // registration that names none, so a global one (same URL for every
        // project) would not work. `url =` is the Codex HTTP form, already
        // the default for `import_agent_entry`; connect now matches it.
        output.push_str(&format!(
            "\n# Nexus Guard (single HTTP instance). Routes this project's agent through Nexus.\n# CLI-first alternative (run inside this project): codex mcp add nexus --url \"{bound_url}\"\n[mcp_servers.nexus]\nurl = \"{bound_url}\"\n",
        ));
        write_text_file_atomic(&config_path, &output)?;
        return Ok(AgentConfigEdit {
            path: config_path.to_string_lossy().into_owned(),
            backup,
            diff: if existed {
                "+ [mcp_servers.nexus] url (merged)".to_string()
            } else {
                "+ [mcp_servers.nexus] url (new file)".to_string()
            },
        });
    }
    let existed = config_path.is_file();
    let mut document = match fs::read_to_string(&config_path) {
        Ok(raw) => serde_json::from_str::<serde_json::Value>(&raw)
            .map_err(|_| "The agent config is damaged. Fix the file or delete it and try again.".to_string())?,
        Err(_) => serde_json::json!({}),
    };
    let object = document
        .as_object_mut()
        .ok_or_else(|| "The agent config is damaged. Fix the file or delete it and try again.".to_string())?;
    if agent_id == "opencode" {
        let mcp = object
            .entry("mcp")
            .or_insert_with(|| serde_json::json!({}));
        if mcp.get("servers").is_none() {
            if let Some(mcp_object) = mcp.as_object_mut() {
                mcp_object.insert("servers".to_string(), serde_json::json!({}));
            }
        }
        let servers = mcp
            .get_mut("servers")
            .and_then(|servers| servers.as_object_mut())
            .ok_or_else(|| "The agent config is damaged. Fix the file or delete it and try again.".to_string())?;
        // HTTP-only canonical entry: overwrite any stale stdio `nexus`
        // entry (command/nexus-server.mjs). Bound to this project's
        // workspace by both header and query — the server refuses a request
        // that names neither.
        servers.insert(
            "nexus".to_string(),
            serde_json::json!({
                "type": "remote",
                "url": bound_url,
                "headers": headers,
            }),
        );
        // Drop the legacy duplicate so there is exactly one Nexus entry.
        servers.remove("nexus-http");
    } else {
        let servers = object
            .entry("mcpServers")
            .or_insert_with(|| serde_json::json!({}));
        let servers = servers
            .as_object_mut()
            .ok_or_else(|| "The agent config is damaged. Fix the file or delete it and try again.".to_string())?;
        servers.insert(
            "nexus".to_string(),
            serde_json::json!({
                "type": "http",
                "url": bound_url,
                "headers": headers,
            }),
        );
        // Drop the legacy duplicate so there is exactly one Nexus entry.
        servers.remove("nexus-http");
    }
    let output = serde_json::to_string_pretty(&document)
        .map_err(|_| "Nexus could not save the agent config. Check the folder is writable and try again.".to_string())?
        + "\n";
    // Back up before any overwrite so a bad write can be restored.
    let backup = backup_config_file(&config_path)?;
    write_text_file_atomic(&config_path, &output)?;
    Ok(AgentConfigEdit {
        path: config_path.to_string_lossy().into_owned(),
        backup,
        diff: if existed {
            "+ nexus url (merged)".to_string()
        } else {
            "+ nexus url (new file)".to_string()
        },
    })
}

#[derive(Debug, Serialize)]
struct AgentConfigEdit {
    path: String,
    backup: String,
    diff: String,
}

fn valid_mcp_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

/// Atomic text write via tmp file + rename, so a crash cannot leave a
/// half-written agent config behind. Plain-language errors, secret-free.
fn write_text_file_atomic(config_path: &std::path::Path, contents: &str) -> Result<(), String> {
    let temporary = PathBuf::from(format!(
        "{}.tmp-{}",
        config_path.to_string_lossy(),
        std::process::id()
    ));
    fs::write(&temporary, contents)
        .map_err(|_| "Nexus could not save the agent config. Check the folder is writable and try again.".to_string())?;
    fs::rename(&temporary, config_path)
        .map_err(|_| "Nexus could not save the agent config. Check the folder is writable and try again.".to_string())?;
    Ok(())
}

/// Copy the existing config to `<config>.bak.<unix_nanos>` before any edit.
/// Returns `""` when there is no file yet (nothing to back up).
fn backup_config_file(config_path: &std::path::Path) -> Result<String, String> {
    if !config_path.is_file() {
        return Ok(String::new());
    }
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let backup =
        PathBuf::from(format!("{}.bak.{stamp}", config_path.to_string_lossy()));
    fs::copy(config_path, &backup)
        .map_err(|_| "Nexus could not back up the agent config. Check the folder is writable and try again.".to_string())?;
    Ok(backup.to_string_lossy().into_owned())
}

/// Remove stale `nexus`/`nexus-http` Codex blocks so connect can replace a
/// stdio fallback (or a URL bound to another workspace) with the canonical
/// HTTP `url =` block. All other `[mcp_servers.*]` blocks pass through
/// untouched; comment lines directly above a removed block are dropped too
/// when they mention Nexus, kept otherwise.
fn strip_codex_nexus_blocks(raw: &str) -> String {
    let lines: Vec<&str> = raw.lines().collect();
    // Find header line indexes for nexus blocks.
    let is_nexus_header = |line: &str| {
        let trimmed = line.trim();
        trimmed == "[mcp_servers.nexus]"
            || trimmed == "[mcp_servers.\"nexus\"]"
            || trimmed == "[mcp_servers.nexus-http]"
            || trimmed == "[mcp_servers.\"nexus-http\"]"
    };
    let mut skip = vec![false; lines.len()];
    let mut i = 0;
    while i < lines.len() {
        if is_nexus_header(lines[i]) {
            // Also drop up to 2 directly-preceding Nexus comment lines (plus
            // one blank separator directly above the block).
            let mut back = i;
            let mut dropped = 0;
            while back > 0 && dropped < 2 {
                let prev = lines[back - 1].trim();
                if prev.starts_with('#') && prev.to_lowercase().contains("nexus") {
                    skip[back - 1] = true;
                    back -= 1;
                    dropped += 1;
                } else if prev.is_empty() && dropped == 0 {
                    // Blank separator directly above the block: drop one.
                    skip[back - 1] = true;
                    break;
                } else {
                    break;
                }
            }
            // Drop the header and its body until the next section header.
            skip[i] = true;
            i += 1;
            while i < lines.len() {
                let trimmed = lines[i].trim();
                if trimmed.starts_with('[') {
                    break;
                }
                skip[i] = true;
                i += 1;
            }
            continue;
        }
        i += 1;
    }
    let mut output = String::new();
    for (idx, line) in lines.iter().enumerate() {
        if skip[idx] {
            continue;
        }
        output.push_str(line);
        output.push('\n');
    }
    // Collapse 3+ blank lines left by removals down to at most one.
    let mut collapsed = String::new();
    let mut blanks = 0;
    for line in output.lines() {
        if line.trim().is_empty() {
            blanks += 1;
            if blanks <= 1 {
                collapsed.push('\n');
            }
            continue;
        }
        blanks = 0;
        collapsed.push_str(line);
        collapsed.push('\n');
    }
    collapsed.trim_end_matches('\n').to_string() + if collapsed.trim().is_empty() { "" } else { "\n" }
}

fn compact_json(value: &serde_json::Value) -> String {
    let raw = serde_json::to_string(value).unwrap_or_else(|_| "?".to_string());
    if raw.len() > 200 {
        format!("{}…", &raw[..200])
    } else {
        raw
    }
}

/// Import one MCP entry pointing at the Nexus HTTP server into the agent's
/// project config. Paper: HTTP-only entries. Used to adopt an existing
/// direct (`found,unmanaged`) entry's slot onto Nexus: backs up first
/// (`<config>.bak.<nanos>`, `""` when new), writes atomically (tmp+rename),
/// returns the backup path and a diff summary. The UI must confirm before
/// calling; unknown entries are never silently re-routed. JSON agents get a
/// workspace-bound remote `url` entry (`?workspace=` + `X-Nexus-Workspace`
/// header); Codex gets a `[mcp_servers.<name>]` block with `url =`
/// (its own `codex mcp add <name> --url …` CLI stays preferred).
#[tauri::command]
fn import_agent_entry(
    workspace_path: String,
    agent_id: String,
    name: String,
    url: Option<String>,
) -> Result<AgentConfigEdit, String> {
    let name = name.trim().to_string();
    if !valid_mcp_name(&name) {
        return Err("That entry name is invalid. Use letters, numbers, - or _.".to_string());
    }
    let http_url = url
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(default_nexus_http_url);
    if !http_url.starts_with("http://") && !http_url.starts_with("https://") {
        return Err("That Nexus URL is invalid. Use an http:// or https:// address.".to_string());
    }
    let workspace = expand_workspace_path(&workspace_path);
    let workspace = fs::canonicalize(&workspace)
        .map_err(|_| "Nexus could not open that folder. Check the path still exists and try again.".to_string())?;
    if !workspace.is_dir() {
        return Err("The project path is not a folder. Choose a folder and try again.".to_string());
    }
    let config_path = agent_config_path(&workspace, agent_id.as_str()).ok_or_else(|| {
        "Import for this agent is manual: use its CLI (claude mcp add --transport http nexus <url>).".to_string()
    })?;
    if agent_id == "codex" {
        if let Some(parent) = config_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|_| "Nexus could not create the agent config folder. Check the folder is writable and try again.".to_string())?;
        }
        let existing = fs::read_to_string(&config_path).unwrap_or_default();
        let header = format!("[mcp_servers.{name}]");
        if existing.contains(&header) {
            return Ok(AgentConfigEdit {
                path: config_path.to_string_lossy().into_owned(),
                backup: String::new(),
                diff: format!("{name} is already in the Codex config; nothing changed."),
            });
        }
        let backup = backup_config_file(&config_path)?;
        let mut output = existing;
        if !output.is_empty() && !output.ends_with('\n') {
            output.push('\n');
        }
        let http_url = nexus_http_url_for_workspace(&http_url, &workspace);
        output.push_str(&format!(
            "\n# Imported by Nexus Guard. Preferred (CLI-first): codex mcp add {name} --url \"{http_url}\"\n{header}\nurl = \"{http_url}\"\n"
        ));
        write_text_file_atomic(&config_path, &output)?;
        return Ok(AgentConfigEdit {
            path: config_path.to_string_lossy().into_owned(),
            backup,
            diff: format!("+ {header} -> {http_url}"),
        });
    }
    let existed = config_path.is_file();
    let mut document = match fs::read_to_string(&config_path) {
        Ok(raw) => serde_json::from_str::<serde_json::Value>(&raw)
            .map_err(|_| "The agent config is damaged. Fix the file or delete it and try again.".to_string())?,
        Err(_) => serde_json::json!({}),
    };
    let object = document
        .as_object_mut()
        .ok_or_else(|| "The agent config is damaged. Fix the file or delete it and try again.".to_string())?;
    // Bind the adopted entry to this project: URL query for agents without
    // header support, plus the header the bridge prefers.
    let http_url = nexus_http_url_for_workspace(&http_url, &workspace);
    let headers = nexus_workspace_headers(&workspace);
    let entry = if agent_id == "opencode" {
        serde_json::json!({ "type": "remote", "url": http_url, "headers": headers })
    } else {
        serde_json::json!({ "type": "http", "url": http_url, "headers": headers })
    };
    if agent_id == "opencode" {
        let mcp = object
            .entry("mcp")
            .or_insert_with(|| serde_json::json!({}));
        if mcp.get("servers").is_none() {
            if let Some(mcp_object) = mcp.as_object_mut() {
                mcp_object.insert("servers".to_string(), serde_json::json!({}));
            }
        }
        let servers = mcp
            .get_mut("servers")
            .and_then(|servers| servers.as_object_mut())
            .ok_or_else(|| "The agent config is damaged. Fix the file or delete it and try again.".to_string())?;
        servers.insert(name.clone(), entry);
    } else {
        let servers = object
            .entry("mcpServers")
            .or_insert_with(|| serde_json::json!({}));
        let servers = servers
            .as_object_mut()
            .ok_or_else(|| "The agent config is damaged. Fix the file or delete it and try again.".to_string())?;
        servers.insert(name.clone(), entry);
    }
    let backup = backup_config_file(&config_path)?;
    let output = serde_json::to_string_pretty(&document)
        .map_err(|_| "Nexus could not save the agent config. Check the folder is writable and try again.".to_string())?
        + "\n";
    write_text_file_atomic(&config_path, &output)?;
    Ok(AgentConfigEdit {
        path: config_path.to_string_lossy().into_owned(),
        backup,
        diff: if existed {
            format!("+ {name} -> {http_url} (merged)")
        } else {
            format!("+ {name} -> {http_url} (new file)")
        },
    })
}

/// Remove one direct (`found,unmanaged`) MCP entry from the agent's project
/// config. Paper: HTTP-only entries; removal targets the named entry
/// whatever its transport. Backs up first (`<config>.bak.<nanos>`), writes
/// atomically (tmp+rename), returns the backup path plus a diff summary
/// (including the removed entry's old value). The UI must confirm before
/// calling; with-confirm removal only, never silent.
#[tauri::command]
fn remove_agent_entry(
    workspace_path: String,
    agent_id: String,
    name: String,
) -> Result<AgentConfigEdit, String> {
    let name = name.trim().to_string();
    if !valid_mcp_name(&name) {
        return Err("That entry name is invalid. Use letters, numbers, - or _.".to_string());
    }
    let workspace = expand_workspace_path(&workspace_path);
    let workspace = fs::canonicalize(&workspace)
        .map_err(|_| "Nexus could not open that folder. Check the path still exists and try again.".to_string())?;
    if !workspace.is_dir() {
        return Err("The project path is not a folder. Choose a folder and try again.".to_string());
    }
    let config_path = agent_config_path(&workspace, agent_id.as_str())
        .ok_or_else(|| "Unknown agent. Choose Codex, Claude Code, Pi, or OpenCode.".to_string())?;
    let raw = fs::read_to_string(&config_path)
        .map_err(|_| "No agent config written yet. Nothing to remove.".to_string())?;
    if agent_id == "codex" {
        let header = format!("[mcp_servers.{name}]");
        if !raw.contains(&header) {
            return Err("That entry is not in the agent config.".to_string());
        }
        let backup = backup_config_file(&config_path)?;
        let mut output = String::new();
        let mut skipping = false;
        for line in raw.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("[mcp_servers.") || trimmed.starts_with('[') {
                skipping = trimmed == header;
                if skipping {
                    continue;
                }
            }
            if skipping {
                continue;
            }
            output.push_str(line);
            output.push('\n');
        }
        write_text_file_atomic(&config_path, &output)?;
        return Ok(AgentConfigEdit {
            path: config_path.to_string_lossy().into_owned(),
            backup,
            diff: format!("- {header} (removed)"),
        });
    }
    let mut document = serde_json::from_str::<serde_json::Value>(&raw)
        .map_err(|_| "The agent config is damaged. Fix the file or delete it and try again.".to_string())?;
    let object = document
        .as_object_mut()
        .ok_or_else(|| "The agent config is damaged. Fix the file or delete it and try again.".to_string())?;
    let removed = if agent_id == "opencode" {
        object
            .get_mut("mcp")
            .and_then(|mcp| mcp.get_mut("servers"))
            .and_then(|servers| servers.as_object_mut())
            .and_then(|servers| servers.remove(&name))
    } else {
        object
            .get_mut("mcpServers")
            .and_then(|servers| servers.as_object_mut())
            .and_then(|servers| servers.remove(&name))
    };
    let Some(removed) = removed else {
        return Err("That entry is not in the agent config.".to_string());
    };
    let backup = backup_config_file(&config_path)?;
    let output = serde_json::to_string_pretty(&document)
        .map_err(|_| "Nexus could not save the agent config. Check the folder is writable and try again.".to_string())?
        + "\n";
    write_text_file_atomic(&config_path, &output)?;
    Ok(AgentConfigEdit {
        path: config_path.to_string_lossy().into_owned(),
        backup,
        diff: format!("- {name} (was: {})", compact_json(&removed)),
    })
}

/// Live session probe: `GET /context?workspace=<ws>` with the
/// `X-Nexus-Workspace` header against the Nexus HTTP server behind
/// `http_url`. Returns `(ok, detail)`. Plain `TcpStream` on purpose (no new
/// dependency); short timeouts, every parse/connect/read failure is
/// `(false, reason)`. Never panics. A 200 means the server minted/validated
/// a session for this workspace; 400 with the missing-workspace reason
/// means the binding was lost; anything else means the server is up but the
/// project is not resolving.
fn probe_http_session(http_url: &str, workspace: &std::path::Path) -> (bool, String) {
    let parsed = match url::Url::parse(http_url) {
        Ok(parsed) => parsed,
        Err(_) => return (false, "That Nexus URL is invalid. Use an http:// address.".to_string()),
    };
    if parsed.scheme() != "http" {
        return (false, "Session probe needs a local http:// Nexus URL.".to_string());
    }
    let host = parsed.host_str().unwrap_or("").to_string();
    if host.is_empty() {
        return (false, "That Nexus URL is invalid. Use an http:// address.".to_string());
    }
    let port = parsed.port().unwrap_or(80);
    let ws = workspace.to_string_lossy().into_owned();
    let encoded: String = form_urlencoded::byte_serialize(ws.as_bytes()).collect();
    let timeout = std::time::Duration::from_millis(900);
    let addrs: Vec<std::net::SocketAddr> = match format!("{host}:{port}").to_socket_addrs() {
        Ok(addrs) => addrs.collect(),
        Err(_) => return (false, "Nexus HTTP server is not reachable. Start it and try again.".to_string()),
    };
    let mut connected = None;
    for addr in addrs {
        match TcpStream::connect_timeout(&addr, timeout) {
            Ok(candidate) => {
                connected = Some(candidate);
                break;
            }
            Err(_) => continue,
        }
    }
    let mut stream = match connected {
        Some(stream) => stream,
        None => return (false, "Nexus HTTP server is not running. Start it and try again.".to_string()),
    };
    if stream.set_read_timeout(Some(timeout)).is_err()
        || stream.set_write_timeout(Some(timeout)).is_err()
    {
        return (false, "Nexus HTTP server is not reachable. Start it and try again.".to_string());
    }
    let request = format!(
        "GET /context?workspace={encoded} HTTP/1.0\r\nHost: {host}\r\n{XNW}: {ws}\r\nConnection: close\r\n\r\n",
        XNW = NEXUS_WORKSPACE_HEADER,
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return (false, "Nexus HTTP server is not reachable. Start it and try again.".to_string());
    }
    let mut response = Vec::with_capacity(1024);
    let mut chunk = [0u8; 2048];
    loop {
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(size) => {
                response.extend_from_slice(&chunk[..size]);
                if response.len() > 16384 {
                    break;
                }
            }
            Err(_) => break,
        }
    }
    let text = String::from_utf8_lossy(&response).into_owned();
    let mut lines = text.lines();
    let status = lines.next().unwrap_or("");
    if status.contains(" 200 ") {
        if text.contains("\"ok\":true") || text.contains("\"session\"") {
            (true, "Nexus resolved this workspace over HTTP.".to_string())
        } else {
            (true, "Nexus answered for this workspace over HTTP.".to_string())
        }
    } else if status.contains(" 400 ") {
        (false, "Nexus answered but the workspace binding was missing. Re-run connect for this project.".to_string())
    } else if status.contains(" 423 ") {
        (false, "Nexus vault is locked. Unlock Nexus Guard and try again.".to_string())
    } else if status.is_empty() {
        (false, "Nexus HTTP server is not reachable. Start it and try again.".to_string())
    } else {
        (false, format!("Nexus answered with an unexpected status: {status}"))
    }
}

/// Test an agent connection end to end as far as Nexus controls it:
/// manifest, HTTP reachability, session mint/validate, saved approval, and
/// the written agent config. Paper: the old "Bridge script" step is gone —
/// there is no per-agent stdio bridge anymore. Steps returned, in order:
/// "Project file", "HTTP reachable", "Session", "Saved approval",
/// "Agent config". `bridge_path` is legacy ignored (kept as `Option` so
/// older callers still invoke); `http_url` defaults to the local server.
#[tauri::command]
fn test_agent_setup(
    workspace_path: String,
    agent_id: String,
    http_url: Option<String>,
    bridge_path: Option<String>,
) -> Result<Vec<AgentSetupTest>, String> {
    let _ = bridge_path;
    let mut steps = Vec::new();
    let workspace = expand_workspace_path(&workspace_path);
    let workspace = fs::canonicalize(&workspace)
        .map_err(|_| "Nexus could not open that folder. Check the path still exists and try again.".to_string())?;
    let effective_http_url = http_url
        .map(|url| url.trim().to_string())
        .filter(|url| !url.is_empty())
        .unwrap_or_else(default_nexus_http_url);
    let manifest_raw = fs::read_to_string(workspace.join(".nexus").join("project.json"))
        .map_err(|_| "No .nexus/project.json here. Save a connection first.".to_string());
    let manifest: Option<serde_json::Value> = match manifest_raw {
        Ok(raw) => match serde_json::from_str(&raw) {
            Ok(manifest) => Some(manifest),
            Err(_) => {
                steps.push(AgentSetupTest { step: "Project file".to_string(), ok: false, detail: "The Nexus project file is damaged. Save the connection again to recreate it.".to_string() });
                None
            }
        },
        Err(reason) => {
            steps.push(AgentSetupTest { step: "Project file".to_string(), ok: false, detail: reason });
            None
        }
    };
    if let Some(manifest) = &manifest {
        let name = manifest.get("project").and_then(|value| value.as_str()).unwrap_or("?");
        steps.push(AgentSetupTest { step: "Project file".to_string(), ok: true, detail: format!("Agents opening this folder resolve {name}."), });
    }
    // Paper: "HTTP reachable" replaces the old "Bridge script" step.
    // Probes GET /healthz on the single HTTP instance via `probe_http_agent`.
    if probe_http_agent(&effective_http_url) {
        steps.push(AgentSetupTest { step: "HTTP reachable".to_string(), ok: true, detail: format!("Nexus HTTP is answering at {effective_http_url}."), });
    } else {
        steps.push(AgentSetupTest { step: "HTTP reachable".to_string(), ok: false, detail: "Nexus HTTP server is not reachable. Start it and try again.".to_string() });
    }
    // "Session mint/validate" where feasible: GET /context for this
    // workspace. Fails closed when the server is down or the binding is
    // missing — never panics, never leaks credentials.
    let (session_ok, session_detail) = probe_http_session(&effective_http_url, &workspace);
    steps.push(AgentSetupTest { step: "Session".to_string(), ok: session_ok, detail: session_detail });
    if let Some(manifest) = &manifest {
        let empty = serde_json::Map::new();
        let connections = manifest.get("connections").and_then(|value| value.as_object()).unwrap_or(&empty);
        let project_id = manifest.get("project_id").and_then(|value| value.as_str()).unwrap_or("");
        let mut checked = false;
        for (provider, entry) in connections {
            if provider.to_lowercase() != "supabase" {
                continue;
            }
            let connection_id = entry.get("connection_id").and_then(|value| value.as_str()).unwrap_or("");
            let status = entry.get("status").and_then(|value| value.as_str()).unwrap_or("");
            if status != "connected" || connection_id.is_empty() || project_id.is_empty() {
                continue;
            }
            checked = true;
            let key = format!("mcp:supabase:{project_id}:{connection_id}");
            match keyring::Entry::new("com.nexusguard.app", &key).and_then(|entry| entry.get_password()) {
                Ok(_) => steps.push(AgentSetupTest { step: "Saved approval".to_string(), ok: true, detail: "The vault holds this project's Supabase approval.".to_string() }),
                Err(_) => steps.push(AgentSetupTest { step: "Saved approval".to_string(), ok: false, detail: "No approval in this vault. Reconnect the service.".to_string() }),
            }
        }
        if !checked {
            steps.push(AgentSetupTest { step: "Saved approval".to_string(), ok: false, detail: "No connected Supabase resource on this project yet.".to_string() });
        }
    }
    let config_path = agent_config_path(&workspace, agent_id.as_str());
    let config_path = match (agent_id.as_str(), config_path) {
        ("other", None) => None,
        (_, Some(path)) => Some(path),
        _ => return Err("Unknown agent. Choose Codex, Claude Code, Pi, or OpenCode.".to_string()),
    };
    match config_path {
        None => {
            // Manual agents: readiness only, no known file to check.
        }
        Some(config_path) => match fs::read_to_string(&config_path) {
            Ok(raw) if raw.contains("nexus") && raw.contains("workspace=") => steps.push(AgentSetupTest { step: "Agent config".to_string(), ok: true, detail: format!("{} points at Nexus over HTTP.", config_path.file_name().and_then(|name| name.to_str()).unwrap_or("config")) }),
            Ok(raw) if raw.contains("nexus") => steps.push(AgentSetupTest { step: "Agent config".to_string(), ok: false, detail: "The agent config has a Nexus entry but it is not workspace-bound HTTP. Re-run connect.".to_string() }),
            Ok(_) => steps.push(AgentSetupTest { step: "Agent config".to_string(), ok: false, detail: "The agent config exists but has no Nexus entry.".to_string() }),
            Err(_) => steps.push(AgentSetupTest { step: "Agent config".to_string(), ok: false, detail: "No agent config written yet. Write it first.".to_string() }),
        },
    }
    Ok(steps)
}

/// Absolute node binary for MCP configs. GUI-launched agents rarely inherit
/// nvm's PATH, so generated configs must not rely on bare `node`.
#[tauri::command]
fn node_binary_path() -> String {
    find_node_binary()
}

#[tauri::command]
fn detect_agents() -> Vec<DetectedAgent> {
    let home = env::var_os("HOME").map(PathBuf::from);    let has_config = |relative: &str| -> bool {
        home.as_ref()
            .map(|base| base.join(relative).exists())
            .unwrap_or(false)
    };
    let candidates: &[(&str, &str, &[&str], &[&str], &str)] = &[
        ("codex", "Codex", &["codex"], &[".codex"], ".codex/config.toml [mcp_servers.nexus]"),
        ("claude", "Claude Code", &["claude"], &[".claude.json", ".claude"], ".mcp.json → mcpServers.nexus"),
        ("pi", "Pi agent", &["pi"], &[".pi"], ".mcp.json (or .pi/mcp.json) → mcpServers.nexus"),
        ("opencode", "OpenCode", &["opencode"], &[".config/opencode"], "opencode.json → mcp.servers.nexus"),
        ("gemini", "Gemini CLI", &["gemini"], &[".gemini"], ".mcp.json → mcpServers.nexus"),
        ("cursor", "Cursor", &["cursor", "cursor-agent"], &[".cursor"], ".cursor/mcp.json → mcpServers.nexus"),
        ("windsurf", "Windsurf", &["windsurf"], &[".windsurf", ".codeium"], "~/.codeium/windsurf/mcp_config.json"),
        ("aider", "Aider", &["aider"], &[".aider.conf.yml"], "Aider has no MCP client; use Nexus via shell only"),
    ];
    // One shared probe: every agent reaches the same local Nexus HTTP server.
    let http_url = default_nexus_http_url();
    let port = nexus_http_port(&http_url);
    let http_reachable = probe_http_agent(&http_url);
    candidates
        .iter()
        .map(|(id, name, binaries, configs, nexus_config)| {
            let binary = binaries.iter().any(|name| executable_in_path(name));
            let config = configs.iter().find(|path| has_config(path)).map(|path| path.to_string());
            let found = binary || config.is_some();
            let mut parts = Vec::new();
            if binary {
                parts.push("command installed".to_string());
            }
            if let Some(path) = config {
                parts.push(format!("config at ~/{path}"));
            }
            DetectedAgent {
                id: id.to_string(),
                name: name.to_string(),
                found,
                detail: if found { parts.join(" · ") } else { "not detected on this machine".to_string() },
                nexus_config: nexus_config.to_string(),
                http_reachable: http_reachable,
                unmanaged: unmanaged_for_agent(id, &port),
            }
        })
        .collect()
}

#[tauri::command]
fn remove_nexus_connection(workspace_path: String, provider: String) -> Result<String, String> {
    // Removes only the named provider entry; all other services keep their
    // persisted { account, resource, target } fields untouched.
    let workspace = expand_workspace_path(&workspace_path);
    let workspace = fs::canonicalize(&workspace)
        .map_err(|_| "Nexus could not open that folder. Check the path still exists and try again.".to_string())?;
    let manifest_path = workspace.join(".nexus").join("project.json");
    let raw = fs::read_to_string(&manifest_path)
        .map_err(|_| "Nexus could not read the project file. Check the path still exists and try again.".to_string())?;
    let mut manifest = serde_json::from_str::<serde_json::Value>(&raw)
        .map_err(|_| "The Nexus project file is damaged. Remove .nexus/project.json and save the connection again to recreate it.".to_string())?;
    let removed = manifest
        .get_mut("connections")
        .and_then(|connections| connections.as_object_mut())
        .map(|connections| connections.remove(&provider.to_lowercase()).is_some())
        .unwrap_or(false);
    if !removed {
        return Err("That service is not linked in the Nexus project file. Nothing to remove.".to_string());
    }
    let output = serde_json::to_string_pretty(&manifest)
        .map_err(|_| "Nexus could not save the project file. Check the folder is writable and try again.".to_string())?
        + "\n";
    let nexus_dir = workspace.join(".nexus");
    let temporary = nexus_dir.join("project.json.tmp");
    fs::write(&temporary, output)
        .map_err(|_| "Nexus could not save the project file. Check the folder is writable and try again.".to_string())?;
    fs::rename(&temporary, &manifest_path)
        .map_err(|_| "Nexus could not save the project file. Check the folder is writable and try again.".to_string())?;
    Ok(manifest_path.to_string_lossy().into_owned())
}

/// The local Nexus HTTP server the app keeps running for agents. Owned here so
/// it stops when the app closes (the vault locks then too, so agents would be
/// refused anyway).
#[derive(Default)]
struct NexusServer(Mutex<Option<std::process::Child>>);

#[derive(Serialize)]
struct NexusServerStatus {
    running: bool,
    /// True when the fix is installing Node.js (missing or older than 20).
    needs_node: bool,
    started_by_app: bool,
    url: String,
    detail: String,
}

/// Find `mcp/nexus-http-server.mjs`: an explicit override, the app's bundled
/// resources, or the source checkout the app was built from.
fn nexus_server_script(resource_dir: Option<PathBuf>) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(custom) = env::var_os("NEXUS_MCP_SERVER") {
        candidates.push(PathBuf::from(custom));
    }
    if let Some(dir) = resource_dir {
        candidates.push(dir.join("mcp").join("nexus-http-server.mjs"));
        candidates.push(dir.join("_up_").join("mcp").join("nexus-http-server.mjs"));
    }
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("mcp").join("nexus-http-server.mjs"));
    candidates.into_iter().find(|path| path.is_file())
}

/// Start the Nexus HTTP server unless something already answers on its port.
/// Never panics; a failure comes back as a plain-language `detail`.
fn ensure_nexus_server_running(app: &tauri::AppHandle) -> NexusServerStatus {
    use tauri::Manager;
    let url = default_nexus_http_url();
    let state = app.state::<NexusServer>();
    let mut slot = match state.0.lock() {
        Ok(slot) => slot,
        Err(_) => return NexusServerStatus { running: false, needs_node: false, started_by_app: false, url, detail: "Nexus could not check its local server. Restart the app.".to_string() },
    };
    // Forget a child that has exited so it can be started again.
    if let Some(child) = slot.as_mut() {
        if matches!(child.try_wait(), Ok(Some(_))) {
            *slot = None;
        }
    }
    let started_by_app = slot.is_some();
    if probe_http_agent(&url) {
        return NexusServerStatus { running: true, needs_node: false, started_by_app, url, detail: "Nexus is running.".to_string() };
    }
    let script = match nexus_server_script(app.path().resource_dir().ok()) {
        Some(script) => script,
        None => return NexusServerStatus { running: false, needs_node: false, started_by_app: false, url, detail: "Nexus could not find its server files. Reinstall the app, or run `node mcp/nexus-http-server.mjs` from the project.".to_string() },
    };
    let node = find_node_binary();
    match node_major_version(&node) {
        None => return NexusServerStatus { running: false, needs_node: true, started_by_app: false, url, detail: format!("Nexus needs Node.js {MIN_NODE_MAJOR} or newer to run its local server, and none was found. Install it from nodejs.org, then reopen Nexus.") },
        Some(major) if major < MIN_NODE_MAJOR => return NexusServerStatus { running: false, needs_node: true, started_by_app: false, url, detail: format!("Nexus needs Node.js {MIN_NODE_MAJOR} or newer, but found version {major}. Update it from nodejs.org, then reopen Nexus.") },
        Some(_) => {}
    }
    let mut command = std::process::Command::new(&node);
    if env::var_os("NEXUS_KEYRING_BIN").is_none() {
        if let Some(keyring) = bundled_keyring_binary() {
            command.env("NEXUS_KEYRING_BIN", keyring);
        }
    }
    let child = command
        .arg(&script)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn();
    match child {
        Ok(child) => *slot = Some(child),
        Err(_) => return NexusServerStatus { running: false, needs_node: false, started_by_app: false, url, detail: "Nexus could not start its local server. Check that Node.js runs from a terminal, then reopen Nexus.".to_string() },
    }
    drop(slot);
    for _ in 0..30 {
        thread::sleep(std::time::Duration::from_millis(100));
        if probe_http_agent(&url) {
            return NexusServerStatus { running: true, needs_node: false, started_by_app: true, url, detail: "Nexus started.".to_string() };
        }
    }
    NexusServerStatus { running: false, needs_node: false, started_by_app: true, url, detail: "Nexus started its server but it is not answering yet. Another program may be using the port.".to_string() }
}

#[tauri::command]
fn ensure_nexus_server(app: tauri::AppHandle) -> NexusServerStatus {
    ensure_nexus_server_running(&app)
}

fn stop_nexus_server(app: &tauri::AppHandle) {
    use tauri::Manager;
    if let Ok(mut slot) = app.state::<NexusServer>().0.lock() {
        if let Some(mut child) = slot.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

// ---- GitHub: each user approves Nexus with their own GitHub account ----

#[derive(Serialize)]
struct GithubStatus {
    /// False when this build has no GitHub App client ID.
    configured: bool,
    /// Where to install the Nexus GitHub App on the user's repositories.
    install_url: Option<String>,
}

#[tauri::command]
fn github_status() -> GithubStatus {
    GithubStatus {
        configured: github_auth::client_id().is_some(),
        install_url: github_auth::app_slug().map(|slug| format!("https://github.com/apps/{slug}/installations/new")),
    }
}

fn github_key(project_id: &str, connection_id: &str) -> Result<String, String> {
    let valid = |value: &str| !value.is_empty() && value.len() <= 128 && value.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
    if !valid(project_id) || !valid(connection_id) {
        return Err("That GitHub connection is not valid. Start again.".to_string());
    }
    Ok(format!("mcp:github:{project_id}:{connection_id}"))
}

fn github_client_id_or_explain() -> Result<String, String> {
    github_auth::client_id().ok_or_else(|| "GitHub is not set up in this build yet. Add the Nexus GitHub App client ID, or enter the details manually.".to_string())
}

fn github_get(url: &str, token: &str) -> Result<serde_json::Value, String> {
    let text = ureq::get(url)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .header("User-Agent", "Nexus-Guard")
        .header("Authorization", &format!("Bearer {token}"))
        .call()
        .map_err(|_| "GitHub did not answer. Check your network, or connect GitHub again.".to_string())?
        .into_body()
        .read_to_string()
        .map_err(|_| "GitHub returned something unexpected. Try again in a moment.".to_string())?;
    serde_json::from_str(&text).map_err(|_| "GitHub returned something unexpected. Try again in a moment.".to_string())
}

/// This binding's stored tokens, renewed first when they are about to expire.
fn github_tokens(key: &str) -> Result<github_auth::Tokens, String> {
    let entry = keyring_entry(key)?;
    let raw = entry.get_password().map_err(|_| "GitHub is not connected for this binding. Connect it again.".to_string())?;
    let tokens = github_auth::Tokens::from_json(&raw).ok_or_else(|| "The saved GitHub approval is unreadable. Connect GitHub again.".to_string())?;
    if !tokens.needs_refresh(github_auth::now_secs()) {
        return Ok(tokens);
    }
    let refresh_token = tokens.refresh_token.clone().unwrap_or_default();
    let renewed = github_auth::refresh(&github_client_id_or_explain()?, &refresh_token)?;
    entry.set_password(&renewed.to_json()).map_err(|_| "The system keychain is unavailable. Unlock it and try again.".to_string())?;
    Ok(renewed)
}

#[tauri::command]
async fn start_github_device_flow() -> Result<github_auth::DeviceStart, String> {
    let client_id = github_client_id_or_explain()?;
    tauri::async_runtime::spawn_blocking(move || github_auth::start(&client_id))
        .await
        .map_err(|_| "Nexus could not start the GitHub sign-in. Try again.".to_string())?
}

#[derive(Serialize)]
struct GithubPollResult {
    /// pending | slow_down | done | expired | denied
    status: String,
    login: Option<String>,
}

/// Check once whether the user has approved. On approval the tokens go straight
/// to the OS keychain; the page only ever learns the GitHub username.
#[tauri::command]
async fn poll_github_device_flow(device_code: String, project_id: String, connection_id: String) -> Result<GithubPollResult, String> {
    let key = github_key(&project_id, &connection_id)?;
    let client_id = github_client_id_or_explain()?;
    tauri::async_runtime::spawn_blocking(move || {
        let status = |value: &str| Ok(GithubPollResult { status: value.to_string(), login: None });
        match github_auth::poll(&client_id, &device_code)? {
            github_auth::Poll::Pending => status("pending"),
            github_auth::Poll::SlowDown => status("slow_down"),
            github_auth::Poll::Expired => status("expired"),
            github_auth::Poll::Denied => status("denied"),
            github_auth::Poll::Done(tokens) => {
                keyring_entry(&key)?
                    .set_password(&tokens.to_json())
                    .map_err(|_| "The system keychain is unavailable. Unlock it (or sign in to the computer) and try again.".to_string())?;
                let login = github_get("https://api.github.com/user", &tokens.access_token)
                    .ok()
                    .and_then(|user| user.get("login").and_then(|v| v.as_str()).map(str::to_string));
                Ok(GithubPollResult { status: "done".to_string(), login })
            }
        }
    })
    .await
    .map_err(|_| "Nexus could not check the GitHub sign-in. Try again.".to_string())?
}

#[derive(Serialize)]
struct GithubRepo {
    full_name: String,
    private: bool,
}

/// The repositories this user has installed the Nexus GitHub App on.
#[tauri::command]
async fn list_github_repos(project_id: String, connection_id: String) -> Result<Vec<GithubRepo>, String> {
    let key = github_key(&project_id, &connection_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let token = github_tokens(&key)?.access_token;
        let installations = github_get("https://api.github.com/user/installations?per_page=100", &token)?;
        let mut repos = Vec::new();
        for installation in installations.get("installations").and_then(|v| v.as_array()).cloned().unwrap_or_default() {
            let Some(id) = installation.get("id").and_then(|v| v.as_u64()) else { continue };
            let page = github_get(&format!("https://api.github.com/user/installations/{id}/repositories?per_page=100"), &token)?;
            for repo in page.get("repositories").and_then(|v| v.as_array()).cloned().unwrap_or_default() {
                if let Some(full_name) = repo.get("full_name").and_then(|v| v.as_str()) {
                    repos.push(GithubRepo { full_name: full_name.to_string(), private: repo.get("private").and_then(|v| v.as_bool()).unwrap_or(false) });
                }
            }
        }
        repos.sort_by(|a, b| a.full_name.to_lowercase().cmp(&b.full_name.to_lowercase()));
        repos.dedup_by(|a, b| a.full_name == b.full_name);
        Ok(repos)
    })
    .await
    .map_err(|_| "Nexus could not load your GitHub repositories. Try again.".to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // A new desktop process always starts locked. The HTTP bridge treats
            // a missing state file as locked as well, so a crash cannot leave a
            // stale unlocked state behind for normal app startup.
            let _ = write_vault_state(true);
            // Bring the local Nexus server up in the background so agents have
            // something to reach without a terminal.
            let handle = app.handle().clone();
            thread::spawn(move || { let _ = ensure_nexus_server_running(&handle); });
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                let _ = write_vault_state(true);
                { use tauri::Manager; stop_nexus_server(window.app_handle()); }
            }
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(OAuthManager::default())
        .manage(NexusServer::default())
        // IMPORTANT: Tauri converts each command parameter name to lowerCamelCase
        // before matching request args. The frontend must therefore send camelCase
        // keys (workspacePath, projectId, …) even though Rust names stay snake_case.
        .invoke_handler(tauri::generate_handler![
            start_supabase_mcp_oauth,
            poll_supabase_mcp_oauth,
            vault_unlock,
            vault_lock,
            vault_save_secret,
            vault_has_secret,
            vault_delete_secret,
            write_nexus_project_file,
            register_nexus_project,
            remove_nexus_connection,
            read_audit_log,
            supabase_list_projects,
            detect_agents,
            scan_project_mcp,
            inspect_project_folder,
            create_project_folder,
            current_user,
            verify_supabase_connection,
            connect_agent_to_project,
            import_agent_entry,
            remove_agent_entry,
            test_agent_setup,
            node_binary_path,
            ensure_nexus_server,
            github_status,
            start_github_device_flow,
            poll_github_device_flow,
            list_github_repos
        ])
        .run(tauri::generate_context!())
        .expect("error while running Nexus Guard");
}

#[cfg(test)]
mod agent_setup_tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn node_versions_parse_to_a_major() {
        assert_eq!(parse_node_major("v20.11.1\n"), Some(20));
        assert_eq!(parse_node_major("v18.0.0"), Some(18));
        assert_eq!(parse_node_major("26.3.0"), Some(26));
        assert_eq!(parse_node_major("not node"), None);
    }

    #[test]
    fn server_script_is_found_in_the_source_checkout() {
        let script = nexus_server_script(None).expect("source checkout has the server script");
        assert!(script.ends_with("nexus-http-server.mjs"));
    }

    // The HTTP bridge refuses a request that names no workspace, so every
    // registration Nexus writes must carry this project's path.
    #[test]
    fn http_url_binds_one_workspace_and_replaces_a_stale_one() {
        let base = "http://127.0.0.1:3939/mcp";
        let bound = nexus_http_url_for_workspace(base, std::path::Path::new("/home/dev/koupa"));
        assert_eq!(bound, "http://127.0.0.1:3939/mcp?workspace=%2Fhome%2Fdev%2Fkoupa");

        // Two projects on the same server get two distinct URLs.
        let other = nexus_http_url_for_workspace(base, std::path::Path::new("/home/dev/nabdh"));
        assert_ne!(bound, other);

        // Re-binding replaces the old workspace instead of appending a second.
        let rebound = nexus_http_url_for_workspace(&bound, std::path::Path::new("/home/dev/nabdh"));
        assert_eq!(rebound, other);
        assert_eq!(rebound.matches("workspace=").count(), 1);

        // Unrelated query params survive.
        let extra = nexus_http_url_for_workspace(
            "http://127.0.0.1:3939/mcp?trace=1",
            std::path::Path::new("/home/dev/koupa"),
        );
        assert!(extra.contains("trace=1"), "lost unrelated query: {extra}");
        assert!(extra.contains("workspace=%2Fhome%2Fdev%2Fkoupa"), "{extra}");

        // A space in the path stays encoded, so the URL survives a config file.
        let spaced = nexus_http_url_for_workspace(base, std::path::Path::new("/home/dev/my app"));
        assert!(!spaced.contains("my app"), "unencoded space: {spaced}");
        assert!(spaced.contains("my+app") || spaced.contains("my%20app"), "{spaced}");

        // Header form names the same workspace.
        let headers = nexus_workspace_headers(std::path::Path::new("/home/dev/koupa"));
        assert_eq!(headers[NEXUS_WORKSPACE_HEADER], "/home/dev/koupa");
    }

    // The bridge stamps `agent` on every audit line. Without the struct field
    // serde drops it silently and the UI can never name who made a call.
    #[test]
    fn audit_log_keeps_the_agent_that_made_the_call() {
        let dir = unique_dir("nexus-audit-agent");
        fs::create_dir_all(dir.join(".nexus")).unwrap();
        fs::write(
            dir.join(".nexus").join("audit.log"),
            // Shaped like a real bridge line, agent included.
            "{\"ts\":\"2026-09-28T09:00:00.000Z\",\"session\":\"s-1\",\"agent\":\"claude-code\",\"project\":\"Koupa\",\"project_id\":\"koupa\",\"environment\":\"development\",\"provider\":\"supabase\",\"resource\":\"koupa-development\",\"operation\":\"list_tables\",\"decision\":\"allow\"}\n\
             {\"ts\":\"2026-09-28T09:01:00.000Z\",\"session\":\"s-2\",\"project\":\"Koupa\",\"operation\":\"delete_table\",\"decision\":\"block\",\"reason\":\"destructive\"}\n",
        )
        .unwrap();

        let entries = read_audit_log(dir.to_string_lossy().into_owned(), None).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].agent.as_deref(), Some("claude-code"));
        // A line written before agent identity existed still parses.
        assert_eq!(entries[1].agent, None);
        assert_eq!(entries[1].decision.as_deref(), Some("block"));

        // The field survives the round-trip back out to the frontend.
        let json = serde_json::to_string(&entries[0]).unwrap();
        assert!(json.contains("\"agent\":\"claude-code\""), "{json}");

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn connect_writes_an_http_entry_bound_to_this_project() {
        for (agent, config_name) in [("claude", ".mcp.json"), ("opencode", "opencode.json")] {
            let dir = unique_dir(&format!("nexus-agent-bound-{agent}"));
            write_manifest(&dir);
            let workspace = dir.to_string_lossy().into_owned();
            let edit = connect_agent_to_project(
                workspace.clone(),
                agent.to_string(),
                None,
                None,
                None,
                None,
            )
            .unwrap();
            // First write has no backup yet; diff names the new entry.
            assert!(edit.backup.is_empty(), "{agent} first write must have empty backup");
            assert!(edit.diff.contains("nexus"), "{agent} diff must name nexus: {}", edit.diff);
            let file = edit.path;
            assert!(file.ends_with(config_name), "{agent} wrote {file}");
            let document: serde_json::Value =
                serde_json::from_str(&fs::read_to_string(&file).unwrap()).unwrap();
            // Paper: single canonical HTTP entry named `nexus` — no stdio,
            // no `nexus-http` duplicate.
            let entry = if agent == "opencode" {
                &document["mcp"]["servers"]["nexus"]
            } else {
                &document["mcpServers"]["nexus"]
            };
            assert!(entry.is_object(), "{agent} canonical nexus entry missing");
            assert!(entry.get("command").is_none(), "{agent} must not write stdio command");
            assert!(entry.get("args").is_none(), "{agent} must not write stdio args");
            let absent = if agent == "opencode" {
                document["mcp"]["servers"].get("nexus-http").is_none()
            } else {
                document["mcpServers"].get("nexus-http").is_none()
            };
            assert!(absent, "{agent} must not keep a nexus-http duplicate");
            // canonicalize matches what the command resolved the path to.
            let canonical = fs::canonicalize(&dir).unwrap();
            let canonical = canonical.to_string_lossy();
            assert_eq!(
                entry["headers"][NEXUS_WORKSPACE_HEADER].as_str().unwrap(),
                canonical.as_ref(),
                "{agent} HTTP entry is not bound to this project",
            );
            let url = entry["url"].as_str().unwrap();
            assert!(url.contains("workspace="), "{agent} url has no workspace: {url}");
            assert_eq!(
                url,
                nexus_http_url_for_workspace(&default_nexus_http_url(), &fs::canonicalize(&dir).unwrap()),
                "{agent} url must be the workspace-bound default",
            );
            // Never writes a credential.
            let raw = fs::read_to_string(&file).unwrap().to_lowercase();
            for needle in ["token", "password", "secret", "bearer"] {
                assert!(!raw.contains(needle), "{agent} config leaks {needle}");
            }
            fs::remove_dir_all(&dir).ok();
        }
    }

    #[test]
    fn vault_state_roundtrip_defaults_to_locked_and_writes_secret_free_state() {
        let dir = unique_dir("nexus-vault-state");
        let state = dir.join("vault-state.json");
        write_vault_state_at(&state, false).unwrap();
        let raw = fs::read_to_string(&state).unwrap();
        assert!(raw.contains("\"locked\":false"));
        assert!(!raw.to_lowercase().contains("password"));
        fs::remove_dir_all(&dir).ok();
    }

    fn unique_dir(prefix: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("{prefix}-{stamp}-{}", std::process::id()));
        fs::create_dir_all(dir.join(".nexus")).unwrap();
        dir
    }

    fn fixture_bridge(dir: &std::path::Path) -> String {
        let bridge = dir.join("nexus-server.mjs");
        fs::write(&bridge, "// fixture bridge").unwrap();
        bridge.to_string_lossy().into_owned()
    }

    fn write_manifest(dir: &std::path::Path) {
        fs::write(
            dir.join(".nexus").join("project.json"),
            serde_json::json!({
                "project": "Test",
                "project_id": "test-proj",
                "environment": "development",
                "connections": {
                    "supabase": {
                        "connection_id": "never-saved-conn",
                        "target": "test-dev",
                        "resource": "test-dev",
                        "method": "mcp",
                        "status": "connected",
                        "project_ref": "abcdefghijklmnopqrst",
                    }
                }
            })
            .to_string(),
        )
        .unwrap();
    }

    #[test]
    fn opencode_merge_keeps_existing_servers() {
        let dir = unique_dir("nexus-agent-opencode");
        write_manifest(&dir);
        fs::write(
            dir.join("opencode.json"),
            r#"{"mcp": {"servers": {"other": {"type": "remote", "url": "https://example.test/mcp"}}}}"#,
        )
        .unwrap();
        let workspace = dir.to_string_lossy().into_owned();
        let edit = connect_agent_to_project(
            workspace.clone(),
            "opencode".to_string(),
            None,
            None,
            None,
            None,
        )
        .unwrap();
        // Overwrote an existing file: backup must exist.
        assert!(!edit.backup.is_empty(), "overwrite must back up");
        assert!(PathBuf::from(&edit.backup).is_file());
        let file = edit.path;
        assert!(file.ends_with("opencode.json"));
        let document: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&file).unwrap()).unwrap();
        assert!(document["mcp"]["servers"]["other"].is_object());
        // Paper HTTP-only: canonical `nexus` is a remote URL entry, bound to
        // this project — never a local stdio command.
        let entry = &document["mcp"]["servers"]["nexus"];
        assert_eq!(entry["type"], "remote");
        let canonical = fs::canonicalize(&dir).unwrap();
        assert_eq!(
            entry["url"],
            nexus_http_url_for_workspace(&default_nexus_http_url(), &canonical),
        );
        assert_eq!(
            entry["headers"][NEXUS_WORKSPACE_HEADER].as_str().unwrap(),
            canonical.to_string_lossy().as_ref(),
        );
        assert!(document["mcp"]["servers"].get("nexus-http").is_none());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn connect_overwrites_stale_stdio_nexus_entry() {
        // A pre-existing stdio `nexus` entry (legacy fallback) is replaced
        // by the canonical HTTP entry, not kept alongside it.
        let dir = unique_dir("nexus-agent-stale-stdio");
        write_manifest(&dir);
        fs::write(
            dir.join(".mcp.json"),
            r#"{"mcpServers": {"nexus": {"command": "node", "args": ["/x/mcp/nexus-server.mjs"]}, "other": {"url": "https://example.test/mcp"}}}"#,
        )
        .unwrap();
        let workspace = dir.to_string_lossy().into_owned();
        let edit = connect_agent_to_project(
            workspace,
            "claude".to_string(),
            None,
            None,
            None,
            None,
        )
        .unwrap();
        assert!(!edit.backup.is_empty(), "overwrite must back up");
        let document: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(dir.join(".mcp.json")).unwrap()).unwrap();
        let entry = &document["mcpServers"]["nexus"];
        assert!(entry.get("command").is_none(), "stale stdio command must go");
        assert!(entry["url"].as_str().unwrap().contains("workspace="));
        assert!(document["mcpServers"]["other"].is_object(), "unrelated entries kept");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn claude_merge_and_codex_append_are_idempotent() {
        let dir = unique_dir("nexus-agent-claude");
        write_manifest(&dir);
        let workspace = dir.to_string_lossy().into_owned();
        connect_agent_to_project(workspace.clone(), "claude".to_string(), None, None, None, None).unwrap();
        connect_agent_to_project(workspace.clone(), "claude".to_string(), None, None, None, None).unwrap();
        let document: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(dir.join(".mcp.json")).unwrap()).unwrap();
        let entry = &document["mcpServers"]["nexus"];
        assert!(entry.is_object());
        assert!(entry["url"].as_str().unwrap().contains("workspace="));
        assert!(entry.get("command").is_none(), "no stdio fallback");
        connect_agent_to_project(workspace.clone(), "codex".to_string(), None, None, None, None).unwrap();
        connect_agent_to_project(workspace.clone(), "codex".to_string(), None, None, None, None).unwrap();
        let config = fs::read_to_string(dir.join(".codex").join("config.toml")).unwrap();
        assert_eq!(config.matches("[mcp_servers.nexus]").count(), 1);
        // Paper HTTP-only: Codex block is `url =` with a workspace query —
        // the raw filesystem path never appears literally (it is encoded).
        assert!(config.contains("url = \"http://127.0.0.1:"));
        assert!(config.contains("workspace="));
        assert!(!config.contains("command ="), "no stdio fallback in codex");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn codex_connect_replaces_stale_stdio_block() {
        let dir = unique_dir("nexus-agent-codex-stale");
        write_manifest(&dir);
        let workspace = dir.to_string_lossy().into_owned();
        let codex_dir = dir.join(".codex");
        fs::create_dir_all(&codex_dir).unwrap();
        fs::write(
            codex_dir.join("config.toml"),
            "[mcp_servers.nexus]\ncommand = \"node\"\nargs = [\"/x/mcp/nexus-server.mjs\"]\n",
        )
        .unwrap();
        let edit = connect_agent_to_project(workspace, "codex".to_string(), None, None, None, None).unwrap();
        assert!(!edit.backup.is_empty(), "stale block overwrite must back up");
        let config = fs::read_to_string(dir.join(".codex").join("config.toml")).unwrap();
        assert_eq!(config.matches("[mcp_servers.nexus]").count(), 1);
        assert!(config.contains("url = \"http://127.0.0.1:"));
        assert!(!config.contains("nexus-server.mjs"));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn setup_test_reports_each_step() {
        let dir = unique_dir("nexus-agent-test");
        write_manifest(&dir);
        let workspace = dir.to_string_lossy().into_owned();
        // No agent config yet: Project file ok, Agent config not ok, HTTP
        // reachable false (no server in tests), Session false.
        let before = test_agent_setup(workspace.clone(), "claude".to_string(), None, None).unwrap();
        assert!(before.iter().any(|step| step.step == "Project file" && step.ok));
        assert!(before.iter().any(|step| step.step == "Agent config" && !step.ok));
        assert!(before.iter().any(|step| step.step == "HTTP reachable" && !step.ok));
        assert!(before.iter().any(|step| step.step == "Session" && !step.ok));
        assert!(!before.iter().any(|step| step.step == "Bridge script"), "stdio step is gone");
        connect_agent_to_project(workspace.clone(), "claude".to_string(), None, None, None, None).unwrap();
        let after = test_agent_setup(workspace.clone(), "claude".to_string(), None, None).unwrap();
        assert!(after.iter().any(|step| step.step == "Agent config" && step.ok));
        assert!(after.iter().any(|step| step.step == "HTTP reachable" && !step.ok));
        assert!(after.iter().any(|step| step.step == "Session" && !step.ok));
        // Step order is part of the UI contract.
        let names: Vec<&str> = after.iter().map(|step| step.step.as_str()).collect();
        assert_eq!(names, vec!["Project file", "HTTP reachable", "Session", "Saved approval", "Agent config"]);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn write_persists_account_resource_and_target_alias() {
        let dir = unique_dir("nexus-account-write");
        let workspace = dir.to_string_lossy().into_owned();
        write_nexus_project_file(
            workspace.clone(),
            "koupa".to_string(),
            "Koupa".to_string(),
            "supabase".to_string(),
            "koupa-development".to_string(),
            None,
            "koupa-supabase".to_string(),
            "mcp".to_string(),
            "connected".to_string(),
            Some("development".to_string()),
            None,
            None,
            Some("personal-supabase".to_string()),
        
            None,
            None,
            None,
            None
        )
        .unwrap();
        let manifest: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(dir.join(".nexus").join("project.json")).unwrap(),
        )
        .unwrap();
        let entry = &manifest["connections"]["supabase"];
        assert_eq!(entry["account"], "personal-supabase");
        // Paper dual-write: accountId mirrors account (like target/resource).
        assert_eq!(entry["accountId"], "personal-supabase");
        assert_eq!(entry["resource"], "koupa-development");
        assert_eq!(entry["target"], "koupa-development");
        // Manifest schema version is always written.
        assert_eq!(manifest["version"], 1);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn write_accepts_account_id_side_and_overrides_persist() {
        let dir = unique_dir("nexus-accountid-overrides");
        let workspace = dir.to_string_lossy().into_owned();
        // accountId input side canonicalises to both keys.
        write_nexus_project_file(
            workspace.clone(),
            "koupa".to_string(),
            "Koupa".to_string(),
            "supabase".to_string(),
            "koupa-development".to_string(),
            None,
            "koupa-supabase".to_string(),
            "mcp".to_string(),
            "connected".to_string(),
            Some("development".to_string()),
            None,
            None,
            None,
            Some("alias-owner".to_string()),
            Some("svc-1".to_string()),
            Some("tag-a".to_string()),
            Some("def-x".to_string()),
        )
        .unwrap();
        let manifest: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(dir.join(".nexus").join("project.json")).unwrap(),
        )
        .unwrap();
        let entry = &manifest["connections"]["supabase"];
        assert_eq!(entry["account"], "alias-owner");
        assert_eq!(entry["accountId"], "alias-owner");
        assert_eq!(entry["serviceOverride"], "svc-1");
        assert_eq!(entry["tagOverride"], "tag-a");
        assert_eq!(entry["defaultOverride"], "def-x");
        // Re-save with no overrides: preserved, not stripped.
        write_nexus_project_file(
            workspace.clone(),
            "koupa".to_string(),
            "Koupa".to_string(),
            "supabase".to_string(),
            "koupa-development".to_string(),
            None,
            "koupa-supabase".to_string(),
            "mcp".to_string(),
            "connected".to_string(),
            Some("development".to_string()),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();
        let manifest: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(dir.join(".nexus").join("project.json")).unwrap(),
        )
        .unwrap();
        let entry = &manifest["connections"]["supabase"];
        assert_eq!(entry["account"], "alias-owner");
        assert_eq!(entry["serviceOverride"], "svc-1");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn write_backs_up_manifest_before_overwrite() {
        let dir = unique_dir("nexus-manifest-backup");
        let workspace = dir.to_string_lossy().into_owned();
        write_nexus_project_file(
            workspace.clone(),
            "koupa".to_string(),
            "Koupa".to_string(),
            "supabase".to_string(),
            "koupa-development".to_string(),
            None,
            "koupa-supabase".to_string(),
            "mcp".to_string(),
            "connected".to_string(),
            Some("development".to_string()),
            None,
            None,
            Some("personal-supabase".to_string()),
            None,
            None,
            None,
            None,
        )
        .unwrap();
        let manifest_path = dir.join(".nexus").join("project.json");
        let before = fs::read_to_string(&manifest_path).unwrap();
        write_nexus_project_file(
            workspace,
            "koupa".to_string(),
            "Koupa".to_string(),
            "notion".to_string(),
            "koupa-docs".to_string(),
            None,
            "koupa-notion".to_string(),
            "mcp".to_string(),
            "connected".to_string(),
            Some("development".to_string()),
            None,
            None,
            Some("personal-notion".to_string()),
            None,
            None,
            None,
            None,
        )
        .unwrap();
        // A .bak.<nanos> sibling holds the previous manifest.
        let mut backups: Vec<PathBuf> = fs::read_dir(dir.join(".nexus"))
            .unwrap()
            .filter_map(|entry| entry.ok().map(|entry| entry.path()))
            .filter(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .map(|name| name.starts_with("project.json.bak."))
                    .unwrap_or(false)
            })
            .collect();
        assert_eq!(backups.len(), 1, "one manifest backup expected");
        let backup = backups.pop().unwrap();
        assert_eq!(fs::read_to_string(&backup).unwrap(), before);
        // No stale tmp file left behind.
        assert!(!dir.join(".nexus").join("project.json.tmp").exists());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn register_creates_manifest_without_connections() {
        let dir = unique_dir("nexus-register");
        // unique_dir pre-creates .nexus; register must still work into it.
        let workspace = dir.to_string_lossy().into_owned();
        let path = register_nexus_project(
            workspace,
            "koupa".to_string(),
            "Koupa".to_string(),
            Some("development".to_string()),
            None,
            None,
        )
        .unwrap();
        assert!(path.ends_with("project.json"));
        let manifest: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(manifest["project"], "Koupa");
        assert_eq!(manifest["project_id"], "koupa");
        assert_eq!(manifest["environment"], "development");
        assert_eq!(manifest["version"], 1);
        assert_eq!(manifest["connections"], serde_json::json!({}));
        // Register is idempotent and keeps connections added later.
        write_nexus_project_file(
            dir.to_string_lossy().into_owned(),
            "koupa".to_string(),
            "Koupa".to_string(),
            "supabase".to_string(),
            "koupa-development".to_string(),
            None,
            "koupa-supabase".to_string(),
            "mcp".to_string(),
            "connected".to_string(),
            Some("development".to_string()),
            None,
            None,
            Some("personal-supabase".to_string()),
            None,
            None,
            None,
            None,
        )
        .unwrap();
        register_nexus_project(
            dir.to_string_lossy().into_owned(),
            "koupa".to_string(),
            "Koupa".to_string(),
            Some("development".to_string()),
            None,
            None,
        )
        .unwrap();
        let manifest: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(dir.join(".nexus").join("project.json")).unwrap(),
        )
        .unwrap();
        assert!(manifest["connections"]["supabase"].is_object(), "register must not wipe connections");
        // Invalid IDs rejected, plain language, no panic.
        assert!(register_nexus_project(
            dir.to_string_lossy().into_owned(),
            "has space".to_string(),
            "Koupa".to_string(),
            None,
            None,
            None,
        )
        .is_err());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn scan_project_mcp_flags_unmanaged_and_skips_nexus_http() {
        let dir = unique_dir("nexus-scan-project");
        let workspace = dir.to_string_lossy().into_owned();
        // Project .mcp.json with one direct entry + connect writes nexus.
        fs::write(
            dir.join(".mcp.json"),
            r#"{"mcpServers": {"supabase-direct": {"command": "node", "args": ["x"]}}}"#,
        )
        .unwrap();
        connect_agent_to_project(workspace.clone(), "claude".to_string(), None, None, None, None).unwrap();
        let found = scan_project_mcp(workspace).unwrap();
        let names: Vec<&str> = found.iter().map(|entry| entry.name.as_str()).collect();
        assert!(names.contains(&"supabase-direct"), "direct entry must be flagged: {names:?}");
        assert!(!names.contains(&"nexus"), "managed nexus HTTP entry must be skipped: {names:?}");
        for entry in &found {
            assert_eq!(entry.kind, "found,unmanaged");
        }
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn probe_http_session_never_panics_on_bad_input() {
        let dir = unique_dir("nexus-session-probe");
        // Closed port: false with a plain-language reason, no panic.
        let (ok, detail) = probe_http_session("http://127.0.0.1:9/mcp", &dir);
        assert!(!ok);
        assert!(!detail.is_empty());
        // Non-URL and non-http schemes: false, no panic.
        assert!(!probe_http_session("not a url", &dir).0);
        assert!(!probe_http_session("https://127.0.0.1:3939/mcp", &dir).0);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn write_without_account_preserves_existing_account() {
        let dir = unique_dir("nexus-account-preserve");
        let workspace = dir.to_string_lossy().into_owned();
        write_nexus_project_file(
            workspace.clone(),
            "koupa".to_string(),
            "Koupa".to_string(),
            "supabase".to_string(),
            "koupa-development".to_string(),
            None,
            "koupa-supabase".to_string(),
            "mcp".to_string(),
            "connected".to_string(),
            Some("development".to_string()),
            None,
            None,
            Some("personal-supabase".to_string()),
        
            None,
            None,
            None,
            None
        )
        .unwrap();
        // Re-save without an account: the stored account must survive.
        write_nexus_project_file(
            workspace.clone(),
            "koupa".to_string(),
            "Koupa".to_string(),
            "supabase".to_string(),
            "koupa-development".to_string(),
            None,
            "koupa-supabase".to_string(),
            "mcp".to_string(),
            "connected".to_string(),
            Some("development".to_string()),
            None,
            None,
            None,
        
            None,
            None,
            None,
            None
        )
        .unwrap();
        let manifest: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(dir.join(".nexus").join("project.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(
            manifest["connections"]["supabase"]["account"],
            "personal-supabase"
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn inspect_returns_account_resource_and_reads_legacy_target_only() {
        let dir = unique_dir("nexus-account-inspect");
        let workspace = dir.to_string_lossy().into_owned();
        // Legacy {target-only} entry: no resource, no account.
        fs::write(
            dir.join(".nexus").join("project.json"),
            serde_json::json!({
                "project": "Legacy",
                "project_id": "legacy-proj",
                "environment": "development",
                "connections": {
                    "supabase": {
                        "connection_id": "legacy-conn",
                        "target": "legacy-dev",
                        "method": "mcp",
                        "status": "connected",
                    }
                }
            })
            .to_string(),
        )
        .unwrap();
        let legacy = inspect_project_folder(workspace.clone()).unwrap();
        assert_eq!(legacy.nexus_connections.len(), 1);
        assert_eq!(legacy.nexus_connections[0].provider, "supabase");
        assert_eq!(
            legacy.nexus_connections[0].resource.as_deref(),
            Some("legacy-dev")
        );
        assert!(legacy.nexus_connections[0].account.is_none());
        // Canonical entry with account.
        write_nexus_project_file(
            workspace.clone(),
            "legacy-proj".to_string(),
            "Legacy".to_string(),
            "supabase".to_string(),
            "legacy-dev".to_string(),
            None,
            "legacy-conn".to_string(),
            "mcp".to_string(),
            "connected".to_string(),
            Some("development".to_string()),
            None,
            None,
            Some("personal-supabase".to_string()),
        
            None,
            None,
            None,
            None
        )
        .unwrap();
        let canonical = inspect_project_folder(workspace).unwrap();
        assert_eq!(canonical.nexus_environment.as_deref(), Some("development"));
        assert_eq!(
            canonical.nexus_connections[0].account.as_deref(),
            Some("personal-supabase")
        );
        assert_eq!(
            canonical.nexus_connections[0].resource.as_deref(),
            Some("legacy-dev")
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn probe_never_panics_and_rejects_bad_urls() {
        assert!(!probe_http_agent("not a url"));
        assert!(!probe_http_agent("https://127.0.0.1:3939/mcp"));
        // Port 9 (discard) is never a Nexus server: refused fast, no panic.
        assert!(!probe_http_agent("http://127.0.0.1:9/mcp"));
    }

    #[test]
    fn unmanaged_classification_needs_http_workspace_binding() {
        // Paper: managed = HTTP URL on the Nexus port + workspace binding.
        // A bare name match is NOT enough, and stdio is never managed.
        assert!(!entry_is_nexus_managed(
            "nexus",
            r#"{"command":"node"}"#,
            "3939"
        ), "bare nexus name without a URL is not managed");
        assert!(!entry_is_nexus_managed(
            "nexus-http",
            r#"{"type":"remote","url":"http://localhost:3939/mcp"}"#,
            "3939"
        ), "unbound URL without workspace= is not managed");
        assert!(entry_is_nexus_managed(
            "nexus",
            r#"{"type":"http","url":"http://127.0.0.1:3939/mcp?workspace=%2Ftmp%2Fapp","headers":{"X-Nexus-Workspace":"/tmp/app"}}"#,
            "3939"
        ));
        // Any slot name counts when the URL is Nexus-bound (import target).
        assert!(entry_is_nexus_managed(
            "my-slot",
            r#"{"type":"remote","url":"http://localhost:3939/mcp?workspace=%2Ftmp%2Fapp"}"#,
            "3939"
        ));
        // Stale stdio entries are unmanaged even under the nexus name.
        assert!(!entry_is_nexus_managed(
            "whatever",
            r#"{"command":"node","args":["/x/mcp/nexus-server.mjs"]}"#,
            "3939"
        ));
        assert!(!entry_is_nexus_managed(
            "nexus",
            r#"{"command":"node","args":["/x/mcp/nexus-http-server.mjs"]}"#,
            "3939"
        ));
        assert!(!entry_is_nexus_managed(
            "supabase-direct-unmanaged",
            r#"{"type":"remote","url":"https://mcp.supabase.com/mcp"}"#,
            "3939"
        ));
    }

    #[test]
    fn connect_writes_single_canonical_nexus_remote() {
        let dir = unique_dir("nexus-agent-httpurl");
        write_manifest(&dir);
        let workspace = dir.to_string_lossy().into_owned();
        let edit = connect_agent_to_project(
            workspace,
            "opencode".to_string(),
            None,
            None,
            None,
            Some("http://127.0.0.1:3939/mcp".to_string()),
        )
        .unwrap();
        let file = edit.path;
        let document: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&file).unwrap()).unwrap();
        // Paper: exactly one Nexus entry — canonical `nexus` remote.
        assert!(document["mcp"]["servers"]["nexus"].is_object());
        assert!(document["mcp"]["servers"].get("nexus-http").is_none());
        // The remote entry keeps the given server URL but binds it to this
        // project — an unbound URL would be refused by the server.
        let canonical = fs::canonicalize(&dir).unwrap();
        assert_eq!(
            document["mcp"]["servers"]["nexus"]["url"],
            nexus_http_url_for_workspace("http://127.0.0.1:3939/mcp", &canonical),
        );
        assert!(document["mcp"]["servers"]["nexus"]["url"]
            .as_str()
            .unwrap()
            .starts_with("http://127.0.0.1:3939/mcp?"));
        assert_eq!(
            document["mcp"]["servers"]["nexus"]["headers"][NEXUS_WORKSPACE_HEADER]
                .as_str()
                .unwrap(),
            canonical.to_string_lossy().as_ref(),
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn import_and_remove_roundtrip_with_backup() {
        let dir = unique_dir("nexus-agent-import");
        let workspace = dir.to_string_lossy().into_owned();
        // Import into a missing file: no backup yet, diff names the entry.
        let created = import_agent_entry(
            workspace.clone(),
            "opencode".to_string(),
            "direct-slot".to_string(),
            Some("http://127.0.0.1:3939/mcp".to_string()),
        )
        .unwrap();
        assert!(created.backup.is_empty());
        assert!(created.diff.contains("+ direct-slot"));
        // Second import merges: backup now exists.
        let merged = import_agent_entry(
            workspace.clone(),
            "opencode".to_string(),
            "direct-slot".to_string(),
            None,
        )
        .unwrap();
        assert!(!merged.backup.is_empty());
        assert!(PathBuf::from(&merged.backup).is_file());
        // Remove: backup + diff with the old value.
        let removed =
            remove_agent_entry(workspace.clone(), "opencode".to_string(), "direct-slot".to_string())
                .unwrap();
        assert!(!removed.backup.is_empty());
        assert!(removed.diff.contains("- direct-slot"));
        let document: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(dir.join("opencode.json")).unwrap()).unwrap();
        assert!(document["mcp"]["servers"].get("direct-slot").is_none());
        // Removing twice errors.
        assert!(remove_agent_entry(workspace, "opencode".to_string(), "direct-slot".to_string()).is_err());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn codex_import_and_remove_roundtrip() {
        let dir = unique_dir("nexus-agent-codex-import");
        let workspace = dir.to_string_lossy().into_owned();
        let imported = import_agent_entry(
            workspace.clone(),
            "codex".to_string(),
            "direct-slot".to_string(),
            None,
        )
        .unwrap();
        assert!(imported.diff.contains("[mcp_servers.direct-slot]"));
        let config = fs::read_to_string(dir.join(".codex").join("config.toml")).unwrap();
        assert!(config.contains("[mcp_servers.direct-slot]"));
        let removed =
            remove_agent_entry(workspace, "codex".to_string(), "direct-slot".to_string()).unwrap();
        assert!(!removed.backup.is_empty());
        let after = fs::read_to_string(dir.join(".codex").join("config.toml")).unwrap();
        assert!(!after.contains("[mcp_servers.direct-slot]"));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn connect_backs_up_before_overwrite_and_reports_backup() {
        for agent in ["claude", "opencode"] {
            let dir = unique_dir(&format!("nexus-connect-backup-{agent}"));
            write_manifest(&dir);
            let workspace = dir.to_string_lossy().into_owned();
            let bridge = fixture_bridge(&dir);
            let keyring = "/tmp/nexus-keyring".to_string();
            // First write: no backup yet.
            let first = connect_agent_to_project(
                workspace.clone(),
                agent.to_string(),
                Some(bridge.clone()),
                Some(keyring.clone()),
                None,
                None,
            )
            .unwrap();
            assert!(first.backup.is_empty(), "{agent} first write must have empty backup");
            assert!(!first.path.is_empty());
            assert!(first.diff.contains("nexus"), "{agent} diff must name nexus: {}", first.diff);
            let before = fs::read_to_string(&first.path).unwrap();
            // Second write overwrites the same config: backup must exist and
            // hold the previous contents.
            let second = connect_agent_to_project(
                workspace.clone(),
                agent.to_string(),
                Some(bridge.clone()),
                Some(keyring.clone()),
                None,
                None,
            )
            .unwrap();
            assert!(!second.backup.is_empty(), "{agent} overwrite must return a backup path");
            assert!(second.backup.starts_with(&format!("{}.bak.", second.path)));
            assert!(PathBuf::from(&second.backup).is_file(), "{agent} backup file must exist");
            let backed_up = fs::read_to_string(&second.backup).unwrap();
            assert_eq!(backed_up, before, "{agent} backup must hold previous contents");
            // No stale tmp file left behind.
            let tmp = format!("{}.tmp-{}", second.path, std::process::id());
            assert!(!PathBuf::from(tmp).exists(), "{agent} tmp file must be renamed away");
            // Secret-free: backup and live file carry no credential markers.
            for raw in [fs::read_to_string(&second.path).unwrap(), backed_up] {
                let lowered = raw.to_lowercase();
                for needle in ["token", "password", "secret", "bearer"] {
                    assert!(!lowered.contains(needle), "{agent} config leaks {needle}");
                }
            }
            fs::remove_dir_all(&dir).ok();
        }
        // Codex TOML branch also backs up on second (appending) write.
        let dir = unique_dir("nexus-connect-backup-codex");
        write_manifest(&dir);
        let workspace = dir.to_string_lossy().into_owned();
        let bridge = fixture_bridge(&dir);
        let first = connect_agent_to_project(
            workspace.clone(),
            "codex".to_string(),
            Some(bridge.clone()),
            Some("/tmp/nexus-keyring".to_string()),
            None,
            None,
        )
        .unwrap();
        assert!(first.backup.is_empty());
        assert!(first.diff.contains("(new file)"), "codex diff: {}", first.diff);
        // Already-connected short-circuit returns empty backup, no duplicate.
        let noop = connect_agent_to_project(
            workspace.clone(),
            "codex".to_string(),
            Some(bridge.clone()),
            Some("/tmp/nexus-keyring".to_string()),
            None,
            None,
        )
        .unwrap();
        assert!(noop.backup.is_empty());
        assert!(noop.diff.contains("nothing changed"), "codex noop diff: {}", noop.diff);
        let config = fs::read_to_string(dir.join(".codex").join("config.toml")).unwrap();
        assert_eq!(config.matches("[mcp_servers.nexus]").count(), 1);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn detect_agents_reports_reachability_shape() {
        let agents = detect_agents();
        assert_eq!(agents.len(), 8);
        for agent in &agents {
            for entry in &agent.unmanaged {
                assert_eq!(entry.kind, "found,unmanaged");
            }
        }
    }
}
