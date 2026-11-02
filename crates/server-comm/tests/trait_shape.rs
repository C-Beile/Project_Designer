//! Confirms the `ServerConnection` trait shape is usable end to end against a mock.
//!
//! This does not exercise any real protocol — none was verified in the research pass (see
//! `PROJECT/20_architecture/p3-server-comm-notes.md`). It only proves a concrete
//! implementer can satisfy every method signature and that the verified error/outcome
//! variants round-trip correctly.

use server_comm::{
    CacheDomain, Credentials, DeployOptions, DeployOutcome, DeployProgress, RestServerCommand,
    ServerCommError, ServerConnection, ServerEndpoint,
};
use std::path::Path;

#[derive(Default)]
struct MockConnection {
    connected: bool,
    last_command: Option<RestServerCommand>,
}

impl ServerConnection for MockConnection {
    fn connect(
        &mut self,
        _endpoint: ServerEndpoint,
        _credentials: Credentials,
    ) -> Result<(), ServerCommError> {
        self.connected = true;
        Ok(())
    }

    fn disconnect(&mut self) -> Result<(), ServerCommError> {
        self.connected = false;
        Ok(())
    }

    fn deploy(
        &mut self,
        project_home: &Path,
        server_config: &Path,
        _options: DeployOptions,
    ) -> Result<DeployOutcome, ServerCommError> {
        if !self.connected {
            return Err(ServerCommError::NotConnected);
        }
        if project_home.as_os_str().is_empty() {
            return Err(ServerCommError::ProjectHomeNotSet);
        }
        if server_config.as_os_str().is_empty() {
            return Err(ServerCommError::ServerConfigNotSet);
        }
        Ok(DeployOutcome::Successful)
    }

    fn poll_progress(&mut self) -> Result<DeployProgress, ServerCommError> {
        Ok(DeployProgress {
            applied: 1,
            total: 1,
            message: None,
        })
    }

    fn send_command(&mut self, command: RestServerCommand) -> Result<(), ServerCommError> {
        self.last_command = Some(command);
        Ok(())
    }
}

#[test]
fn mock_connection_satisfies_the_trait_end_to_end() {
    let mut conn = MockConnection::default();
    conn.connect(
        ServerEndpoint {
            host: "localhost".into(),
            port: 8080,
        },
        Credentials {
            user: "designer".into(),
            password: "secret".into(),
        },
    )
    .unwrap();

    let outcome = conn
        .deploy(
            Path::new("/tmp/project"),
            Path::new("/tmp/project/system/dev/dev.aod"),
            DeployOptions {
                force: true,
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(outcome, DeployOutcome::Successful);

    let progress = conn.poll_progress().unwrap();
    assert_eq!(progress.applied, progress.total);

    conn.send_command(RestServerCommand::ClearCache(CacheDomain::DataModel))
        .unwrap();
    assert_eq!(
        conn.last_command,
        Some(RestServerCommand::ClearCache(CacheDomain::DataModel))
    );

    conn.disconnect().unwrap();
    assert!(!conn.connected);
}

#[test]
fn deploy_without_project_home_reports_the_verified_error() {
    let mut conn = MockConnection::default();
    conn.connect(
        ServerEndpoint {
            host: "localhost".into(),
            port: 8080,
        },
        Credentials {
            user: "designer".into(),
            password: "secret".into(),
        },
    )
    .unwrap();

    let err = conn
        .deploy(Path::new(""), Path::new("cfg"), DeployOptions::default())
        .unwrap_err();
    assert_eq!(err, ServerCommError::ProjectHomeNotSet);
}

#[test]
fn deploy_partly_failed_outcome_carries_the_verified_failed_models_payload() {
    let outcome = DeployOutcome::PartlyFailed {
        failed_models: vec!["Customer".into(), "Order".into()],
    };
    match outcome {
        DeployOutcome::PartlyFailed { failed_models } => {
            assert_eq!(failed_models, vec!["Customer", "Order"]);
        }
        _ => panic!("expected PartlyFailed"),
    }
}

#[test]
fn credentials_debug_redacts_the_password() {
    let creds = Credentials {
        user: "designer".into(),
        password: "s3cret".into(),
    };
    let debug = format!("{creds:?}");
    assert!(debug.contains("designer"));
    assert!(!debug.contains("s3cret"));
    assert!(debug.contains("<redacted>"));
}
