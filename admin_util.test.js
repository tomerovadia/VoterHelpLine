const AdminUtil = require('./admin_util');

test("Returns null if message doesn't by mentioning Slack bot: excludes @ sign.", () => {
  const input = `<${process.env.SLACK_BOT_USER_ID}> ROUTE_VOTER someVoterIdBlah +18551234567 someDestinationChannelBlah`;
  expect(AdminUtil.parseAdminSlackMessage(input)).toBe(null);
});

test("Returns null if message doesn't by mentioning Slack bot: different user.", () => {
  const input = `<@1234567890> ROUTE_VOTER someVoterIdBlah +18551234567 someDestinationChannelBlah`;
  expect(AdminUtil.parseAdminSlackMessage(input)).toBe(null);
});

test("Returns null if message doesn't immediately follow Slack bot mention with command.", () => {
  const input = `<@${process.env.SLACK_BOT_USER_ID}> someVoterIdBlah +18551234567 someDestinationChannelBlah`;
  expect(AdminUtil.parseAdminSlackMessage(input)).toBe(null);
});

test("Returns null if message doesn't immediately follow Slack bot mention with one of approved commands.", () => {
  const input = `<@${process.env.SLACK_BOT_USER_ID}> INVALID_COMMAND someVoterIdBlah +18551234567 someDestinationChannelBlah`;
  expect(AdminUtil.parseAdminSlackMessage(input)).toBe(null);
});

test("Returns object that contains admin command.", () => {
  const input = `<@${process.env.SLACK_BOT_USER_ID}> ROUTE_VOTER someVoterIdBlah +18551234567 someDestinationChannelBlah`;
  expect(AdminUtil.parseAdminSlackMessage(input)).toEqual(expect.objectContaining({
    command: "ROUTE_VOTER"
  }));
});

describe('ROUTE_VOTER', () => {

  test("ROUTE_VOTER Returns object that contains the voter userId.", () => {
    const input = `<@${process.env.SLACK_BOT_USER_ID}> ROUTE_VOTER someVoterIdBlah +18551234567 someDestinationChannelBlah`;
    expect(AdminUtil.parseAdminSlackMessage(input)).toEqual(expect.objectContaining({
      userId: "someVoterIdBlah"
    }));
  });

  test("ROUTE_VOTER Returns object that contains the voter userId.", () => {
    const input = `<@${process.env.SLACK_BOT_USER_ID}> ROUTE_VOTER someVoterIdBlah <tel:+18551234567|+18551234567> someDestinationChannelBlah`;
    expect(AdminUtil.parseAdminSlackMessage(input)).toEqual(expect.objectContaining({
      twilioPhoneNumber: "+18551234567",
    }));
  });

  test("ROUTE_VOTER Returns object that contains the destination channel.", () => {
    const input = `<@${process.env.SLACK_BOT_USER_ID}> ROUTE_VOTER someVoterIdBlah +18551234567 someDestinationChannelBlah`;
    expect(AdminUtil.parseAdminSlackMessage(input)).toEqual(expect.objectContaining({
      destinationSlackChannelName: "someDestinationChannelBlah"
    }));
  });

  test("ROUTE_VOTER Returns null for any admin message that contains more than required params.", () => {
    const input = `<@${process.env.SLACK_BOT_USER_ID}> ROUTE_VOTER someVoterIdBlah +18551234567 someDestinationChannelBlah somethingExtra`;
    expect(AdminUtil.parseAdminSlackMessage(input)).toBe(null);
  });

  test("ROUTE_VOTER Returns null for any admin message that contains fewer than required params.", () => {
    const input = `<@${process.env.SLACK_BOT_USER_ID}> ROUTE_VOTER someVoterIdBlah +18551234567`;
    expect(AdminUtil.parseAdminSlackMessage(input)).toBe(null);
  });

  test.only("ROUTE_VOTER Is resilient to multiple spaces between arguments.", () => {
    const input = `<@${process.env.SLACK_BOT_USER_ID}>    ROUTE_VOTER   someVoterIdBlah  +18551234567 someDestinationChannelBlah`;
    expect(AdminUtil.parseAdminSlackMessage(input)).toEqual(expect.objectContaining({
      command: "ROUTE_VOTER",
      userId: "someVoterIdBlah",
      twilioPhoneNumber: "+18551234567",
      destinationSlackChannelName: "someDestinationChannelBlah",
    }));
  });

});
