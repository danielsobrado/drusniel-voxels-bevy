use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;
use serde_json::Value;
use serde_yaml::{Mapping, Value as YamlValue};
use thiserror::Error;

use super::manifest::Registry;
use super::schema::{Scene, Target};
use super::sha256::{Sha256Error, digest_file};

include!("baseline/types.inc.rs");
include!("baseline/promotion.inc.rs");
include!("baseline/support.inc.rs");
