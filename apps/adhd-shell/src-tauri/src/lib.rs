use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackendRequest {
    service: String,
    method: String,
    path: String,
    base_url: Option<String>,
    body: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackendResponse {
    ok: bool,
    status: u16,
    body: Value,
}

fn default_base_url_for_service(service: &str) -> Result<&'static str, String> {
    match service {
        "host" => Ok("http://127.0.0.1:8787"),
        "federation" => Ok("http://127.0.0.1:8788"),
        _ => Err(format!("Unsupported backend service: {service}")),
    }
}

fn base_url_for_request(service: &str, base_url: Option<&str>) -> Result<String, String> {
    match base_url.map(str::trim) {
        Some("") => Err("Backend base URL must not be empty".to_string()),
        Some(url) => Ok(url.trim_end_matches('/').to_string()),
        None => Ok(default_base_url_for_service(service)?.to_string()),
    }
}

fn build_url(service: &str, base_url: Option<&str>, path: &str) -> Result<String, String> {
    let base = base_url_for_request(service, base_url)?;
    let normalized_path = if path.starts_with('/') {
        path.to_string()
    } else {
        format!("/{path}")
    };
    Ok(format!("{base}{normalized_path}"))
}

fn parse_method(method: &str) -> Result<Method, String> {
    match method {
        "GET" => Ok(Method::GET),
        "POST" => Ok(Method::POST),
        _ => Err(format!("Unsupported backend method: {method}")),
    }
}

#[tauri::command]
async fn backend_request(
    service: String,
    method: String,
    path: String,
    base_url: Option<String>,
    body: Option<Value>,
) -> Result<BackendResponse, String> {
    let request = BackendRequest {
        service,
        method,
        path,
        base_url,
        body,
    };

    let url = build_url(&request.service, request.base_url.as_deref(), &request.path)?;
    let method = parse_method(&request.method)?;
    let client = reqwest::Client::new();
    let mut builder = client.request(method, url);

    if let Some(body) = request.body {
        builder = builder.json(&body);
    }

    let response = builder
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let status = response.status().as_u16();
    let ok = response.status().is_success();
    let body = response
        .json::<Value>()
        .await
        .unwrap_or_else(|_| Value::Null);

    Ok(BackendResponse { ok, status, body })
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![backend_request])
        .run(tauri::generate_context!())
        .expect("error while running ADHD Tauri shell");
}
