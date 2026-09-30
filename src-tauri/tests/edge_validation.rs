//! Edge-case validation for Nexus Guard (read-only against `src-tauri/src/lib.rs`).
//!
//! `src-tauri/src/lib.rs` exposes only `pub fn run()` — all Tauri commands
//! (`write_nexus_project_file`, `inspect_project_folder`,
//! `remove_nexus_connection`, `import_agent_entry`, `remove_agent_entry`,
//! `probe_http_agent`, …) are private `fn` items, so an integration test
//! cannot `use nexus_guard_lib::write_nexus_project_file`. Per the task
//! brief ("via lib import **or replicate logic with temp dirs**") this file
//! replicates the exact logic from `lib.rs` (read-only copy) and drives it
//! with temp dirs. Any divergence would be a test bug, not a lib change.
//!
//! `tray_spike.rs` is NOT wired into `lib.rs` (`mod tray_spike` absent), so
//! it is included here via `#[path]` to exercise the real expire logic.

use std::env;
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

// Real expire logic — same file lib unit tests cover, wired here directly.
#[path = "../src/tray_spike.rs"]
mod tray_spike;

// ---------------------------------------------------------------------------
// Replicated helpers (exact copies from lib.rs, minus #[tauri::command])
// ---------------------------------------------------------------------------

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
        return Err("The project ID is invalid.".to_string());
    }
    if connection_id.is_empty()
        || connection_id.len() > 128
        || !connection_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err("The connection ID is invalid.".to_string());
    }

    let workspace = expand_workspace_path(&workspace_path);
    let workspace = fs::canonicalize(&workspace)
        .map_err(|error| format!("The project folder could not be opened: {error}"))?;
    if !workspace.is_dir() {
        return Err("The project path is not a folder.".to_string());
    }
    let nexus_dir = workspace.join(".nexus");
    fs::create_dir_all(&nexus_dir)
        .map_err(|error| format!("Nexus could not create the .nexus folder: {error}"))?;
    let manifest_path = nexus_dir.join("project.json");
    let mut manifest = if manifest_path.exists() {
        let raw = fs::read_to_string(&manifest_path)
            .map_err(|error| format!("Nexus could not read the project file: {error}"))?;
        serde_json::from_str::<serde_json::Value>(&raw)
            .map_err(|error| format!("The existing Nexus project file is invalid: {error}"))?
    } else {
        serde_json::json!({})
    };
    let object = manifest
        .as_object_mut()
        .ok_or_else(|| "The Nexus project file must contain an object.".to_string())?;
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
    for (key, value) in [("repo", repo), ("branch", branch)] {
        if let Some(identity) = value.filter(|text| !text.trim().is_empty()) {
            object.insert(key.to_string(), serde_json::Value::String(identity));
        }
    }
    object.insert("version".to_string(), serde_json::Value::Number(1.into()));
    let connections = object
        .entry("connections")
        .or_insert_with(|| serde_json::json!({}));
    let connections = connections
        .as_object_mut()
        .ok_or_else(|| "The Nexus connections must be an object.".to_string())?;
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
    connection.insert("resource".to_string(), serde_json::Value::String(target));
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
        .map_err(|error| format!("Nexus could not write the project file: {error}"))?
        + "\n";
    let _ = backup_config_file(&manifest_path);
    let temporary = nexus_dir.join("project.json.tmp");
    fs::write(&temporary, output)
        .map_err(|error| format!("Nexus could not save the project file: {error}"))?;
    fs::rename(&temporary, &manifest_path)
        .map_err(|error| format!("Nexus could not finish saving the project file: {error}"))?;
    Ok(manifest_path.to_string_lossy().into_owned())
}

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
        return Err("The project ID is invalid.".to_string());
    }
    if project_name.trim().is_empty() {
        return Err("The project name is invalid.".to_string());
    }
    let workspace = expand_workspace_path(&workspace_path);
    let workspace = fs::canonicalize(&workspace)
        .map_err(|error| format!("The project folder could not be opened: {error}"))?;
    if !workspace.is_dir() {
        return Err("The project path is not a folder.".to_string());
    }
    let nexus_dir = workspace.join(".nexus");
    fs::create_dir_all(&nexus_dir)
        .map_err(|error| format!("Nexus could not create the .nexus folder: {error}"))?;
    let manifest_path = nexus_dir.join("project.json");
    let mut manifest = if manifest_path.exists() {
        let raw = fs::read_to_string(&manifest_path)
            .map_err(|error| format!("Nexus could not read the project file: {error}"))?;
        serde_json::from_str::<serde_json::Value>(&raw)
            .map_err(|error| format!("The existing Nexus project file is invalid: {error}"))?
    } else {
        serde_json::json!({})
    };
    let object = manifest
        .as_object_mut()
        .ok_or_else(|| "The Nexus project file must contain an object.".to_string())?;
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
        .map_err(|error| format!("Nexus could not write the project file: {error}"))?
        + "\n";
    let _ = backup_config_file(&manifest_path);
    let temporary = nexus_dir.join("project.json.tmp");
    fs::write(&temporary, output)
        .map_err(|error| format!("Nexus could not save the project file: {error}"))?;
    fs::rename(&temporary, &manifest_path)
        .map_err(|error| format!("Nexus could not finish saving the project file: {error}"))?;
    Ok(manifest_path.to_string_lossy().into_owned())
}

