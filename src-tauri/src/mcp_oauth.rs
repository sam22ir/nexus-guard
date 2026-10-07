//! Generic sign-in for any remote MCP server that follows the MCP
//! authorization spec: discover the server's OAuth endpoints, register Nexus as
//! a client on the spot (dynamic client registration), then sign in with PKCE.
//! No per-service app registration and no per-service code: a service is just a
//! URL. Shared by the desktop app and the `nexus-keyring` helper (token refresh).

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Refresh this long before the access token actually expires.
const REFRESH_MARGIN_SECS: u64 = 120;

pub fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// How the client proves itself at the token endpoint.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthMethod {
    None,
    Basic,
    Post,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Discovery {
    pub resource: String,
    pub authorization_endpoint: String,
    pub token_endpoint: String,
    pub registration_endpoint: String,
    pub scopes_supported: Vec<String>,
    pub auth_method: AuthMethod,
}

/// Everything needed to call the server now and to renew the sign-in later.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tokens {
    pub access_token: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refresh_token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<u64>,
    pub token_endpoint: String,
    pub client_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_secret: Option<String>,
    pub auth_method: AuthMethod,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resource: Option<String>,
}

impl Tokens {
    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_default()
    }
    /// `None` for anything that is not a generic MCP sign-in (for example a Supabase or GitHub entry).
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

// ---------- pure parsing (unit tested) ----------

/// A service address Nexus is willing to send a sign-in to: https on the normal
/// port, a real public-looking hostname, and nothing smuggled in the URL.
/// Applies to every service, built in or typed by the user.
pub fn check_service_url(raw: &str) -> Result<url::Url, String> {
    let url = url::Url::parse(raw.trim()).map_err(|_| "That address is not valid. Use the full https address of the service's MCP server.".to_string())?;
    if url.scheme() != "https" {
        return Err("Nexus only signs in to services over https.".to_string());
    }
    if !url.username().is_empty() || url.password().is_some() || url.fragment().is_some() {
        return Err("The address cannot contain a username, password or fragment.".to_string());
    }
    if url.port().is_some_and(|port| port != 443) {
        return Err("Use the normal https port (443).".to_string());
    }
    let host = match url.host() {
        Some(url::Host::Domain(domain)) => domain.to_ascii_lowercase(),
        _ => return Err("Use a service name such as mcp.example.com, not an IP address.".to_string()),
    };
    let internal = host == "localhost" || !host.contains('.') || [".local", ".localhost", ".internal", ".lan", ".home", ".corp", ".intranet"].iter().any(|suffix| host.ends_with(suffix));
    if internal {
        return Err("That looks like an address on your own network. Nexus only signs in to public services.".to_string());
    }
    Ok(url)
}

/// The `resource_metadata="…"` address from a `WWW-Authenticate` challenge.
pub fn extract_resource_metadata(www_authenticate: &str) -> Option<String> {
    let start = www_authenticate.find("resource_metadata=\"")? + "resource_metadata=\"".len();
    let rest = &www_authenticate[start..];
    Some(rest[..rest.find('"')?].to_string())
}

/// Scopes that only read. Asked for at sign-in so the provider itself keeps
/// the token read-only wherever it lets us. Empty means "no read-only scope
/// advertised"; the caller then asks for nothing and relies on Nexus's own
/// read-only rule for tools.
pub fn read_scopes(supported: &[String]) -> Vec<String> {
    let is_word = |s: &str, word: &str| s.split(|c: char| !c.is_ascii_alphanumeric()).any(|part| part.eq_ignore_ascii_case(word));
    let mut picked: Vec<String> = supported
        .iter()
        .filter(|scope| {
            let reads = is_word(scope, "read") || is_word(scope, "viewer") || is_word(scope, "view");
            let writes = ["write", "admin", "delete", "manage", "all", "full", "access"].iter().any(|bad| is_word(scope, bad));
            reads && !writes
        })
        .cloned()
        .collect();
    // Keep the sign-in renewable.
    if supported.iter().any(|s| s == "offline_access") && !picked.is_empty() {
        picked.push("offline_access".to_string());
    }
    picked
}

