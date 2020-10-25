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
- eastern-south-0
- demo-eastern-south-0
- eastern-north-0
- demo-eastern-north-0
- central-0
- demo-central-0

- pennsylvania-0
- demo-pennsylvania-0
- florida-0
- demo-florida-0
- texas-0
- demo-texas-0
- georgia-0
- demo-georgia-0
- new-york-0
- demo-new-york-0
- arizona-0
- demo-arizona-0
- wisconsin-0
- demo-wisconsin-0
- illinois-0
- demo-illinois-0
- minnesota-0
- demo-minnesota-0
- colorado-0
- demo-colorado-0
- california-0
- demo-california-0
- north-carolina-0
- demo-north-carolina-0

#### Redis

- RPUSH openPodsPullDemoNational demo-national-0
- RPUSH openPodsPullNational national-0

- RPUSH openPodsPullDemoPacific demo-pacific-0
- RPUSH openPodsPullDemoMountain demo-mountain-0
- RPUSH openPodsPullDemoEasternSouth demo-eastern-south-0
- RPUSH openPodsPullDemoEasternNorth demo-eastern-north-0
- RPUSH openPodsPullDemoCentral demo-central-0

- RPUSH openPodsPullPacific pacific-0
- RPUSH openPodsPullMountain mountain-0
- RPUSH openPodsPullEasternSouth eastern-south-0
- RPUSH openPodsPullEasternNorth eastern-north-0
- RPUSH openPodsPullCentral central-0

- RPUSH openPodsPullPennsylvania pennsylvania-0
- RPUSH openPodsPullDemoPennsylvania demo-pennsylvania-0
- RPUSH openPodsPullFlorida florida-0
- RPUSH openPodsPullDemoFlorida demo-florida-0
- RPUSH openPodsPullTexas texas-0
- RPUSH openPodsPullDemoTexas demo-texas-0
- RPUSH openPodsPullGeorgia georgia-0
- RPUSH openPodsPullDemoGeorgia demo-georgia-0
- RPUSH openPodsPullNewYork new-york-0
- RPUSH openPodsPullDemoNewYork demo-new-york-0
- RPUSH openPodsPullArizona arizona-0
- RPUSH openPodsPullDemoArizona demo-arizona-0
- RPUSH openPodsPullWisconsin wisconsin-0
- RPUSH openPodsPullDemoWisconsin demo-wisconsin-0
- RPUSH openPodsPullIllinois illinois-0
- RPUSH openPodsPullDemoIllinois demo-illinois-0
- RPUSH openPodsPullMinnesota minnesota-0
- RPUSH openPodsPullDemoMinnesota demo-minnesota-0
- RPUSH openPodsPullColorado colorado-0
- RPUSH openPodsPullDemoColorado demo-colorado-0
- RPUSH openPodsPullCalifornia california-0
- RPUSH openPodsPullDemoCalifornia demo-california-0
- RPUSH openPodsPullNorthCarolina north-carolina-0
- RPUSH openPodsPullDemoNorthCarolina demo-north-carolina-0

#### Example State-to-Region Config (valid for VoteAmerica as of Oct 18, 2020)

HMSET stateRegionConfig "Alabama" "Central" "Alaska" "Pacific" "Arizona" "Arizona" "Arkansas" "Central" "California" "California" "Colorado" "Colorado" "Connecticut" "Eastern North" "Delaware" "Eastern North" "District of Columbia" "Eastern South" "Florida" "Florida" "Georgia" "Georgia" "Hawaii" "Pacific" "Idaho" "Mountain" "Illinois" "Illinois" "Indiana" "Eastern North" "Iowa" "Central" "Kansas" "Central" "Kentucky" "Eastern South" "Louisiana" "Central" "Maine" "Eastern North" "Maryland" "Eastern South" "Massachusetts" "Eastern North" "Michigan" "Eastern North" "Minnesota" "Minnesota" "Mississippi" "Central" "Missouri" "Central" "Montana" "Mountain" "Nebraska" "Central" "Nevada" "Pacific" "New Hampshire" "Eastern North" "New Jersey" "Eastern North" "New Mexico" "Mountain" "New York" "New York" "North Carolina" "North Carolina" "North Dakota" "Central" "Ohio" "Eastern North" "Oklahoma" "Central" "Oregon" "Pacific" "Pennsylvania" "Pennsylvania" "Rhode Island" "Eastern North" "South Carolina" "Eastern South" "South Dakota" "Central" "Tennessee" "Eastern South" "Texas" "Texas" "Utah" "Mountain" "Vermont" "Eastern North" "Virginia" "Eastern South" "Washington" "Pacific" "West Virginia" "Eastern South" "Wisconsin" "Wisconsin" "Wyoming" "Mountain" "National" "National"

## Slack App

### OAuth & Permissions

#### OAuth Tokens & Redirect URLs

Create an **OAuth Access Token** and put it in `.env` as `SLACK_USER_ACCESS_TOKEN`.  It should start with `xoxp-`.

Create a **Bot User OAuth Access Token** and put it in `.env` as `SLACK_BOT_ACCESS_TOKEN`.  It should start with `xoxb-`.

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

##### Needs Attention

This should be added as a **global** shortcut.

- **Name:** Needs Attention
- **Short Description:** Show voters needing attention
- **Callback ID:** show_needs_attention

##### Manage Entry Points

This should be added as a **global** shortcut.

- **Name:** Manage Entry Points
- **Short Description:** Manage entry points by state or region
- **Callback ID:** manage_entry_points

### Slash commands

#### Unclaimed

- **Command:** /unclaimed
- **Request URL:** base URL + /slack-command
- **Short Description:** List unclaimed voters in a channel
- **Usage Hint:** (None)

#### Needs attention

- **Command:** /needs-attention
- **Request URL:** base URL + /slack-command
- **Short Description:** List voters needing your attention
- **Usage Hint:** (None)

#### Broadcast

- **Command:** /broadcast
- **Request URL:** base URL + /slack-command
- **Short Description:** Broadcast helpline status to channels or volunteers
- **Usage Hint:** channel-status|volunteer-status [optional preamble message]