#[derive(Debug)]
struct ConnectionSummary {
    provider: String,
    account: Option<String>,
    resource: Option<String>,
    target: Option<String>,
}

// Mirrors the mapping closure inside lib.rs inspect_project_folder.
fn summarize_connections(manifest: &serde_json::Value) -> Vec<ConnectionSummary> {
    manifest
        .get("connections")
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
        .unwrap_or_default()
}

fn remove_nexus_connection(workspace_path: String, provider: String) -> Result<String, String> {
    let workspace = expand_workspace_path(&workspace_path);
    let workspace = fs::canonicalize(&workspace)
        .map_err(|error| format!("The project folder could not be opened: {error}"))?;
    let manifest_path = workspace.join(".nexus").join("project.json");
    let raw = fs::read_to_string(&manifest_path)
        .map_err(|error| format!("Nexus could not read the project file: {error}"))?;
    let mut manifest = serde_json::from_str::<serde_json::Value>(&raw)
        .map_err(|error| format!("The existing Nexus project file is invalid: {error}"))?;
    let removed = manifest
        .get_mut("connections")
        .and_then(|connections| connections.as_object_mut())
        .map(|connections| connections.remove(&provider.to_lowercase()).is_some())
        .unwrap_or(false);
    if !removed {
        return Err("That service is not linked in the Nexus project file.".to_string());
    }
    let output = serde_json::to_string_pretty(&manifest)
        .map_err(|error| format!("Nexus could not write the project file: {error}"))?
        + "\n";
    let nexus_dir = workspace.join(".nexus");
    let temporary = nexus_dir.join("project.json.tmp");
    fs::write(&temporary, output)
        .map_err(|error| format!("Nexus could not save the project file: {error}"))?;
    fs::rename(&temporary, &manifest_path)
        .map_err(|error| format!("Nexus could not finish saving the project file: {error}"))?;
    Ok(manifest_path.to_string_lossy().into_owned())
}

#[derive(Debug)]
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

fn backup_config_file(config_path: &Path) -> Result<String, String> {
    if !config_path.is_file() {
        return Ok(String::new());
    }
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let backup = PathBuf::from(format!("{}.bak.{stamp}", config_path.to_string_lossy()));
    fs::copy(config_path, &backup)
        .map_err(|error| format!("Nexus could not back up the agent config: {error}"))?;
    Ok(backup.to_string_lossy().into_owned())
}

fn compact_json(value: &serde_json::Value) -> String {
    let raw = serde_json::to_string(value).unwrap_or_else(|_| "?".to_string());
    if raw.len() > 200 {
        format!("{}…", &raw[..200])
    } else {
        raw
    }
}

fn default_nexus_http_url() -> String {
    let port = env::var("NEXUS_HTTP_PORT")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "3939".to_string());
    format!("http://127.0.0.1:{port}/mcp")
}

fn agent_config_path(workspace: &Path, agent_id: &str) -> Option<PathBuf> {
    match agent_id {
        "claude" | "pi" => Some(workspace.join(".mcp.json")),
        "opencode" => Some(workspace.join("opencode.json")),
        "codex" => Some(workspace.join(".codex").join("config.toml")),
        _ => None,
    }
}

const NEXUS_WORKSPACE_HEADER: &str = "X-Nexus-Workspace";

fn nexus_http_url_for_workspace(http_url: &str, workspace: &Path) -> String {
    let workspace = workspace.to_string_lossy();
    match url::Url::parse(http_url) {
        Ok(mut parsed) => {
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
            if parsed.query() == Some("") {
                parsed.set_query(None);
            }
            parsed.to_string()
        }
        Err(_) => format!(
            "{http_url}{}workspace={}",
            if http_url.contains('?') { "&" } else { "?" },
            url::form_urlencoded::byte_serialize(workspace.as_bytes()).collect::<String>(),
        ),
    }
}

fn nexus_workspace_headers(workspace: &Path) -> serde_json::Value {
    serde_json::json!({ NEXUS_WORKSPACE_HEADER: workspace.to_string_lossy() })
}

#[allow(dead_code)]
fn find_node_binary() -> String {
    if let Some(path_var) = env::var_os("PATH") {
        for dir in env::split_paths(&path_var) {
            let candidate = dir.join("node");
            if candidate.is_file() {
                return candidate.to_string_lossy().into_owned();
            }
        }
    }
    "node".to_string()
}

fn write_text_file_atomic(config_path: &Path, contents: &str) -> Result<(), String> {
    let temporary = PathBuf::from(format!(
        "{}.tmp-{}",
        config_path.to_string_lossy(),
        std::process::id()
    ));
    fs::write(&temporary, contents)
        .map_err(|error| format!("Nexus could not save the agent config: {error}"))?;
    fs::rename(&temporary, config_path)
        .map_err(|error| format!("Nexus could not save the agent config: {error}"))?;
    Ok(())
}

