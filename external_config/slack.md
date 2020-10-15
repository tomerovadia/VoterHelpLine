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

## Slack App

### OAuth & Permissions

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