/// Build the discovery result from the server's metadata documents.
pub fn parse_discovery(server_url: &str, resource_metadata: Option<&Value>, auth_server: &Value) -> Result<Discovery, String> {
    let text = |key: &str| auth_server.get(key).and_then(Value::as_str).map(str::to_string);
    let list = |key: &str| -> Vec<String> {
        auth_server.get(key).and_then(Value::as_array).map(|a| a.iter().filter_map(|v| v.as_str().map(str::to_string)).collect()).unwrap_or_default()
    };
    let authorization_endpoint = text("authorization_endpoint").ok_or("This service did not publish a sign-in address.")?;
    let token_endpoint = text("token_endpoint").ok_or("This service did not publish a token address.")?;
    let registration_endpoint = text("registration_endpoint")
        .ok_or("This service does not allow Nexus to register itself, so it needs a registered app first.")?;
    if !list("code_challenge_methods_supported").iter().any(|m| m == "S256") {
        return Err("This service does not support the secure sign-in (PKCE) Nexus requires.".to_string());
    }
    let methods = list("token_endpoint_auth_methods_supported");
    let auth_method = if methods.is_empty() || methods.iter().any(|m| m == "none") {
        AuthMethod::None
    } else if methods.iter().any(|m| m == "client_secret_post") {
        AuthMethod::Post
    } else if methods.iter().any(|m| m == "client_secret_basic") {
        AuthMethod::Basic
    } else {
        return Err("This service needs a sign-in method Nexus does not support yet.".to_string());
    };
    let mut scopes = list("scopes_supported");
    if scopes.is_empty() {
        scopes = resource_metadata
            .and_then(|m| m.get("scopes_supported"))
            .and_then(Value::as_array)
            .map(|a| a.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
            .unwrap_or_default();
    }
    let resource = resource_metadata
        .and_then(|m| m.get("resource"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| server_url.to_string());
    Ok(Discovery { resource, authorization_endpoint, token_endpoint, registration_endpoint, scopes_supported: scopes, auth_method })
}

pub fn pkce_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

pub fn authorization_url(d: &Discovery, client_id: &str, redirect_uri: &str, challenge: &str, state: &str, scope: &str) -> Result<String, String> {
    let mut url = url::Url::parse(&d.authorization_endpoint).map_err(|_| "This service published an invalid sign-in address.".to_string())?;
    {
        let mut q = url.query_pairs_mut();
        q.append_pair("response_type", "code");
        q.append_pair("client_id", client_id);
        q.append_pair("redirect_uri", redirect_uri);
        q.append_pair("code_challenge", challenge);
        q.append_pair("code_challenge_method", "S256");
        q.append_pair("state", state);
        q.append_pair("resource", &d.resource);
        if !scope.is_empty() {
            q.append_pair("scope", scope);
        }
    }
    Ok(url.to_string())
}

pub fn parse_token_response(text: &str, now: u64, d: &TokenContext) -> Result<Tokens, String> {
    let v: Value = serde_json::from_str(text).map_err(|_| "The service returned something unexpected. Try again in a moment.".to_string())?;
    let access_token = v.get("access_token").and_then(Value::as_str).filter(|t| !t.is_empty()).ok_or("The service did not complete the sign-in. Try connecting again.")?.to_string();
    Ok(Tokens {
        access_token,
        refresh_token: v.get("refresh_token").and_then(Value::as_str).map(str::to_string).or_else(|| d.previous_refresh_token.clone()),
        expires_at: v.get("expires_in").and_then(Value::as_u64).map(|s| now + s),
        token_endpoint: d.token_endpoint.clone(),
        client_id: d.client_id.clone(),
        client_secret: d.client_secret.clone(),
        auth_method: d.auth_method,
        resource: d.resource.clone(),
    })
}

/// What a token response needs to know to build the stored record.
pub struct TokenContext {
    pub token_endpoint: String,
    pub client_id: String,
    pub client_secret: Option<String>,
    pub auth_method: AuthMethod,
    pub resource: Option<String>,
    pub previous_refresh_token: Option<String>,
}

// ---------- network ----------

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder().http_status_as_error(false).timeout_global(Some(Duration::from_secs(20))).build().into()
}

fn get_json(url: &str) -> Option<Value> {
    let response = agent().get(url).header("Accept", "application/json").header("User-Agent", "Nexus-Guard").call().ok()?;
    if !response.status().is_success() {
        return None;
    }
    serde_json::from_str(&response.into_body().read_to_string().ok()?).ok()
}

/// Ask the server what sign-in it wants and where.
pub fn discover(server_url: &str) -> Result<Discovery, String> {
    let url = check_service_url(server_url)?;
    let origin = format!("{}://{}", url.scheme(), url.host_str().unwrap_or(""));
    let origin = match url.port() {
        Some(port) => format!("{origin}:{port}"),
        None => origin,
    };
    let path = url.path().trim_end_matches('/').to_string();

    // An unauthenticated call makes the server say where its metadata lives.
    let init = r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"nexus-guard","version":"1"}}}"#;
    let challenge = agent()
        .post(server_url)
        .header("Accept", "application/json, text/event-stream")
        .header("Content-Type", "application/json")
        .header("User-Agent", "Nexus-Guard")
        .send(init)
        .ok()
        .and_then(|r| r.headers().get("www-authenticate").and_then(|v| v.to_str().ok()).map(str::to_string));
    let mut candidates: Vec<String> = challenge.as_deref().and_then(extract_resource_metadata).into_iter().collect();
    candidates.push(format!("{origin}/.well-known/oauth-protected-resource{path}"));
    candidates.push(format!("{origin}/.well-known/oauth-protected-resource"));
    let resource_metadata = candidates.iter().find_map(|c| get_json(c));

    let issuer = resource_metadata
        .as_ref()
        .and_then(|m| m.get("authorization_servers"))
        .and_then(Value::as_array)
        .and_then(|a| a.first())
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| origin.clone());
    let issuer_url = url::Url::parse(&issuer).map_err(|_| "This service published an invalid sign-in server.".to_string())?;
    let issuer_origin = format!("{}://{}{}", issuer_url.scheme(), issuer_url.host_str().unwrap_or(""), issuer_url.port().map(|p| format!(":{p}")).unwrap_or_default());
    let issuer_path = issuer_url.path().trim_end_matches('/');
    let metadata_urls = [
        format!("{issuer_origin}/.well-known/oauth-authorization-server{issuer_path}"),
        format!("{issuer_origin}/.well-known/oauth-authorization-server"),
        format!("{issuer_origin}/.well-known/openid-configuration{issuer_path}"),
        format!("{}/.well-known/openid-configuration", issuer.trim_end_matches('/')),
    ];
    let auth_server = metadata_urls
        .iter()
        .find_map(|u| get_json(u).filter(|m| m.get("authorization_endpoint").is_some()))
        .ok_or("This service does not publish a sign-in setup Nexus can use.")?;
    parse_discovery(server_url, resource_metadata.as_ref(), &auth_server)
}