// Mirror of lib.rs connect_agent_to_project (HTTP-only, backup before
// overwrite, atomic tmp+rename, canonicalize+is_dir checks). Legacy
// bridge/keyring/node args are ignored. Returns the backup path.
#[allow(clippy::too_many_arguments)]
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
        .map_err(|error| format!("The project folder could not be opened: {error}"))?;
    if !workspace.is_dir() {
        return Err("The project path is not a folder.".to_string());
    }
    let config_path = agent_config_path(&workspace, agent_id.as_str())
        .ok_or_else(|| "Unknown agent.".to_string())?;
    let http_url = http_url
        .map(|url| url.trim().to_string())
        .filter(|url| !url.is_empty())
        .unwrap_or_else(default_nexus_http_url);
    if !http_url.starts_with("http://") && !http_url.starts_with("https://") {
        return Err("That Nexus URL is invalid.".to_string());
    }
    let bound_url = nexus_http_url_for_workspace(&http_url, &workspace);
    let headers = nexus_workspace_headers(&workspace);
    if agent_id == "codex" {
        if let Some(parent) = config_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Nexus could not create the agent config folder: {error}"))?;
        }
        let existing = fs::read_to_string(&config_path).unwrap_or_default();
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
        let backup = backup_config_file(&config_path)?;
        let stripped = strip_codex_nexus_blocks(&existing);
        let mut output = stripped;
        if !output.is_empty() && !output.ends_with('\n') {
            output.push('\n');
        }
        output.push_str(&format!(
            "\n# Nexus Guard (single HTTP instance).\n# CLI-first alternative: codex mcp add nexus --url \"{bound_url}\"\n[mcp_servers.nexus]\nurl = \"{bound_url}\"\n",
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
            .map_err(|error| format!("The existing config is not valid JSON: {error}"))?,
        Err(_) => serde_json::json!({}),
    };
    let object = document
        .as_object_mut()
        .ok_or_else(|| "The existing config must contain an object.".to_string())?;
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
            .ok_or_else(|| "The opencode config has an unusable mcp.servers section.".to_string())?;
        servers.insert(
            "nexus".to_string(),
            serde_json::json!({
                "type": "remote",
                "url": bound_url,
                "headers": headers,
            }),
        );
        servers.remove("nexus-http");
    } else {
        let servers = object
            .entry("mcpServers")
            .or_insert_with(|| serde_json::json!({}));
        let servers = servers
            .as_object_mut()
            .ok_or_else(|| "The MCP config has an unusable mcpServers section.".to_string())?;
        servers.insert(
            "nexus".to_string(),
            serde_json::json!({
                "type": "http",
                "url": bound_url,
                "headers": headers,
            }),
        );
        servers.remove("nexus-http");
    }
    let backup = backup_config_file(&config_path)?;
    let output = serde_json::to_string_pretty(&document)
        .map_err(|error| format!("Nexus could not write the agent config: {error}"))?
        + "\n";
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

fn strip_codex_nexus_blocks(raw: &str) -> String {
    let lines: Vec<&str> = raw.lines().collect();
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
            let mut back = i;
            let mut dropped = 0;
            while back > 0 && dropped < 2 {
                let prev = lines[back - 1].trim();
                if prev.starts_with('#') && prev.to_lowercase().contains("nexus") {
                    skip[back - 1] = true;
                    back -= 1;
                    dropped += 1;
                } else if prev.is_empty() && dropped == 0 {
                    skip[back - 1] = true;
                    break;
                } else {
                    break;
                }
            }
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

fn entry_is_nexus_managed(name: &str, raw: &str, port: &str) -> bool {
    let _ = name;
    let lowered = raw.to_lowercase();
    if lowered.contains("nexus-server.mjs") || lowered.contains("nexus-http-server.mjs") {
        return false;
    }
    let on_nexus_port = lowered.contains(&format!("127.0.0.1:{port}"))
        || lowered.contains(&format!("localhost:{port}"));
    if !on_nexus_port {
        return false;
    }
    let bound = lowered.contains("workspace=")
        || lowered.contains("x-nexus-workspace");
    let is_http_entry = lowered.contains("http://") || lowered.contains("https://");
    on_nexus_port && bound && is_http_entry
}
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
        return Err("That Nexus URL is invalid.".to_string());
    }
    let workspace = expand_workspace_path(&workspace_path);
    let workspace = fs::canonicalize(&workspace)
        .map_err(|error| format!("The project folder could not be opened: {error}"))?;
    if !workspace.is_dir() {
        return Err("The project path is not a folder.".to_string());
    }
    let config_path = agent_config_path(&workspace, agent_id.as_str()).ok_or_else(|| {
        "Import for this agent is manual: use its CLI (claude mcp add --transport http nexus <url>).".to_string()
    })?;
    if agent_id == "codex" {
        if let Some(parent) = config_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Nexus could not create the .codex folder: {error}"))?;
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
            .map_err(|error| format!("The existing config is not valid JSON: {error}"))?,
        Err(_) => serde_json::json!({}),
    };
    let object = document
        .as_object_mut()
        .ok_or_else(|| "The existing config must contain an object.".to_string())?;
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
            .ok_or_else(|| "The opencode config has an unusable mcp.servers section.".to_string())?;
        servers.insert(name.clone(), entry);
    } else {
        let servers = object
            .entry("mcpServers")
            .or_insert_with(|| serde_json::json!({}));
        let servers = servers
            .as_object_mut()
            .ok_or_else(|| "The MCP config has an unusable mcpServers section.".to_string())?;
        servers.insert(name.clone(), entry);
    }
    let backup = backup_config_file(&config_path)?;
    let output = serde_json::to_string_pretty(&document)
        .map_err(|error| format!("Nexus could not write the agent config: {error}"))?
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

