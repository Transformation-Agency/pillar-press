use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    process::{Child, Command},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
#[cfg(not(debug_assertions))]
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    process::Stdio,
    thread,
    time::Duration,
};
use tauri::{
    menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu},
    AppHandle, Emitter, Manager, Url,
};

const MENU_SETUP_MODEL: &str = "setup-local-model";
const MENU_OPEN_DATA_DIR: &str = "open-data-folder";
const MENU_CREATE_BACKUP: &str = "create-local-backup";
const MENU_OPEN_BACKUPS: &str = "open-backups-folder";
const MENU_START_OLLAMA: &str = "start-ollama";
const MENU_OPEN_OLLAMA_DOWNLOAD: &str = "open-ollama-download";
const MENU_RELOAD: &str = "reload-window";

#[derive(Serialize)]
struct OllamaStatus {
    installed: bool,
    running: bool,
    version: Option<String>,
    message: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct DesktopLLMProfile {
    id: String,
    #[serde(default)]
    label: Option<String>,
    provider: String,
    model: String,
    #[serde(default, rename = "baseUrl")]
    base_url: Option<String>,
    #[serde(default, rename = "apiKey")]
    api_key: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct DesktopSettings {
    #[serde(default)]
    provider: Option<String>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default, rename = "baseUrl")]
    base_url: Option<String>,
    #[serde(default, rename = "apiKey")]
    api_key: Option<String>,
    #[serde(default)]
    profiles: Option<Vec<DesktopLLMProfile>>,
    #[serde(default, rename = "defaultProfileId")]
    default_profile_id: Option<String>,
    #[serde(default, rename = "taskDefaults")]
    task_defaults: Option<HashMap<String, String>>,
}

#[derive(Serialize)]
struct DesktopRuntimeStatus {
    local_first: bool,
    server_url: Option<String>,
    data_dir: String,
    database_path: String,
    settings_path: String,
    bundled_node_path: Option<String>,
}

#[derive(Clone, Serialize)]
struct BackupResult {
    path: String,
}

#[derive(Serialize)]
struct BackupManifest {
    app: String,
    version: String,
    created_at_unix_ms: u128,
    database: String,
    settings: Option<String>,
    settings_secrets: String,
    storage: String,
}

struct DesktopServer {
    child: Mutex<Option<Child>>,
    ollama_child: Mutex<Option<Child>>,
    port: Mutex<Option<u16>>,
    #[cfg(not(debug_assertions))]
    scheduler_started: Mutex<bool>,
}

impl DesktopServer {
    fn new() -> Self {
        Self {
            child: Mutex::new(None),
            ollama_child: Mutex::new(None),
            port: Mutex::new(None),
            #[cfg(not(debug_assertions))]
            scheduler_started: Mutex::new(false),
        }
    }
}

impl Drop for DesktopServer {
    fn drop(&mut self) {
        if let Ok(child_slot) = self.child.get_mut() {
            if let Some(child) = child_slot {
                let _ = child.kill();
            }
        }
        if let Ok(child_slot) = self.ollama_child.get_mut() {
            if let Some(child) = child_slot {
                let _ = child.kill();
            }
        }
    }
}

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(dir) = std::env::var_os("KINGS_PRESS_DESKTOP_DATA_DIR").map(PathBuf::from) {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        return Ok(dir);
    }

    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("desktop-settings.json"))
}

fn database_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("kings-press.sqlite3"))
}

fn backups_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app_data_dir(app)?.join("backups");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn storage_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app_data_dir(app)?.join("storage");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

#[cfg(target_os = "macos")]
fn disable_macos_window_restoration() {
    let _ = Command::new("defaults")
        .args([
            "write",
            "com.kingspress.editorialdesk",
            "NSQuitAlwaysKeepsWindows",
            "-bool",
            "false",
        ])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();

    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        let saved_state = home
            .join("Library")
            .join("Saved Application State")
            .join("com.kingspress.editorialdesk.savedState");
        let _ = fs::remove_dir_all(saved_state);
    }
}

fn init_database_at(path: &PathBuf) -> Result<(), String> {
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.execute_batch(include_str!("../../db/local-sqlite-schema.sql"))
        .map_err(|e| e.to_string())
}