/// Register Nexus as a client (no per-service app needed).
pub fn register(d: &Discovery, redirect_uri: &str) -> Result<(String, Option<String>), String> {
    let method = match d.auth_method {
        AuthMethod::None => "none",
        AuthMethod::Basic => "client_secret_basic",
        AuthMethod::Post => "client_secret_post",
    };
    let body = serde_json::json!({
        "client_name": "Nexus Guard",
        "redirect_uris": [redirect_uri],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": method,
    });
    let response = agent()
        .post(&d.registration_endpoint)
        .header("Accept", "application/json")
        .header("User-Agent", "Nexus-Guard")
        .send_json(body)
        .map_err(|_| "Could not reach the service to register Nexus. Check your network, then try again.".to_string())?;
    if !response.status().is_success() {
        return Err("The service did not accept Nexus as a sign-in client. It may only allow approved clients.".to_string());
    }
    let v: Value = serde_json::from_str(&response.into_body().read_to_string().map_err(|_| "The service returned something unexpected.".to_string())?)
        .map_err(|_| "The service returned something unexpected.".to_string())?;
    let client_id = v.get("client_id").and_then(Value::as_str).ok_or("The service did not register Nexus.")?.to_string();
    Ok((client_id, v.get("client_secret").and_then(Value::as_str).map(str::to_string)))
}

fn token_request(ctx: &TokenContext, mut form: Vec<(&str, String)>) -> Result<Tokens, String> {
    form.push(("client_id", ctx.client_id.clone()));
    let mut request = agent().post(&ctx.token_endpoint).header("Accept", "application/json").header("User-Agent", "Nexus-Guard");
    if let (AuthMethod::Basic, Some(secret)) = (ctx.auth_method, &ctx.client_secret) {
        request = request.header("Authorization", &format!("Basic {}", base64::engine::general_purpose::STANDARD.encode(format!("{}:{}", ctx.client_id, secret))));
    } else if let (AuthMethod::Post, Some(secret)) = (ctx.auth_method, &ctx.client_secret) {
        form.push(("client_secret", secret.clone()));
    }
    let response = request
        .send_form(form.iter().map(|(k, v)| (*k, v.as_str())))
        .map_err(|_| "Could not reach the service. Check your network, then try again.".to_string())?;
    if !response.status().is_success() {
        return Err("The service did not complete the sign-in. Try connecting again.".to_string());
    }
    let text = response.into_body().read_to_string().map_err(|_| "The service returned something unexpected.".to_string())?;
    parse_token_response(&text, now_secs(), ctx)
}

