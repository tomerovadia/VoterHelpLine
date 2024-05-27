import Hashes from 'jshashes';

export const mockConstituentPhoneNumber = 'mockConstituentPhoneNumber';
const MD5 = new Hashes.MD5();
export const mockConstituentId = MD5.hex(mockConstituentPhoneNumber);
export const mockThreadInfoChannelId1 = "mockThreadInfoChannelId1";
export const mockThreadInfoChannelId2 = "mockThreadInfoChannelId2";
export const mockThreadInfoChannelName1 = "mockThreadInfoChannelName1";
export const mockThreadInfoChannelName2 = "mockThreadInfoChannelName2";

export const mockTopLevelThreadSlackOptions = {
    "blocks": 
      [
        {
          "text": 
            {
              "text": "<!channel> New voter\n8e11012e2804a933a23197043b99a2b3 via mockTwilioPhoneNumber", 
              "type": "mrkdwn"
            }, 
          "type": "section"
        }, 
        {
          "elements": 
          [
            {
              "action_id": "VOLUNTEER_DROPDOWN", 
              "placeholder": {
                "emoji": true, 
                "text": "Claim this voter", 
                "type": "plain_text"
              }, 
              "type": "users_select"
            }
          ], 
          "type": "actions"
        }, 
        {
          "elements": 
            [
              {"action_id": "VOTER_STATUS_DROPDOWN",
              "initial_option": {
                "text": {
                  "emoji": true,
                  "text": "Unknown",
                  "type": "plain_text"
                }, 
                "value": "UNKNOWN"
              },
              "options": 
              [
                {"text": 
                {"emoji": true,
                "text": "Unknown",
                "type": "plain_text"
              },
              "value": "UNKNOWN"
            },
            {"text": {
              "emoji": true,
              "text": "Unregistered",
              "type": "plain_text"
            },
            "value": "UNREGISTERED"
          },
          {
            "text": {
              "emoji": true,
              "text": "Registered",
              "type": "plain_text"
            }, "value": "REGISTERED"
          },
          {
            "text": {
              "emoji": true,
              "text": "Requested ballot",
              "type": "plain_text"
            }, 
            "value": "REQUESTED_BALLOT"
          },
          {
            "text": {
              "emoji": true,
              "text": "Received ballot",
              "type": "plain_text"
            }, "value": "RECEIVED_BALLOT"
          },
          {
            "text": {
              "emoji": true,
              "text": "Will vote in-person",
              "type": "plain_text"
            },
            "value": "IN_PERSON"
          },
          {
            "text": {
              "emoji": true,
              "text": "Voted :tada:",
              "type": "plain_text"
            },
            "value": "VOTED"
          },
          {
            "text": {
              "emoji": true,
              "text": "Not voting this election :cry:",
              "type": "plain_text"
            },
            "value": "NOT_VOTING"
          }],
          "type": "static_select"
        },
        {
          "action_id": "VOTER_STATUS_REFUSED_BUTTON",
          "confirm": {
            "confirm": {
              "text": "Confirm",
              "type": "plain_text"
            }, "deny": {
              "text": "Cancel",
              "type": "plain_text"
            }, 
            "text":{
              "text": "Please confirm that you'd like to update this voter's status to REFUSED. This will block volunteers and our other platforms from messaging the voter.",
              "type": "mrkdwn"
            },
            "title": {
              "text": "Are you sure?",
              "type": "plain_text"
            }},
            "style": "danger",
            "text": {
              "emoji": true,
              "text": "Refused",
              "type": "plain_text"
            },
            "type": "button",
            "value": "REFUSED"
          },
          {
            "action_id": "VOTER_STATUS_SPAM_BUTTON",
            "confirm": {
              "confirm": {
                "text": "Confirm",
                "type": "plain_text"
              },
              "deny": {
                "text": "Cancel",
                "type": "plain_text"
              },
              "text": {
                "text": "Please confirm that you'd like to mark this phone number as SPAM. This will block their phone number from messaging us and all volunteers and our other platforms from messaging them.",
                "type": "mrkdwn"
              },
              "title": {
                "text": "Are you sure?",
                "type": "plain_text"
              }},
              "style": "danger",
              "text": {
                "emoji": true,
                "text": "Spam",
                "type": "plain_text"
              },
              "type": "button",
              "value": "SPAM"
            },
            {
              "action_id": "ROUTE_TO_JOURNEY",
              "confirm": {
                "confirm": {
                  "text": "Confirm",
                  "type": "plain_text"
                },
                "deny": {
                  "text": "Cancel",
                  "type": "plain_text"
                },
                "text": {
                  "text": "Are you sure you want to route this voter to a journey pod?\n\nPlease remember to let the voter know that someone will be following up with them.",
                  "type": "mrkdwn"
                },
                "title": {
                  "text": "Are you sure?",
                  "type": "plain_text"
                }},
                "text": {
                  "emoji": true,
                  "text": "Route to Journey",
                  "type": "plain_text"},
                  "type": "button"
                }],
                "type": "actions"
              },
              {
                "accessory": {
                  "action_id": "SESSION_TOPICS",
                  "options": [
                    {
                      "text": {
                        "text": "How to verify voter registration",
                        "type": "plain_text"
                      },
                      "value": "VERIFY"
                    },
                    {
                      "text": {
                        "text": "How to register to vote",
                        "type": "plain_text"
                      },
                      "value": "REGISTER"
                    },
                    {
                      "text": {
                        "text": "How to request an absentee ballot",
                        "type": "plain_text"
                      },
                      "value": "ABSENTEE_REQUEST"
                    },
                    {
                      "text": {
                        "text": "Absentee ballot did not arrive",
                        "type": "plain_text"
                      },
                      "value": "ABSENTEE_BALLOT_DID_NOT_ARRIVE"
                    },
                    {
                      "text": {
                        "text": "Absentee ballot was damaged",
                        "type": "plain_text"
                      },
                      "value": "ABSENTEE_BALLOT_DAMAGED"
                    },
                    {
                      "text": {
                        "text": "Multiple absentee ballots arrived",
                        "type": "plain_text"
                      },
                      "value": "ABSENTEE_BALLOT_MULTIPLE"
                    },
                    {
                      "text": {
                        "text": "How to return a ballot",
                        "type": "plain_text"
                      },
                      "value": "ABSENTEE_BALLOT_RETURN"
                    },
                    {
                      "text": {
                        "text": "How to track my ballot",
                        "type": "plain_text"
                      },
                      "value": "ABSENTEE_BALLOT_TRACK"
                    }, 
                    {"text": {
                      "text": "Where to vote",
                      "type": "plain_text"
                    },
                    "value": "WHERE_TO_VOTE"
                  },
                  {
                    "text": {
                      "text": "How to vote early",
                      "type": "plain_text"
                    },
                    "value": "VOTE_EARLY"
                  }, 
                  {
                    "text": {
                      "text": "How to vote in person despite having absentee ballot",
                      "type": "plain_text"
                    },
                    "value": "ABSENTEE_VOTE_IN_PERSON"
                  }, 
                  {
                    "text": {
                      "text": "Moved",
                      "type": "plain_text"
                    },
                    "value": "MOVED"
                  }, {
                    "text": {
                      "text": "Unusual and/or uncategorized question",
                      "type": "plain_text"
                    },
                    "value": "UNUSUAL_QUESTION"
                  }
                ],
                  "placeholder": {
                    "text": "Select",
                    "type": "plain_text"
                  },
                  "type": "multi_static_select"
                },
                "block_id": "votertopic",
                "text": {
                  "text": "Voter questions, topics discussed",
                  "type": "mrkdwn"
                },
                "type": "section"
              }
            ],
              "channel": "lobby"
  }

