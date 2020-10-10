// List of enums

// Callback IDs are strings used in shortcuts, mostly.
export enum SlackCallbackId {
  OPEN_CLOSE_CHANNELS = 'open_close_channels',
  OPEN_CLOSE_CHANNELS_MODAL = 'open_close_channels_modal',
  OPEN_CLOSE_CHANNELS_ERROR_MODAL = 'open_close_channels_error_modal',
  RESET_DEMO = 'reset_demo',
  RESET_DEMO_MODAL = 'reset_demo_modal',
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
