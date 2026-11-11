use super::{Browser, Settings};
use futures_util::{future::{AbortHandle, Abortable}, stream::FuturesUnordered, StreamExt};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    io::{BufRead, Write},
    path::{Path, PathBuf},
    process::Stdio,
};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

struct NativeActivity<F> {
    request: F,
    active: bool,
    generation: u64,
    idle: futures_util::future::BoxFuture<'static, u64>,
}

impl<F, Fut> NativeActivity<F>
where
    F: Fn(Value) -> Fut,
    Fut: std::future::Future<Output = Result<Value, String>>,
{
    fn new(request: F) -> Self {
        Self { request, active: false, generation: 0, idle: Box::pin(std::future::pending()) }
    }

    async fn set(&mut self, active: bool) {
        self.generation += 1;
        self.idle = Box::pin(std::future::pending());
        if self.active != active {
            let _ = (self.request)(json!({"action":"activity","active":active})).await;
            self.active = active;
        }
    }

    fn finish(&mut self) {
        let generation = self.generation;
        let delay = tokio::time::sleep(std::time::Duration::from_secs(4));
        self.idle = Box::pin(async move {
            delay.await;
            generation
        });
    }
}

pub fn arguments(cli: &Path, data: &Path, port: u16, settings: &Settings) -> Vec<String> {
    let mut args = vec![
        cli.to_string_lossy().into(),
        "--cdp-endpoint".into(),
        format!("http://127.0.0.1:{port}"),
        "--output-dir".into(),
        data.join("browser/output").to_string_lossy().into(),
    ];
    for (flag, origins) in [
        ("--allowed-origins", &settings.allowed_origins),
        ("--blocked-origins", &settings.blocked_origins),
    ] {
        if !origins.is_empty() {
            args.extend([flag.into(), origins.join(";")]);
        }
    }
    args
}
pub fn current_url(result: &Value) -> Option<String> {
    result["content"]
        .as_array()?
        .iter()
        .filter_map(|c| c["text"].as_str())
        .flat_map(str::lines)
        .find_map(|line| {
            if !line.strip_prefix("- ").is_some_and(|s| {
                s.split_once(": (current) [")
                    .is_some_and(|(index, _)| index.parse::<usize>().is_ok())
            }) {
                return None;
            }
            let (_, url) = line.rsplit_once("](")?;
            Some(url.strip_suffix(')')?.into())
        })
}
fn selection(result: &Value, id: &str) -> Option<Value> {
    let index = result["content"]
        .as_array()?
        .iter()
        .filter_map(|c| c["text"].as_str())
        .flat_map(str::lines)
        .find_map(|line| {
            line.strip_prefix("- ")?
                .split_once(": (current) [")?
                .0
                .parse::<usize>()
                .ok()
        })?;
    Some(
        json!({"jsonrpc":"2.0","id":format!("{id}-select"),"method":"tools/call","params":{"name":"browser_tabs","arguments":{"action":"select","index":index}}}),
    )
}
pub async fn run(data: PathBuf) -> Result<(), String> {
    let mut signal = super::signal::Shutdown::new()?;
    let browser = Browser::new(data);
    browser.serve().await?;
    let result = proxy(&browser, &mut signal).await;
    // Only stops a browser owned by this launcher (daemon-less mode).
    browser.shutdown().await;
    result
}
async fn proxy(
    browser: &std::sync::Arc<Browser>,
    signal: &mut super::signal::Shutdown,
) -> Result<(), String> {
    let settings = browser.settings()?;
    super::validate(&settings)?;
    let cli = match std::env::var_os("NUCODE_BROWSER_CLI") {
        Some(cli) => PathBuf::from(cli),
        None => crate::shared::engine_runtime::prepare(&browser.data, "browser", None).await?
            .join("node_modules/@playwright/mcp/cli.js"),
    };
    if !cli.is_file() {
        return Err(
            "Playwright MCP runtime missing. Install engines/browser (@playwright/mcp@0.0.83)."
                .into(),
        );
    }
    // Playwright lists its unchanged schemas without connecting to CDP. Recreate
    // the MCP session with the real endpoint only on the first browser tool.
    let mut child = spawn(&cli, &browser.data, 1, &settings)?;
    let mut port = None;
    let mut initialize = None;
    let mut input = child.stdin.take().ok_or("Missing MCP input")?;
    let mut output = BufReader::new(child.stdout.take().ok_or("Missing MCP output")?).lines();
    let (tx, mut rx) = tokio::sync::mpsc::channel(32);
    std::thread::spawn(move || {
        for line in std::io::stdin().lock().lines() {
            if tx.blocking_send(line).is_err() {
                break;
            }
        }
    });
    let mut calls: HashSet<String> = HashSet::new();
    let tab_id = format!("nu-browser-tabs-{}", uuid::Uuid::new_v4());
    let mut pending = HashMap::new();
    let mut sequence = 0;
    let mut activity = NativeActivity::new(|params| browser.request(params));
    let client = super::web::client()?;
    let mut web_requests = FuturesUnordered::new();
    let mut web_cancellations: HashMap<String, AbortHandle> = HashMap::new();
    let result = async {
        loop {
            tokio::select! {
                _ = signal.wait() => break,
                Some(completed) = web_requests.next() => {
                    let completed: Result<(Value, Value), futures_util::future::Aborted> = completed;
                    if let Ok((id, result)) = completed {
                        web_cancellations.remove(&id.to_string());
                        emit(&json!({"jsonrpc":"2.0","id":id,"result":result}).to_string())?;
                    }
                }
                generation = &mut activity.idle => {
                    if generation == activity.generation { activity.set(false).await; }
                }
                line = rx.recv() => {
                    let Some(line) = line else { break; };
                    let line = line.map_err(|e| e.to_string())?;
                    if let Ok(v) = serde_json::from_str::<Value>(&line) {
                        if v["method"] == "initialize" { initialize = Some(v.clone()); }
                        if v["method"] == "notifications/cancelled" {
                            if let Some(cancel) = web_cancellations.remove(&v["params"]["requestId"].to_string()) {
                                cancel.abort();
                                continue;
                            }
                            activity.set(false).await;
                            for id in cancel_pending(&mut pending, &v["params"]["requestId"]) {
                                let cancel = json!({"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":id}});
                                input.write_all(format!("{cancel}\n").as_bytes()).await.map_err(|e| e.to_string())?;
                            }
                            calls.remove(&v["params"]["requestId"].to_string());
                            if port.is_some() {
                                let _ = browser.request(json!({"action":"activity","active":!calls.is_empty()})).await;
                            }
                        }
                        if v["method"] == "tools/call" {
                            if matches!(v["params"]["name"].as_str(), Some("web_search" | "web_fetch")) {
                                let (cancel, registration) = AbortHandle::new_pair();
                                web_cancellations.insert(v["id"].to_string(), cancel);
                                web_requests.push(Abortable::new(web_call(client.clone(), browser.settings(), v), registration));
                                continue;
                            }
                            let endpoint = match browser.request(json!({"action":"ensure"})).await {
                                Ok(endpoint) => endpoint,
                                Err(error) => {
                                    emit(&json!({"jsonrpc":"2.0","id":v["id"],"result":{"isError":true,"content":[{"type":"text","text":error}]}}).to_string())?;
                                    continue;
                                }
                            };
                            if endpoint["native"] == true {
                                activity.set(true).await;
                                let result = browser.request(json!({"action":"tool","name":v["params"]["name"],"arguments":v["params"]["arguments"]})).await;
                                activity.finish();
                                let result = result.unwrap_or_else(|error|json!({"isError":true,"content":[{"type":"text","text":error}]}));
                                emit(&json!({"jsonrpc":"2.0","id":v["id"],"result":result}).to_string())?;
                                continue;
                            }
                            activity.set(false).await;
                            let current_port = endpoint["port"].as_u64().ok_or("Missing browser debugging port")? as u16;
                            if port != Some(current_port) {
                                let mut init = initialize.clone().ok_or("Initialize MCP before calling browser tools")?;
                                let _ = child.kill().await; let _ = child.wait().await;
                                for id in calls.drain() {
                                    let id: Value = serde_json::from_str(&id).map_err(|e| e.to_string())?;
                                    emit(&json!({"jsonrpc":"2.0","id":id,"error":{"code":-32000,"message":"Browser restarted; retry the tool call"}}).to_string())?;
                                }
                                pending.clear();
                                child = spawn(&cli,&browser.data,current_port,&settings)?;
                                input = child.stdin.take().ok_or("Missing MCP input")?;
                                output = BufReader::new(child.stdout.take().ok_or("Missing MCP output")?).lines();
                                let init_id = format!("{tab_id}-initialize");
                                init["id"] = json!(init_id);
                                input.write_all(format!("{init}\n").as_bytes()).await.map_err(|e| e.to_string())?;
                                tokio::time::timeout(std::time::Duration::from_secs(30), async {
                                    loop {
                                        let line = output.next_line().await.map_err(|e| e.to_string())?.ok_or("Playwright MCP exited during initialization")?;
                                        let response: Value = serde_json::from_str(&line).map_err(|e| e.to_string())?;
                                        if response["id"] == init_id {
                                            if response.get("error").is_some() { return Err(response["error"].to_string()); }
                                            return Ok(());
                                        }
                                    }
                                }).await.map_err(|_| "Playwright MCP initialization timed out")??;
                                input.write_all(b"{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}\n").await.map_err(|e| e.to_string())?;
                                port = Some(current_port);
                            }
                            calls.insert(v["id"].to_string());
                            let _ = browser.request(json!({"action":"activity","active":true})).await;
                            sequence += 1;
                            let id = format!("{tab_id}-{sequence}");
                            let query = json!({"jsonrpc":"2.0","id":id,"method":"tools/call","params":{"name":"browser_tabs","arguments":{"action":"list"}}});
                            pending.insert(id, line);
                            input.write_all(format!("{query}\n").as_bytes()).await.map_err(|e| e.to_string())?;
                            continue;
                        }
                    }
                    input.write_all(format!("{line}\n").as_bytes()).await.map_err(|e| e.to_string())?;
                }
                line = output.next_line() => {
                    let Some(line) = line.map_err(|e| e.to_string())? else { break; };
                    let mut line = line;
                    if let Ok(mut v) = serde_json::from_str::<Value>(&line) {
                        if v["result"]["tools"].is_array() {
                            let settings = browser.settings()?;
                            let native = cfg!(target_os = "macos") && settings.engine == crate::types::BrowserEngine::Native;
                            super::backend::filter_tools(&mut v, native, settings.web_search.provider);
                            line = v.to_string();
                        }
                        if let Some(original) = v["id"].as_str().and_then(|id| pending.remove(id)) {
                            let id = v["id"].as_str().unwrap();
                            if !id.ends_with("-select") {
                                if let Some(query) = selection(&v["result"], id) {
                                    pending.insert(format!("{id}-select"), original);
                                    input.write_all(format!("{query}\n").as_bytes()).await.map_err(|e| e.to_string())?;
                                    continue;
                                }
                            }
                            if let Some(url) = current_url(&v["result"]) { let _ = browser.request(json!({"action":"agentTab","url":url})).await; }
                            input.write_all(format!("{original}\n").as_bytes()).await.map_err(|e| e.to_string())?;
                            continue;
                        }
                        if v["id"] == tab_id {
                            if let Some(query) = selection(&v["result"], &tab_id) {
                                input.write_all(format!("{query}\n").as_bytes()).await.map_err(|e| e.to_string())?;
                            }
                            continue;
                        }
                        if v["id"] == format!("{tab_id}-select") {
                            if let Some(url) = current_url(&v["result"]) { let _ = browser.request(json!({"action":"agentTab","url":url})).await; }
                            continue;
                        }
                        if v["id"].as_str().is_some_and(|id| id.starts_with(&tab_id)) { continue; }
                        if calls.remove(&v["id"].to_string()) {
                            let query = json!({"jsonrpc":"2.0","id":tab_id,"method":"tools/call","params":{"name":"browser_tabs","arguments":{"action":"list"}}});
                            input.write_all(format!("{query}\n").as_bytes()).await.map_err(|e| e.to_string())?;
                            let _ = browser.request(json!({"action":"activity","active":!calls.is_empty()})).await;
                        }
                    }
                    emit(&line)?;
                }
            }
        }
        Ok(())
    }.await;
    activity.set(false).await;
    if port.is_some() {
        let _ = browser
            .request(json!({"action":"activity","active":false}))
            .await;
    }
    let _ = child.kill().await;
    let _ = child.wait().await;
    result
}