export const mockMessageHistorySlackOptions = {
  "blocks": [
    {
      "text": {
        "text": "Past session in <slack://channel?team=T123456&id=mockThreadInfoChannelId2|#mockThreadInfoChannelName2> ended <!date^1715524500^{time} {date_short}|1715524500> - <mockThreadPermalink|Open> Topics: , ",
        "type": "mrkdwn"
      },
      "type": "section"
    },
    {
      "elements": [
        {
          "action_id": "VOTER_SESSION_EXPAND",
          "style": "primary",
          "text": {
            "emoji": true,
            "text": "Show",
            "type": "plain_text"
          },
          "type": "button",
          "value": "8e11012e2804a933a23197043b99a2b3 mockTwilioPhoneNumber 978987989 238905720384 0"
        }
      ],
      "type": "actions"
    }
  ],
  "channel": "mockSlackChannelId",
  "parentMessageTs": "mockSlackParentThreadTs"
};

export const mockThreadInfos = [
 {
  slackParentMessageTs: "mockThreadInfoSlackMessageTs1",
  channelId: mockThreadInfoChannelId1,
  userId: mockConstituentId,
  lastUpdate: "2024-05-12T14:30:00Z",
  lastUpdateAge: 129834708924,
  volunteerSlackUserId: "mockThreadInfoVolunteerSlackUserId1",
  volunteerSlackUserName: "mockThreadInfoVolunteerSlackUserName1",
  historyTs: "mockThreadInfoHistoryTs1",
  voterStatus: "mockThreadInfoVoterStatus1",
  sessionStartEpoch: 537489204893,
  sessionEndEpoch: 2093480293,
  topics: ["mockThreadInfoTopic1", "mockThreadInfoTopic2"],
 },
 {
  slackParentMessageTs: "mockThreadInfoSlackMessageTs2",
  channelId: mockThreadInfoChannelId2,
  userId: mockConstituentId,
  lastUpdate: "2024-05-12T14:35:00Z",
  lastUpdateAge: 324532453345,
  volunteerSlackUserId: "mockThreadInfoVolunteerSlackUserId2",
  volunteerSlackUserName: "mockThreadInfoVolunteerSlackUserName2",
  historyTs: "mockThreadInfoHistoryTs2",
  voterStatus: "mockThreadInfoVoterStatus2",
  sessionStartEpoch: 978987989,
  sessionEndEpoch: 238905720384,
  topics: ["mockThreadInfoTopic3", "mockThreadInfoTopic4"],
 },
]

export const mockHistoricalMessages = [
  {
    timestamp: "2024-05-11T14:35:00Z",
    message: "hi can you help me vote?",
    automated: false,
    direction: "INBOUND",
    originating_slack_user_name: null,
    slack_attachments: null,
    twilio_attachments: null,
  },
  {
    timestamp: "2024-05-11T14:40:00Z",
    message: "hi welcome to the helpline",
    automated: true,
    direction: "OUTBOUND",
    originating_slack_user_name: "mockOriginatingSlackUserName",
    slack_attachments: null,
    twilio_attachments: null,
  }
];