fn remove_agent_entry(
    workspace_path: String,
    agent_id: String,
    name: String,
) -> Result<AgentConfigEdit, String> {
    let name = name.trim().to_string();
    if !valid_mcp_name(&name) {
        return Err("That entry name is invalid.".to_string());
    }
    let workspace = expand_workspace_path(&workspace_path);
    let workspace = fs::canonicalize(&workspace)
        .map_err(|error| format!("The project folder could not be opened: {error}"))?;
    if !workspace.is_dir() {
        return Err("The project path is not a folder.".to_string());
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
        .map_err(|error| format!("The existing config is not valid JSON: {error}"))?;
    let object = document
        .as_object_mut()
        .ok_or_else(|| "The existing config must contain an object.".to_string())?;
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
        .map_err(|error| format!("Nexus could not write the agent config: {error}"))?
        + "\n";
    write_text_file_atomic(&config_path, &output)?;
    Ok(AgentConfigEdit {
        path: config_path.to_string_lossy().into_owned(),
        backup,
        diff: format!("- {name} (was: {})", compact_json(&removed)),
    })
}

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
    let timeout = Duration::from_millis(700);
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

// ---------------------------------------------------------------------------
// Test scaffolding
// ---------------------------------------------------------------------------

static COUNTER: AtomicU64 = AtomicU64::new(0);

fn unique_dir(prefix: &str) -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let dir = env::temp_dir().join(format!("{prefix}-{stamp}-{n}-{}", std::process::id()));
    fs::create_dir_all(dir.join(".nexus")).unwrap();
    dir
}

fn read_manifest(dir: &Path) -> serde_json::Value {
    let raw = fs::read_to_string(dir.join(".nexus").join("project.json")).unwrap();
    serde_json::from_str(&raw).unwrap()
}

fn base_write(workspace: &str, account: Option<String>) -> Result<String, String> {
    write_nexus_project_file(
        workspace.to_string(),
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
        account,
        None,
        None,
        None,
        None,
    )
}

fn assert_backup_shape(config_path: &str, backup: &str) {
    assert!(
        !backup.is_empty(),
        "expected a backup path for {config_path}"
    );
    let prefix = format!("{config_path}.bak.");
    assert!(
        backup.starts_with(&prefix),
        "backup {backup} must start with {prefix}"
    );
    let stamp = backup[prefix.len()..].to_string();
    assert!(
        !stamp.is_empty() && stamp.bytes().all(|b| b.is_ascii_digit()),
        "backup stamp must be unix nanos, got: {stamp}"
    );
    assert!(
        Path::new(backup).is_file(),
        "backup file must exist: {backup}"
    );
}

// ---------------------------------------------------------------------------
// 1. write_nexus_project_file account handling
// ---------------------------------------------------------------------------

#[test]
fn edge_write_with_account_writes_canonical_alias() {
    let dir = unique_dir("edge-write-acct");
    let ws = dir.to_string_lossy().into_owned();
    base_write(&ws, Some("personal-supabase".to_string())).unwrap();
    let m = read_manifest(&dir);
    let e = &m["connections"]["supabase"];
    assert_eq!(e["account"], "personal-supabase");
    // Paper dual-write: accountId mirrors account (like target/resource).
    assert_eq!(e["accountId"], "personal-supabase");
    assert_eq!(e["resource"], "koupa-development");
    assert_eq!(e["target"], "koupa-development");
    assert_eq!(m["version"], 1);
    fs::remove_dir_all(&dir).ok();
}

