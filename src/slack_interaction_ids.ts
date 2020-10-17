// List of enums

// Callback IDs are strings used in shortcuts, mostly.
export enum SlackCallbackId {
  OPEN_CLOSE_CHANNELS = 'open_close_channels',
  OPEN_CLOSE_CHANNELS_CONFIRM = 'open_close_channels_confirm',
  OPEN_CLOSE_CHANNELS_ERROR = 'open_close_channels_error',
  RESET_DEMO = 'reset_demo',
  SHOW_NEEDS_ATTENTION = 'show_needs_attention',
  SET_NEEDS_ATTENTION = 'set_needs_attention',
  CLEAR_NEEDS_ATTENTION = 'clear_needs_attention',
}

// Action IDs are used in interactive blocks
export enum SlackActionId {
  // Open/Close Channel Modal
  OPEN_CLOSE_CHANNELS_FILTER_STATE = 'OPEN_CLOSE_CHANNELS_FILTER_STATE',
  OPEN_CLOSE_CHANNELS_FILTER_TYPE = 'OPEN_CLOSE_CHANNELS_FILTER_TYPE',
  OPEN_CLOSE_CHANNELS_CHANNEL_STATE_DROPDOWN = 'OPEN_CLOSE_CHANNELS_CHANNEL_STATE_DROPDOWN',

  // Voter status messages
  CLOSED_VOTER_PANEL_UNDO_BUTTON = 'CLOSED_VOTER_PANEL_UNDO_BUTTON',
  VOLUNTEER_DROPDOWN = 'VOLUNTEER_DROPDOWN',
  VOTER_STATUS_DROPDOWN = 'VOTER_STATUS_DROPDOWN',
  VOTER_STATUS_VOTED_BUTTON = 'VOTER_STATUS_VOTED_BUTTON',
  VOTER_STATUS_REFUSED_BUTTON = 'VOTER_STATUS_REFUSED_BUTTON',
  VOTER_STATUS_SPAM_BUTTON = 'VOTER_STATUS_SPAM_BUTTON',
}

// Prefixes per-state blocks in open-close channel modal
export const OPEN_CLOSE_CHANNELS_BLOCK_ID_PREFIX = 'OPEN_CLOSE_CHANNELS:';
