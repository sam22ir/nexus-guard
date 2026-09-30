use serde::Deserialize;
use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone)]
struct Project {
    name: &'static str,
    git_remote: &'static str,
    resources: BTreeMap<&'static str, &'static str>,
}

#[derive(Debug, PartialEq, Eq)]
enum Context {
    Ready {
        project: String,
        resources: BTreeMap<String, String>,
    },
    Unclear {
        reason: String,
    },
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Manifest {
    project: String,
    connections: Option<BTreeMap<String, String>>,
}

#[derive(Default)]
struct Registry {
    // A folder is linked to a project only after the user registers it.
    workspaces: BTreeMap<PathBuf, Project>,
}

fn sample_projects() -> Vec<Project> {
    vec![
        Project {
            name: "Koupa",
            git_remote: "https://example.test/koupa.git",
            resources: BTreeMap::from([
                ("supabase", "supabase-koupa-dev"),
                ("convex", "convex-koupa-dev"),
                ("clerk", "clerk-koupa-dev"),
                ("sentry", "sentry-koupa-dev"),
            ]),
        },
        Project {
            name: "Nabdh",
            git_remote: "https://example.test/nabdh.git",
            resources: BTreeMap::from([
                ("supabase", "supabase-nabdh-dev"),
                ("convex", "convex-nabdh-dev"),
                ("clerk", "clerk-nabdh-dev"),
                ("sentry", "sentry-nabdh-dev"),
            ]),
        },
    ]
}

fn git_output(folder: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(folder)
        .args(args)
        .output()
        .map_err(|_| "Git could not be started.".to_string())?;
    if !output.status.success() {
        return Err("Git could not verify this folder.".to_string());
    }
    String::from_utf8(output.stdout)
        .map(|text| text.trim().to_string())
        .map_err(|_| "Git returned a path or address that could not be read.".to_string())
}

fn repository_root(folder: &Path) -> Result<PathBuf, String> {
    let folder =
        fs::canonicalize(folder).map_err(|_| "This folder could not be opened.".to_string())?;
    let root = git_output(&folder, &["rev-parse", "--show-toplevel"])?;
    fs::canonicalize(root).map_err(|_| "The repository folder could not be opened.".to_string())
}

fn current_remote(root: &Path) -> Result<String, String> {
    git_output(root, &["config", "--local", "--get", "remote.origin.url"])
}

impl Registry {
    fn register(&mut self, folder: &Path, project_name: &str) -> Result<(), String> {
        let root = repository_root(folder)?;
        let project = sample_projects()
            .into_iter()
            .find(|project| project.name == project_name)
            .ok_or_else(|| "This project has not been set up in the test.".to_string())?;
        if current_remote(&root)? != project.git_remote {
            return Err("The Git address does not match the chosen project.".to_string());
        }
        if self.workspaces.contains_key(&root) {
            return Err("This folder is already registered.".to_string());
        }
        self.workspaces.insert(root, project);
        Ok(())
    }

    fn resolve(&self, folder: &Path) -> Context {
        match self.try_resolve(folder) {
            Ok(context) => context,
            Err(reason) => Context::Unclear { reason },
        }
    }