#[test]
fn edge_write_overrides_persist_and_survive_resave() {
    let dir = unique_dir("edge-write-overrides");
    let ws = dir.to_string_lossy().into_owned();
    write_nexus_project_file(
        ws.clone(),
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
    let m = read_manifest(&dir);
    let e = &m["connections"]["supabase"];
    assert_eq!(e["account"], "alias-owner");
    assert_eq!(e["accountId"], "alias-owner");
    assert_eq!(e["serviceOverride"], "svc-1");
    assert_eq!(e["tagOverride"], "tag-a");
    assert_eq!(e["defaultOverride"], "def-x");
    // Re-save with no overrides: preserved, not stripped.
    base_write(&ws, None).unwrap();
    let m2 = read_manifest(&dir);
    assert_eq!(m2["connections"]["supabase"]["serviceOverride"], "svc-1");
    assert_eq!(m2["connections"]["supabase"]["account"], "alias-owner");
    fs::remove_dir_all(&dir).ok();
}

#[test]
fn edge_register_creates_manifest_without_connections() {
    let dir = unique_dir("edge-register");
    let ws = dir.to_string_lossy().into_owned();
    let path = register_nexus_project(
        ws.clone(),
        "koupa".to_string(),
        "Koupa".to_string(),
        Some("development".to_string()),
        None,
        None,
    )
    .unwrap();
    assert!(path.ends_with("project.json"));
    let m = read_manifest(&dir);
    assert_eq!(m["project"], "Koupa");
    assert_eq!(m["project_id"], "koupa");
    assert_eq!(m["version"], 1);
    assert_eq!(m["connections"], serde_json::json!({}));
    // Register keeps connections added later (add-project then connect).
    base_write(&ws, Some("personal-supabase".to_string())).unwrap();
    register_nexus_project(
        ws,
        "koupa".to_string(),
        "Koupa".to_string(),
        Some("development".to_string()),
        None,
        None,
    )
    .unwrap();
    let m2 = read_manifest(&dir);
    assert!(m2["connections"]["supabase"].is_object());
    fs::remove_dir_all(&dir).ok();
}

#[test]
fn edge_write_none_preserves_existing_account_no_strip() {
    let dir = unique_dir("edge-write-preserve");
    let ws = dir.to_string_lossy().into_owned();
    base_write(&ws, Some("personal-supabase".to_string())).unwrap();
    // Re-save without account: must NOT strip.
    base_write(&ws, None).unwrap();
    let m = read_manifest(&dir);
    assert_eq!(
        m["connections"]["supabase"]["account"],
        "personal-supabase",
        "account=None must preserve existing account"
    );
    // Empty / whitespace account is also treated as None -> preserve.
    base_write(&ws, Some("   ".to_string())).unwrap();
    let m2 = read_manifest(&dir);
    assert_eq!(m2["connections"]["supabase"]["account"], "personal-supabase");
    base_write(&ws, Some("".to_string())).unwrap();
    let m3 = read_manifest(&dir);
    assert_eq!(m3["connections"]["supabase"]["account"], "personal-supabase");
    fs::remove_dir_all(&dir).ok();
}

#[test]
fn edge_write_none_preserves_accountid_alias_side() {
    // Existing entry stored under the legacy alias key must also survive
    // a re-save with account=None (lib checks all three alias sides).
    let dir = unique_dir("edge-write-alias-preserve");
    let ws = dir.to_string_lossy().into_owned();
    fs::write(
        dir.join(".nexus").join("project.json"),
        serde_json::json!({
            "project": "Koupa", "project_id": "koupa", "environment": "development",
            "connections": {
                "supabase": {
                    "connection_id": "koupa-supabase",
                    "target": "koupa-development",
                    "resource": "koupa-development",
                    "accountId": "alias-owner",
                    "method": "mcp", "status": "connected"
                }
            }
        })
        .to_string(),
    )
    .unwrap();
    base_write(&ws, None).unwrap();
    let m = read_manifest(&dir);
    // Writer canonicalises to `account` but must carry the aliased value.
    assert_eq!(m["connections"]["supabase"]["account"], "alias-owner");
    fs::remove_dir_all(&dir).ok();
}

// ---------------------------------------------------------------------------
// 2 + 3. inspect fallbacks and aliases
// ---------------------------------------------------------------------------

#[test]
fn edge_legacy_target_only_falls_back_resource_account_none() {
    let dir = unique_dir("edge-legacy");
    fs::write(
        dir.join(".nexus").join("project.json"),
        serde_json::json!({
            "project": "Legacy", "project_id": "legacy-proj",
            "environment": "development",
            "connections": {
                "supabase": {
                    "connection_id": "legacy-conn",
                    "target": "legacy-dev",
                    "method": "mcp", "status": "connected"
                }
            }
        })
        .to_string(),
    )
    .unwrap();
    let m = read_manifest(&dir);
    let conns = summarize_connections(&m);
    assert_eq!(conns.len(), 1);
    assert_eq!(conns[0].provider, "supabase");
    assert_eq!(conns[0].resource.as_deref(), Some("legacy-dev"));
    assert_eq!(conns[0].target.as_deref(), Some("legacy-dev"));
    assert!(conns[0].account.is_none(), "legacy target-only has no account");
    fs::remove_dir_all(&dir).ok();
}

#[test]
fn edge_account_aliases_accepted_on_read() {
    for (key, val) in [
        ("account", "owner-a"),
        ("accountId", "owner-b"),
        ("account_id", "owner-c"),
    ] {
        let dir = unique_dir("edge-alias-read");
        let mut entry = serde_json::json!({
            "connection_id": "c1", "target": "t1", "resource": "t1",
            "method": "mcp", "status": "connected"
        });
        entry[key] = serde_json::Value::String(val.to_string());
        fs::write(
            dir.join(".nexus").join("project.json"),
            serde_json::json!({
                "project": "P", "project_id": "p",
                "environment": "development",
                "connections": { "supabase": entry }
            })
            .to_string(),
        )
        .unwrap();
        let m = read_manifest(&dir);
        let conns = summarize_connections(&m);
        assert_eq!(
            conns[0].account.as_deref(),
            Some(val),
            "alias key {key} must be accepted on read"
        );
        fs::remove_dir_all(&dir).ok();
    }
}

// ---------------------------------------------------------------------------
// 4. remove_nexus_connection scope
// ---------------------------------------------------------------------------

#[test]
fn edge_remove_only_named_provider_preserves_others() {
    let dir = unique_dir("edge-remove-scope");
    let ws = dir.to_string_lossy().into_owned();
    write_nexus_project_file(
        ws.clone(),
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
    write_nexus_project_file(
        ws.clone(),
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
        None
    )
    .unwrap();
    // Provider match is lowercased in lib; mixed case must still remove.
    remove_nexus_connection(ws.clone(), "Supabase".to_string()).unwrap();
    let m = read_manifest(&dir);
    assert!(m["connections"].get("supabase").is_none());
    assert!(m["connections"].get("notion").is_some());
    let kept = &m["connections"]["notion"];
    assert_eq!(kept["account"], "personal-notion");
    assert_eq!(kept["resource"], "koupa-docs");
    assert_eq!(kept["target"], "koupa-docs");
    // Removing a missing provider errors, does not touch the file.
    assert!(remove_nexus_connection(ws, "supabase".to_string()).is_err());
    let m2 = read_manifest(&dir);
    assert!(m2["connections"].get("notion").is_some());
    fs::remove_dir_all(&dir).ok();
}

// ---------------------------------------------------------------------------
// 5. import/remove backup naming + diff
// ---------------------------------------------------------------------------

#[test]
fn edge_import_missing_file_empty_backup_no_panic() {
    let dir = unique_dir("edge-import-missing");
    // unique_dir only creates .nexus; no opencode.json exists yet.
    let ws = dir.to_string_lossy().into_owned();
    let created = import_agent_entry(
        ws,
        "opencode".to_string(),
        "direct-slot".to_string(),
        Some("http://127.0.0.1:3939/mcp".to_string()),
    )
    .unwrap();
    assert!(
        created.backup.is_empty(),
        "missing file import must return empty backup"
    );
    assert!(created.diff.contains("+ direct-slot"));
    assert!(created.diff.contains("(new file)"));
    assert!(created.path.ends_with("opencode.json"));
    fs::remove_dir_all(&dir).ok();
}

#[test]
fn edge_import_existing_backup_naming_and_diff() {
    let dir = unique_dir("edge-import-backup");
    let ws = dir.to_string_lossy().into_owned();
    import_agent_entry(
        ws.clone(),
        "opencode".to_string(),
        "slot-a".to_string(),
        Some("http://127.0.0.1:3939/mcp".to_string()),
    )
    .unwrap();
    let merged = import_agent_entry(
        ws.clone(),
        "opencode".to_string(),
        "slot-b".to_string(),
        None,
    )
    .unwrap();
    assert_backup_shape(&merged.path, &merged.backup);
    assert!(merged.diff.contains("+ slot-b"));
    assert!(merged.diff.contains("(merged)"));
    // claude (.mcp.json) variant also merges with backup.
    import_agent_entry(
        ws.clone(),
        "claude".to_string(),
        "slot-c".to_string(),
        Some("http://127.0.0.1:3939/mcp".to_string()),
    )
    .unwrap();
    let merged2 = import_agent_entry(
        ws.clone(),
        "claude".to_string(),
        "slot-d".to_string(),
        None,
    )
    .unwrap();
    assert_backup_shape(&merged2.path, &merged2.backup);
    assert!(merged2.diff.contains("+ slot-d"));
    fs::remove_dir_all(&dir).ok();
}

#[test]
fn edge_remove_backup_naming_and_diff_with_old_value() {
    let dir = unique_dir("edge-remove-backup");
    let ws = dir.to_string_lossy().into_owned();
    import_agent_entry(
        ws.clone(),
        "opencode".to_string(),
        "direct-slot".to_string(),
        Some("http://127.0.0.1:3939/mcp".to_string()),
    )
    .unwrap();
    let removed =
        remove_agent_entry(ws.clone(), "opencode".to_string(), "direct-slot".to_string())
            .unwrap();
    assert_backup_shape(&removed.path, &removed.backup);
    assert!(removed.diff.starts_with("- direct-slot"));
    assert!(
        removed.diff.contains("was:"),
        "remove diff must carry the old value, got: {}",
        removed.diff
    );
    let doc: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(dir.join("opencode.json")).unwrap()).unwrap();
    assert!(doc["mcp"]["servers"].get("direct-slot").is_none());
    // Second remove errors (no panic).
    assert!(remove_agent_entry(ws, "opencode".to_string(), "direct-slot".to_string()).is_err());
    fs::remove_dir_all(&dir).ok();
}

#[test]
fn edge_codex_import_remove_roundtrip() {
    let dir = unique_dir("edge-codex");
    let ws = dir.to_string_lossy().into_owned();
    let imported = import_agent_entry(ws.clone(), "codex".to_string(), "direct-slot".to_string(), None)
        .unwrap();
    assert!(imported.diff.contains("[mcp_servers.direct-slot]"));
    // First codex import on missing file: empty backup (nothing to back up).
    assert!(imported.backup.is_empty());
    let second = import_agent_entry(ws.clone(), "codex".to_string(), "slot-2".to_string(), None)
        .unwrap();
    assert_backup_shape(&second.path, &second.backup);
    let removed = remove_agent_entry(ws, "codex".to_string(), "direct-slot".to_string()).unwrap();
    assert!(!removed.backup.is_empty());
    assert!(removed.diff.contains("(removed)"));
    fs::remove_dir_all(&dir).ok();
}

// ---------------------------------------------------------------------------
// 6. probe_http_agent closed port
// ---------------------------------------------------------------------------

#[test]
fn edge_probe_closed_port_false_no_panic_fast() {
    for bad in ["not a url", "https://127.0.0.1:3939/mcp", "http://", "ftp://x/y"] {
        assert!(!probe_http_agent(bad), "bad url must be false: {bad}");
    }
    // Port 9 (discard) is closed/refused: false, fast, no panic.
    let start = Instant::now();
    let hit = probe_http_agent("http://127.0.0.1:9/mcp");
    let elapsed = start.elapsed();
    assert!(!hit, "closed port must probe false");
    assert!(
        elapsed < Duration::from_secs(2),
        "closed-port probe must be fast (<2s), took {elapsed:?}"
    );
}

// ---------------------------------------------------------------------------
// 7. tray_spike expire logic (real module via #[path])
// ---------------------------------------------------------------------------

#[test]
fn edge_tray_expire_boundary_and_late_verdict() {
    use tray_spike::{QuickApproveRequest, TimeoutVerdict, QUICK_APPROVE_TTL_SECS};
    assert_eq!(QUICK_APPROVE_TTL_SECS, 60);
    let req = QuickApproveRequest::new(
        "req-1",
        "Koupa",
        "development",
        "Agent asks to list tables.",
        "nexus://approvals/req-1",
        1_000,
    );
    // Just before deadline: not expired, no verdict.
    assert_eq!(req.remaining_secs(1_000 + 59), 1);
    assert!(!req.is_expired(1_000 + 59));
    assert_eq!(tray_spike::resolve_on_timeout(&req, 1_000 + 59), None);
    // Exact boundary issued+ttl: expired == deny (saturating, no underflow).
    assert_eq!(req.remaining_secs(1_000 + 60), 0);
    assert!(req.is_expired(1_000 + 60));
    assert_eq!(
        tray_spike::resolve_on_timeout(&req, 1_000 + 60),
        Some(TimeoutVerdict::Deny)
    );
    // Late verdict: still deny, never approve-after-expiry.
    assert_eq!(
        tray_spike::resolve_on_timeout(&req, 1_000 + 3_600),
        Some(TimeoutVerdict::Deny)
    );
    assert!(req.is_expired(u64::MAX));
}

// ---------------------------------------------------------------------------
// 8. connect_agent_to_project backup on overwrite (regression)
// ---------------------------------------------------------------------------

fn fixture_bridge(dir: &Path) -> String {
    let bridge = dir.join("nexus-server.mjs");
    fs::write(&bridge, "// fixture bridge").unwrap();
    bridge.to_string_lossy().into_owned()
}

#[test]
fn edge_connect_overwrite_backs_up_and_reports_backup() {
    for agent in ["claude", "opencode"] {
        let dir = unique_dir(&format!("edge-connect-backup-{agent}"));
        let ws = dir.to_string_lossy().into_owned();
        let bridge = fixture_bridge(&dir);
        let first = connect_agent_to_project(
            ws.clone(),
            agent.to_string(),
            Some(bridge.clone()),
            Some("/tmp/nexus-keyring".to_string()),
            None,
            None,
        )
        .unwrap();
        assert!(
            first.backup.is_empty(),
            "{agent} first connect must have empty backup"
        );
        assert!(first.diff.contains("nexus"), "{agent} diff: {}", first.diff);
        let before = fs::read_to_string(&first.path).unwrap();
        let second = connect_agent_to_project(
            ws.clone(),
            agent.to_string(),
            Some(bridge.clone()),
            Some("/tmp/nexus-keyring".to_string()),
            None,
            None,
        )
        .unwrap();
        assert_backup_shape(&second.path, &second.backup);
        assert_eq!(
            fs::read_to_string(&second.backup).unwrap(),
            before,
            "{agent} backup must hold previous contents"
        );
        assert!(second.diff.contains("(merged)"), "{agent} diff: {}", second.diff);
        // Atomic write: no stale tmp file left behind.
        let tmp = format!("{}.tmp-{}", second.path, std::process::id());
        assert!(!Path::new(&tmp).exists(), "{agent} tmp must be renamed away");
        fs::remove_dir_all(&dir).ok();
    }
    // Codex branch: first append is a new file (empty backup), repeat is a
    // no-op with empty backup and no duplicate block.
    let dir = unique_dir("edge-connect-backup-codex");
    let ws = dir.to_string_lossy().into_owned();
    let bridge = fixture_bridge(&dir);
    let first = connect_agent_to_project(
        ws.clone(),
        "codex".to_string(),
        Some(bridge.clone()),
        Some("/tmp/nexus-keyring".to_string()),
        None,
        None,
    )
    .unwrap();
    assert!(first.backup.is_empty());
    assert!(first.diff.contains("(new file)"), "codex diff: {}", first.diff);
    let noop = connect_agent_to_project(
        ws,
        "codex".to_string(),
        Some(bridge),
        Some("/tmp/nexus-keyring".to_string()),
        None,
        None,
    )
    .unwrap();
    assert!(noop.backup.is_empty());
    assert!(noop.diff.contains("nothing changed"), "codex noop: {}", noop.diff);
    fs::remove_dir_all(&dir).ok();
}

#[test]
fn edge_connect_writes_single_http_entry_no_stdio() {
    // Paper HTTP-only shape: canonical `nexus` remote, no stdio keys, no
    // `nexus-http` duplicate, workspace-bound url + header.
    for (agent, file, ptr) in [
        ("claude", ".mcp.json", "/mcpServers/nexus"),
        ("opencode", "opencode.json", "/mcp/servers/nexus"),
    ] {
        let dir = unique_dir(&format!("edge-connect-shape-{agent}"));
        let ws = dir.to_string_lossy().into_owned();
        let edit = connect_agent_to_project(ws, agent.to_string(), None, None, None, None).unwrap();
        assert!(edit.path.ends_with(file));
        let doc: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&edit.path).unwrap()).unwrap();
        let entry = doc.pointer(ptr).expect("canonical nexus entry missing");
        assert!(entry.get("command").is_none(), "{agent} must not write stdio command");
        assert!(entry.get("args").is_none(), "{agent} must not write stdio args");
        let url = entry.get("url").and_then(|u| u.as_str()).unwrap();
        assert!(url.contains("workspace="), "{agent} url unbound: {url}");
        let canonical = fs::canonicalize(&dir).unwrap();
        assert_eq!(
            entry.get("headers").and_then(|h| h.get("X-Nexus-Workspace")).and_then(|h| h.as_str()).unwrap(),
            canonical.to_string_lossy().as_ref(),
        );
        fs::remove_dir_all(&dir).ok();
    }
    // Codex: `url =` block, no command, workspace query present.
    let dir = unique_dir("edge-connect-shape-codex");
    let ws = dir.to_string_lossy().into_owned();
    connect_agent_to_project(ws, "codex".to_string(), None, None, None, None).unwrap();
    let config = fs::read_to_string(dir.join(".codex").join("config.toml")).unwrap();
    assert!(config.contains("[mcp_servers.nexus]"));
    assert!(config.contains("url = \"http://127.0.0.1:"));
    assert!(config.contains("workspace="));
    assert!(!config.contains("command ="), "no stdio fallback");
    fs::remove_dir_all(&dir).ok();
}

