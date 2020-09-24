const DbApiUtil = require('./db_api_util');

getVoterStatusOptions = () => {
  switch (process.env.CLIENT_ORGANIZATION) {
    case "VOTER_HELP_LINE":
      return {
        "UNKNOWN": "Unknown",
        "UNREGISTERED": "Unregistered",
        "REGISTERED": "Registered",
        "REQUESTED_BALLOT": "Requested ballot",
        "RECEIVED_BALLOT": "Received ballot",
        "IN_PERSON": "Will vote in-person",
        "VOTED": "Voted",
        "SPAM": "Spam",
        "REFUSED": "Refused",
      };
    case "VOTE_FROM_HOME_2020":
      return {
        "UNKNOWN": "Unknown",
        "UNREGISTERED": "Unregistered",
        "REGISTERED": "Registered",
        "REQUESTED_BALLOT": "Requested ballot",
        "RECEIVED_BALLOT": "Received ballot",
        "IN_PERSON": "Will vote in-person",
        "VOTED": "Voted",
        "SPAM": "Spam",
        "REFUSED": "Refused",
      };
    default:
      return {
        "UNKNOWN": "Unknown",
        "UNREGISTERED": "Unregistered",
        "REGISTERED": "Registered",
        "REQUESTED_BALLOT": "Requested ballot",
        "RECEIVED_BALLOT": "Received ballot",
        "IN_PERSON": "Will vote in-person",
        "VOTED": "Voted",
        "SPAM": "Spam",
        "REFUSED": "Refused",
      };
  }
};

exports.getVoterStatusOptions = getVoterStatusOptions;



const voterInfoSection = (messageText) => {
  return {
    "type": "section",
    "text": {
      "type": "mrkdwn",
      "text": messageText,
    }
  };
};

exports.voterInfoSection = voterInfoSection;

const volunteerSelectionPanel = {
  "type": "actions",
  "elements": [
    {
      "type": "users_select",
      "placeholder": {
        "type": "plain_text",
        "text": "Claim this voter",
        "emoji": true
      },
    }
  ]
};

const voterStatusPanel = {
  "type": "actions",
  "elements": [
      {
        "type": "static_select",
        "initial_option": {
          "text": {
            "type": "plain_text",
            "text": "Unknown",
            "emoji": true
          },
          "value": "UNKNOWN"
        },
        "options": [
          {
            "text": {
              "type": "plain_text",
              "text": "Unknown",
              "emoji": true
            },
            "value": "UNKNOWN"
          },
          {
            "text": {
              "type": "plain_text",
              "text": "Unregistered",
              "emoji": true
            },
            "value": "UNREGISTERED"
          },
          {
            "text": {
              "type": "plain_text",
              "text": "Registered",
              "emoji": true
            },
            "value": "REGISTERED"
          },
          {
            "text": {
              "type": "plain_text",
              "text": "Requested ballot",
              "emoji": true
            },
            "value": "REQUESTED_BALLOT"
          },
          {
            "text": {
              "type": "plain_text",
              "text": "Received ballot",
              "emoji": true
            },
            "value": "RECEIVED_BALLOT"
          },
          {
            "text": {
              "type": "plain_text",
              "text": "Will vote in-person",
              "emoji": true
            },
            "value": "IN_PERSON"
          }
        ]
    },
    {
      "type": "button",
      "style": "primary",
      "text": {
        "type": "plain_text",
        "text": "Voted",
        "emoji": true
      },
      "value": "VOTED",
      "confirm": {
        "title": {
          "type": "plain_text",
          "text": "Are you sure?"
        },
        "text": {
          "type": "mrkdwn",
          "text": "Please confirm that you'd like to update this voter's status to VOTED."
        },
        "confirm": {
          "type": "plain_text",
          "text": "Confirm"
        },
        "deny": {
          "type": "plain_text",
          "text": "Cancel"
        },
      },
    },
    {
      "type": "button",
      "style": "danger",
      "text": {
        "type": "plain_text",
        "text": "Refused",
        "emoji": true
      },
      "value": "REFUSED",
      "confirm": {
        "title": {
          "type": "plain_text",
          "text": "Are you sure?"
        },
        "text": {
          "type": "mrkdwn",
          "text": "Please confirm that you'd like to update this voter's status to REFUSED. This will block volunteers and our other platforms from messaging the voter."
        },
        "confirm": {
          "type": "plain_text",
          "text": "Confirm"
        },
        "deny": {
          "type": "plain_text",
          "text": "Cancel"
        },
      },
    },
    {
      "type": "button",
      "style": "danger",
      "text": {
        "type": "plain_text",
        "text": "Spam",
        "emoji": true
      },
      "value": "SPAM",
      "confirm": {
        "title": {
          "type": "plain_text",
          "text": "Are you sure?"
        },
        "text": {
          "type": "mrkdwn",
          "text": "Please confirm that you'd like to mark this phone number as SPAM. This will block their phone number from messaging us and all volunteers and our other platforms from messaging them."
        },
        "confirm": {
          "type": "plain_text",
          "text": "Confirm"
        },
        "deny": {
          "type": "plain_text",
          "text": "Cancel"
        },
      },
    }
  ]
};