pub fn exchange_code(ctx: &TokenContext, code: &str, redirect_uri: &str, verifier: &str) -> Result<Tokens, String> {
    let mut form = vec![
        ("grant_type", "authorization_code".to_string()),
        ("code", code.to_string()),
        ("redirect_uri", redirect_uri.to_string()),
        ("code_verifier", verifier.to_string()),
    ];
    if let Some(resource) = &ctx.resource {
        form.push(("resource", resource.clone()));
    }
    token_request(ctx, form)
}

/// Trade the refresh token for new tokens, keeping the same client.
pub fn refresh(tokens: &Tokens) -> Result<Tokens, String> {
    let refresh_token = tokens.refresh_token.clone().ok_or("This sign-in cannot be renewed. Connect the service again.")?;
    let ctx = TokenContext {
        token_endpoint: tokens.token_endpoint.clone(),
        client_id: tokens.client_id.clone(),
        client_secret: tokens.client_secret.clone(),
        auth_method: tokens.auth_method,
        resource: tokens.resource.clone(),
        previous_refresh_token: Some(refresh_token.clone()),
    };
    let mut form = vec![("grant_type", "refresh_token".to_string()), ("refresh_token", refresh_token)];
    if let Some(resource) = &ctx.resource {
        form.push(("resource", resource.clone()));
    }
    token_request(&ctx, form)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn strings(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn only_public_https_service_addresses_are_accepted() {
        for ok in ["https://mcp.example.com/mcp", "https://mcp.example.com", "https://a.b.example.co.uk/x/y?z=1", "https://mcp.example.com:443/mcp", " https://mcp.example.com/mcp "] {
            assert!(check_service_url(ok).is_ok(), "{ok}");
        }
        for bad in [
            "http://mcp.example.com/mcp", "ftp://mcp.example.com", "mcp.example.com", "", "https://",
            "https://localhost/mcp", "https://127.0.0.1/mcp", "https://[::1]/mcp", "https://192.168.1.5/mcp", "https://10.0.0.1",
            "https://intranet/mcp", "https://printer.local/mcp", "https://db.internal/mcp", "https://x.lan", "https://x.localhost",
            "https://user:pw@mcp.example.com/mcp", "https://user@mcp.example.com", "https://mcp.example.com/mcp#frag", "https://mcp.example.com:8443/mcp",
        ] {
            assert!(check_service_url(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn finds_the_metadata_address_in_a_challenge() {
        let www = r#"Bearer error="invalid_token", resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp""#;
        assert_eq!(extract_resource_metadata(www).as_deref(), Some("https://mcp.example.com/.well-known/oauth-protected-resource/mcp"));
        assert_eq!(extract_resource_metadata("Bearer realm=\"x\""), None);
    }

    #[test]
    fn asks_only_for_read_scopes() {
        assert_eq!(read_scopes(&strings(&["read", "write", "openid"])), strings(&["read"]));
        assert_eq!(read_scopes(&strings(&["data.records:read", "data.records:write", "schema.bases:read"])), strings(&["data.records:read", "schema.bases:read"]));
        assert_eq!(read_scopes(&strings(&["workspace:admin", "workspace:viewer", "offline_access"])), strings(&["workspace:viewer", "offline_access"]));
        // Nothing read-only advertised: ask for nothing rather than guess.
        assert!(read_scopes(&strings(&["mcp_all", "global", "default"])).is_empty());
        // "read" as part of a bigger word is not a read scope.
        assert!(read_scopes(&strings(&["threads", "spread"])).is_empty());
        // A scope that also allows writing is never picked.
        assert!(read_scopes(&strings(&["read_write", "full_access:read"])).is_empty());
    }

    #[test]
    fn discovery_needs_registration_and_pkce() {
        let ok = json!({"authorization_endpoint":"https://a/authorize","token_endpoint":"https://a/token","registration_endpoint":"https://a/register","code_challenge_methods_supported":["S256"],"token_endpoint_auth_methods_supported":["none","client_secret_post"],"scopes_supported":["read"]});
        let d = parse_discovery("https://mcp.example.com/mcp", Some(&json!({"resource":"https://mcp.example.com/mcp"})), &ok).unwrap();
        assert_eq!(d.auth_method, AuthMethod::None);
        assert_eq!(d.scopes_supported, strings(&["read"]));
        assert_eq!(d.resource, "https://mcp.example.com/mcp");

        let mut no_dcr = ok.clone();
        no_dcr.as_object_mut().unwrap().remove("registration_endpoint");
        assert!(parse_discovery("https://x", None, &no_dcr).unwrap_err().contains("registered app"));

        let mut no_pkce = ok.clone();
        no_pkce["code_challenge_methods_supported"] = json!(["plain"]);
        assert!(parse_discovery("https://x", None, &no_pkce).is_err());

        let mut secret_only = ok.clone();
        secret_only["token_endpoint_auth_methods_supported"] = json!(["client_secret_basic"]);
        assert_eq!(parse_discovery("https://x", None, &secret_only).unwrap().auth_method, AuthMethod::Basic);
        // The resource falls back to the server address; scopes fall back to the resource metadata.
        let mut bare = ok.clone();
        bare.as_object_mut().unwrap().remove("scopes_supported");
        let d = parse_discovery("https://srv/mcp", Some(&json!({"scopes_supported":["x:read"]})), &bare).unwrap();
        assert_eq!(d.resource, "https://srv/mcp");
        assert_eq!(d.scopes_supported, strings(&["x:read"]));
    }

    #[test]
    fn the_sign_in_link_carries_pkce_state_and_the_resource() {
        let d = Discovery { resource: "https://mcp.example.com/mcp".into(), authorization_endpoint: "https://a/authorize?tenant=1".into(), token_endpoint: "t".into(), registration_endpoint: "r".into(), scopes_supported: vec![], auth_method: AuthMethod::None };
        let url = authorization_url(&d, "cid", "http://127.0.0.1:9/oauth/callback", &pkce_challenge("verifier"), "st", "read").unwrap();
        let parsed = url::Url::parse(&url).unwrap();
        let q: std::collections::HashMap<_, _> = parsed.query_pairs().into_owned().collect();
        assert_eq!(q["tenant"], "1");
        assert_eq!(q["response_type"], "code");
        assert_eq!(q["code_challenge_method"], "S256");
        assert_eq!(q["code_challenge"], pkce_challenge("verifier"));
        assert_eq!(q["resource"], "https://mcp.example.com/mcp");
        assert_eq!(q["scope"], "read");
        assert!(!authorization_url(&d, "cid", "r", "c", "s", "").unwrap().contains("scope="));
    }

    #[test]
    fn token_answers_become_a_renewable_record() {
        let ctx = TokenContext { token_endpoint: "https://a/token".into(), client_id: "cid".into(), client_secret: Some("sec".into()), auth_method: AuthMethod::Post, resource: Some("https://r".into()), previous_refresh_token: Some("old".into()) };
        let t = parse_token_response(r#"{"access_token":"at","expires_in":3600}"#, 1000, &ctx).unwrap();
        assert_eq!(t.expires_at, Some(4600));
        assert_eq!(t.refresh_token.as_deref(), Some("old"), "keeps the old refresh token when none comes back");
        assert!(parse_token_response(r#"{"error":"invalid_grant"}"#, 0, &ctx).is_err());
        let rotated = parse_token_response(r#"{"access_token":"at","refresh_token":"new"}"#, 0, &ctx).unwrap();
        assert_eq!(rotated.refresh_token.as_deref(), Some("new"));
        assert_eq!(rotated.expires_at, None);
    }

    #[test]
    fn stored_records_round_trip_and_other_entries_are_ignored() {
        let t = Tokens { access_token: "a".into(), refresh_token: Some("r".into()), expires_at: Some(10_000), token_endpoint: "https://a/token".into(), client_id: "c".into(), client_secret: None, auth_method: AuthMethod::None, resource: None };
        assert_eq!(Tokens::from_json(&t.to_json()), Some(t.clone()));
        assert!(t.to_json().contains("\"accessToken\":\"a\""), "the server reads accessToken");
        assert!(!t.needs_refresh(5_000));
        assert!(t.needs_refresh(9_950));
        assert!(!Tokens { refresh_token: None, ..t }.needs_refresh(99_999));
        // A Supabase or GitHub entry is not a generic record, so refresh code leaves it alone.
        assert!(Tokens::from_json(r#"{"accessToken":"x","refreshToken":"y"}"#).is_none());
        assert!(Tokens::from_json("garbage").is_none());
    }

    /// Live check against real servers: `cargo test --lib mcp_oauth -- --ignored`.
    /// Public, read-only requests only; nothing is registered.
    #[test]
    #[ignore]
    fn live_discovery_finds_sign_in_endpoints() {
        for url in ["https://mcp.linear.app/mcp", "https://mcp.stripe.com", "https://mcp.neon.tech/mcp", "https://mcp.sentry.dev/mcp", "https://mcp.notion.com/mcp"] {
            let d = discover(url).unwrap_or_else(|e| panic!("{url}: {e}"));
            assert!(d.registration_endpoint.starts_with("https://"), "{url}");
            println!("{url} -> {} | method {:?} | read scopes {:?}", d.authorization_endpoint, d.auth_method, read_scopes(&d.scopes_supported));
        }
    }
}
