use bevy::prelude::*;

#[derive(Resource, Default, Debug, Clone)]
pub struct NetworkSession {
    pub server_running: bool,
    pub client_connected: bool,
    pub host_password: String,
    pub connection_ip: Option<String>,
    pub connection_port: Option<String>,
    pub last_latency_ms: Option<u128>,
    pub last_health_ok: bool,
}

impl NetworkSession {
    pub fn reset_client(&mut self) {
        self.client_connected = false;
        self.connection_ip = None;
        self.connection_port = None;
        self.last_latency_ms = None;
        self.last_health_ok = false;
    }

    pub fn is_connected(&self) -> bool {
        self.client_connected
    }
}
