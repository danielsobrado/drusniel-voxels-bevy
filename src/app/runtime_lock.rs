use fs2::FileExt;
use std::fmt;
use std::fs::{File, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const LOCK_DIR_NAME: &str = "drusniel-voxels";
const LOCK_FILE_NAME: &str = "runtime.lock";
const BENCH_LOCK_PATH_ENV: &str = "DRUSNIEL_BENCH_RUNTIME_LOCK";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RuntimeInstanceKind {
    Game,
    EditorRuntime,
    EditorNativeViewport,
    Bench,
}

impl RuntimeInstanceKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Game => "game",
            Self::EditorRuntime => "editor-runtime",
            Self::EditorNativeViewport => "editor-native-viewport",
            Self::Bench => "bench",
        }
    }
}

#[derive(Debug)]
pub enum RuntimeInstanceLockError {
    CreateDirectory { path: PathBuf, source: io::Error },
    Open { path: PathBuf, source: io::Error },
    AlreadyRunning { path: PathBuf, metadata: String },
    Write { path: PathBuf, source: io::Error },
}

impl fmt::Display for RuntimeInstanceLockError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::CreateDirectory { path, source } => {
                write!(
                    f,
                    "failed to create runtime lock directory '{}': {source}",
                    path.display()
                )
            }
            Self::Open { path, source } => {
                write!(
                    f,
                    "failed to open runtime lock file '{}': {source}",
                    path.display()
                )
            }
            Self::AlreadyRunning { path, metadata } => {
                write!(
                    f,
                    "another Drusniel runtime is already running; lock file '{}' is held",
                    path.display()
                )?;
                if !metadata.trim().is_empty() {
                    write!(f, "\nCurrent lock owner:\n{}", metadata.trim())?;
                }
                Ok(())
            }
            Self::Write { path, source } => {
                write!(
                    f,
                    "failed to write runtime lock file '{}': {source}",
                    path.display()
                )
            }
        }
    }
}

impl std::error::Error for RuntimeInstanceLockError {}

pub struct RuntimeInstanceLock {
    file: Option<File>,
    path: PathBuf,
}

impl RuntimeInstanceLock {
    pub fn acquire(kind: RuntimeInstanceKind) -> Result<Self, RuntimeInstanceLockError> {
        Self::acquire_at(kind, default_lock_path(kind))
    }

    pub fn acquire_at(
        kind: RuntimeInstanceKind,
        path: impl Into<PathBuf>,
    ) -> Result<Self, RuntimeInstanceLockError> {
        let path = path.into();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|source| {
                RuntimeInstanceLockError::CreateDirectory {
                    path: parent.to_path_buf(),
                    source,
                }
            })?;
        }

        let mut file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(&path)
            .map_err(|source| RuntimeInstanceLockError::Open {
                path: path.clone(),
                source,
            })?;

        if file.try_lock_exclusive().is_err() {
            return Err(RuntimeInstanceLockError::AlreadyRunning {
                metadata: read_existing_metadata(&mut file),
                path,
            });
        }

        write_lock_metadata(&mut file, kind, &path)?;

        Ok(Self {
            file: Some(file),
            path,
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for RuntimeInstanceLock {
    fn drop(&mut self) {
        let Some(file) = self.file.take() else {
            return;
        };
        let _ = file.unlock();
        drop(file);
        let _ = std::fs::remove_file(&self.path);
    }
}

fn default_lock_path(kind: RuntimeInstanceKind) -> PathBuf {
    if kind == RuntimeInstanceKind::Bench {
        if let Some(path) = env_lock_path(BENCH_LOCK_PATH_ENV) {
            return path;
        }
    }

    std::env::temp_dir()
        .join(LOCK_DIR_NAME)
        .join(LOCK_FILE_NAME)
}

fn env_lock_path(name: &str) -> Option<PathBuf> {
    let value = std::env::var_os(name)?;
    if value.is_empty() {
        return None;
    }
    Some(PathBuf::from(value))
}

fn read_existing_metadata(file: &mut File) -> String {
    let mut metadata = String::new();
    if file.seek(SeekFrom::Start(0)).is_ok() {
        let _ = file.read_to_string(&mut metadata);
    }
    metadata
}

fn write_lock_metadata(
    file: &mut File,
    kind: RuntimeInstanceKind,
    path: &Path,
) -> Result<(), RuntimeInstanceLockError> {
    file.set_len(0)
        .and_then(|_| file.seek(SeekFrom::Start(0)).map(|_| ()))
        .and_then(|_| {
            writeln!(file, "pid={}", std::process::id())?;
            writeln!(file, "kind={}", kind.as_str())?;
            writeln!(file, "started_unix_secs={}", unix_timestamp_secs())?;
            if let Ok(exe) = std::env::current_exe() {
                writeln!(file, "exe={}", exe.display())?;
            }
            if let Ok(cwd) = std::env::current_dir() {
                writeln!(file, "cwd={}", cwd.display())?;
            }
            Ok(())
        })
        .map_err(|source| RuntimeInstanceLockError::Write {
            path: path.to_path_buf(),
            source,
        })
}

fn unix_timestamp_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn second_runtime_lock_is_rejected_while_first_is_alive() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("runtime.lock");
        let first =
            RuntimeInstanceLock::acquire_at(RuntimeInstanceKind::Game, &path).expect("first lock");

        let second = RuntimeInstanceLock::acquire_at(RuntimeInstanceKind::Bench, &path);

        assert!(matches!(
            second,
            Err(RuntimeInstanceLockError::AlreadyRunning { .. })
        ));
        assert!(path.exists());
        drop(first);
    }

    #[test]
    fn runtime_lock_file_is_removed_on_drop() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("runtime.lock");

        {
            let lock = RuntimeInstanceLock::acquire_at(RuntimeInstanceKind::EditorRuntime, &path)
                .expect("lock");
            assert_eq!(lock.path(), path.as_path());
            assert!(path.exists());
        }

        assert!(!path.exists());
        let _second = RuntimeInstanceLock::acquire_at(RuntimeInstanceKind::Game, &path)
            .expect("reacquire after drop");
    }

    #[test]
    fn bench_uses_shared_runtime_lock_by_default() {
        if std::env::var_os(BENCH_LOCK_PATH_ENV).is_none() {
            assert_eq!(
                default_lock_path(RuntimeInstanceKind::Bench),
                default_lock_path(RuntimeInstanceKind::Game)
            );
        }
    }
}