#[test]
fn edge_unmanaged_needs_http_workspace_binding() {
    // Managed = HTTP URL on Nexus port + workspace binding. Bare names and
    // stdio entries are unmanaged (import/remove candidates).
    assert!(!entry_is_nexus_managed("nexus", r#"{"command":"node"}"#, "3939"));
    assert!(!entry_is_nexus_managed(
        "nexus-http",
        r#"{"type":"remote","url":"http://localhost:3939/mcp"}"#,
        "3939"
    ));
    assert!(entry_is_nexus_managed(
        "nexus",
        r#"{"type":"http","url":"http://127.0.0.1:3939/mcp?workspace=%2Ftmp%2Fapp","headers":{"X-Nexus-Workspace":"/tmp/app"}}"#,
        "3939"
    ));
    assert!(!entry_is_nexus_managed(
        "whatever",
        r#"{"command":"node","args":["/x/mcp/nexus-server.mjs"]}"#,
        "3939"
    ));
    assert!(!entry_is_nexus_managed(
        "supabase-direct-unmanaged",
        r#"{"type":"remote","url":"https://mcp.supabase.com/mcp"}"#,
        "3939"
    ));
}

// ---------------------------------------------------------------------------
// 9. overlong workspace handling (no panic, plain Err)
// ---------------------------------------------------------------------------

#[test]
fn edge_overlong_workspace_is_rejected_without_panic() {
    let overlong = format!("/tmp/{}", "x".repeat(6000));
    let result = write_nexus_project_file(
        overlong.clone(),
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
    );
    assert!(result.is_err(), "overlong workspace must error, not panic");
    let dir = unique_dir("edge-overlong-connect");
    let bridge = fixture_bridge(&dir);
    let connect_result = connect_agent_to_project(
        overlong,
        "claude".to_string(),
        Some(bridge),
        Some("/tmp/nexus-keyring".to_string()),
        None,
        None,
    );
    assert!(connect_result.is_err(), "overlong workspace must error, not panic");
    assert!(remove_nexus_connection("/tmp/".to_string() + &"y".repeat(6000), "supabase".to_string()).is_err());
    assert!(import_agent_entry(
        format!("/tmp/{}", "z".repeat(6000)),
        "opencode".to_string(),
        "slot".to_string(),
        None,
    )
    .is_err());
    fs::remove_dir_all(&dir).ok();
}

// ---------------------------------------------------------------------------
// 10. invalid project_id / connection_id rejection (SAFE_ID)
// ---------------------------------------------------------------------------

#[test]
fn edge_invalid_project_and_connection_ids_rejected() {
    let dir = unique_dir("edge-bad-ids");
    let ws = dir.to_string_lossy().into_owned();
    let bad_ids = [
        String::new(),
        "has space".to_string(),
        "has/slash".to_string(),
        "has@at".to_string(),
        "has.dot".to_string(),
        "x".repeat(129),
    ];
    for bad in &bad_ids {
        let project_result = write_nexus_project_file(
            ws.clone(),
            bad.clone(),
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
    );
        assert!(project_result.is_err(), "project_id {bad:?} must be rejected");
        let connection_result = write_nexus_project_file(
            ws.clone(),
            "koupa".to_string(),
            "Koupa".to_string(),
            "supabase".to_string(),
            "koupa-development".to_string(),
            None,
            bad.clone(),
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
    );
        assert!(connection_result.is_err(), "connection_id {bad:?} must be rejected");
    }
    // Boundary: 128 chars is accepted, and error text stays plain-language.
    let max_id = "a".repeat(128);
    let ok = base_write(&ws, None);
    assert!(ok.is_ok());
    let overlong = write_nexus_project_file(
        ws.clone(),
        "x".repeat(129),
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
    .unwrap_err();
    assert!(overlong.contains("project ID"), "got: {overlong}");
    assert!(!overlong.to_lowercase().contains("token"));
    let _ = max_id;
    fs::remove_dir_all(&dir).ok();
}
