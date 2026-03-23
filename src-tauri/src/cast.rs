use serde::{Deserialize, Serialize};
use std::io::Write;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tiny_http::{Header, Method, Response, Server};
// use screenshots::Screen; // Unused

// specific imports for casting
// ALL REMOVED based on unused warnings and API mismatch.
// We use full paths in implementation.
// use rust_cast::Channel;
// use std::net::TcpListener; // Unused - now using TcpStream::connect
use reqwest::Url;
use std::fs::File;

// --- Shared TLS imports for Chromecast connections ---
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::DigitallySignedStruct;

/// Shared TLS certificate verifier that accepts all certs.
/// Chromecast devices use self-signed certificates on local networks,
/// so we must bypass standard TLS verification to connect.
#[derive(Debug)]
struct NoCertificateVerification;
impl ServerCertVerifier for NoCertificateVerification {
    fn verify_server_cert(
        &self,
        _end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        vec![
            rustls::SignatureScheme::ECDSA_NISTP256_SHA256,
            rustls::SignatureScheme::ECDSA_NISTP384_SHA384,
            rustls::SignatureScheme::ED25519,
            rustls::SignatureScheme::RSA_PKCS1_SHA256,
            rustls::SignatureScheme::RSA_PSS_SHA256,
        ]
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum CastProtocol {
    Chromecast,
    AirPlay,
    Dlna,
    Miracast, // Placeholder
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CastDevice {
    pub id: String,
    pub name: String,
    pub protocol: CastProtocol,
    pub ip: String,
    pub port: u16,
    pub dial_url: Option<String>,
    pub upnp_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CaptureRect {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
    pub dpr: f64,
}

pub struct CastState {
    pub devices: Arc<Mutex<Vec<CastDevice>>>,
    pub stream_server_port: Arc<Mutex<Option<u16>>>,
    pub app_handle: Arc<Mutex<Option<AppHandle>>>,
    // Legacy fields kept for minimal diff but unused in new pipeline
    pub capture_rect: Arc<Mutex<Option<CaptureRect>>>,
    // Persistent connection for Frontend Audio Piping
    pub audio_stream: Arc<Mutex<Option<std::net::TcpStream>>>,
    // Chromecast UI State Transmitter
    pub cc_state_tx: Arc<Mutex<Option<std::sync::mpsc::Sender<String>>>>,
}

impl CastState {
    pub fn new() -> Self {
        Self {
            devices: Arc::new(Mutex::new(Vec::new())),
            stream_server_port: Arc::new(Mutex::new(None)),
            app_handle: Arc::new(Mutex::new(None)),
            capture_rect: Arc::new(Mutex::new(None)),
            audio_stream: Arc::new(Mutex::new(None)),
            cc_state_tx: Arc::new(Mutex::new(None)),
        }
    }
}

#[tauri::command]
pub async fn start_discovery(app: AppHandle, state: State<'_, CastState>) -> Result<(), String> {
    // 0. Ensure server is started early
    ensure_server_started(app.clone(), &state);

    let devices_store = state.devices.clone();

    // Set app handle in state
    {
        let mut handle = state.app_handle.lock().unwrap();
        *handle = Some(app.clone());
    }

    // Clear existing devices on fresh discovery start
    {
        let mut devices = state.devices.lock().unwrap();
        devices.clear();
    }

    // Emit startup
    let _ = app.emit("cast-debug", "🔍 UNIVERSAL DISCOVERY STARTED (mDNS + SSDP)");
    let _ = app.emit(
        "cast-discovery-started",
        "Scanning for Universal Cast devices...",
    );

    let app_handle = app.clone();

    // Spawn discovery task
    std::thread::spawn(move || {
        use std::net::UdpSocket;
        use std::time::Duration;

        // --- macOS Local Network Privacy Trigger ---
        // We MUST attempt a UDP broadcast to explicitly trigger the
        // "Local Network Access" permission dialog on macOS. Without this,
        // direct TCP connects to local IPs will silently fail with "os error 65"
        #[cfg(target_os = "macos")]
        {
            if let Ok(socket) = UdpSocket::bind("0.0.0.0:0") {
                let _ = socket.set_broadcast(true);
                // Broadcast to standard generic multicast or 255.255.255.255
                // Port 5354 (non-mDNS) still triggers local network permission,
                // but avoids noise in mdns-sd crate logs.
                let _ = socket.send_to(b"DUMMY_PING", "224.0.0.251:5354");
                let _ = socket.send_to(b"DUMMY_PING", "255.255.255.255:5354");
                log::info!("🔒 Fired macOS Local Network Privacy native trigger");
            }
        }

        let _ = app_handle.emit("cast-debug", "🚀 Running multi-protocol discovery...");

        // 1. SSDP DISCOVERY (Roku, Samsung, LG, DIAL)
        // Send M-SEARCH multicast to 239.255.255.250:1900
        let h_app = app_handle.clone();
        let h_store = devices_store.clone();
        std::thread::spawn(move || {
            let ssdp_msg = "M-SEARCH * HTTP/1.1\r\n\
                           HOST: 239.255.255.250:1900\r\n\
                           MAN: \"ssdp:discover\"\r\n\
                           MX: 2\r\n\
                           ST: ssdp:all\r\n\r\n";

            if let Ok(socket) = UdpSocket::bind("0.0.0.0:0") {
                let _ = socket.set_read_timeout(Some(Duration::from_secs(3)));
                let _ = socket.send_to(ssdp_msg.as_bytes(), "239.255.255.250:1900");

                let mut buf = [0u8; 2048];
                let start = std::time::Instant::now();
                while start.elapsed() < Duration::from_secs(3) {
                    if let Ok((amt, _src)) = socket.recv_from(&mut buf) {
                        let response = String::from_utf8_lossy(&buf[..amt]);

                        // --- IMPROVED SSDP PARSING ---
                        // 1. Get IP and Port from LOCATION header
                        let location = response
                            .lines()
                            .find(|l| l.to_lowercase().starts_with("location:"))
                            .and_then(|l| l.split_once(':'))
                            .map(|(_, v)| v.trim());

                        let mut ip = _src.ip().to_string();
                        let mut port = _src.port(); // Ephemeral fallback

                        // --- V104: EARLIER Infrastructure Filtering ---
                        // Ignore devices ending in .1 (usually routers/gateways) unless they strongly identify as Casting/TVs
                        // This prevents unnecessary XML fetches and logging from router IPs
                        let is_gateway = ip.ends_with(".1");
                        let resp_lower = response.to_lowercase();
                        let is_strongly_identified = resp_lower.contains("google")
                            || resp_lower.contains("castbuild")
                            || resp_lower.contains("roku")
                            || resp_lower.contains("samsung")
                            || resp_lower.contains("lg");

                        if is_gateway && !is_strongly_identified {
                            log::debug!("🚫 SSDP Discovery: Ignoring potential gateway at {}", ip);
                            continue;
                        }

                        if let Some(loc_url) = location {
                            // loc_url is usually http://192.168.1.209:57298/xml/device_description.xml
                            if let Ok(url) = Url::parse(loc_url) {
                                if let Some(host) = url.host_str() {
                                    ip = host.to_string();
                                }
                                if let Some(p) = url.port() {
                                    port = p;
                                }

                                // NEW: Fetch XML for better diagnostics (using Tauri runtime)
                                let xml_url = loc_url.to_string();
                                let h_app_xml = h_app.clone();
                                let ip_for_closure = ip.clone(); // Clone IP here
                                let h_store_for_closure = h_store.clone();
                                tauri::async_runtime::spawn(async move {
                                    let client = reqwest::Client::new();
                                    match client.get(&xml_url).send().await {
                                        Ok(resp) => {
                                            let mut headers_debug = String::new();
                                            for (k, v) in resp.headers() {
                                                headers_debug
                                                    .push_str(&format!("{}: {:?} | ", k, v));
                                            }

                                            let mut dial_url = None;
                                            let mut app_url_msg = String::new();
                                            if let Some(app_url) =
                                                resp.headers().get("Application-URL")
                                            {
                                                if let Ok(url_str) = app_url.to_str() {
                                                    app_url_msg =
                                                        format!(" | 🌟 DIAL App-URL: {}", url_str);
                                                    dial_url = Some(url_str.to_string());
                                                }
                                            }

                                            let mut upnp_url = None;
                                            if let Ok(text) = resp.text().await {
                                                // Parse for UPnP AVTransport control URL
                                                // UPnP XML is usually <service><serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType>...<controlURL>/MediaRenderer/AVTransport/Control</controlURL></service>
                                                if let Ok(re) = regex::Regex::new(
                                                    r"(?s)<serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType>.*?<controlURL>(.*?)</controlURL>",
                                                ) {
                                                    if let Some(caps) = re.captures(&text) {
                                                        if let Some(url_match) = caps.get(1) {
                                                            let raw_ctrl =
                                                                url_match.as_str().trim();
                                                            // Combine relative URL with base URL
                                                            if let Ok(base_url) =
                                                                Url::parse(&xml_url)
                                                            {
                                                                if let Ok(full_url) =
                                                                    base_url.join(raw_ctrl)
                                                                {
                                                                    upnp_url =
                                                                        Some(full_url.to_string());
                                                                    app_url_msg.push_str(&format!(" | 🌟 UPnP AVTransport: {}", full_url));
                                                                }
                                                            }
                                                        }
                                                    }
                                                }

                                                let preview = if text.len() > 300 {
                                                    format!("{}...", &text[..300])
                                                } else {
                                                    text
                                                };
                                                let msg = format!(
                                                    "📄 SSDP XML from {}{} \nHEADERS: {}\nBODY: {}",
                                                    xml_url, app_url_msg, headers_debug, preview
                                                );
                                                let _ = h_app_xml.emit("cast-debug", msg.clone());
                                                log::info!("{}", msg);
                                            }

                                            // Update the device in the store if we found capabilities
                                            if dial_url.is_some() || upnp_url.is_some() {
                                                let mut devices =
                                                    h_store_for_closure.lock().unwrap();
                                                if let Some(device) = devices
                                                    .iter_mut()
                                                    .find(|d| d.ip == ip_for_closure)
                                                {
                                                    if dial_url.is_some() {
                                                        device.dial_url = dial_url.clone();
                                                    }
                                                    if upnp_url.is_some() {
                                                        device.upnp_url = upnp_url.clone();
                                                    }

                                                    // Re-emit the updated device so the frontend gets the URLs
                                                    let _ = h_app_xml
                                                        .emit("cast-device-found", device.clone());
                                                }
                                            }
                                        }
                                        Err(e) => {
                                            log::warn!(
                                                "⚠️ Failed to fetch SSDP XML from {}: {}",
                                                xml_url,
                                                e
                                            );
                                        }
                                    }
                                });
                            }
                        }

                        // Parse SSDP headers to identify device type
                        let mut protocol = CastProtocol::Dlna; // Default
                        let mut name = format!("Media Device ({})", ip);

                        log::info!(
                            "📡 SSDP Packet from {}: (Location identified: {})",
                            ip,
                            location.is_some()
                        );

                        if resp_lower.contains("roku") {
                            protocol = CastProtocol::Miracast; // We use Miracast/Dlna enum slot for Roku
                            name = format!("Roku ({})", ip);
                        } else if resp_lower.contains("samsung") {
                            protocol = CastProtocol::Dlna;
                            name = format!("Samsung TV ({})", ip);
                            // Samsung often uses 8001 or 8000 for control/Dlna
                            if port > 30000 {
                                port = 8001;
                            }
                        } else if resp_lower.contains("lg") || resp_lower.contains("webos") {
                            name = format!("LG TV ({})", ip);
                        } else if resp_lower.contains("google")
                            || resp_lower.contains("castbuild")
                            || resp_lower.contains("eureka")
                            || resp_lower.contains("chromecast")
                            || port == 8008
                            || port == 8009
                        {
                            protocol = CastProtocol::Chromecast;
                            name = format!("Chromecast ({})", ip);
                        }

                        let device = CastDevice {
                            id: format!("ssdp-{}", ip.replace('.', "-")),
                            name,
                            protocol,
                            ip: ip.clone(),
                            port,           // Use parsed port
                            dial_url: None, // Set async later
                            upnp_url: None, // Set async later
                        };

                        let mut devices = h_store.lock().unwrap();
                        if !devices.iter().any(|d| d.ip == ip) {
                            devices.push(device.clone());
                            let _ = h_app.emit("cast-device-found", device);
                        }
                    }
                }
            }
        });

        // 2. mDNS DISCOVERY (Chromecast, AirPlay, FCast) via mdns-sd
        let m_app = app_handle.clone();
        let m_store = devices_store.clone();
        std::thread::spawn(move || {
            use mdns_sd::{ServiceDaemon, ServiceEvent};
            if let Ok(mdns) = ServiceDaemon::new() {
                let services = vec![
                    "_googlecast._tcp.local.",
                    "_airplay._tcp.local.",
                    "_fcast._tcp.local.",
                    "_raop._tcp.local.",
                ];
                for service in services {
                    if let Ok(receiver) = mdns.browse(service) {
                        let start = std::time::Instant::now();
                        while start.elapsed() < Duration::from_secs(4) {
                            if let Ok(event) = receiver.recv_timeout(Duration::from_millis(100)) {
                                if let ServiceEvent::ServiceResolved(info) = event {
                                    // V114.27: Prefer IPv4 (avoiding OS Error 65 / No route to host)
                                    let ip_addr = info.get_addresses().iter().find(|a| a.is_ipv4());
                                    if let Some(addr) = ip_addr {
                                        let ip = addr.to_string();
                                        let fullname = info.get_fullname().to_string();

                                        let protocol = if service.contains("googlecast") {
                                            CastProtocol::Chromecast
                                        } else if service.contains("airplay")
                                            || service.contains("raop")
                                        {
                                            CastProtocol::AirPlay
                                        } else {
                                            CastProtocol::Dlna
                                        };

                                        let name = fullname;

                                        let device = CastDevice {
                                            id: format!("mdns-{}", ip.replace('.', "-")),
                                            name,
                                            protocol,
                                            ip: ip.clone(),
                                            port: info.get_port(),
                                            dial_url: None,
                                            upnp_url: None,
                                        };

                                        let mut devices = m_store.lock().unwrap();
                                        if !devices.iter().any(|d| d.ip == ip) {
                                            devices.push(device.clone());
                                            let _ = m_app.emit("cast-device-found", device);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });

        // 2.5 NATIVE macOS DNS-SD FALLBACK
        // Bypasses UDP socket blocks in mdns-sd crate
        #[cfg(target_os = "macos")]
        {
            let mac_app = app_handle.clone();
            let mac_store = devices_store.clone();
            std::thread::spawn(move || {
                use std::io::Read;
                use std::process::Command;

                log::info!("🔍 Starting native macOS dns-sd fallback...");
                let mut child = Command::new("dns-sd")
                    .args(["-t", "2", "-B", "_googlecast._tcp"])
                    .stdout(std::process::Stdio::piped())
                    .spawn()
                    .expect("Failed to start dns-sd");

                std::thread::sleep(Duration::from_secs(2));
                let _ = Command::new("kill")
                    .arg("-9")
                    .arg(child.id().to_string())
                    .output();

                let mut output = String::new();
                if let Some(mut stdout) = child.stdout.take() {
                    let _ = stdout.read_to_string(&mut output);
                }

                for line in output.lines() {
                    if line.contains("Add") && line.contains("_googlecast._tcp.") {
                        let parts: Vec<&str> = line.split_whitespace().collect();
                        if parts.len() >= 7 {
                            let instance_name = parts[6..].join(" ");
                            log::info!("🔍 Native Cast found: {}", instance_name);

                            // Resolve
                            let mut resolve_child = Command::new("dns-sd")
                                .args(["-t", "1", "-L", &instance_name, "_googlecast._tcp"])
                                .stdout(std::process::Stdio::piped())
                                .spawn()
                                .expect("Failed to start resolve");

                            std::thread::sleep(Duration::from_secs(2));
                            let _ = Command::new("kill")
                                .arg("-9")
                                .arg(resolve_child.id().to_string())
                                .output();

                            let mut resolve_out = String::new();
                            if let Some(mut stdout) = resolve_child.stdout.take() {
                                let _ = stdout.read_to_string(&mut resolve_out);
                            }

                            // Extract Friendly Name from TXT record `fn=`
                            let mut friendly_name = instance_name.clone();
                            if let Some(fn_start) = resolve_out.find(" fn=") {
                                let remainder = &resolve_out[fn_start + 4..];
                                let fn_end = remainder.find(' ').unwrap_or(remainder.len());
                                friendly_name = remainder[..fn_end].to_string();
                            }

                            if let Some(idx) = resolve_out.find("can be reached at ") {
                                let end = resolve_out[idx..]
                                    .find(" (")
                                    .unwrap_or(resolve_out.len() - idx);
                                let host_port = &resolve_out[idx + 18..idx + end].trim();

                                if let Some((host, _port_str)) = host_port.rsplit_once(':') {
                                    let mut ip_child = Command::new("dns-sd")
                                        .args(["-t", "1", "-G", "v4", host])
                                        .stdout(std::process::Stdio::piped())
                                        .spawn()
                                        .expect("Failed");

                                    std::thread::sleep(Duration::from_secs(1));
                                    let _ = Command::new("kill")
                                        .arg("-9")
                                        .arg(ip_child.id().to_string())
                                        .output();

                                    let mut ip_out = String::new();
                                    if let Some(mut s) = ip_child.stdout.take() {
                                        let _ = s.read_to_string(&mut ip_out);
                                    }

                                    for rline in ip_out.lines() {
                                        if rline.contains("Add") && rline.contains(host) {
                                            let rparts: Vec<&str> =
                                                rline.split_whitespace().collect();
                                            if rparts.len() >= 6 {
                                                let ip = rparts[5].to_string();
                                                log::info!(
                                                    "✅ Native Cast Resolved: {} -> {}",
                                                    friendly_name,
                                                    ip
                                                );

                                                let device = CastDevice {
                                                    id: format!(
                                                        "mdns-native-{}",
                                                        ip.replace('.', "-")
                                                    ),
                                                    name: friendly_name.clone(),
                                                    protocol: CastProtocol::Chromecast,
                                                    ip: ip.clone(),
                                                    port: 8009,
                                                    dial_url: None,
                                                    upnp_url: None,
                                                };

                                                let mut devices = mac_store.lock().unwrap();
                                                if !devices.iter().any(|d| d.ip == ip) {
                                                    devices.push(device.clone());
                                                    let _ =
                                                        mac_app.emit("cast-device-found", device);
                                                }
                                                break;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            });
        }

        /*
        // 3. LEGACY TCP PROBE (Chromecast Port 8009)
        // V114.27: DISABLED - Causes OS Error 65 if subnet doesn't match
        let known_ips = vec![("192.168.1.6", "Living room TV"), ("192.168.1.7", "Swamp")];
        for (ip, name) in &known_ips {
            let addr = format!("{}:8009", ip);
            if TcpStream::connect_timeout(&addr.parse().unwrap(), Duration::from_millis(500))
                .is_ok()
            {
                let device = CastDevice {
                    id: format!("chromecast-{}", ip.replace('.', "-")),
                    name: name.to_string(),
                    protocol: CastProtocol::Chromecast,
                    ip: ip.to_string(),
                    port: 8009,
                };
                let mut devices = devices_store.lock().unwrap();
                if !devices.iter().any(|d| d.ip == *ip) {
                    devices.push(device.clone());
                    let _ = app_handle.emit("cast-device-found", device);
                }
            }
        }
        */
    });

    Ok(())
}

#[tauri::command]
pub async fn stop_discovery(_state: State<'_, CastState>) -> Result<(), String> {
    // Stop browsing logic here
    Ok(())
}

#[tauri::command]
pub async fn discover_devices(
    app: AppHandle,
    state: State<'_, CastState>,
    protocol: String,
) -> Result<Vec<CastDevice>, String> {
    log::info!("discover_devices called for protocol: {}", protocol);

    // Start discovery
    start_discovery(app, state.clone()).await?;

    // Wait a moment for discovery to populate
    tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;

    // Return current devices
    let devices = state.devices.lock().unwrap();
    let filtered: Vec<CastDevice> = devices
        .iter()
        .filter(|d| match protocol.as_str() {
            "chromecast" => matches!(d.protocol, CastProtocol::Chromecast),
            "airplay" => matches!(d.protocol, CastProtocol::AirPlay),
            _ => true,
        })
        .cloned()
        .collect();

    log::info!("Returning {} devices", filtered.len());
    Ok(filtered)
}

// --- SERVER & CAPTURE INFRASTRUCTURE ---

pub fn ensure_server_started(app_handle: AppHandle, state: &CastState) -> u16 {
    let mut port_lock = state.stream_server_port.lock().unwrap();
    if let Some(port) = *port_lock {
        return port;
    }

    // Define HLS Directory - System Temp is most reliable
    let hls_dir = std::env::temp_dir().join("mxs-cast-hls-v2");
    // We do NOT clean here because ffmpeg.rs cleans it on start.
    // Actually, we should ensuring it exists for the server startup.
    if !hls_dir.exists() {
        let _ = std::fs::create_dir_all(&hls_dir);
    }
    log::info!("📂 HLS Output Directory: {:?}", hls_dir);

    // Match provided ports
    let preferred_ports = vec![8089, 8088, 8090];
    let mut server_opt = None;
    for port in &preferred_ports {
        let addr = format!("0.0.0.0:{}", port);
        if let Ok(s) = Server::http(&addr) {
            server_opt = Some(s);
            break;
        }
    }

    let server = if let Some(s) = server_opt {
        s
    } else {
        log::error!("❌ Failed to bind any Stream Server port!");
        return 0;
    };

    let server_port = match server.server_addr() {
        tiny_http::ListenAddr::IP(addr) => addr.port(),
        _ => preferred_ports[0],
    };

    // Store port using EXISTING lock (NOT a new lock - that would deadlock!)
    *port_lock = Some(server_port);
    // Drop the lock immediately so other threads can access it
    drop(port_lock);

    log::info!("🚀 HLS Stream Server Started on Port: {}", server_port);

    // --- START CAPTURE THREADS feeding FFmpeg TCP inputs ---
    let _capture_app_handle = app_handle.clone();
    let _video_port = 5555;
    let _audio_port = 5556;
    let _capture_rect_lock = state.capture_rect.clone();

    // --- LEGACY FFMPEG STARTUP DISABLED FOR STATE MIRRORING ---
    /*
    // 1. Audio Capture Thread (Connects to FFmpeg's TCP 5556)
    thread::spawn(move || {
        log::info!("🎤 Starting cpal audio capture -> TCP...");
        use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
        use std::net::TcpStream;

        // Wait for FFmpeg to start listening, with retry
        thread::sleep(Duration::from_millis(500));

        let mut stream = None;
        for attempt in 1..=30 {
            match TcpStream::connect(format!("127.0.0.1:{}", audio_port)) {
                Ok(s) => {
                    log::info!("✅ Connected to FFmpeg Audio port on attempt {}", attempt);
                    stream = Some(s);
                    break;
                }
                Err(_) if attempt < 30 => {
                    thread::sleep(Duration::from_millis(100));
                }
                Err(e) => {
                    log::error!("❌ Failed to connect to FFmpeg audio after 30 attempts: {}", e);
                    return;
                }
            }
        }

        if let Some(mut tcp_stream) = stream {
            let host = cpal::default_host();

            // PRIORITIZE LOOPBACK/BLACKHOLE, AVOID DEFAULT MIC
            let input_devices = host.input_devices().ok();
            let mut target_device = None;

            if let Some(devices) = input_devices {
                for d in devices {
                    if let Ok(name) = d.name() {
                        let n = name.to_lowercase();
                        if n.contains("blackhole") || n.contains("loopback") || n.contains("teleport") {
                            log::info!("🎤 Found Loopback Device: {}", name);
                            target_device = Some(d);
                            break;
                        }
                    }
                }
            }

            // IF NO LOOPBACK FOUND, DO *NOT* FALLBACK TO MIC (Causes Feedback!)
            // We'd rather have correct video and silent audio than feedback.
            if target_device.is_none() {
                log::warn!("⚠️ No BlackHole/Loopback device found. Disabling Audio Capture to prevent feedback.");
                // We keep the TCP stream open but send silence or nothing?
                // FFmpeg needs data to keep time? No, for audio it might just wait.
                // Let's send silence to keep sync.
                 let silence = vec![0u8; 1024 * 4]; // 1024 samples * 4 bytes (f32)
                 loop {
                     let _ = tcp_stream.write_all(&silence);
                     thread::sleep(Duration::from_millis(21)); // ~48kHz rate
                 }
            }

            if let Some(device) = target_device {
                let config = cpal::StreamConfig {
                    channels: 2,
                    sample_rate: cpal::SampleRate(48000),
                    buffer_size: cpal::BufferSize::Fixed(1024),
                };

                let err_fn = move |err| log::error!("Audio stream error: {}", err);
                let stream_socket = Arc::new(Mutex::new(tcp_stream));

                let audio_stream = device.build_input_stream(
                    &config,
                    move |data: &[f32], _: &_| {
                        if let Ok(mut s) = stream_socket.lock() {
                            // Convert f32 samples to bytes
                            let mut bytes = Vec::with_capacity(data.len() * 4);
                            for sample in data {
                                bytes.extend_from_slice(&sample.to_le_bytes());
                            }
                            let _ = s.write_all(&bytes);
                        }
                    },
                    err_fn,
                    None
                );

                if let Ok(s) = audio_stream {
                    let _ = s.play();
                    // Keep thread alive
                    loop { thread::sleep(Duration::from_secs(1)); }
                }
            }
        }
    });

    // 2. Video Capture Thread (Connects to FFmpeg's TCP 5555)
    thread::spawn(move || {
        log::info!("🚀 Starting reactive window capture -> TCP...");
        use std::net::TcpStream;

        // Wait for FFmpeg to start listening, with retry
        thread::sleep(Duration::from_millis(500));

        let mut stream = None;
        for attempt in 1..=30 {
            match TcpStream::connect(format!("127.0.0.1:{}", video_port)) {
                Ok(s) => {
                    log::info!("✅ Connected to FFmpeg Video port on attempt {}", attempt);
                    stream = Some(s);
                    break;
                }
                Err(_) if attempt < 30 => {
                    thread::sleep(Duration::from_millis(100));
                }
                Err(e) => {
                    log::error!("❌ Failed to connect to FFmpeg video after 30 attempts: {}", e);
                    return;
                }
            }
        }

        if let Some(mut tcp_stream) = stream {
            let frame_duration = Duration::from_micros(33333); // 30 FPS target

            use xcap::Window;
            let mut cached_window_index: Option<usize> = None;
            let mut last_window_search = std::time::Instant::now();

            loop {
                let start = std::time::Instant::now();

                // 1. Find/Refresh Window Handle (throttled search)
                let mut buffer = None;

                if cached_window_index.is_none() || last_window_search.elapsed().as_secs() > 2 {
                     let windows = Window::all().unwrap_or_default();
                     log::debug!("🔍 Scanning {} windows for 'mxs'...", windows.len());

                     if let Some((i, w)) = windows.iter().enumerate().find(|(_, w)| {
                        let title = w.title().to_lowercase();
                        title.contains("mxs") || title.contains("studio") || title.contains("loop")
                     }) {
                        log::info!("✅ Found window: '{}' at index {}", w.title(), i);
                        cached_window_index = Some(i);
                        buffer = w.capture_image().ok();
                     } else {
                        log::warn!("⚠️ No matching window found for capture!");
                        cached_window_index = None;
                     }
                     last_window_search = std::time::Instant::now();
                } else if let Some(idx) = cached_window_index {
                    let windows = Window::all().unwrap_or_default();
                    if let Some(w) = windows.get(idx) {
                        let title = w.title().to_lowercase();
                        if title.contains("mxs") || title.contains("studio") || title.contains("loop") {
                            buffer = w.capture_image().ok();
                        } else {
                            log::warn!("⚠️ Window title changed or lost: '{}'. Rescanning...", title);
                            cached_window_index = None;
                        }
                    } else {
                        cached_window_index = None;
                    }
                }


                if let Some(buf) = buffer {
                    // Resize to 1280x720 (16:9)
                    let width = buf.width();
                    let height = buf.height();
                    let raw = buf.into_raw();

                    if let Some(img_buffer) = image::RgbaImage::from_raw(width, height, raw) {
                        let dynamic = image::DynamicImage::ImageRgba8(img_buffer);
                        // OPTIMIZATION: Nearest Neighbor is fast!
                        let scaled = dynamic.resize_exact(1280, 720, image::imageops::FilterType::Nearest);
                        let rgba = scaled.to_rgba8();
                        let frame_bytes = rgba.as_raw();

                        // Send the frame
                        let _ = tcp_stream.write_all(frame_bytes);

                        // FRAME DUPLICATION LOGIC:
                        // If capture took > 33ms, duplicate this frame to fill the gap.
                        // This keeps FFmpeg fed at 30fps even if capture is only 5fps.
                        let elapsed = start.elapsed();
                        if elapsed > frame_duration {
                            let miss_count = (elapsed.as_millis() / frame_duration.as_millis()) as usize;
                            if miss_count > 0 {
                                // log::debug!("🐢 Slow capture ({:?}), repeating frame {} times", elapsed, miss_count);
                                for _ in 0..miss_count {
                                    let _ = tcp_stream.write_all(frame_bytes);
                                }
                            }
                        }
                    }
                } else {
                    // Send black frame if window not found to keep stream alive
                    let black = vec![0u8; 1280 * 720 * 4];
                    let _ = tcp_stream.write_all(&black);
                }

                // If we were somehow FASTER than 33ms, sleep (unlikely on Mac currently)
                let elapsed_total = start.elapsed();
                if elapsed_total < frame_duration {
                    thread::sleep(frame_duration - elapsed_total);
                }
            }
        }
    });

    // 3. Start FFmpeg (Always check if alive)
    {
        let mut ffmpeg = state.ffmpeg.lock().unwrap();
        if !ffmpeg.is_running() {
             log::info!("🔄 FFmpeg not running. Starting/Restarting pipeline...");
             thread::sleep(Duration::from_millis(100));
             if let Err(e) = ffmpeg.start(video_port, audio_port, hls_dir.clone().into(), app_handle.clone()) {
                log::error!("Failed to start FFmpeg: {}", e);
             }
        }
    }
    */
    log::info!("🚀 HLS/FFmpeg muted for State Mirroring efficiency.");

    // 4. HTTP File Server Loop
    let server_hls_dir = hls_dir.clone();
    thread::spawn(move || {
        log::info!("🌐 Studio HTTP Server thread running...");
        for request in server.incoming_requests() {
            let url = request.url().to_string();
            log::info!("🌐 Incoming HTTP Request: {}", url);
            // CORS Headers (Full Set)
            let headers = vec![
                Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap(),
                Header::from_bytes(&b"Access-Control-Allow-Methods"[..], &b"GET, OPTIONS"[..])
                    .unwrap(),
                Header::from_bytes(
                    &b"Access-Control-Allow-Headers"[..],
                    &b"Content-Type, Range"[..],
                )
                .unwrap(),
            ];

            // --- HTTP ROUTER ---
            // Connectivity Check Endpoint
            if url == "/ping" {
                log::info!("✅ PING received from Chromecast!");
                let response = Response::from_string("pong")
                    .with_header(
                        Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap(),
                    )
                    .with_header(
                        Header::from_bytes(&b"Content-Type"[..], &b"text/plain"[..]).unwrap(),
                    );
                let _ = request.respond(response);
                continue;
            }

            // CORS Preflight Options for ANY path
            if request.method() == &Method::Options {
                let _ = request.respond(
                    Response::empty(200)
                        .with_header(headers[0].clone())
                        .with_header(headers[1].clone())
                        .with_header(headers[2].clone()),
                );
                continue;
            }

            // === LOCAL RECEIVER SERVING ===
            // Serve receiver files from assets/ subfolders correctly
            if url.starts_with("/receiver/")
                || url.starts_with("/index.html")
                || url.starts_with("/mxs_receiver_v2.html")
                || url == "/receiver.html"
                || url == "/receiver-mirror.html"
                || url == "/receiver"
                || url == "/"
            {
                // Determine the logical path relative to assets
                let relative_path = if url == "/" || url == "/index.html" {
                    // This is tricky: if the user hits root, do they want the app or receiver?
                    // Usually this internal server is FOR the receiver.
                    "index.html"
                } else {
                    url.trim_start_matches('/')
                        .split('?')
                        .next()
                        .unwrap_or("index.html")
                };

                // Specific mapping overrides
                let final_rel_path =
                    if relative_path == "index.html" || relative_path.contains("v2") {
                        "index.html"
                    } else {
                        relative_path
                    };

                // Try to find file in assets directory (macOS bundle style)
                let exe_path = std::env::current_exe().ok();
                let assets_base = exe_path
                    .as_ref()
                    .and_then(|p| p.parent())
                    .map(|p| p.join("../Resources/assets"));

                // Fallback to project root public folder or current dir assets
                let cwd = std::env::current_dir().unwrap_or_default();
                let public_base = cwd.join("public");
                let assets_dev_base = cwd.join("assets");
                let assets_local_base = cwd.join("src-tauri/assets");
                let parent_public_base = cwd.parent().map(|p| p.join("public"));

                let mut target_path = None;

                // Search in various bases
                let bases = vec![
                    assets_base,
                    Some(assets_dev_base),
                    Some(public_base),
                    Some(assets_local_base),
                    parent_public_base,
                ];

                for base_opt in bases {
                    if let Some(base) = base_opt {
                        let p = base.join(final_rel_path);
                        if p.exists() {
                            target_path = Some(p);
                            break;
                        }
                    }
                }

                if let Some(path) = target_path {
                    if let Ok(file) = File::open(&path) {
                        log::info!("📺 Serving LOCAL {} from: {:?}", final_rel_path, path);
                        let mut res = Response::from_file(file);
                        for h in headers.clone() {
                            res.add_header(h);
                        }
                        res.add_header(
                            Header::from_bytes(
                                &b"Content-Type"[..],
                                &b"text/html; charset=utf-8"[..],
                            )
                            .unwrap(),
                        );
                        res.add_header(
                            Header::from_bytes(&b"Cache-Control"[..], &b"no-cache"[..]).unwrap(),
                        );
                        let _ = request.respond(res);
                        continue;
                    }
                }

                // If file not found, return embedded minimal receiver
                log::warn!("⚠️ receiver.html not found, serving embedded fallback");
                let embedded_html = r#"<!DOCTYPE html>
<html><head><title>MXS-004 Receiver (Local)</title>
<script src="https://www.gstatic.com/cast/sdk/libs/caf_receiver/v3/cast_receiver_framework.js"></script>
</head><body style="background:#000;color:#b38600;display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;">
<h1>MXS-004 Local Receiver</h1>
<script>
const ctx = cast.framework.CastReceiverContext.getInstance();
ctx.addCustomMessageListener('urn:x-cast:com.nowmultimedia.mxs004', e => console.log('MSG:', e));
ctx.start();
</script>
</body></html>"#;
                let mut res = Response::from_string(embedded_html);
                for h in headers.clone() {
                    res.add_header(h);
                }
                res.add_header(
                    Header::from_bytes(&b"Content-Type"[..], &b"text/html"[..]).unwrap(),
                );
                let _ = request.respond(res);
                continue;
            } // End HTML handling

            // === GENERIC ASSET SERVING (CSS, JS, Fonts) ===
            // This handles resources requested by the HTML files
            {
                let path_clean = url.strip_prefix("/").unwrap_or(&url);
                // Look for file in the resolved assets directory
                // We reuse the asset discovery logic from above, simplified

                let exe_path = std::env::current_exe().ok();
                let assets_dir = exe_path
                    .as_ref()
                    .and_then(|p| p.parent())
                    .map(|p| p.join("../Resources/assets")); // macOS bundle

                let cwd = std::env::current_dir().unwrap_or_default();
                let assets_dev_dir = cwd.join("assets");
                let public_dir = cwd.join("public");
                let assets_local_dir = cwd.join("src-tauri/assets");
                let parent_public_dir = cwd.parent().map(|p| p.join("public"));
                let parent_assets_dir = cwd.parent().map(|p| p.join("assets"));

                // Check ALL directories sequentially (don't short-circuit on directory existence!)
                let mut search_dirs: Vec<std::path::PathBuf> = Vec::new();
                if let Some(dir) = assets_dir.filter(|p| p.exists()) {
                    search_dirs.push(dir);
                }
                if assets_dev_dir.exists() {
                    search_dirs.push(assets_dev_dir);
                }
                if public_dir.exists() {
                    search_dirs.push(public_dir);
                }
                if assets_local_dir.exists() {
                    search_dirs.push(assets_local_dir);
                }
                if let Some(d) = parent_public_dir.filter(|p| p.exists()) {
                    search_dirs.push(d);
                }
                if let Some(d) = parent_assets_dir.filter(|p| p.exists()) {
                    search_dirs.push(d);
                }

                let found_path = search_dirs
                    .iter()
                    .map(|dir| dir.join(path_clean))
                    .find(|p| p.exists() && p.is_file());

                if let Some(path) = found_path {
                    if let Ok(file) = File::open(&path) {
                        let extension = path.extension().and_then(|s| s.to_str()).unwrap_or("");
                        let content_type = match extension {
                            "css" => "text/css",
                            "js" => "application/javascript",
                            "png" => "image/png",
                            "jpg" | "jpeg" => "image/jpeg",
                            "otf" | "ttf" => "font/otf",
                            "woff2" => "font/woff2",
                            _ => "application/octet-stream",
                        };

                        log::info!(
                            "📦 Serving Asset: {} ({}) from {:?}",
                            url,
                            content_type,
                            path
                        );
                        let mut res = Response::from_file(file);
                        for h in headers.clone() {
                            res.add_header(h);
                        }
                        res.add_header(
                            Header::from_bytes(&b"Content-Type"[..], content_type.as_bytes())
                                .unwrap(),
                        );
                        res.add_header(
                            Header::from_bytes(&b"Cache-Control"[..], &b"public, max-age=3600"[..])
                                .unwrap(),
                        );
                        let _ = request.respond(res);
                        continue;
                    }
                } else {
                    log::warn!(
                        "🚫 Asset 404: '{}'. CWD: {:?}. Parent(public) exitsts: {:?}",
                        url,
                        std::env::current_dir(),
                        cwd.parent()
                            .map(|p| p.join("public").exists())
                            .unwrap_or(false)
                    );
                }
            }

            // Fallthrough to HLS if generic asset not found

            // Serve HLS Files
            if url.starts_with("/hls/") {
                let filename = url.strip_prefix("/hls/").unwrap_or("");
                let file_path = server_hls_dir.join(filename);

                log::info!("📨 Serving HLS Request: {}", filename);

                // No blocking wait loop! Client has retry logic.
                if filename.ends_with(".m3u8") && !file_path.exists() {
                    log::warn!("⚠️ Playlist not ready yet: {}", filename);
                }

                if let Ok(file) = File::open(&file_path) {
                    let mut res = Response::from_file(file);

                    // Add all CORS headers
                    for h in headers.clone() {
                        res.add_header(h);
                    }

                    // Add Content-Type
                    if filename.ends_with(".m3u8") {
                        res.add_header(
                            Header::from_bytes(&b"Content-Type"[..], &b"application/x-mpegurl"[..])
                                .unwrap(),
                        );
                        // Disable caching for playlist
                        res.add_header(
                            Header::from_bytes(
                                &b"Cache-Control"[..],
                                &b"no-cache, no-store, must-revalidate"[..],
                            )
                            .unwrap(),
                        );
                    } else if filename.ends_with(".ts") {
                        res.add_header(
                            Header::from_bytes(&b"Content-Type"[..], &b"video/mp2t"[..]).unwrap(),
                        );
                    }

                    let _ = request.respond(res);
                } else {
                    let _ = request.respond(Response::empty(404));
                }
            // === AUDIO FILE SERVING for Chromecast ===
            } else if url.starts_with("/audio/") {
                let filename = url.strip_prefix("/audio/").unwrap_or("");
                let audio_dir = server_hls_dir.join("audio");
                let file_path = audio_dir.join(filename);

                log::info!("🎵 Audio Request: {}", filename);

                if let Ok(file) = File::open(&file_path) {
                    let mut res = Response::from_file(file);

                    for h in headers.clone() {
                        res.add_header(h);
                    }

                    // Determine content type based on extension
                    if filename.ends_with(".wav") {
                        res.add_header(
                            Header::from_bytes(&b"Content-Type"[..], &b"audio/wav"[..]).unwrap(),
                        );
                    } else if filename.ends_with(".mp3") {
                        res.add_header(
                            Header::from_bytes(&b"Content-Type"[..], &b"audio/mpeg"[..]).unwrap(),
                        );
                    } else if filename.ends_with(".ogg") {
                        res.add_header(
                            Header::from_bytes(&b"Content-Type"[..], &b"audio/ogg"[..]).unwrap(),
                        );
                    } else if filename.ends_with(".m4a") || filename.ends_with(".aac") {
                        res.add_header(
                            Header::from_bytes(&b"Content-Type"[..], &b"audio/aac"[..]).unwrap(),
                        );
                    }

                    // Cache audio files for performance
                    res.add_header(
                        Header::from_bytes(&b"Cache-Control"[..], &b"public, max-age=3600"[..])
                            .unwrap(),
                    );

                    let _ = request.respond(res);
                } else {
                    log::warn!("❌ Audio file not found: {:?}", file_path);
                    let _ = request.respond(Response::empty(404));
                }
            } else {
                let _ = request.respond(Response::empty(404));
            }
        }
    });

    server_port
}
pub fn get_local_ip(target_ip: &str) -> Option<String> {
    // 1. Try to find an IP on the SAME SUBNET as the Chromecast (Best)
    if let Ok(target) = target_ip.parse::<std::net::IpAddr>() {
        if let Ok(opts) = local_ip_address::list_afinet_netifas() {
            for (_, ip) in opts {
                if let (std::net::IpAddr::V4(local_v4), std::net::IpAddr::V4(target_v4)) =
                    (ip, target)
                {
                    let l_oct = local_v4.octets();
                    let t_oct = target_v4.octets();
                    log::info!("🔍 Checking interface: {} vs target: {}", ip, target);
                    // Match first 3 octets (common C-class subnet)
                    if l_oct[0] == t_oct[0] && l_oct[1] == t_oct[1] && l_oct[2] == t_oct[2] {
                        log::info!("✅ Selected Subnet-Matched IP: {}", ip);
                        return Some(ip.to_string());
                    }
                }
            }
        }
    }

    // 2. Fallback: Find first non-loopback IPv4 address
    if let Ok(opts) = local_ip_address::list_afinet_netifas() {
        for (name, ip) in opts {
            if ip.is_ipv4() && !ip.is_loopback() {
                log::info!("Selected primary interface: {} ({})", name, ip);
                return Some(ip.to_string());
            }
        }
    }

    None
}

#[tauri::command]
pub async fn cast_to_device(
    state: State<'_, CastState>,
    window: tauri::Window,
    device_id: String,
    protocol: String,
    rect: Option<CaptureRect>,
) -> Result<(), String> {
    use rust_cast::channels::{
        connection::ConnectionChannel, heartbeat::HeartbeatChannel, media::MediaChannel,
        receiver::ReceiverChannel,
    };
    use rust_cast::message_manager::MessageManager;
    use rustls::{ClientConfig, ClientConnection, RootCertStore, StreamOwned};
    use std::net::TcpStream;
    use std::rc::Rc;
    use std::sync::Arc;

    // Install default crypto provider if not already installed
    let _ = rustls::crypto::ring::default_provider().install_default();

    // Get app handle for emitting debug events
    let app_handle = window.app_handle().clone();
    let _ = app_handle.emit(
        "cast-debug",
        format!("🔌 cast_to_device called: {} via {}", device_id, protocol),
    );
    log::info!(
        "Connecting to device: {} via {} with rect: {:?}",
        device_id,
        protocol,
        rect
    );
    println!("🔌 cast_to_device called: {} via {}", device_id, protocol);

    // 1. Update shared capture rect
    if let Some(r) = rect {
        if let Ok(mut guard) = state.capture_rect.lock() {
            *guard = Some(r);
        }
    }

    // 2. Ensure server is started
    let server_port = ensure_server_started(app_handle.clone(), &state);
    let _ = app_handle.emit(
        "cast-debug",
        format!("🚀 Stream server on port: {}", server_port),
    );

    // 4. Find Device or use manual IP
    let (ip, port): (String, u16) = if device_id.starts_with("manual-") {
        // Extract IP from manual device ID
        let manual_ip = device_id.strip_prefix("manual-").unwrap_or("").to_string();
        println!("📍 Manual IP cast to: {}", manual_ip);
        log::info!("📍 Manual IP cast to: {}", manual_ip);
        (manual_ip, 8009) // Standard Chromecast port
    } else {
        // Look up device from discovery
        let devices = state.devices.lock().unwrap().clone();
        let target_device = devices.into_iter().find(|d| d.id == device_id);

        if let Some(device) = target_device {
            (device.ip.clone(), device.port)
        } else {
            log::error!("Device not found: {}", device_id);
            return Err(format!("Device not found: {}", device_id));
        }
    };

    let device_id_clone = device_id.clone();
    let app_handle_thread = app_handle.clone();
    let ip_clone = ip.clone();

    let _ = app_handle.emit("cast-debug", format!("🔍 Found device IP: {}:{}", ip, port));

    thread::spawn(move || {
        let local_ip = get_local_ip(&ip_clone).unwrap_or("0.0.0.0".to_string());
        log::info!(
            "Connecting to {} ({}:{}) from local {}",
            device_id_clone,
            ip_clone,
            port,
            local_ip
        );
        let _ = app_handle_thread.emit(
            "cast-debug",
            format!("🔗 Connecting to {}:{} from {}", ip_clone, port, local_ip),
        );

        // --- MANUAL TLS CONNECTION ---
        // NoCertificateVerification is now defined at module level (top of cast.rs)

        // Setup Rustls
        let mut root_store = RootCertStore::empty();
        root_store.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());

        let mut config = ClientConfig::builder()
            .with_root_certificates(root_store)
            .with_no_client_auth();

        // DANGER: Disable verification for internal IP
        config
            .dangerous()
            .set_certificate_verifier(Arc::new(NoCertificateVerification {}));

        // Use rustls::pki_types::ServerName
        let server_name = ServerName::try_from("google.com").unwrap().to_owned();

        match ClientConnection::new(Arc::new(config), server_name) {
            Ok(conn) => {
                let _ = app_handle_thread
                    .emit("cast-debug", "🔐 TLS connection created, connecting TCP...");
                let addr = format!("{}:{}", ip_clone.trim(), port)
                    .parse::<std::net::SocketAddr>()
                    .unwrap();

                // V115: MacOS EHOSTUNREACH (Error 65) Workaround via ARP Table Wakeup
                let _ = std::process::Command::new("ping")
                    .arg("-c")
                    .arg("1")
                    .arg("-W")
                    .arg("100")
                    .arg(ip_clone.trim())
                    .output();

                let mut connected_sock = None;
                for retry in 1..=5 {
                    match TcpStream::connect(&addr) {
                        Ok(s) => {
                            connected_sock = Some(s);
                            break;
                        }
                        Err(e) => {
                            log::warn!("⚠️ TCP connect attempt {} failed: {}", retry, e);
                            if retry == 5 {
                                let _ = app_handle_thread
                                    .emit("cast-debug", format!("❌ TCP Connect Failed: {}", e));
                                return;
                            }
                            std::thread::sleep(Duration::from_secs(1));
                        }
                    }
                }

                if let Some(sock) = connected_sock {
                    let _ = sock.set_read_timeout(Some(Duration::from_secs(5)));
                    let _ = sock.set_write_timeout(Some(Duration::from_secs(5)));
                    let _ = app_handle_thread
                        .emit("cast-debug", "✅ TCP connected! Setting up stream...");
                    // Set a reasonable timeout for the setup phase (connecting, launching)
                    sock.set_read_timeout(Some(Duration::from_secs(5))).ok();
                    let stream = StreamOwned::new(conn, sock.try_clone().unwrap());
                    // Keep the original socket to change timeout later
                    let shared_sock = sock;

                    // --- MESSAGE MANAGER ---
                    let message_manager = Rc::new(MessageManager::new(stream));

                    // --- CHANNELS ---
                    let heartbeat = HeartbeatChannel::new(
                        "sender-0",
                        "receiver-0",
                        Rc::clone(&message_manager),
                    );
                    let connection =
                        ConnectionChannel::new("sender-0", Rc::clone(&message_manager));
                    let receiver =
                        ReceiverChannel::new("sender-0", "receiver-0", Rc::clone(&message_manager));
                    let _media = MediaChannel::new("sender-0", Rc::clone(&message_manager));

                    log::info!("✅ Connected to ChromeCast (Manual TLS)!");
                    let _ = app_handle_thread.emit("cast-debug", "✅ Connected to Chromecast!");

                    // Establish basic connection and heartbeat
                    let _ = connection.connect("receiver-0");
                    if let Err(e) = heartbeat.ping() {
                        let _ = app_handle_thread
                            .emit("cast-debug", format!("⚠️ Initial ping failed: {:?}", e));
                    } else {
                        let _ = app_handle_thread
                            .emit("cast-debug", "💓 Heartbeat ping sent (Handshake OK)");
                    }

                    // Warm up with status check
                    let _ = app_handle_thread
                        .emit("cast-debug", "🔍 Checking current receiver status...");
                    match receiver.get_status() {
                        Ok(status) => {
                            let _ = app_handle_thread.emit(
                                "cast-debug",
                                format!(
                                    "📊 Status: Found {} active apps",
                                    status.applications.len()
                                ),
                            );
                        }
                        Err(e) => {
                            let _ = app_handle_thread
                                .emit("cast-debug", format!("⚠️ Status check warning: {:?}", e));
                        }
                    }

                    // Increase timeout for the actual launch
                    shared_sock
                        .set_read_timeout(Some(Duration::from_secs(30)))
                        .ok();

                    // === USE DEFAULT MEDIA RECEIVER FOR HLS ===
                    let _ = app_handle_thread.emit(
                        "cast-debug",
                        "🚀 Launching Default Media Receiver for HLS...",
                    );

                    let app_arg =
                        rust_cast::channels::receiver::CastDeviceApp::DefaultMediaReceiver;
                    let mut launch_result = receiver.launch_app(&app_arg);

                    if let Err(ref e) = launch_result {
                        log::warn!("⚠️ Initial launch failed: {:?}. Retrying in 2s...", e);
                        std::thread::sleep(Duration::from_secs(2));
                        launch_result = receiver.launch_app(&app_arg);
                    }

                    match launch_result {
                        Ok(app) => {
                            let _ = connection.connect(&app.transport_id);
                            let _ = app_handle_thread
                                .emit("cast-debug", "🎬 HLS Cast Active! (~8s latency)");

                            // Heartbeat Loop
                            loop {
                                std::thread::sleep(Duration::from_secs(4));
                                if let Err(e) = heartbeat.ping() {
                                    let _ = app_handle_thread.emit(
                                        "cast-debug",
                                        format!("⚠️ Heartbeat failed: {:?}", e),
                                    );
                                    break;
                                }
                                while message_manager.receive().is_ok() {}
                            }
                        }
                        Err(e) => {
                            let _ = app_handle_thread
                                .emit("cast-debug", format!("❌ launch_app failed: {:?}", e));
                        }
                    }
                }
            }
            Err(e) => {
                let _ = app_handle_thread.emit("cast-debug", format!("❌ TLS Setup failed: {}", e));
            }
        }
    });

    Ok(())
}

/// Launch the custom MXS-004 Hybrid Receiver on a Chromecast
#[tauri::command]
pub async fn chromecast_launch_hybrid(
    state: State<'_, CastState>,
    _window: tauri::Window,
    device_id: String,
    ws_url: String,
) -> Result<(), String> {
    use rust_cast::channels::{
        connection::ConnectionChannel, heartbeat::HeartbeatChannel, media::MediaChannel, receiver::ReceiverChannel,
    };
    use rust_cast::message_manager::MessageManager;
    use rustls::{ClientConfig, ClientConnection, RootCertStore, StreamOwned};
    use serde_json;
    use std::net::TcpStream;
    use std::rc::Rc;
    use std::sync::Arc;
    use std::time::Duration;

    log::info!(
        "🎬 Launching Hybrid Receiver on {}: WS={}",
        device_id,
        ws_url
    );

    // 1. Find Device (synchronous, before thread)
    let ip = {
        let devices = state.devices.lock().unwrap();
        let target = devices.iter().find(|d| d.id == device_id);
        if let Some(d) = target {
            d.ip.clone()
        } else {
            if device_id.starts_with("chromecast-") {
                device_id
                    .strip_prefix("chromecast-")
                    .unwrap()
                    .replace("-", ".")
            } else if device_id.starts_with("mdns-native-") {
                device_id
                    .strip_prefix("mdns-native-")
                    .unwrap()
                    .replace("-", ".")
            } else if device_id.starts_with("ssdp-") {
                device_id.strip_prefix("ssdp-").unwrap().replace("-", ".")
            } else {
                return Err("Device not found".into());
            }
        }
    };

    let port = 8009;

    let (tx, rx) = std::sync::mpsc::channel::<String>();
    {
        let mut guard = state.cc_state_tx.lock().unwrap();
        *guard = Some(tx);
    }

    let app_handle_thread = _window.app_handle().clone();
    let (tx_result, rx_result) = tokio::sync::oneshot::channel::<Result<(), String>>();

    std::thread::spawn(move || {
        // NoCertificateVerification is now defined at module level (top of cast.rs)

        let _ = rustls::crypto::ring::default_provider().install_default();

        let mut app_session = None;
        let mut active_sock = None;
        'outer: for attempt in 1..=3 {
            log::info!("🔄 Hybrid Launch Attempt {}/3...", attempt);

            // Trigger macOS Local Network Permission Dialog (UDP Broadcast Trigger)
            #[cfg(target_os = "macos")]
            {
                use std::net::UdpSocket;
                if let Ok(socket) = UdpSocket::bind("0.0.0.0:0") {
                    let _ = socket.set_broadcast(true);
                    // Port 5354 avoids DNS parsing errors in mdns-sd logs.
                    let _ = socket.send_to(b"MXS_PERM_TRIGGER", "224.0.0.251:5354");
                    let _ = socket.send_to(b"MXS_PERM_TRIGGER", "255.255.255.255:5354");
                    log::info!("🔒 Fired macOS Local Network Privacy trigger (Hybrid Launch)");
                }
            }

            let current_app_id =
                rust_cast::channels::receiver::CastDeviceApp::Custom("D18A9B3A".to_string());

            let mut root_store = RootCertStore::empty();
            root_store.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
            let mut config = ClientConfig::builder()
                .with_root_certificates(root_store)
                .with_no_client_auth();
            config
                .dangerous()
                .set_certificate_verifier(Arc::new(NoCertificateVerification {}));

            let server_name = ServerName::try_from("google.com").unwrap().to_owned();
            let conn = match ClientConnection::new(Arc::new(config), server_name) {
                Ok(c) => c,
                Err(e) => {
                    log::error!("❌ TLS ClientConnection failed: {}", e);
                    let _ = app_handle_thread.emit("cast-debug", format!("❌ TLS Setup Failed: {}", e));
                    let _ = tx_result.send(Err(format!("TLS ClientConnection failed: {}", e)));
                    return;
                }
            };

            let addr_str = format!("{}:{}", ip.trim(), port);
            let addr = match addr_str.parse::<std::net::SocketAddr>() {
                Ok(a) => a,
                Err(e) => {
                    log::error!("❌ Socket Address Parse failed: {} ({})", addr_str, e);
                    let _ = tx_result.send(Err(format!("Socket Address Parse failed: {}", e)));
                    return;
                }
            };

            let _ = std::process::Command::new("ping")
                .arg("-c")
                .arg("1")
                .arg("-W")
                .arg("100")
                .arg(ip.trim())
                .output();

            let mut sock = None;
            for retry in 1..=8 {
                log::info!("📡 TCP Connection Attempt {} to {}...", retry, addr);
                match TcpStream::connect_timeout(&addr, Duration::from_secs(4)) {
                    Ok(s) => {
                        sock = Some(s);
                        break;
                    }
                    Err(e) => {
                        log::warn!("⚠️ TCP connect attempt {} failed: {}", retry, e);
                        if e.raw_os_error() == Some(65) {
                            log::error!("❌ OS Error 65 (No route to host). This usually means Local Network access is blocked by macOS.");
                        }
                        if retry == 8 {
                            log::error!("TCP connection failed to {}: {}", addr, e);
                            let error_msg = if e.raw_os_error() == Some(65) {
                                format!("TCP connection failed: No route to host (os error 65). Please ensure 'Local Network' permission is enabled for MXS-004 in macOS System Settings.")
                            } else {
                                format!("TCP connection failed: {}", e)
                            };
                            let _ = app_handle_thread.emit("cast-debug", format!("❌ {}", error_msg));
                            let _ = tx_result.send(Err(error_msg));
                            return;
                        }
                        std::thread::sleep(Duration::from_millis(1500));
                    }
                }
            }
            let sock = sock.unwrap();
            // V115: Extended timeout for custom app launch (Chromecast can take 15-20s)
            let _ = sock.set_read_timeout(Some(Duration::from_secs(30)));
            let _ = sock.set_write_timeout(Some(Duration::from_secs(10)));
            let _ = sock.set_nonblocking(false); // Force blocking mode for rust_cast

            log::info!("✅ TCP connected to {} (Attempt {})", addr, attempt);
            let _ = app_handle_thread.emit("cast-debug", format!("✅ TCP Connected to {}", ip.trim()));

            // Keep the socket for mirroring later, but be careful with clones
            active_sock = match sock.try_clone() {
                Ok(s) => Some(s),
                Err(e) => {
                    log::error!("❌ Failed to clone socket: {}", e);
                    let _ = tx_result.send(Err(format!("Failed to clone socket: {}", e)));
                    return;
                }
            };

            let stream = StreamOwned::new(conn, sock);
            let message_manager = Rc::new(MessageManager::new(stream));

            // V117: Define all needed channels at the top level of the loop
            let sender_id = "sender-0".to_string();
            let receiver_id = "receiver-0".to_string();
            
            let heartbeat =
                HeartbeatChannel::new(sender_id.clone(), receiver_id.clone(), Rc::clone(&message_manager));
            let connection = ConnectionChannel::new(sender_id.clone(), Rc::clone(&message_manager));
            let receiver =
                ReceiverChannel::new(sender_id.clone(), receiver_id.clone(), Rc::clone(&message_manager));
            let media = MediaChannel::new(sender_id, Rc::clone(&message_manager));

            let _ = app_handle_thread.emit("cast-debug", "📡 Connection Step: Sending CONNECT...");
            let _ = connection.connect(receiver_id.clone());
            
            let _ = app_handle_thread.emit("cast-debug", "📡 Connection Step: Sending PING...");
            let _ = heartbeat.ping();
            
            // Stabilization delay — give Chromecast time to process CONNECT + PING (V4: Upwards of 4s)
            std::thread::sleep(Duration::from_millis(4000));

            // Drain any pending messages from the socket before proceeding
            // This prevents stale PONG/STATUS messages from interfering with launch_app
            // Use a short timeout for the drain so we don't block for 30s
            if let Some(ref s) = active_sock {
                let _ = s.set_read_timeout(Some(Duration::from_millis(200)));
            }
            loop {
                match message_manager.receive() {
                    Ok(_) => { /* drained one message, try again */ },
                    Err(_) => break, // No more messages (WouldBlock or timeout)
                }
            }
            // Restore long timeout for warmup + launch
            if let Some(ref s) = active_sock {
                let _ = s.set_read_timeout(Some(Duration::from_secs(30)));
            }
            
            // WARM-UP: Try to get status before launching. 
            // This confirms the TLS channel is actually working.
            let _ = app_handle_thread.emit("cast-debug", "📡 Connection Step: WARM-UP Status Check...");
            let mut warm_up_success = false;
            for w in 1..=3 {
                match receiver.get_status() {
                    Ok(status) => {
                        log::info!("🔥 Channel WARMED UP (Attempt {}). Apps: {}", w, status.applications.len());
                         let _ = app_handle_thread.emit("cast-debug", format!("🔥 Channel WARMED UP ({} apps found)", status.applications.len()));
                        
                        // Ultra-Intensive App Logging
                        for a in &status.applications {
                             log::info!("   - [Warmup] App: {} (ID: {})", a.display_name, a.app_id);
                             let _ = app_handle_thread.emit("cast-debug", format!("🔍 [Warmup] Found: {} ({})", a.display_name, a.app_id));
                        }

                        // Session Hijack Prevention: Only stop apps if they are NOT system/idle apps
                        let non_system_apps: Vec<_> = status.applications.iter()
                            .filter(|a| a.app_id != "E8C28D3C" && a.app_id != "D18A9B3A")
                            .collect();

                        if !non_system_apps.is_empty() {
                            log::info!("🛑 Stopping {} non-system app(s) for a clean slate...", non_system_apps.len());
                            let _ = app_handle_thread.emit("cast-debug", format!("🛑 Stopping {} conflicting app(s)...", non_system_apps.len()));
                            for a in non_system_apps {
                                log::info!("   - Stopping: {} ({})", a.display_name, a.app_id);
                                let _ = app_handle_thread.emit("cast-debug", format!("🛑 Stopping: {} ({})", a.display_name, a.app_id));
                                let _ = receiver.stop_app(a.session_id.clone());
                            }
                            // Wait for device to flush and clear memory
                            std::thread::sleep(Duration::from_secs(2));
                            
                            // V4 NUCLEAR: Disconnect and let things settle
                            log::info!("🌩️ Disconnecting for a fresh start...");
                            let _ = app_handle_thread.emit("cast-debug", "🌩️ Disconnecting for a fresh start...");
                            drop(receiver);
                            drop(connection);
                            drop(heartbeat);
                            drop(message_manager);
                            std::thread::sleep(Duration::from_secs(3));
                            
                            // Re-connect
                            log::info!("🚀 PERFORMING CLEAN SLATE RECONNECT...");
                            let _ = app_handle_thread.emit("cast-debug", "🚀 PERFORMING CLEAN SLATE RECONNECT...");
                            continue 'outer;
                        }
                        
                        warm_up_success = true;
                        break;
                    },
                    Err(e) => {
                        log::warn!("❄️ Warm-up check {} stalled: {:?}", w, e);
                        let _ = app_handle_thread.emit("cast-debug", format!("❄️ Warm-up stalled ({}/3): {:?}", w, e));
                        std::thread::sleep(Duration::from_millis(1000));
                    }
                }
            }
            
            if !warm_up_success {
                log::error!("❌ Socket is DEAD (No response to status after 3 warm-ups)");
                let _ = app_handle_thread.emit("cast-debug", "❌ CRITICAL: Device is not responding to commands (Handshake failed)");
                // We'll continue anyway just in case launch_app behaves differently, 
                // but this is a bad sign.
            }

            if attempt >= 2 {
                log::info!("🔄 Attempt {}: Performing session reset...", attempt);
                if let Ok(status) = receiver.get_status() {
                    for app in status.applications {
                        log::info!("🛑 Stopping app: {} ({})", app.display_name, app.session_id);
                        let _ = receiver.stop_app(app.session_id.clone());
                    }
                    // V114.30: Longer wait for cold boot / teardown
                    let wait_secs = if attempt >= 3 { 12 } else { 8 };
                    log::info!("⏳ Waiting {} seconds for device teardown...", wait_secs);
                    std::thread::sleep(Duration::from_secs(wait_secs));
                }
            }

            // V116: Set generous timeout for the actual launch (custom apps can take 15-20s)
            if let Some(ref s) = active_sock {
                let _ = s.set_read_timeout(Some(Duration::from_secs(30)));
            }

            let _ = app_handle_thread.emit("cast-debug", "🚀 Launching Custom Receiver (D18A9B3A)...");
            match receiver.launch_app(&current_app_id) {
                Ok(app) => {
                    log::info!("✅ Custom App Launched! Session: {}", app.session_id);
                    let _ = app_handle_thread
                        .emit("cast-debug", format!("✅ App Launched: {}", app.session_id));
                    app_session = Some((app, connection, heartbeat, message_manager, media, true));
                    break;
                }
                Err(e) => {
                    log::warn!("⚠️ Attempt {} failed: {:?}. Checking status...", attempt, e);
                    let _ = app_handle_thread.emit("cast-debug", format!("⚠️ Launch error: {:?}. Checking status...", e));
                    
                    // HEAL: App might have started but response was slow (WouldBlock).
                    // Try to catch it in status with more retries and longer waits.
                    for i in 1..=5 {
                        log::info!("🔄 Recovery check {}/5...", i);
                        let _ = app_handle_thread.emit("cast-debug", format!("🔄 Recovery check {}/5...", i));
                        
                        std::thread::sleep(Duration::from_millis(3000));
                        
                        // Temporarily bump timeout for status check during launch phase
                        if let Some(ref s) = active_sock {
                            let _ = s.set_read_timeout(Some(Duration::from_secs(10)));
                        }
                        
                        match receiver.get_status() {
                            Ok(status) => {
                                log::info!("🔍 Device Status: {} apps running.", status.applications.len());
                                for (idx, a) in status.applications.iter().enumerate() {
                                    log::info!("   [{}] App: {} (ID: {})", idx, a.display_name, a.app_id);
                                    let _ = app_handle_thread.emit("cast-debug", format!("🔍 Found: {} ({})", a.display_name, a.app_id));
                                }

                                let target_app = status.applications.iter().find(|a| {
                                     match &current_app_id {
                                         rust_cast::channels::receiver::CastDeviceApp::Custom(id) => {
                                             a.app_id.to_uppercase() == id.to_uppercase()
                                         },
                                         _ => false
                                     }
                                });
                                
                                if let Some(app_meta) = target_app {
                                    log::info!("✅ App RECOVERED from status. Session: {}", app_meta.session_id);
                                    let _ = app_handle_thread.emit("cast-debug", format!("✅ Recovered Session: {}", app_meta.session_id));
                                    
                                    let app = rust_cast::channels::receiver::Application {
                                        app_id: app_meta.app_id.clone(),
                                        display_name: app_meta.display_name.clone(),
                                        namespaces: app_meta.namespaces.clone(),
                                        session_id: app_meta.session_id.clone(),
                                        transport_id: app_meta.transport_id.clone(),
                                        status_text: app_meta.status_text.clone(),
                                    };
                                    
                                    app_session = Some((app, connection, heartbeat, message_manager, media, true));
                                    break 'outer;
                                } else {
                                    log::warn!("❌ App ID D18A9B3A not found in status list (yet).");
                                }
                            }
                            Err(status_err) => {
                                log::error!("❌ Recovery status check failed: {:?}", status_err);
                                let _ = app_handle_thread.emit("cast-debug", format!("❌ Status check error: {:?}", status_err));
                            }
                        }
                    }

                    if attempt < 3 {
                        log::info!("⏳ Attempt {} failed. Retrying with reset...", attempt);
                        let _ = app_handle_thread.emit("cast-debug", format!("⚠️ Attempt {} failed, retrying...", attempt));
                    } else {
                        // V114.30: No DMR fallback — it gives false success while being unable
                        // to receive custom namespace messages. Fail loudly instead.
                        log::error!("❌ Custom app D18A9B3A failed after 3 attempts: {:?}", e);
                        let _ = app_handle_thread.emit("cast-debug", "❌ CRITICAL: Custom App D18A9B3A failed after 3 attempts. Please reboot the Chromecast and try again.");
                        let _ = tx_result.send(Err(format!("Custom app launch failed after 3 attempts: {:?}", e)));
                        return;
                    }
                }
            }
        }

        let (app, connection, heartbeat, message_manager, _media, is_custom) = match app_session {
            Some(sess) => sess,
            None => {
                log::error!("❌ App session could not be established after fallback.");
                let _ = tx_result.send(Err("App session could not be established (Default Receiver also failed).".to_string()));
                return;
            }
        };

        log::info!(
            "✅ Hybrid App Launched! Session: {}, Transport: {}",
            app.session_id,
            app.transport_id
        );

        let _ = connection.connect(&app.transport_id);

        let namespace = "urn:x-cast:com.nowmultimedia.mxs004";
        let payload = serde_json::json!({
            "type": "connect",
            "wsUrl": ws_url
        });
        let msg_str = payload.to_string();

        use rust_cast::message_manager::{CastMessage, CastMessagePayload};

        let cast_message = CastMessage {
            namespace: namespace.to_string(),
            source: "sender-0".to_string(),
            destination: app.transport_id.clone(),
            payload: CastMessagePayload::String(msg_str.clone()),
        };

        if is_custom {
            let _ = message_manager.send(cast_message);
            log::info!("📡 Sent WS URL to Custom Receiver: {}", ws_url);
        } else {
            // V118: Standard Media LOAD command for Default Media Receiver
            if !ws_url.is_empty() {
                log::info!("📡 Sending standard media LOAD command for DMR fallback...");
                let _ = app_handle_thread.emit("cast-debug", "📡 Sending standard media LOAD command for DMR fallback...");
                
                let load_payload = serde_json::json!({
                    "type": "LOAD",
                    "requestId": 1,
                    "sessionId": app.session_id,
                    "media": {
                        "contentId": ws_url,
                        "contentType": "audio/wav",
                        "streamType": "LIVE",
                        "metadata": {
                            "metadataType": 3, // AUDIO_BOOK_DESCRIPTION (or generic music)
                            "title": "MXS-004 Studio Master",
                            "artist": "NowMultimedia",
                        }
                    },
                    "autoplay": true,
                    "currentTime": 0
                });
                
                let load_msg = CastMessage {
                    namespace: "urn:x-cast:com.google.cast.media".to_string(),
                    source: "sender-0".to_string(),
                    destination: app.transport_id.clone(),
                    payload: CastMessagePayload::String(load_payload.to_string()),
                };
                let _ = message_manager.send(load_msg);
            }
        }

        // --- Signal success to command handler ---
        let _ = tx_result.send(Ok(()));

        // --- NEW: UI State Mirroring Loop ---
        // Since we are already inside a spawned thread, we can just start the loop here.
        // This thread owns the Rc<MessageManager>, Heartbeat, etc.
        let transport_id = app.transport_id.clone();
        let mut last_ping = std::time::Instant::now();

        // V114.30: These variables were used by the now-disabled WS URL resend loop
        let _last_connect_send = std::time::Instant::now();
        let _connect_send_count = 1;
        let _connect_payload_str = msg_str.clone();

        let _ = app_handle_thread.emit("cast-debug", format!("📡 Initial WS URL Sent to {}", transport_id));

        // VERY IMPORTANT: Set a SHORT read timeout during mirroring so heartbeat doesn't block UI state
        if let Some(sock) = &active_sock {
            let _ = sock.set_read_timeout(Some(Duration::from_millis(100)));
        }

        loop {
            // V114.30: DISABLED - Re-send initial connect URL payload
            // This violates WebRTC socket lifetimes by causing the receiver to violently
            // destroy and recreate WebSockets every 2 seconds for the first 10 seconds of connection.
            /*
            if connect_send_count < 5 && last_connect_send.elapsed().as_secs() >= 2 {
                let retry_msg = CastMessage {
                    namespace: namespace.to_string(),
                    source: "sender-0".to_string(),
                    destination: transport_id.clone(),
                    payload: CastMessagePayload::String(connect_payload_str.clone()),
                };
                let _ = message_manager.send(retry_msg);
                let _ = app_handle_thread.emit("cast-debug", format!("📡 RESENT WS URL (Attempt {})", connect_send_count + 1));
                log::info!("📡 RESENT WS URL (Attempt {})", connect_send_count + 1);
                connect_send_count += 1;
                last_connect_send = std::time::Instant::now();
            }
            */

            // Check for new UI state from frontend (non-blocking)
            match rx.recv_timeout(Duration::from_millis(50)) {
                Ok(data) => {
                    let msg = CastMessage {
                        namespace: namespace.to_string(),
                        source: "sender-0".to_string(),
                        destination: transport_id.clone(),
                        payload: CastMessagePayload::String(data),
                    };
                    if let Err(e) = message_manager.send(msg) {
                        let _ = app_handle_thread.emit("cast-debug", format!("⚠️ Failed to send state update: {:?}", e));
                        log::warn!("⚠️ Failed to send state update: {:?}", e);
                        break;
                    }
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    // No new state, just continue to heartbeat check
                }
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                    let _ = app_handle_thread.emit("cast-debug", "🛑 State update channel disconnected.");
                    log::info!("🛑 State update channel disconnected.");
                    break;
                }
            }

            // Periodic Heartbeat (every 4 seconds)
            if last_ping.elapsed().as_secs() >= 4 {
                if let Err(e) = heartbeat.ping() {
                    let _ = app_handle_thread.emit("cast-debug", format!("⚠️ Heartbeat failed in state loop: {:?}", e));
                    log::warn!("⚠️ Heartbeat failed in state loop: {:?}", e);
                    break;
                }
                last_ping = std::time::Instant::now();

                // Read exactly ONE message (usually the PONG or a Status Update)
                // Since the Chromecast replies immediately, this will take < 10ms
                // and prevents the 2-second timeout from blocking the UI mirroring.
                if let Err(e) = message_manager.receive() {
                     if !e.to_string().contains("WouldBlock") && !e.to_string().contains("timeout") {
                         let _ = app_handle_thread.emit("cast-debug", format!("⚠️ Socket read error: {:?}", e));
                     }
                }
            }
        }

        log::info!("🛑 Chromecast connection loop ended.");
    });

    rx_result.await.map_err(|e| format!("Command dropped: {}", e))?
}

#[tauri::command]
pub fn push_chromecast_state(state: State<'_, CastState>, data: String) -> Result<(), String> {
    let tx_guard = state.cc_state_tx.lock().unwrap();
    if let Some(tx) = tx_guard.as_ref() {
        if let Err(e) = tx.send(data) {
            log::debug!("push_chromecast_state channel send failed: {:?}", e);
        }
    } else {
        // Only log this very occasionally or at debug level to avoid spam
        log::debug!("push_chromecast_state called but cc_state_tx is None!");
    }
    Ok(())
}

#[tauri::command]
pub async fn universal_cast_url(
    _state: State<'_, CastState>,
    ip: String,
    port: u16,
    url: String,
    protocol: String,
    dial_url: Option<String>,
    upnp_url: Option<String>,
) -> Result<(), String> {
    log::info!(
        "🎬 UNIVERSAL CAST: {} via {} to {}:{} (DIAL: {:?}, UPNP: {:?})",
        url,
        protocol,
        ip,
        port,
        dial_url,
        upnp_url
    );

    match protocol.to_lowercase().as_str() {
        "miracast" | "roku" => {
            // Roku External Control Protocol (ECP)
            // POST /launch/8?contentId=URL
            let roku_url = format!(
                "http://{}:8060/launch/8?contentId={}",
                ip,
                urlencoding::encode(&url)
            );
            log::info!("🚀 Roku ECP Launch: {}", roku_url);

            let client = reqwest::Client::new();
            client
                .post(roku_url)
                .send()
                .await
                .map_err(|e| e.to_string())?;
            Ok(())
        }
        "dlna" | "samsung" | "lg" => {
            // UPnP & DIAL (Discovery and Launch) Protocol
            log::info!(
                "🚀 DLNA/DIAL Launch attempting for {}:{} (Protocol: {})",
                ip,
                port,
                protocol
            );

            let client = reqwest::Client::builder()
                .timeout(Duration::from_secs(5))
                .user_agent("DLNADOC/1.50 SEC_HHP_[TV]UA_1.0") // Specialized Samsung UA
                .build()
                .map_err(|e| format!("Client build failed: {}", e))?;

            let mut diagnostics = Vec::new();

            // 1. Try Explicit UPnP AVTransport First (Most reliable for generic media)
            if let Some(upnp) = upnp_url {
                let metadata = format!(
                    "&lt;DIDL-Lite xmlns=\"urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/\" xmlns:upnp=\"urn:schemas-upnp-org:metadata-1-0/upnp/\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:sec=\"http://www.sec.co.kr/\"&gt;&lt;item id=\"0\" parentID=\"-1\" restricted=\"1\"&gt;&lt;upnp:class&gt;object.item.audioItem.musicTrack&lt;/upnp:class&gt;&lt;dc:title&gt;8Track Audio Stream&lt;/dc:title&gt;&lt;res protocolInfo=\"http-get:*:audio/wav:DLNA.ORG_OP=01;DLNA.ORG_FLAGS=01500000000000000000000000000000;DLNA.ORG_PN=LPCM\"&gt;{}&lt;/res&gt;&lt;/item&gt;&lt;/DIDL-Lite&gt;", 
                    url
                );

                let req_body_set = format!(
                    "<?xml version=\"1.0\" encoding=\"utf-8\"?>\
                    <s:Envelope s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\" xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\">\
                        <s:Body>\
                            <u:SetAVTransportURI xmlns:u=\"urn:schemas-upnp-org:service:AVTransport:1\">\
                                <InstanceID>0</InstanceID>\
                                <CurrentURI>{}</CurrentURI>\
                                <CurrentURIMetaData>{}</CurrentURIMetaData>\
                            </u:SetAVTransportURI>\
                        </s:Body>\
                    </s:Envelope>",
                    url, metadata
                );

                let req_body_play = "\
                    <?xml version=\"1.0\" encoding=\"utf-8\"?>\
                    <s:Envelope s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\" xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\">\
                        <s:Body>\
                            <u:Play xmlns:u=\"urn:schemas-upnp-org:service:AVTransport:1\">\
                                <InstanceID>0</InstanceID>\
                                <Speed>1</Speed>\
                            </u:Play>\
                        </s:Body>\
                    </s:Envelope>";

                // Send SetAVTransportURI
                match client
                    .post(&upnp)
                    .header(
                        "SOAPACTION",
                        "\"urn:schemas-upnp-org:service:AVTransport:1#SetAVTransportURI\"",
                    )
                    .header("Content-Type", "text/xml; charset=\"utf-8\"")
                    .body(req_body_set)
                    .send()
                    .await
                {
                    Ok(resp) if resp.status().is_success() => {
                        log::info!("✅ UPnP SetAVTransportURI succeeded!");
                        diagnostics.push("UPnP SetAVTransportURI: Success".to_string());
                        // Follow up immediately with Play
                        let _ = client
                            .post(&upnp)
                            .header(
                                "SOAPACTION",
                                "\"urn:schemas-upnp-org:service:AVTransport:1#Play\"",
                            )
                            .header("Content-Type", "text/xml; charset=\"utf-8\"")
                            .body(req_body_play.to_string())
                            .send()
                            .await;
                        log::info!("✅ UPnP Play command sent.");
                        return Ok(());
                    }
                    Ok(resp) => {
                        let status = resp.status();
                        let body = resp.text().await.unwrap_or_default();
                        log::warn!(
                            "⚠️ UPnP SetAVTransportURI failed with status: {} - {}",
                            status,
                            body
                        );
                        diagnostics.push(format!("UPnP SetAV failed: {} [{}]", status, body));
                    }
                    Err(e) => {
                        log::warn!("⚠️ UPnP SetAVTransportURI req failed: {}", e);
                        diagnostics.push(format!("UPnP SetAV Error: {}", e));
                    }
                }
            }

            // 2. Try Explicit DIAL Application-URL if discovered
            if let Some(dial_base) = dial_url {
                log::info!("🚀 Attempting precise DIAL Launch via base: {}", dial_base);
                let apps = vec![
                    "org.tizen.browser",
                    "Browser",
                    "org.tizen.common-app.browser",
                ];
                for app in apps {
                    let full_url = format!(
                        "{}{}",
                        if dial_base.ends_with('/') {
                            dial_base.clone()
                        } else {
                            format!("{}/", dial_base)
                        },
                        app
                    );
                    log::info!("   -> Probing DIAL App: {}", full_url);

                    for is_json in [false, true] {
                        let req = client
                            .post(&full_url)
                            .header("Origin", "https://www.youtube.com")
                            .header("Referer", "https://www.youtube.com/tv")
                            .header("User-Agent", "Mozilla/5.0 (SMART-TV; Linux; Tizen 5.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/5.0 TV Safari/538.1");

                        let req = if is_json {
                            req.header("Content-Type", "application/json")
                                .body(format!("{{\"url\":\"{}\", \"action\":\"play\"}}", url))
                        } else {
                            req.header("Content-Type", "application/x-www-form-urlencoded")
                                .body(format!("url={}&action=play", urlencoding::encode(&url)))
                        };

                        if let Ok(resp) = req.send().await {
                            if resp.status().is_success() || resp.status().as_u16() == 201 {
                                log::info!("✅ DIAL Launch success on: {}", full_url);
                                return Ok(());
                            }
                        }
                    }
                }
            }

            // 3. Fallback: List of common potential DIAL endpoints to try
            let mut endpoints = vec![
                (
                    format!(
                        "http://{}:{}/api/v2/applications/org.tizen.browser",
                        ip, port
                    ),
                    true,
                ),
                (
                    format!("http://{}:8001/api/v2/applications/org.tizen.browser", ip),
                    true,
                ),
                (
                    format!("http://{}:8080/api/v2/applications/org.tizen.browser", ip),
                    true,
                ),
                (
                    format!("http://{}:8002/api/v2/applications/org.tizen.browser", ip),
                    true,
                ),
                (
                    format!("http://{}:8000/api/v2/applications/org.tizen.browser", ip),
                    true,
                ),
                (
                    format!("http://{}:{}/apps/org.tizen.browser", ip, port),
                    false,
                ),
                (format!("http://{}:8001/apps/org.tizen.browser", ip), false),
                (format!("http://{}:8080/apps/org.tizen.browser", ip), false),
                (format!("http://{}:8000/apps/org.tizen.browser", ip), false),
                (format!("http://{}:{}/apps/Browser", ip, port), false),
                (format!("http://{}:8001/apps/Browser", ip), false),
                (format!("http://{}:8080/apps/Browser", ip), false),
                (format!("http://{}:8000/apps/Browser", ip), false),
                (format!("http://{}:9000/apps/Browser", ip), false),
                (format!("http://{}:7676/apps/Browser", ip), false),
                // Fallback ID: org.tizen.common-app.browser
                (
                    format!("http://{}:8080/apps/org.tizen.common-app.browser", ip),
                    false,
                ),
                // Legacy ID: 201110161
                (format!("http://{}:8080/apps/201110161", ip), false),
                (format!("http://{}:8001/apps/201110161", ip), false),
                // Fallback test to see if ANY DIAL app works
                (format!("http://{}:8008/apps/YouTube", ip), false),
                (format!("http://{}:8080/apps/YouTube", ip), false),
                (
                    format!("http://{}:8080/api/v2/applications/YouTube", ip),
                    true,
                ),
                (
                    format!("http://{}:8001/api/v2/applications/YouTube", ip),
                    true,
                ),
            ];

            // Deduplicate endpoints
            endpoints.sort_by(|a, b| a.0.cmp(&b.0));
            endpoints.dedup_by(|a, b| a.0 == b.0);

            for (endpoint, _is_json) in endpoints {
                log::info!("📡 Probing DIAL endpoint (GET): {}", endpoint);

                // Try a diagnostic GET first to see what's there
                let get_req = client
                    .get(&endpoint)
                    .header("Origin", "http://localhost")
                    .header("Referer", format!("http://{}", ip)) // Samsung often requires Referer
                    .header("Connection", "close"); // Legacy Samsung preference

                match get_req.send().await {
                    Ok(resp) => {
                        let status = resp.status();
                        let body_preview = match status.as_u16() {
                            200 | 403 | 401 | 400 => match resp.text().await {
                                Ok(t) => {
                                    if t.len() > 100 {
                                        format!("{}...", &t[..100])
                                    } else {
                                        t
                                    }
                                }
                                Err(_) => "no body".to_string(),
                            },
                            _ => "body skipped".to_string(),
                        };

                        log::info!("🔍 GET {} -> {} ({})", endpoint, status, body_preview);
                        diagnostics
                            .push(format!("GET {}: {} [{}]", endpoint, status, body_preview));

                        // For Samsung, we try POST if it's not a definitive 404
                        if status.as_u16() != 404 {
                            log::info!("🚀 Attempting DIAL Launch (POST) on: {}", endpoint);

                            // Try multiple variations of headers for the POST
                            let origin_yt = "https://www.youtube.com";
                            let referer_yt = "https://www.youtube.com/tv";
                            let ua_tizen = "Mozilla/5.0 (SMART-TV; Linux; Tizen 5.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/5.0 TV Safari/538.1";
                            let variations = vec![
                                (Some(origin_yt), true), // Try with spoofed Tizen TV UA
                                (None, false),
                                (Some("http://localhost"), false),
                            ];

                            for (origin, use_spoof_ua) in variations {
                                // Try BOTH JSON and FORM for every variation to be sure
                                for try_json in [true, false] {
                                    let mut req = client
                                        .post(&endpoint)
                                        .header("Connection", "close")
                                        .header("Referer", referer_yt);

                                    if let Some(o) = origin {
                                        req = req.header("Origin", o);
                                    }

                                    if use_spoof_ua {
                                        req = req.header("User-Agent", ua_tizen);
                                    } else {
                                        req = req.header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36");
                                    }

                                    let req = if try_json {
                                        req.header("Content-Type", "application/json").body(
                                            format!("{{\"url\":\"{}\", \"action\":\"play\"}}", url),
                                        )
                                    } else {
                                        req.header(
                                            "Content-Type",
                                            "application/x-www-form-urlencoded",
                                        )
                                        .body(format!(
                                            "url={}&action=play",
                                            urlencoding::encode(&url)
                                        ))
                                    };

                                    match req.send().await {
                                        Ok(launch_resp) => {
                                            let l_status = launch_resp.status();
                                            if l_status.is_success() || l_status.as_u16() == 201 {
                                                log::info!("✅ DIAL Launch success on: {} (Origin: {:?}, SpoofedUA: {}, JSON: {})", endpoint, origin, use_spoof_ua, try_json);
                                                return Ok(());
                                            } else {
                                                log::warn!("⚠️ Launch failure on {} (Origin: {:?}, JSON: {}): {}", endpoint, origin, try_json, l_status);
                                                diagnostics.push(format!(
                                                    "POST {} [O:{:?}, J:{}]: {}",
                                                    endpoint, origin, try_json, l_status
                                                ));
                                            }
                                        }
                                        Err(e) => {
                                            log::warn!(
                                                "⚠️ Launch error on {} (Origin: {:?}): {}",
                                                endpoint,
                                                origin,
                                                e
                                            );
                                            diagnostics.push(format!(
                                                "POST-Error {} [O:{:?}]: {}",
                                                endpoint, origin, e
                                            ));
                                        }
                                    }
                                }
                            }
                        }
                    }
                    Err(e) => {
                        log::warn!("⚠️ GET failure on {}: {}", endpoint, e);
                        diagnostics.push(format!("GET-Error {}: {}", endpoint, e));
                    }
                }
            }

            Err(format!(
                "Final DIAL failure. Detailed Diagnostics: [{}]",
                diagnostics.join(" | ")
            ))
        }
        _ => Err("Unsupported universal protocol".to_string()),
    }
}

// --- Screen Permission Check (Not Needed for App Window Capture) ---
// Since we use tauri-plugin-screenshots to capture our own window,
// we don't need macOS screen recording permission.
#[tauri::command]
pub async fn check_permissions() -> Result<String, String> {
    log::info!("Screen Recording Permission Check: Not required for app window capture");
    // We use tauri-plugin-screenshots which captures the app's own window
    // This does NOT require screen recording permission on macOS
    Ok("Granted".to_string())
}

// Command called by discovery to start the server early
#[tauri::command]
pub async fn start_stream_server(
    app: AppHandle,
    state: State<'_, CastState>,
) -> Result<u16, String> {
    log::info!("start_stream_server called (early init)");
    let port = ensure_server_started(app, &state);
    Ok(port)
}

#[tauri::command]
pub fn push_audio_chunk(state: State<'_, CastState>, chunk: Vec<u8>) {
    // Only process if we have data
    if chunk.is_empty() {
        return;
    }

    let mut stream_guard = state.audio_stream.lock().unwrap();

    // Connect if not connected
    if stream_guard.is_none() {
        // Try to connect to audio port (5556)
        if let Ok(s) = std::net::TcpStream::connect("127.0.0.1:5556") {
            // Set non-blocking? No, we want blocking write so we don't drop audio.
            let _ = s.set_nodelay(true);
            *stream_guard = Some(s);
        }
    }

    if let Some(stream) = stream_guard.as_mut() {
        // Write raw bytes directly to FFmpeg (assumes input is already f32le bytes)
        if let Err(e) = stream.write_all(&chunk) {
            log::warn!("Audio Pipe Broken: {}, dropping frame", e);
            // Drop connection to reconnect next time
            *stream_guard = None;
        }
    }
}

/// Upload audio file data for Chromecast URL-based playback
/// Returns the HTTP URL that the Chromecast can fetch
#[tauri::command]
pub async fn upload_cast_audio(
    state: State<'_, CastState>,
    app: AppHandle,
    track_id: u32,
    audio_data: Vec<u8>,
    file_extension: String,
) -> Result<String, String> {
    // Get server port (ensure server is started)
    let server_port = ensure_server_started(app.clone(), &state);
    if server_port == 0 {
        return Err("Stream server not running".into());
    }

    // Create audio directory in HLS dir
    let hls_dir = std::env::temp_dir().join("mxs-cast-hls-v2");
    let audio_dir = hls_dir.join("audio");
    if !audio_dir.exists() {
        std::fs::create_dir_all(&audio_dir)
            .map_err(|e| format!("Failed to create audio dir: {}", e))?;
    }

    // Generate filename
    let filename = format!("track{}.{}", track_id, file_extension);
    let file_path = audio_dir.join(&filename);

    // Write audio data
    std::fs::write(&file_path, &audio_data)
        .map_err(|e| format!("Failed to write audio file: {}", e))?;

    log::info!(
        "🎵 Saved audio file: {:?} ({} bytes)",
        file_path,
        audio_data.len()
    );

    // Get local IP for URL
    let local_ip = get_local_ip("192.168.1.1").unwrap_or_else(|| "192.168.1.8".to_string());
    let audio_url = format!("http://{}:{}/audio/{}", local_ip, server_port, filename);

    log::info!("🔗 Audio URL for Chromecast: {}", audio_url);

    Ok(audio_url)
}