#[cfg(not(debug_assertions))]
fn reserve_local_port() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    listener
        .local_addr()
        .map(|addr| addr.port())
        .map_err(|e| e.to_string())
}

#[cfg(not(debug_assertions))]
fn wait_for_server(port: u16) -> bool {
    for _ in 0..80 {
        if TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return true;
        }
        thread::sleep(Duration::from_millis(250));
    }
    false
}

#[cfg(not(debug_assertions))]
fn append_startup_log(data_dir: &PathBuf, message: &str) {
    let path = data_dir.join("desktop-startup.log");
    if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{message}");
    }
}

fn bundled_node_path(app: &AppHandle) -> Option<PathBuf> {
    let resource_dir = app.path().resource_dir().ok()?;
    let bin_name = if cfg!(windows) { "node.exe" } else { "node" };
    resource_path(app, "node")
        .map(|path| path.join("bin").join(bin_name))
        .filter(|path| path.exists())
        .or_else(|| {
            let candidate = resource_dir.join("node").join("bin").join(bin_name);
            candidate.exists().then_some(candidate)
        })
}

fn resource_path(app: &AppHandle, name: &str) -> Option<PathBuf> {
    let resource_dir = app.path().resource_dir().ok()?;
    [
        resource_dir.join(name),
        resource_dir.join("resources").join(name),
    ]
    .into_iter()
    .find(|path| path.exists())
}

fn open_path(path: PathBuf) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut cmd = Command::new("open");
        cmd.arg(path);
        cmd
    };

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut cmd = Command::new("explorer");
        cmd.arg(path);
        cmd
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut cmd = Command::new("xdg-open");
        cmd.arg(path);
        cmd
    };

    command.spawn().map(|_| ()).map_err(|e| e.to_string())
}

fn open_url(url: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut cmd = Command::new("open");
        cmd.arg(url);
        cmd
    };

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", "start", "", url]);
        cmd
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut cmd = Command::new("xdg-open");
        cmd.arg(url);
        cmd
    };

    command.spawn().map(|_| ()).map_err(|e| e.to_string())
}

fn ollama_bin() -> PathBuf {
    if let Some(path) = std::env::var_os("OLLAMA_BIN").map(PathBuf::from) {
        if path.exists() {
            return path;
        }
    }

    #[cfg(target_os = "macos")]
    let candidates = [
        "/opt/homebrew/bin/ollama",
        "/usr/local/bin/ollama",
        "/Applications/Ollama.app/Contents/Resources/ollama",
    ];

    #[cfg(target_os = "windows")]
    let candidates = [
        r"C:\Program Files\Ollama\ollama.exe",
        r"C:\Users\Public\AppData\Local\Programs\Ollama\ollama.exe",
    ];

    #[cfg(all(unix, not(target_os = "macos")))]
    let candidates = ["/usr/local/bin/ollama", "/usr/bin/ollama"];

    for candidate in candidates {
        let path = PathBuf::from(candidate);
        if path.exists() {
            return path;
        }
    }

    PathBuf::from(if cfg!(windows) {
        "ollama.exe"
    } else {
        "ollama"
    })
}

fn ollama_command() -> Command {
    Command::new(ollama_bin())
}

fn copy_dir_recursive(from: &PathBuf, to: &PathBuf) -> Result<(), String> {
    if !from.exists() {
        return Ok(());
    }
    fs::create_dir_all(to).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(from).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let from_path = entry.path();
        let to_path = to.join(entry.file_name());
        if from_path.is_dir() {
            copy_dir_recursive(&from_path, &to_path)?;
        } else {
            fs::copy(&from_path, &to_path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn redact_setting_secrets(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Object(map) => {
            let keys: Vec<String> = map.keys().cloned().collect();
            for key in keys {
                let lowered = key.to_ascii_lowercase();
                if lowered.contains("apikey")
                    || lowered.contains("api_key")
                    || lowered.contains("secret")
                    || lowered.contains("token")
                    || lowered.contains("password")
                {
                    map.insert(key, serde_json::Value::Null);
                } else if let Some(child) = map.get_mut(&key) {
                    redact_setting_secrets(child);
                }
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                redact_setting_secrets(item);
            }
        }
        _ => {}
    }
}

fn copy_redacted_settings(from: &PathBuf, to: &PathBuf) -> Result<(), String> {
    let text = fs::read_to_string(from).map_err(|e| e.to_string())?;
    let mut value: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    redact_setting_secrets(&mut value);
    let json = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
    fs::write(to, json).map_err(|e| e.to_string())
}

fn backup_stamp_ms() -> Result<u128, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())
        .map(|duration| duration.as_millis())
}

