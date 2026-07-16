use std::collections::BTreeMap;

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ReadinessSnapshot {
    pub runtime_ready: bool,
    pub runtime_error: Option<String>,
    pub pending: BTreeMap<String, u64>,
}

impl ReadinessSnapshot {
    pub fn blockers(&self) -> Vec<String> {
        let mut blockers = Vec::new();
        if let Some(error) = &self.runtime_error {
            blockers.push(format!("runtime error: {error}"));
        }
        if !self.runtime_ready {
            blockers.push("runtime not ready".to_string());
        }
        blockers.extend(
            self.pending
                .iter()
                .filter(|(_, value)| **value != 0)
                .map(|(key, value)| format!("{key}={value}")),
        );
        blockers
    }

    pub fn is_ready(&self) -> bool {
        self.blockers().is_empty()
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct FreezeState {
    pub camera: bool,
    pub wind: bool,
    pub clouds: bool,
    pub particles: bool,
    pub water: bool,
    pub sun: bool,
    pub random_epochs: bool,
    pub history_updates: bool,
    pub streaming_commits: bool,
}

impl FreezeState {
    pub fn freeze_after_readiness(
        &mut self,
        readiness: &ReadinessSnapshot,
    ) -> Result<(), Vec<String>> {
        let blockers = readiness.blockers();
        if !blockers.is_empty() {
            return Err(blockers);
        }
        *self = Self {
            camera: true,
            wind: true,
            clouds: true,
            particles: true,
            water: true,
            sun: true,
            random_epochs: true,
            history_updates: true,
            streaming_commits: true,
        };
        Ok(())
    }

    pub fn unfreeze(&mut self) {
        *self = Self::default();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn freeze_requires_readiness() {
        let mut state = FreezeState::default();
        let readiness = ReadinessSnapshot {
            runtime_ready: false,
            ..Default::default()
        };
        assert!(state.freeze_after_readiness(&readiness).is_err());
        assert_eq!(state, FreezeState::default());
    }

    #[test]
    fn freeze_sets_every_contract_flag() {
        let mut state = FreezeState::default();
        let readiness = ReadinessSnapshot {
            runtime_ready: true,
            ..Default::default()
        };
        state.freeze_after_readiness(&readiness).unwrap();
        assert!(state.camera && state.streaming_commits && state.history_updates);
    }
}
