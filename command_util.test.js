const CommandUtil = require('./command_util');

test("Returns null if message doesn't by mentioning Slack bot: excludes @ sign.", () => {
  const input = `<${process.env.SLACK_BOT_USER_ID}> ROUTE_VOTER someVoterIdBlah +18551234567 someDestinationChannelBlah`;
  expect(CommandUtil.parseSlackCommand(input)).toBe(null);
});

test("Returns null if message doesn't by mentioning Slack bot: different user.", () => {
  const input = `<@1234567890> ROUTE_VOTER someVoterIdBlah +18551234567 someDestinationChannelBlah`;
  expect(CommandUtil.parseSlackCommand(input)).toBe(null);
});

test("Returns null if message doesn't immediately follow Slack bot mention with command.", () => {
  const input = `<@${process.env.SLACK_BOT_USER_ID}> someVoterIdBlah +18551234567 someDestinationChannelBlah`;
  expect(CommandUtil.parseSlackCommand(input)).toBe(null);
});

test("Returns null if message doesn't immediately follow Slack bot mention with one of approved commands.", () => {
  const input = `<@${process.env.SLACK_BOT_USER_ID}> INVALID_COMMAND someVoterIdBlah +18551234567 someDestinationChannelBlah`;
  expect(CommandUtil.parseSlackCommand(input)).toBe(null);
});

describe('ROUTE_VOTER', () => {
  test("Returns object that contains admin command.", () => {
    const input = `<@${process.env.SLACK_BOT_USER_ID}> ROUTE_VOTER someVoterIdBlah +18551234567 someDestinationChannelBlah`;
    expect(CommandUtil.parseSlackCommand(input)).toEqual(expect.objectContaining({
      command: CommandUtil.ROUTE_VOTER
    }));
  });

  test("ROUTE_VOTER Returns object that contains the voter userId.", () => {
    const input = `<@${process.env.SLACK_BOT_USER_ID}> ROUTE_VOTER someVoterIdBlah +18551234567 someDestinationChannelBlah`;
    expect(CommandUtil.parseSlackCommand(input)).toEqual(expect.objectContaining({
      userId: "someVoterIdBlah"
    }));
  });

  test("ROUTE_VOTER Returns object that contains the voter userId.", () => {
    const input = `<@${process.env.SLACK_BOT_USER_ID}> ROUTE_VOTER someVoterIdBlah <tel:+18551234567|+18551234567> someDestinationChannelBlah`;
    expect(CommandUtil.parseSlackCommand(input)).toEqual(expect.objectContaining({
      twilioPhoneNumber: "+18551234567",
    }));
  });

  test("ROUTE_VOTER Returns object that contains the destination channel.", () => {
    const input = `<@${process.env.SLACK_BOT_USER_ID}> ROUTE_VOTER someVoterIdBlah +18551234567 someDestinationChannelBlah`;
    expect(CommandUtil.parseSlackCommand(input)).toEqual(expect.objectContaining({
      destinationSlackChannelName: "someDestinationChannelBlah"
    }));
  });

  test("ROUTE_VOTER Returns null for any admin message that contains more than required params.", () => {
    const input = `<@${process.env.SLACK_BOT_USER_ID}> ROUTE_VOTER someVoterIdBlah +18551234567 someDestinationChannelBlah somethingExtra`;
    expect(CommandUtil.parseSlackCommand(input)).toBe(null);
  });

  test("ROUTE_VOTER Returns null for any admin message that contains fewer than required params.", () => {
    const input = `<@${process.env.SLACK_BOT_USER_ID}> ROUTE_VOTER someVoterIdBlah +18551234567`;
    expect(CommandUtil.parseSlackCommand(input)).toBe(null);
  });

  test("ROUTE_VOTER Is resilient to multiple spaces between arguments.", () => {
    const input = `<@${process.env.SLACK_BOT_USER_ID}>    ROUTE_VOTER   someVoterIdBlah  +18551234567 someDestinationChannelBlah`;
    expect(CommandUtil.parseSlackCommand(input)).toEqual(expect.objectContaining({
      command: CommandUtil.ROUTE_VOTER,
      userId: "someVoterIdBlah",
      twilioPhoneNumber: "+18551234567",
      destinationSlackChannelName: "someDestinationChannelBlah",
    }));
  });

});

describe('UPDATE_VOTER_STATUS', () => {

  test("UPDATE_VOTER_STATUS Returns object that contains the voter userId.", () => {
    const input = `<@${process.env.SLACK_BOT_USER_ID}> UPDATE_VOTER_STATUS someVoterIdBlah VOTED`;
    expect(CommandUtil.parseSlackCommand(input)).toEqual(expect.objectContaining({
      command: "UPDATE_VOTER_STATUS"
    }));
  });

  test("UPDATE_VOTER_STATUS Returns object that contains the voter userId.", () => {
    const input = `<@${process.env.SLACK_BOT_USER_ID}> UPDATE_VOTER_STATUS someVoterIdBlah VOTED`;
    expect(CommandUtil.parseSlackCommand(input)).toEqual(expect.objectContaining({
      userId: "someVoterIdBlah",
    }));
  });

  test("UPDATE_VOTER_STATUS Returns object that contains the voter userId.", () => {
    const input = `<@${process.env.SLACK_BOT_USER_ID}> UPDATE_VOTER_STATUS someVoterIdBlah VOTED`;
    expect(CommandUtil.parseSlackCommand(input)).toEqual(expect.objectContaining({
      voterStatus: "VOTED",
    }));
  });

  test("UPDATE_VOTER_STATUS Returns null for any admin message that contains more than required params.", () => {
    const input = `<@${process.env.SLACK_BOT_USER_ID}> UPDATE_VOTER_STATUS someVoterIdBlah VOTED somethingExtra`;
    expect(CommandUtil.parseSlackCommand(input)).toBe(null);
  });

  test("UPDATE_VOTER_STATUS Returns null for any admin message that contains fewer than required params.", () => {
    const input = `<@${process.env.SLACK_BOT_USER_ID}> UPDATE_VOTER_STATUS someVoterIdBlah`;
    expect(CommandUtil.parseSlackCommand(input)).toBe(null);
  });

  test("UPDATE_VOTER_STATUS Returns null for any admin message that contains fewer than required params.", () => {
    const input = `<@${process.env.SLACK_BOT_USER_ID}> UPDATE_VOTER_STATUS someVoterIdBlah`;
    expect(CommandUtil.parseSlackCommand(input)).toBe(null);
  });

  test("UPDATE_VOTER_STATUS Returns null for invalid voter status.", () => {
    const input = `<@${process.env.SLACK_BOT_USER_ID}> UPDATE_VOTER_STATUS someVoterIdBlah someInvalidVoterStatus`;
    expect(CommandUtil.parseSlackCommand(input)).toBe(null);
  });

  test("UPDATE_VOTER_STATUS Is resilient to multiple spaces between arguments.", () => {
    const input = `<@${process.env.SLACK_BOT_USER_ID}>    UPDATE_VOTER_STATUS   someVoterIdBlah  VOTED`;
    expect(CommandUtil.parseSlackCommand(input)).toEqual(expect.objectContaining({
      command: "UPDATE_VOTER_STATUS",
      userId: "someVoterIdBlah",
      voterStatus: "VOTED",
    }));
  });

});
