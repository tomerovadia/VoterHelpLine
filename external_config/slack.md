# Slack Config

## Slack Workspace

### VoteAmerica Initial Setup

#### Channels

Important: The Slack bot must be given access to each of these channels.

- lobby
- demo-lobby

- national-0
- demo-national-0

- pacific-0
- demo-pacific-0
- mountain-0
- demo-mountain-0
- southeast-0
- demo-southeast-0
- northeast-0
- demo-northeast-0
- central-0
- demo-central-0

You must also create these channels and note their channel IDs (use Copy Link and get the `Cxxxxxx` part). Set the appropriate values in .env:

- admin-control-room (ADMIN_CONTROL_ROOM_SLACK_CHANNEL_ID)
- attachments (ATTACHMENTS_SLACK_CHANNEL_ID)

#### Redis

Note: for your development environment, you can simply `cat reset-redis.txt | redis-cli`.

RPUSH openPodsPullDemoNational demo-national-0
RPUSH openPodsPullNational national-0

RPUSH openPodsPullDemoPacific demo-pacific-0
RPUSH openPodsPullDemoMountain demo-mountain-0
RPUSH openPodsPullDemoSoutheast demo-southeast-0
RPUSH openPodsPullDemoNortheast demo-northeast-0
RPUSH openPodsPullDemoCentral demo-central-0

RPUSH openPodsPullPacific pacific-0
RPUSH openPodsPullMountain mountain-0
RPUSH openPodsPullSoutheast southeast-0
RPUSH openPodsPullNortheast northeast-0
RPUSH openPodsPullCentral central-0

#### Example State-to-Region Config

HMSET stateRegionConfig "Alabama" "Central" "Alaska" "Pacific" "Arizona" "Mountain" "Arkansas" "Central" "California" "Pacific" "Colorado" "Mountain" "Connecticut" "Northeast" "Delaware" "Northeast" "District of Columbia" "Southeast" "Florida" "Southeast" "Georgia" "Southeast" "Hawaii" "Pacific" "Idaho" "Mountain" "Illinois" "Central" "Indiana" "Northeast" "Iowa" "Central" "Kansas" "Central" "Kentucky" "Southeast" "Louisiana" "Central" "Maine" "Northeast" "Maryland" "Southeast" "Massachusetts" "Northeast" "Michigan" "Northeast" "Minnesota" "Central" "Mississippi" "Central" "Missouri" "Central" "Montana" "Mountain" "Nebraska" "Central" "Nevada" "Pacific" "New Hampshire" "Northeast" "New Jersey" "Northeast" "New Mexico" "Mountain" "New York" "Northeast" "North Carolina" "Southeast" "North Dakota" "Central" "Ohio" "Northeast" "Oklahoma" "Central" "Oregon" "Pacific" "Pennsylvania" "Northeast" "Rhode Island" "Northeast" "South Carolina" "Southeast" "South Dakota" "Central" "Tennessee" "Southeast" "Texas" "Central" "Utah" "Mountain" "Vermont" "Northeast" "Virginia" "Southeast" "Washington" "Pacific" "West Virginia" "Southeast" "Wisconsin" "Central" "Wyoming" "Mountain" "National" "National"

## Slack App

### OAuth & Permissions

#### OAuth Tokens & Redirect URLs

Create an **OAuth Access Token** and put it in `.env` as `SLACK_USER_ACCESS_TOKEN`. It should start with `xoxp-`.

Create a **Bot User OAuth Access Token** and put it in `.env` as `SLACK_BOT_ACCESS_TOKEN`. It should start with `xoxb-`.

#### Scopes

##### Bot Token Scopes

- app_mentions:read
- channels:history
- channels:read
- chat:write
- chat:write.customize
- chat:write.public
- commands
- groups:history
- groups:read
- reactions:write
- users:read
- files:write

##### User Token Scopes

- files:write

### Event Subscriptions

#### Subscribe to bot events

- app_mention
- message.channels
- message.groups

### Interactivity & Shortcuts

#### Shortcuts

##### Reset Demo

This should be added as a **messages** shortcut.

- **Name:** Reset Demo
- **Short Description:** Closes this conversation, allowing the volunteer to message the demo line again as a new mock voter.
- **Callback ID:** reset_demo

##### Set Needs Attention

This should be added as a **messages** shortcut.

- **Name:** Set Needs Attention
- **Short Description:** Add this thread to your Needs Attention list
- **Callback ID:** set_needs_attention

##### Clear Needs Attention

This should be added as a **messages** shortcut.

- **Name:** Clear Needs Attention
- **Short Description**: Remove this thread from your Needs Attention list
- **Callback ID**: clear_needs_attention

##### Manage Entry Points

This should be added as a **global** shortcut.

- **Name:** Manage Entry Points
- **Short Description:** Manage entry points by state or region
- **Callback ID:** manage_entry_points

This should be added as a **messages** shortcut.

- **Name:** Route to Journey
- **Short Description:** Routes this voter to a new channel for follow-up
- **Callback ID:** route_to_journey

### Slash commands

#### Unclaimed

- **Command:** /unclaimed
- **Request URL:** base URL + /slack-command
- **Short Description:** List unclaimed voters in a channel
- **Usage Hint:** (None)
- **Escape channels, users, and links sent to your app:** Unchecked

#### Needs attention

- **Command:** /needs-attention
- **Request URL:** base URL + /slack-command
- **Short Description:** List voters needing your attention
- **Usage Hint:** (None)
- **Escape channels, users, and links sent to your app:** Checked

#### Broadcast

- **Command:** /broadcast
- **Request URL:** base URL + /slack-command
- **Short Description:** Broadcast helpline status to channels or volunteers
- **Usage Hint:** channel-status|volunteer-status [optional preamble message]
- **Escape channels, users, and links sent to your app:** Unchecked

#### Follow-up

- **Command:** /follow-up
- **Request URL:** base URL + /slack-command
- **Short Description:** List voters to follow-up with
- **Usage Hint:** days-idle
- **Escape channels, users, and links sent to your app:** Unchecked