fn write_backup_manifest(
    backup_dir: &PathBuf,
    created_at_unix_ms: u128,
    has_settings: bool,
    has_storage: bool,
) -> Result<(), String> {
    let manifest = BackupManifest {
        app: "King's Press Editorial Desk".into(),
        version: env!("CARGO_PKG_VERSION").into(),
        created_at_unix_ms,
        database: "kings-press.sqlite3".into(),
        settings: has_settings.then(|| "desktop-settings.json".into()),
        settings_secrets: if has_settings {
            "nulled"
        } else {
            "not included"
        }
        .into(),
        storage: if has_storage {
            "storage/".into()
        } else {
            "not present"
        }
        .into(),
    };
    let json = serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?;
    fs::write(backup_dir.join("backup-manifest.json"), json).map_err(|e| e.to_string())
}

fn create_backup_at(app: &AppHandle) -> Result<PathBuf, String> {
    init_database_at(&database_path(app)?)?;
    let stamp = backup_stamp_ms()?;
    let backup_dir = backups_dir(app)?.join(format!("kings-press-backup-{stamp}"));
    fs::create_dir_all(&backup_dir).map_err(|e| e.to_string())?;

    let db = database_path(app)?;
    if db.exists() {
        let backup_db = backup_dir.join("kings-press.sqlite3");
        let conn = Connection::open(&db).map_err(|e| e.to_string())?;
        conn.execute("VACUUM INTO ?1", [backup_db.to_string_lossy().as_ref()])
            .map_err(|e| e.to_string())?;
    }
    let settings = settings_path(app)?;
    if settings.exists() {
        copy_redacted_settings(&settings, &backup_dir.join("desktop-settings.json"))?;
    }
    let storage = storage_dir(app)?;
    let has_storage = storage.exists();
    copy_dir_recursive(&storage, &backup_dir.join("storage"))?;
    write_backup_manifest(&backup_dir, stamp, settings.exists(), has_storage)?;

    Ok(backup_dir)
}

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let about = AboutMetadata {
        name: Some("King's Press Editorial Desk".into()),
        version: Some(env!("CARGO_PKG_VERSION").into()),
        comments: Some("Local-first editorial operations desk for King's Press.".into()),
        website: Some("https://ollama.com/download".into()),
        website_label: Some("Local model setup".into()),
        ..Default::default()
    };

    Menu::with_items(
        app,
        &[
            &Submenu::with_items(
                app,
                "King's Press Editorial Desk",
                true,
                &[
                    &PredefinedMenuItem::about(
                        app,
                        Some("About King's Press Editorial Desk"),
                        Some(about),
                    )?,
                    &PredefinedMenuItem::separator(app)?,
                    &MenuItem::with_id(
                        app,
                        MENU_SETUP_MODEL,
                        "Set Up Local Model...",
                        true,
                        Some("CmdOrCtrl+,"),
                    )?,
                    &MenuItem::with_id(
                        app,
                        MENU_OPEN_DATA_DIR,
                        "Open Data Folder",
                        true,
                        Some("CmdOrCtrl+Shift+O"),
                    )?,
                    &MenuItem::with_id(
                        app,
                        MENU_CREATE_BACKUP,
                        "Create Local Backup",
                        true,
                        Some("CmdOrCtrl+Shift+B"),
                    )?,
                    &MenuItem::with_id(
                        app,
                        MENU_OPEN_BACKUPS,
                        "Open Backups Folder",
                        true,
                        None::<&str>,
                    )?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::hide(app, None)?,
                    &PredefinedMenuItem::hide_others(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::quit(app, None)?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::undo(app, None)?,
                    &PredefinedMenuItem::redo(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::cut(app, None)?,
                    &PredefinedMenuItem::copy(app, None)?,
                    &PredefinedMenuItem::paste(app, None)?,
                    &PredefinedMenuItem::select_all(app, None)?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "View",
                true,
                &[
                    &MenuItem::with_id(app, MENU_RELOAD, "Reload", true, Some("CmdOrCtrl+R"))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::fullscreen(app, None)?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "Window",
                true,
                &[
                    &PredefinedMenuItem::minimize(app, None)?,
                    &PredefinedMenuItem::maximize(app, None)?,
                    &PredefinedMenuItem::close_window(app, None)?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "Help",
                true,
                &[
                    &MenuItem::with_id(app, MENU_START_OLLAMA, "Start Ollama", true, None::<&str>)?,
                    &MenuItem::with_id(
                        app,
                        MENU_OPEN_OLLAMA_DOWNLOAD,
                        "Install Ollama...",
                        true,
                        None::<&str>,
                    )?,
                    &MenuItem::with_id(
                        app,
                        MENU_SETUP_MODEL,
                        "Set Up Local Model...",
                        true,
                        None::<&str>,
                    )?,
                ],
            )?,
        ],
    )
}

fn handle_menu_event(app: &AppHandle, id: &str) {
    match id {
        MENU_SETUP_MODEL => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
            let _ = app.emit("kingspress:show-model-setup", ());
        }
        MENU_OPEN_DATA_DIR => {
            if let Ok(path) = app_data_dir(app) {
                let _ = open_path(path);
            }
        }
        MENU_CREATE_BACKUP => {
            if let Ok(path) = create_backup_at(app) {
                let _ = open_path(path.clone());
                let _ = app.emit(
                    "kingspress:backup-created",
                    BackupResult {
                        path: path.to_string_lossy().to_string(),
                    },
                );
            }
        }
        MENU_OPEN_BACKUPS => {
            if let Ok(path) = backups_dir(app) {
                let _ = open_path(path);
            }
        }
        MENU_START_OLLAMA => {
            let _ = start_ollama_service(app.clone());
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
            let _ = app.emit("kingspress:show-model-setup", ());
        }
        MENU_OPEN_OLLAMA_DOWNLOAD => {
            let _ = open_url("https://ollama.com/download");
        }
        MENU_RELOAD => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.eval("window.location.reload()");
            }
        }
        _ => {}
    }
}

#[cfg(not(debug_assertions))]
fn post_local_json(port: u16, path: &str) -> Result<String, String> {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).map_err(|e| e.to_string())?;
    let body = "{}";
    let req = format!(
        "POST {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\nAccept: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream
        .write_all(req.as_bytes())
        .map_err(|e| e.to_string())?;
    let mut resp = String::new();
    stream
        .read_to_string(&mut resp)
        .map_err(|e| e.to_string())?;
    if resp.starts_with("HTTP/1.1 2") || resp.starts_with("HTTP/1.0 2") {
        Ok(resp)
    } else {
        Err(resp
            .lines()
            .next()
            .unwrap_or("scheduler request failed")
            .to_string())
    }
}

fn start_gather_scheduler(app: &AppHandle) -> Result<(), String> {
    #[cfg(debug_assertions)]
    {
        let _ = app;
        return Ok(());
    }

    #[cfg(not(debug_assertions))]
    {
        let server = app.state::<DesktopServer>();
        let mut started = server.scheduler_started.lock().map_err(|e| e.to_string())?;
        if *started {
            return Ok(());
        }
        let port = match *server.port.lock().map_err(|e| e.to_string())? {
            Some(port) => port,
            None => return Ok(()),
        };
        *started = true;
        thread::spawn(move || {
            thread::sleep(Duration::from_secs(10));
            loop {
                let _ = post_local_json(port, "/api/gather/schedules/run-due");
                thread::sleep(Duration::from_secs(60));
            }
        });
        Ok(())
    }
}

fn start_packaged_server(app: &AppHandle) -> Result<Option<String>, String> {
    #[cfg(debug_assertions)]
    {
        let _ = app;
        return Ok(None);
    }

    #[cfg(not(debug_assertions))]
    {
        let port = reserve_local_port()?;
        let data_dir = app_data_dir(app)?;
        append_startup_log(&data_dir, "starting packaged server");
        let db_path = database_path(app)?;
        let storage_path = storage_dir(app)?;
        let settings = settings_path(app)?;
        init_database_at(&db_path)?;
        append_startup_log(&data_dir, "local database initialized");

        let server_dir = resource_path(app, "desktop-server").ok_or_else(|| {
            let resource_dir = app
                .path()
                .resource_dir()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|e| format!("unavailable ({e})"));
            format!(
                "Packaged desktop server was not found under Tauri resources at {resource_dir}."
            )
        })?;
        append_startup_log(
            &data_dir,
            &format!("desktop server resource: {}", server_dir.to_string_lossy()),
        );
        let server_entry = server_dir.join("server.js");
        if !server_entry.exists() {
            return Err(format!(
                "Packaged desktop server was not found at {}.",
                server_entry.to_string_lossy()
            ));
        }

        let node_bin = std::env::var_os("KINGS_PRESS_NODE_BIN")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .or_else(|| bundled_node_path(app))
            .unwrap_or_else(|| PathBuf::from("node"));
        append_startup_log(
            &data_dir,
            &format!("node executable: {}", node_bin.to_string_lossy()),
        );
        let mut command = Command::new(node_bin);
        command
            .arg(&server_entry)
            .current_dir(&server_dir)
            .env("NODE_ENV", "production")
            .env("HOSTNAME", "127.0.0.1")
            .env("PORT", port.to_string())
            .env("KINGS_PRESS_LOCAL_FIRST", "true")
            .env("DATA_BACKEND", "sqlite")
            .env("STORAGE_PROVIDER", "local")
            .env("KINGS_PRESS_STORAGE", "local")
            .env("KINGS_PRESS_DATA_DIR", &data_dir)
            .env("KINGS_PRESS_DB_PATH", &db_path)
            .env("KINGS_PRESS_STORAGE_DIR", &storage_path)
            .env("KINGS_PRESS_LLM_SETTINGS_PATH", &settings)
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        let child = command.spawn().map_err(|e| {
            append_startup_log(&data_dir, &format!("server spawn failed: {e}"));
            format!("Could not start local King’s Press server: {e}")
        })?;
        append_startup_log(&data_dir, &format!("server spawned on port {port}"));
        if !wait_for_server(port) {
            append_startup_log(&data_dir, "server wait timed out");
            return Err("Timed out waiting for the local King’s Press server to start.".into());
        }
        append_startup_log(&data_dir, "server ready");

        let server = app.state::<DesktopServer>();
        *server.child.lock().map_err(|e| e.to_string())? = Some(child);
        *server.port.lock().map_err(|e| e.to_string())? = Some(port);

        Ok(Some(format!("http://127.0.0.1:{port}")))
    }
}

