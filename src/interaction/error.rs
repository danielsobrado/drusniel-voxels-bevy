//! Error types for gameplay interaction systems.
//!
//! This module provides structured error types for block placement,
//! entity interaction, and other gameplay operations.

use bevy::prelude::*;
use thiserror::Error;

/// Errors that can occur during block placement operations.
#[derive(Debug, Error, Clone)]
pub enum PlacementError {
    /// Attempted to place a block in an invalid position.
    #[error("Cannot place block at {position:?}: {reason}")]
    InvalidPosition {
        position: IVec3,
        reason: String,
    },

    /// Attempted to place a block where the player is standing.
    #[error("Cannot place block at player position {position:?}")]
    PlayerBlocking {
        position: IVec3,
    },

    /// Attempted to place a block in a solid space.
    #[error("Position {position:?} is already occupied by a solid block")]
    PositionOccupied {
        position: IVec3,
    },

    /// Attempted to place a block outside world bounds.
    #[error("Position {position:?} is outside world bounds")]
    OutOfBounds {
        position: IVec3,
    },

    /// No valid target surface to place on.
    #[error("No valid placement surface found")]
    NoTarget,
}

/// Errors that can occur during block breaking operations.
#[derive(Debug, Error, Clone)]
pub enum BreakError {
    /// Attempted to break an unbreakable block (bedrock).
    #[error("Cannot break bedrock at {position:?}")]
    Unbreakable {
        position: IVec3,
    },

    /// No block targeted for breaking.
    #[error("No block targeted")]
    NoTarget,

    /// Block is out of interaction range.
    #[error("Block at {position:?} is out of range")]
    OutOfRange {
        position: IVec3,
    },
}

/// Errors that can occur during entity combat operations.
#[derive(Debug, Error, Clone)]
pub enum CombatError {
    /// Entity not found.
    #[error("Entity not found")]
    EntityNotFound,

    /// Entity has no health component.
    #[error("Entity has no health component")]
    NoHealthComponent,

    /// Entity is already dead.
    #[error("Entity is already dead")]
    AlreadyDead,

    /// Target is out of range.
    #[error("Target is out of attack range")]
    OutOfRange,
}

/// Errors that can occur during drag operations in edit mode.
#[derive(Debug, Error, Clone)]
pub enum DragError {
    /// No block being dragged.
    #[error("No block is being dragged")]
    NotDragging,

    /// Invalid drop position.
    #[error("Cannot drop block at {position:?}: {reason}")]
    InvalidDropPosition {
        position: IVec3,
        reason: String,
    },

    /// Block fell through the world.
    #[error("Block would fall through the world at {position:?}")]
    NoGround {
        position: IVec3,
    },
}

/// Resource to track the last gameplay error for UI display.
#[derive(Resource, Default)]
pub struct LastGameplayError {
    /// The error message, if any.
    pub message: Option<String>,
    /// When the error occurred (for timeout-based clearing).
    pub timestamp: f64,
}

impl LastGameplayError {
    /// Records a new error.
    pub fn set(&mut self, message: impl Into<String>, time: f64) {
        self.message = Some(message.into());
        self.timestamp = time;
    }

    /// Clears the error if it's older than the given duration.
    pub fn clear_if_expired(&mut self, current_time: f64, duration: f64) {
        if self.message.is_some() && current_time - self.timestamp > duration {
            self.message = None;
        }
    }

    /// Clears the error immediately.
    pub fn clear(&mut self) {
        self.message = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn placement_error_display() {
        let err = PlacementError::InvalidPosition {
            position: IVec3::new(1, 2, 3),
            reason: "test reason".to_string(),
        };
        let msg = err.to_string();
        assert!(msg.contains("1, 2, 3"));
        assert!(msg.contains("test reason"));
    }

    #[test]
    fn break_error_display() {
        let err = BreakError::Unbreakable {
            position: IVec3::new(5, 5, 5),
        };
        let msg = err.to_string();
        assert!(msg.contains("bedrock"));
        assert!(msg.contains("5, 5, 5"));
    }

    #[test]
    fn combat_error_variants() {
        assert_eq!(CombatError::EntityNotFound.to_string(), "Entity not found");
        assert_eq!(CombatError::AlreadyDead.to_string(), "Entity is already dead");
    }

    #[test]
    fn last_gameplay_error_lifecycle() {
        let mut error = LastGameplayError::default();
        assert!(error.message.is_none());

        error.set("Test error", 0.0);
        assert!(error.message.is_some());
        assert_eq!(error.message.as_ref().unwrap(), "Test error");

        // Should not clear if not expired
        error.clear_if_expired(1.0, 5.0);
        assert!(error.message.is_some());

        // Should clear if expired
        error.clear_if_expired(6.0, 5.0);
        assert!(error.message.is_none());
    }
}