    fn try_resolve(&self, folder: &Path) -> Result<Context, String> {
        let root = repository_root(folder)?;
        let project = self
            .workspaces
            .get(&root)
            .ok_or_else(|| "This folder has not been registered.".to_string())?;

        // Never switch to another project just because a Git address changed later.
        if current_remote(&root)? != project.git_remote {
            return Err("The Git address changed after this folder was registered.".to_string());
        }

        let manifest_path = root.join(".nexus").join("project.json");
        let manifest = match fs::read_to_string(manifest_path) {
            Ok(text) => Some(
                serde_json::from_str::<Manifest>(&text)
                    .map_err(|_| "The project file is invalid.".to_string())?,
            ),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(_) => return Err("The project file could not be read.".to_string()),
        };

        if let Some(manifest) = manifest {
            if manifest.project != project.name {
                return Err("The project file and registered folder disagree.".to_string());
            }
            if let Some(connections) = manifest.connections {
                let approved: BTreeMap<String, String> = project
                    .resources
                    .iter()
                    .map(|(provider, target)| ((*provider).to_string(), (*target).to_string()))
                    .collect();
                if connections != approved {
                    return Err("The project file and approved services disagree.".to_string());
                }
            }
        }

        Ok(Context::Ready {
            project: project.name.to_string(),
            resources: project
                .resources
                .iter()
                .map(|(provider, target)| ((*provider).to_string(), (*target).to_string()))
                .collect(),
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct AgentSession {
    id: String,
    workspace: PathBuf,
    open: bool,
}

#[derive(Debug, PartialEq, Eq)]
struct ServiceGrant {
    project: String,
    provider: String,
    target: String,
    credential_exposed: bool,
}

struct Broker<'a> {
    registry: &'a Registry,
}

impl<'a> Broker<'a> {
    fn new(registry: &'a Registry) -> Self {
        Self { registry }
    }

    fn open_session(&self, id: &str, folder: &Path) -> Result<AgentSession, String> {
        if !matches!(self.registry.resolve(folder), Context::Ready { .. }) {
            return Err("This agent cannot start because the project is unclear.".to_string());
        }
        Ok(AgentSession {
            id: id.to_string(),
            workspace: repository_root(folder)?,
            open: true,
        })
    }

    fn request_service(
        &self,
        session: &AgentSession,
        provider: &str,
        requested_target: Option<&str>,
    ) -> Result<ServiceGrant, String> {
        if !session.open {
            return Err("This agent session is closed.".to_string());
        }

        let context = self.registry.resolve(&session.workspace);
        let Context::Ready { project, resources } = context else {
            return Err("The project became unclear, so Nexus blocked the request.".to_string());
        };
        let target = resources
            .get(provider)
            .ok_or_else(|| format!("{project} does not have a {provider} connection."))?;

        if let Some(requested_target) = requested_target {
            if requested_target != target {
                return Err(format!(
                    "Wrong {provider} connection requested for {project}; Nexus blocked it."
                ));
            }
        }

        Ok(ServiceGrant {
            project,
            provider: provider.to_string(),
            target: target.clone(),
            credential_exposed: false,
        })
    }

    fn close_session(session: &mut AgentSession) {
        session.open = false;
    }
}

#[cfg(test)]
fn guard_target(context: &Context, provider: &str, requested_target: &str) -> bool {
    matches!(
        context,
        Context::Ready { resources, .. }
            if resources.get(provider).is_some_and(|expected| expected == requested_target)
    )
}

// A fake read used to prove a blocked request never reaches the next step.
#[cfg(test)]
fn guarded_read<T>(
    context: &Context,
    provider: &str,
    requested_target: &str,
    read: impl FnOnce() -> T,
) -> Result<T, &'static str> {
    if guard_target(context, provider, requested_target) {
        Ok(read())
    } else {
        Err("BLOCK")
    }
}

fn main() {
    let folders: Vec<PathBuf> = env::args_os().skip(1).map(PathBuf::from).collect();
    if folders.len() != 2 {
        eprintln!("Use: nexus-check <Koupa folder> <Nabdh folder>");
        std::process::exit(2);
    }

    let mut registry = Registry::default();
    for (name, folder) in [("Koupa", &folders[0]), ("Nabdh", &folders[1])] {
        if let Err(message) = registry.register(folder, name) {
            eprintln!("Could not register {name}: {message}");
            std::process::exit(1);
        }
    }

    let broker = Broker::new(&registry);
    let mut koupa_agent = broker
        .open_session("agent-1", &folders[0])
        .expect("Koupa should open");
    let nabdh_agent = broker
        .open_session("agent-2", &folders[1])
        .expect("Nabdh should open");

    for session in [&koupa_agent, &nabdh_agent] {
        let grant = broker
            .request_service(session, "supabase", None)
            .expect("the matching service should be available");
        println!(
            "{} → {} → {} → {} (secret shown: {})",
            session.id, grant.project, grant.provider, grant.target, grant.credential_exposed
        );
    }

    let wrong_request =
        broker.request_service(&koupa_agent, "supabase", Some("supabase-nabdh-dev"));
    println!(
        "agent-1 asking for Nabdh's connection: {}",
        if wrong_request.is_err() {
            "blocked"
        } else {
            "allowed"
        }
    );

    Broker::close_session(&mut koupa_agent);
    println!(
        "closed agent-1 asking again: {}",
        if broker
            .request_service(&koupa_agent, "supabase", None)
            .is_err()
        {
            "blocked"
        } else {
            "allowed"
        }
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static NEXT_ID: AtomicU64 = AtomicU64::new(0);

    struct TestRepo {
        root: PathBuf,
    }

    impl TestRepo {
        fn new(name: &str, remote: &str) -> Self {
            let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
            let stamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let root = env::temp_dir().join(format!(
                "nexus-check-{name}-{}-{stamp}-{id}",
                std::process::id()
            ));
            fs::create_dir_all(&root).unwrap();
            let repo = Self { root };
            repo.git(&["init", "--quiet"]);
            repo.git(&["remote", "add", "origin", remote]);
            repo
        }

        fn git(&self, args: &[&str]) {
            let status = Command::new("git")
                .arg("-C")
                .arg(&self.root)
                .args(args)
                .status()
                .unwrap();
            assert!(status.success(), "git command failed: {args:?}");
        }

        fn manifest(&self, project: &str) {
            let nexus = self.root.join(".nexus");
            fs::create_dir_all(&nexus).unwrap();
            fs::write(
                nexus.join("project.json"),
                format!(r#"{{"project":"{project}"}}"#),
            )
            .unwrap();
        }
    }

    impl Drop for TestRepo {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn two_repos() -> (TestRepo, TestRepo, Registry) {
        let koupa = TestRepo::new("koupa", "https://example.test/koupa.git");
        let nabdh = TestRepo::new("nabdh", "https://example.test/nabdh.git");
        koupa.manifest("Koupa");
        nabdh.manifest("Nabdh");
        let mut registry = Registry::default();
        registry.register(&koupa.root, "Koupa").unwrap();
        registry.register(&nabdh.root, "Nabdh").unwrap();
        (koupa, nabdh, registry)
    }

    #[test]
    fn real_folders_keep_their_own_resources() {
        let (koupa, nabdh, registry) = two_repos();
        let koupa_context = registry.resolve(&koupa.root);
        let nabdh_context = registry.resolve(&nabdh.root);
        assert!(
            matches!(&koupa_context, Context::Ready { project, resources }
            if project == "Koupa" && resources["supabase"] == "supabase-koupa-dev")
        );
        assert!(
            matches!(&nabdh_context, Context::Ready { project, resources }
            if project == "Nabdh" && resources["supabase"] == "supabase-nabdh-dev")
        );
        assert!(!guard_target(
            &koupa_context,
            "supabase",
            "supabase-nabdh-dev"
        ));
        assert!(!guard_target(
            &nabdh_context,
            "supabase",
            "supabase-koupa-dev"
        ));
    }

    #[test]
    fn nested_folder_still_finds_the_right_project() {
        let (koupa, _nabdh, registry) = two_repos();
        let nested = koupa.root.join("src").join("deep");
        fs::create_dir_all(&nested).unwrap();
        assert!(
            matches!(registry.resolve(&nested), Context::Ready { project, .. } if project == "Koupa")
        );
    }

    #[test]
    fn changed_git_address_does_not_switch_projects() {
        let (koupa, _nabdh, registry) = two_repos();
        koupa.git(&[
            "remote",
            "set-url",
            "origin",
            "https://example.test/nabdh.git",
        ]);
        let context = registry.resolve(&koupa.root);
        assert!(matches!(context, Context::Unclear { .. }));
    }

    #[test]
    fn conflicting_project_file_is_blocked() {
        let (koupa, _nabdh, registry) = two_repos();
        koupa.manifest("Nabdh");
        let context = registry.resolve(&koupa.root);
        assert!(matches!(context, Context::Unclear { .. }));
        let mut called = false;
        assert_eq!(
            guarded_read(&context, "supabase", "supabase-koupa-dev", || {
                called = true;
            }),
            Err("BLOCK")
        );
        assert!(!called);
    }

    #[test]
    fn changed_service_mapping_is_blocked() {
        let (koupa, _nabdh, registry) = two_repos();
        fs::write(
            koupa.root.join(".nexus/project.json"),
            r#"{"project":"Koupa","connections":{"supabase":"supabase-nabdh-dev"}}"#,
        )
        .unwrap();
        assert!(matches!(
            registry.resolve(&koupa.root),
            Context::Unclear { .. }
        ));
    }

    #[test]
    fn invalid_project_file_is_blocked() {
        let (koupa, _nabdh, registry) = two_repos();
        fs::write(koupa.root.join(".nexus/project.json"), "not valid json").unwrap();
        assert!(matches!(
            registry.resolve(&koupa.root),
            Context::Unclear { .. }
        ));
    }

    #[test]
    fn unregistered_folder_is_not_guessed() {
        let (koupa, _nabdh, _registry) = two_repos();
        assert!(matches!(
            Registry::default().resolve(&koupa.root),
            Context::Unclear { .. }
        ));
    }

    #[test]
    fn wrong_target_never_reaches_fake_service() {
        let (koupa, _nabdh, registry) = two_repos();
        let context = registry.resolve(&koupa.root);
        let mut called = false;
        let result = guarded_read(&context, "supabase", "supabase-nabdh-dev", || {
            called = true;
            "fake response"
        });
        assert_eq!(result, Err("BLOCK"));
        assert!(!called);
    }

    #[test]
    fn matching_target_reaches_fake_service() {
        let (koupa, _nabdh, registry) = two_repos();
        let context = registry.resolve(&koupa.root);
        let result = guarded_read(&context, "supabase", "supabase-koupa-dev", || {
            "fake response"
        });
        assert_eq!(result, Ok("fake response"));
    }

    #[test]
    fn two_simultaneous_workspaces_stay_separate() {
        let (koupa, nabdh, registry) = two_repos();
        std::thread::scope(|scope| {
            let registry = &registry;
            for (root, expected_project, expected_target) in [
                (&koupa.root, "Koupa", "supabase-koupa-dev"),
                (&nabdh.root, "Nabdh", "supabase-nabdh-dev"),
            ] {
                scope.spawn(move || {
                    for _ in 0..10 {
                        let context = registry.resolve(root);
                        assert!(matches!(&context, Context::Ready { project, .. } if project == expected_project));
                        assert!(guard_target(&context, "supabase", expected_target));
                    }
                });
            }
        });
    }

    #[test]
    fn two_agents_receive_their_own_connections() {
        let (koupa, nabdh, registry) = two_repos();
        let broker = Broker::new(&registry);
        let koupa_agent = broker.open_session("agent-1", &koupa.root).unwrap();
        let nabdh_agent = broker.open_session("agent-2", &nabdh.root).unwrap();

        let koupa_grant = broker
            .request_service(&koupa_agent, "supabase", None)
            .unwrap();
        let nabdh_grant = broker
            .request_service(&nabdh_agent, "supabase", None)
            .unwrap();

        assert_eq!(koupa_grant.project, "Koupa");
        assert_eq!(koupa_grant.target, "supabase-koupa-dev");
        assert_eq!(nabdh_grant.project, "Nabdh");
        assert_eq!(nabdh_grant.target, "supabase-nabdh-dev");
        assert!(!koupa_grant.credential_exposed);
        assert!(!nabdh_grant.credential_exposed);
    }

    #[test]
    fn agents_can_ask_at_the_same_time_without_mixing_projects() {
        let (koupa, nabdh, registry) = two_repos();
        let broker = Broker::new(&registry);
        let koupa_agent = broker.open_session("agent-1", &koupa.root).unwrap();
        let nabdh_agent = broker.open_session("agent-2", &nabdh.root).unwrap();

        std::thread::scope(|scope| {
            let koupa_job = scope.spawn(|| {
                for _ in 0..20 {
                    let grant = broker
                        .request_service(&koupa_agent, "supabase", None)
                        .unwrap();
                    assert_eq!(grant.project, "Koupa");
                    assert_eq!(grant.target, "supabase-koupa-dev");
                }
            });
            let nabdh_job = scope.spawn(|| {
                for _ in 0..20 {
                    let grant = broker
                        .request_service(&nabdh_agent, "supabase", None)
                        .unwrap();
                    assert_eq!(grant.project, "Nabdh");
                    assert_eq!(grant.target, "supabase-nabdh-dev");
                }
            });
            koupa_job.join().unwrap();
            nabdh_job.join().unwrap();
        });
    }

    #[test]
    fn an_agent_cannot_request_the_other_projects_connection() {
        let (koupa, _nabdh, registry) = two_repos();
        let broker = Broker::new(&registry);
        let koupa_agent = broker.open_session("agent-1", &koupa.root).unwrap();
        let result = broker.request_service(&koupa_agent, "supabase", Some("supabase-nabdh-dev"));
        assert!(result.is_err());
    }

    #[test]
    fn a_closed_agent_cannot_request_a_service() {
        let (koupa, _nabdh, registry) = two_repos();
        let broker = Broker::new(&registry);
        let mut agent = broker.open_session("agent-1", &koupa.root).unwrap();
        Broker::close_session(&mut agent);
        assert!(broker.request_service(&agent, "supabase", None).is_err());
    }

    #[test]
    fn changed_address_cannot_be_registered_as_wrong_project() {
        let (koupa, _nabdh, _registry) = two_repos();
        let mut new_registry = Registry::default();
        assert!(new_registry.register(&koupa.root, "Nabdh").is_err());
    }
}