#[tauri::command]
fn ollama_status() -> OllamaStatus {
    let version = ollama_command().arg("--version").output();
    match version {
        Ok(out) => {
            let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
            let running = ollama_command()
                .arg("list")
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false);
            OllamaStatus {
                installed: true,
                running,
                version: if text.is_empty() { None } else { Some(text) },
                message: if running {
                    None
                } else {
                    Some("Ollama is installed but not running.".into())
                },
            }
        }
        Err(_) => OllamaStatus {
            installed: false,
            running: false,
            version: None,
            message: Some("Ollama was not found on PATH.".into()),
        },
    }
}

fn is_ollama_running() -> bool {
    ollama_command()
        .arg("list")
        .output()
        .map(|out| out.status.success())
        .unwrap_or(false)
}

#[tauri::command]
fn start_ollama_service(app: AppHandle) -> Result<(), String> {
    if is_ollama_running() {
        return Ok(());
    }

    let version = ollama_command()
        .arg("--version")
        .output()
        .map_err(|_| "Ollama is not installed. Install it first, then reopen setup.".to_string())?;
    if !version.status.success() {
        return Err("Ollama is installed but could not be started from the command line.".into());
    }

    let server = app.state::<DesktopServer>();
    let mut child_slot = server.ollama_child.lock().map_err(|e| e.to_string())?;
    if child_slot.is_none() {
        let child = ollama_command()
            .arg("serve")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(|e| format!("Could not start Ollama: {e}"))?;
        *child_slot = Some(child);
    }
    drop(child_slot);

    for _ in 0..32 {
        if is_ollama_running() {
            return Ok(());
        }
        std::thread::sleep(std::time::Duration::from_millis(250));
    }

    Err("Ollama was started but did not become ready yet. Try again in a few seconds.".into())
}

