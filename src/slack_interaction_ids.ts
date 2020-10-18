// List of enums

// Callback IDs are strings used in shortcuts, mostly.
export enum SlackCallbackId {
  MANAGE_ENTRY_POINTS = 'manage_entry_points',
  MANAGE_ENTRY_POINTS_CONFIRM = 'manage_entry_points_confirm',
  MANAGE_ENTRY_POINTS_ERROR = 'manage_entry_points_error',
  RESET_DEMO = 'reset_demo',
  SHOW_NEEDS_ATTENTION = 'show_needs_attention',
  SET_NEEDS_ATTENTION = 'set_needs_attention',
  CLEAR_NEEDS_ATTENTION = 'clear_needs_attention',
}

// Action IDs are used in interactive blocks
export enum SlackActionId {
  // Open/Close Channel Modal
  MANAGE_ENTRY_POINTS_FILTER_STATE = 'MANAGE_ENTRY_POINTS_FILTER_STATE',
  MANAGE_ENTRY_POINTS_FILTER_TYPE = 'MANAGE_ENTRY_POINTS_FILTER_TYPE',
  MANAGE_ENTRY_POINTS_CHANNEL_STATE_DROPDOWN = 'MANAGE_ENTRY_POINTS_CHANNEL_STATE_DROPDOWN',

  // Voter status messages
  CLOSED_VOTER_PANEL_UNDO_BUTTON = 'CLOSED_VOTER_PANEL_UNDO_BUTTON',
  VOLUNTEER_DROPDOWN = 'VOLUNTEER_DROPDOWN',
  VOTER_STATUS_DROPDOWN = 'VOTER_STATUS_DROPDOWN',
  VOTER_STATUS_VOTED_BUTTON = 'VOTER_STATUS_VOTED_BUTTON',
  VOTER_STATUS_REFUSED_BUTTON = 'VOTER_STATUS_REFUSED_BUTTON',
  VOTER_STATUS_SPAM_BUTTON = 'VOTER_STATUS_SPAM_BUTTON',
}

// Prefixes per-state blocks in open-close channel modal
export const MANAGE_ENTRY_POINTS_BLOCK_ID_PREFIX = 'MANAGE_ENTRY_POINTS:';
