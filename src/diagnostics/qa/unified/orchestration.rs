use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use thiserror::Error;

use super::manifest::Registry as SceneRegistry;
use super::schema::{Lane, Scene, Target};

const SCHEMA_VERSION: u32 = 1;
const PROGRAM_ALLOWLIST: [&str; 4] = ["cargo", "node", "npm", "npx"];
const PLACEHOLDER_ALLOWLIST: [&str; 5] = [
    "OUTPUT_DIR",
    "REPOSITORY_ROOT",
    "RUN_INDEX",
    "SCENE_ID",
    "TARGET",
];

include!("orchestration/types.inc.rs");
include!("orchestration/core.inc.rs");
include!("orchestration/support.inc.rs");