async fn web_call(client: reqwest::Client, settings: Result<Settings, String>, request: Value) -> (Value, Value) {
    let result = match settings {
        Ok(settings) => super::web::call(&client, &settings, request["params"]["name"].as_str().unwrap_or(""), &request["params"]["arguments"]).await,
        Err(error) => Err(error),
    };
    let result = match result {
        Ok(text) => json!({"content":[{"type":"text","text":text}]}),
        Err(error) => json!({"isError":true,"content":[{"type":"text","text":error}]}),
    };
    (request["id"].clone(), result)
}

fn emit(line: &str) -> Result<(), String> {
    let mut stdout = std::io::stdout().lock();
    writeln!(stdout, "{line}")
        .and_then(|_| stdout.flush())
        .map_err(|e| e.to_string())
}

pub(super) fn cancel_pending(
    pending: &mut HashMap<String, String>,
    request: &Value,
) -> Vec<String> {
    let ids: Vec<_> = pending
        .iter()
        .filter(|(_, line)| serde_json::from_str::<Value>(line).is_ok_and(|v| v["id"] == *request))
        .map(|(id, _)| id.clone())
        .collect();
    for id in &ids {
        pending.remove(id);
    }
    ids
}
pub(super) fn command(
    cli: &Path,
    data: &Path,
    port: u16,
    settings: &Settings,
) -> tokio::process::Command {
    let mut command = tokio::process::Command::new(
        crate::shared::engine_runtime::node_path(),
    );
    command
        .args(arguments(cli, data, port, settings))
        .current_dir(data.join("browser/output"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .kill_on_drop(true);
    command
}
pub(super) fn spawn(
    cli: &Path,
    data: &Path,
    port: u16,
    settings: &Settings,
) -> Result<tokio::process::Child, String> {
    std::fs::create_dir_all(data.join("browser/output")).map_err(|e| e.to_string())?;
    command(cli, data, port, settings)
        .spawn()
        .map_err(|e| format!("Cannot start Playwright MCP: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{sync::Mutex, time::Duration};

    #[tokio::test]
    async fn background_calls_return_mcp_errors_and_cancel_without_results() {
        let client = super::super::web::client().unwrap();
        let request = json!({"id":"fetch","params":{"name":"web_fetch","arguments":{"url":"file:///unavailable"}}});
        let (id, result) = web_call(client.clone(), Ok(Settings::default()), request.clone()).await;
        assert_eq!(id, "fetch");
        assert_eq!(result, json!({"isError":true,"content":[{"type":"text","text":"Only HTTP(S) URLs are supported"}]}));
        let (cancel, registration) = AbortHandle::new_pair();
        let future = Abortable::new(web_call(client.clone(), Ok(Settings::default()), request.clone()), registration);
        cancel.abort();
        assert!(future.await.is_err());
        let (_, result) = web_call(client, Err("Settings unavailable".into()), request).await;
        assert_eq!(result["content"][0]["text"], "Settings unavailable");
    }

    #[tokio::test]
    async fn slow_background_request_does_not_block_other_completions() {
        use futures_util::FutureExt;
        let mut requests = FuturesUnordered::new();
        let (cancel, registration) = AbortHandle::new_pair();
        requests.push(Abortable::new(std::future::pending::<(Value, Value)>(), registration).boxed());
        let (_, registration) = AbortHandle::new_pair();
        requests.push(Abortable::new(web_call(super::super::web::client().unwrap(), Ok(Settings::default()),
            json!({"id":7,"params":{"name":"web_search","arguments":{}}})), registration).boxed());
        let (id, result) = tokio::time::timeout(Duration::from_secs(1), requests.next()).await.unwrap().unwrap().unwrap();
        assert_eq!(id, 7);
        assert_eq!(result, json!({"isError":true,"content":[{"type":"text","text":"Web search is not set up. Choose a provider in Settings → Browser."}]}));
        cancel.abort();
        assert!(requests.next().await.unwrap().is_err());
        assert!(requests.next().await.is_none());
    }

    #[tokio::test]
    async fn native_activity_stays_active_between_calls() {
        let requests = Mutex::new(Vec::new());
        let mut activity = NativeActivity::new(|params| {
            requests.lock().unwrap().push(params);
            std::future::ready(Ok(Value::Null))
        });
        activity.set(true).await;
        activity.finish();
        assert!(tokio::time::timeout(Duration::from_millis(100), &mut activity.idle).await.is_err());
        activity.set(true).await;
        // Starting another call invalidates the previous idle transition.
        assert!(tokio::time::timeout(Duration::from_millis(100), &mut activity.idle).await.is_err());
        let finished = tokio::time::Instant::now();
        activity.finish();
        let generation = tokio::time::timeout(Duration::from_secs(5), &mut activity.idle).await.unwrap();
        assert_eq!(generation, activity.generation);
        assert!(finished.elapsed() >= Duration::from_secs(4));
        activity.set(false).await;
        assert_eq!(*requests.lock().unwrap(), vec![
            json!({"action":"activity","active":true}),
            json!({"action":"activity","active":false}),
        ]);
    }

    #[tokio::test]
    async fn native_activity_clears_immediately_and_invalidates_idle_on_cancel_or_shutdown() {
        let requests = Mutex::new(Vec::new());
        let mut activity = NativeActivity::new(|params| {
            requests.lock().unwrap().push(params);
            std::future::ready(Ok(Value::Null))
        });
        for finish in [true, false] {
            activity.set(true).await;
            if finish { activity.finish(); }
            let generation = activity.generation;
            activity.set(false).await;
            assert!(activity.generation > generation);
            assert!(!activity.active);
            assert_eq!(requests.lock().unwrap().last().unwrap(), &json!({"action":"activity","active":false}));
            assert!(tokio::time::timeout(Duration::from_millis(100), &mut activity.idle).await.is_err());
        }
        activity.set(false).await;
        assert_eq!(requests.lock().unwrap().len(), 4);
    }
}