exports.voterStatusPanel = voterStatusPanel;

exports.getVoterStatusBlocks = (messageText) => {
  return [
  		voterInfoSection(messageText),
      volunteerSelectionPanel,
  		voterStatusPanel
  	];
};

exports.makeClosedVoterPanelBlocks = (messageText, includeUndoButton) => {
  console.log("\nENTERING SLACKINTERACTIONAPIUTIL.getClosedVoterStatusPanel");

  const blocks = [];

  blocks.push({
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": messageText,
      },
    });

  if (includeUndoButton) {
    blocks.push({
        "type": "actions",
        "elements": [
          {
            "type": "button",
            "style": "danger",
            "text": {
              "type": "plain_text",
              "text": "Undo",
              "emoji": true,
            },
            "value": "UNDO",
            "confirm": {
              "title": {
              	"type": "plain_text",
              	"text": "Are you sure?"
              },
              "text": {
              	"type": "mrkdwn",
              	"text": "Please confirm you'd like to reset the voter's status."
              },
              "confirm": {
              	"type": "plain_text",
              	"text": "Confirm"
              },
              "deny": {
              	"type": "plain_text",
              	"text": "Cancel"
              },
  					},
          }
        ],
      });
  }
  return blocks;
};

exports.replaceVoterPanelBlocks = (oldBlocks, replacementBlocks) => {
  const newBlocks = [];
  // The first block is the user info.
  newBlocks.push(oldBlocks[0]);
  // The second block is the volunteer dropdown.
  newBlocks.push(oldBlocks[1]);
  // The remaining blocks are the panel.
  for (let idx in replacementBlocks) {
    newBlocks.push(replacementBlocks[idx]);
  }
  return newBlocks;
};

// This function mutates the blocks input.
exports.populateDropdownNewInitialValue = (blocks, newInitialValue) => {
  const voterStatusOptions = getVoterStatusOptions();
  const isVoterStatusOption = Object.keys(voterStatusOptions).includes(newInitialValue);
  for (let i in blocks) {
    const block = blocks[i];
    if (block.type === "actions") {
      const elements = block.elements;
      for (let j in elements) {
        element = elements[j];
        if (isVoterStatusOption) {
          if (element.type === "static_select") {
            element.initial_option.value = newInitialValue;
            element.initial_option.text.text = voterStatusOptions[newInitialValue];
            // Javascript modifies the blocks by reference, so end but don't return anything.
            return;
          }
        } else {
          if (element.type === "users_select") {
            element.initial_user = newInitialValue;
            // Javascript modifies the blocks by reference, so end but don't return anything.
            return;
          }
        }
      }
    }
  }
};