#[tauri::command]
fn open_ollama_download() -> Result<(), String> {
    open_url("https://ollama.com/download")
}

#[tauri::command]
fn list_ollama_models() -> Result<Vec<String>, String> {
    let out = ollama_command()
        .arg("list")
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    let text = String::from_utf8_lossy(&out.stdout);
    Ok(text
        .lines()
        .skip(1)
        .filter_map(|line| line.split_whitespace().next())
        .filter(|name| !name.is_empty())
        .map(str::to_string)
        .collect())
}

#[tauri::command]
fn pull_ollama_model(model: String) -> Result<(), String> {
    let model = model.trim();
    if model.is_empty() {
        return Err("Choose a model first.".into());
    }
    let out = ollama_command()
        .args(["pull", model])
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

#[tauri::command]
fn save_model_choice(app: AppHandle, model: String) -> Result<(), String> {
    let model = model.trim();
    if model.is_empty() {
        return Err("Choose a model first.".into());
    }
    let settings = DesktopSettings {
        provider: Some("ollama".into()),
        model: Some(model.into()),
        base_url: Some("http://127.0.0.1:11434".into()),
        api_key: None,
        profiles: Some(vec![DesktopLLMProfile {
            id: "ollama-local".into(),
            label: Some("Ollama local".into()),
            provider: "ollama".into(),
            model: model.into(),
            base_url: Some("http://127.0.0.1:11434".into()),
            api_key: None,
        }]),
        default_profile_id: Some("ollama-local".into()),
        task_defaults: None,
    };
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(settings_path(&app)?, json).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_llm_settings(app: AppHandle, settings: DesktopSettings) -> Result<(), String> {
    let provider = settings.provider.as_deref().unwrap_or("ollama").trim();
    let model = settings.model.as_deref().unwrap_or("").trim();
    let profiles = settings
        .profiles
        .unwrap_or_default()
        .into_iter()
        .filter_map(|p| {
            let id = p.id.trim().to_string();
            let provider = p.provider.trim().to_string();
            let model = p.model.trim().to_string();
            if id.is_empty() || provider.is_empty() || model.is_empty() {
                return None;
            }
            Some(DesktopLLMProfile {
                id,
                label: p
                    .label
                    .as_deref()
                    .map(str::trim)
                    .filter(|v| !v.is_empty())
                    .map(str::to_string),
                provider,
                model,
                base_url: p
                    .base_url
                    .as_deref()
                    .map(str::trim)
                    .filter(|v| !v.is_empty())
                    .map(str::to_string),
                api_key: p
                    .api_key
                    .as_deref()
                    .map(str::trim)
                    .filter(|v| !v.is_empty())
                    .map(str::to_string),
            })
        })
        .collect::<Vec<_>>();
    if model.is_empty() {
        if profiles.is_empty() {
            return Err("Choose a model first.".into());
        }
    }
    let default_profile_id = settings
        .default_profile_id
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
        .or_else(|| profiles.first().map(|p| p.id.clone()));
    let cleaned = DesktopSettings {
        provider: Some(provider.into()),
        model: if model.is_empty() {
            profiles.first().map(|p| p.model.clone())
        } else {
            Some(model.into())
        },
        base_url: settings
            .base_url
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .map(str::to_string),
        api_key: settings
            .api_key
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .map(str::to_string),
        profiles: if profiles.is_empty() {
            None
        } else {
            Some(profiles)
        },
        default_profile_id,
        task_defaults: settings.task_defaults.map(|defaults| {
            defaults
                .into_iter()
                .filter_map(|(task, profile_id)| {
                    let task = task.trim().to_string();
                    let profile_id = profile_id.trim().to_string();
                    if task.is_empty() || profile_id.is_empty() {
                        None
                    } else {
                        Some((task, profile_id))
                    }
                })
                .collect()
        }),
    };
    let json = serde_json::to_string_pretty(&cleaned).map_err(|e| e.to_string())?;
    fs::write(settings_path(&app)?, json).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_model_choice(app: AppHandle) -> Result<Option<DesktopSettings>, String> {
    let path = settings_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&text)
        .map(Some)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn init_local_database(app: AppHandle) -> Result<String, String> {
    let path = database_path(&app)?;
    init_database_at(&path)?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn create_local_backup(app: AppHandle) -> Result<BackupResult, String> {
    let path = create_backup_at(&app)?;
    let _ = open_path(path.clone());
    Ok(BackupResult {
        path: path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn desktop_runtime_status(app: AppHandle) -> Result<DesktopRuntimeStatus, String> {
    let data_dir = app_data_dir(&app)?;
    let database_path = database_path(&app)?;
    let settings_path = settings_path(&app)?;
    let bundled_node_path = bundled_node_path(&app).map(|path| path.to_string_lossy().to_string());
    let server = app.state::<DesktopServer>();
    let port = *server.port.lock().map_err(|e| e.to_string())?;

    Ok(DesktopRuntimeStatus {
        local_first: true,
        server_url: port.map(|p| format!("http://127.0.0.1:{p}")),
        data_dir: data_dir.to_string_lossy().to_string(),
        database_path: database_path.to_string_lossy().to_string(),
        settings_path: settings_path.to_string_lossy().to_string(),
        bundled_node_path,
    })
}

fn main() {
    #[cfg(target_os = "macos")]
    disable_macos_window_restoration();

    tauri::Builder::default()
        .menu(build_menu)
        .on_menu_event(|app, event| handle_menu_event(app, event.id().as_ref()))
        .manage(DesktopServer::new())
        .setup(|app| {
            if let Some(server_url) = start_packaged_server(app.handle())? {
                start_gather_scheduler(app.handle())?;
                if let Some(window) = app.get_webview_window("main") {
                    let url = Url::parse(&server_url).map_err(|e| e.to_string())?;
                    window.navigate(url).map_err(|e| e.to_string())?;
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ollama_status,
            start_ollama_service,
            open_ollama_download,
            list_ollama_models,
            pull_ollama_model,
            save_model_choice,
            save_llm_settings,
            get_model_choice,
            init_local_database,
            create_local_backup,
            desktop_runtime_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running King's Press Editorial Desk");
}

#[cfg(test)]
mod tests {
    use super::{redact_setting_secrets, write_backup_manifest};
    use serde_json::json;
    use std::{fs, path::PathBuf};

    #[test]
    fn redacts_secret_like_desktop_settings_without_removing_model_config() {
        let mut value = json!({
            "provider": "openai",
            "model": "gpt-4o-mini",
            "baseUrl": "https://api.openai.com/v1",
            "apiKey": "sk-secret",
            "nested": {
                "refreshToken": "refresh-secret",
                "displayName": "King's Press"
            },
            "items": [
                { "client_secret": "oauth-secret", "label": "drive" },
                { "password": "pw", "safe": true }
            ]
        });

        redact_setting_secrets(&mut value);

        assert_eq!(value["provider"], "openai");
        assert_eq!(value["model"], "gpt-4o-mini");
        assert_eq!(value["baseUrl"], "https://api.openai.com/v1");
        assert!(value["apiKey"].is_null());
        assert!(value["nested"]["refreshToken"].is_null());
        assert_eq!(value["nested"]["displayName"], "King's Press");
        assert!(value["items"][0]["client_secret"].is_null());
        assert_eq!(value["items"][0]["label"], "drive");
        assert!(value["items"][1]["password"].is_null());
        assert_eq!(value["items"][1]["safe"], true);
    }

    #[test]
    fn writes_backup_manifest_with_redaction_metadata() {
        let dir =
            std::env::temp_dir().join(format!("kings-press-backup-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        write_backup_manifest(&PathBuf::from(&dir), 1234567890, true, true).unwrap();
        let text = fs::read_to_string(dir.join("backup-manifest.json")).unwrap();
        let manifest: serde_json::Value = serde_json::from_str(&text).unwrap();

        assert_eq!(manifest["app"], "King's Press Editorial Desk");
        assert_eq!(manifest["version"], env!("CARGO_PKG_VERSION"));
        assert_eq!(manifest["created_at_unix_ms"].as_u64(), Some(1234567890));
        assert_eq!(manifest["database"], "kings-press.sqlite3");
        assert_eq!(manifest["settings"], "desktop-settings.json");
        assert_eq!(manifest["settings_secrets"], "nulled");
        assert_eq!(manifest["storage"], "storage/");

        let _ = fs::remove_dir_all(&dir);
    }
}
