import Hashes from 'jshashes';
import * as DbApiUtil from './db_api_util';
import * as SlackApiUtil from './slack_api_util';
import * as LoadBalancer from './load_balancer';
import * as PodUtil from './pod_util';
import * as SlackBlockUtil from './slack_block_util';
import * as SlackBlockEntrypointUtil from './slack_block_entrypoint_util';
import * as SlackInteractionApiUtil from './slack_interaction_api_util';
import { SlackActionId, SlackCallbackId } from './slack_interaction_ids';
import * as RedisApiUtil from './redis_api_util';
import logger from './logger';
import { VoterStatus } from './types';
import { PromisifiedRedisClient } from './redis_client';
import { ChannelType, UserInfo, SlackThreadInfo } from './types';
import redisClient from './redis_client';

const maxCommandLines = 50; // if we go bigger slack tends to truncate the msg

export type VoterStatusUpdate = VoterStatus | 'UNDO';

type SlackInteractionEventValuesPayload = Record<
  string,
  Record<
    string,
    {
      type: string;
      value?: string;
      selected_option?: SlackBlockUtil.SlackOption;
      selected_options?: SlackBlockUtil.SlackOption[];
    }
  >
>;

export type SlackInteractionEventPayload = {
  type: string;
  callback_id: string;
  trigger_id: string;
  view: {
    id: string;
    blocks: SlackBlockUtil.SlackBlock[];
    callback_id: string;
    private_metadata: string;
    root_view_id: string;
    state?: {
      values: SlackInteractionEventValuesPayload;
    };
  };
  container: {
    thread_ts: string;
  };
  channel: {
    id: string;
  };
  actions: SlackBlockUtil.SlackAction[];
  user: {
    id: string;
  };
  message: {
    ts: string;
    thread_ts: string | null;
    blocks: SlackBlockUtil.SlackBlock[];
  };
  action_ts: string;

  // Not a Slack prop.
  automatedButtonSelection: boolean | undefined;

  // Added in cases where we've opened a loading modal. Not a Slack prop.
  modalExternalId?: string;
};

export type SlackSyntheticPayload = {
  container: {
    thread_ts: string;
  };
  channel: {
    id: string;
  };
  actions?: undefined;
  user: {
    id: null;
  };
  message: {
    blocks: SlackBlockUtil.SlackBlock[];
  };
  automatedButtonSelection: boolean | undefined;
};

type Payload = SlackInteractionEventPayload | SlackSyntheticPayload;

export type SlackModalPrivateMetadata = {
  commandType: string;
  userId: string;
  userPhoneNumber: string;
  twilioPhoneNumber: string;
  slackChannelId: string;
  slackParentMessageTs: string;
  originatingSlackUserName: string;
  originatingSlackUserId: string;
  slackChannelName: string;
  actionTs: string;
  success?: boolean;
  failureReason?: string;
};

const getClosedVoterPanelText = (
  selectedVoterStatus: VoterStatusUpdate,
  originatingSlackUserName: string
): string => {
  logger.info('ENTERING SLACKINTERACTIONAPIUTIL.getClosedVoterPanelText');
  const timeSinceEpochSecs = Math.round(Date.now() / 1000);
  // See https://api.slack.com/reference/surfaces/formatting#visual-styles
  const specialSlackTimestamp = `<!date^${timeSinceEpochSecs}^{date_num} {time_secs}|${new Date()}>`;

  return `:no_entry_sign: This voter was marked as *${selectedVoterStatus}* by *${originatingSlackUserName}* on *${specialSlackTimestamp}*. :no_entry_sign:`;
};

const handleVoterStatusUpdateHelper = async ({
  payload,
  selectedVoterStatus,
  originatingSlackUserName,
  slackChannelName,
  userPhoneNumber,
  twilioPhoneNumber,
}: {
  payload: Payload;
  selectedVoterStatus: VoterStatusUpdate;
  originatingSlackUserName: string;
  slackChannelName: string | null;
  userPhoneNumber: string;
  twilioPhoneNumber: string;
}) => {
  logger.info('ENTERING SLACKINTERACTIONHANDLER.handleVoterStatusUpdateHelper');
  const MD5 = new Hashes.MD5();
  const userId = MD5.hex(userPhoneNumber);

  const timeSinceEpochSecs = Math.round(Date.now() / 1000);
  // See https://api.slack.com/reference/surfaces/formatting#visual-styles
  const specialSlackTimestamp = `<!date^${timeSinceEpochSecs}^{date_num} {time_secs}|${new Date()}>`;

  // Post a message in the voter thread recording this status change.
  await SlackApiUtil.sendMessage(
    `*Operator:* Voter status changed to *${selectedVoterStatus}* by *${originatingSlackUserName}* at *${specialSlackTimestamp}*.`,
    {
      parentMessageTs: payload.container.thread_ts,
      channel: payload.channel.id,
    }
  );

  logger.info(
    `SLACKINTERACTIONHANDLER.handleVoterStatusUpdateHelper: Successfully sent message recording voter status change`
  );

  await DbApiUtil.logVoterStatusToDb({
    userId,
    userPhoneNumber,
    twilioPhoneNumber,
    isDemo: LoadBalancer.phoneNumbersAreDemo(
      twilioPhoneNumber,
      userPhoneNumber
    ),
    voterStatus: selectedVoterStatus,
    originatingSlackUserName,
    originatingSlackUserId: payload.user.id,
    slackChannelName,
    slackChannelId: payload.channel.id,
    slackParentMessageTs: payload.container.thread_ts,
    actionTs: payload.actions ? payload.actions[0].action_ts : null,
  });
};

export async function handleVoterStatusUpdate({
  payload,
  selectedVoterStatus,
  originatingSlackUserName,
  slackChannelName,
  userPhoneNumber,
  twilioPhoneNumber,
  redisClient,
}: {
  payload: Payload;
  selectedVoterStatus: VoterStatusUpdate;
  originatingSlackUserName: string;
  slackChannelName: string | null;
  userPhoneNumber: string;
  twilioPhoneNumber: string;
  redisClient: PromisifiedRedisClient;
}): Promise<void> {
  // Interaction is selection of a new voter status, from either dropdown selection or button press.
  if (
    Object.keys(SlackBlockUtil.getVoterStatusOptions()).includes(
      selectedVoterStatus
    )
  ) {
    logger.info(
      `SLACKINTERACTIONHANDLER.handleVoterStatusUpdate: Determined user interaction is a voter status update`
    );
    await handleVoterStatusUpdateHelper({
      payload,
      selectedVoterStatus,
      originatingSlackUserName,
      slackChannelName,
      userPhoneNumber,
      twilioPhoneNumber,
    });

    // Accommodate either a button press or an automated, programmatic operation
    // that desires the same effect.
    if (
      (payload.actions && payload.actions[0].type === 'button') ||
      payload.automatedButtonSelection
    ) {
      const closedVoterPanelText = getClosedVoterPanelText(
        selectedVoterStatus,
        originatingSlackUserName
      );
      const closedVoterPanelBlocks = SlackBlockUtil.makeClosedVoterPanelBlocks(
        closedVoterPanelText,
        true /* include undo button */
      );
      const newParentMessageBlocks = SlackBlockUtil.replaceVoterPanelBlocks(
        payload.message.blocks,
        closedVoterPanelBlocks
      );

      await SlackInteractionApiUtil.replaceSlackMessageBlocks({
        slackChannelId: payload.channel.id,
        slackParentMessageTs: payload.container.thread_ts,
        newBlocks: newParentMessageBlocks,
      });

      // Make sure we don't text voters marked as REFUSED or SPAM.
      if (selectedVoterStatus === 'REFUSED' || selectedVoterStatus === 'SPAM') {
        await RedisApiUtil.setHash(
          redisClient,
          'slackBlockedUserPhoneNumbers',
          { [userPhoneNumber]: '1' }
        );
        if (selectedVoterStatus === 'SPAM') {
          await RedisApiUtil.setHash(
            redisClient,
            'twilioBlockedUserPhoneNumbers',
            { [userPhoneNumber]: '1' }
          );
        }
      }
      // Steps to take if the dropdown was changed.
    } else {
      // Take the blocks and replace the initial_option with the new status, so that
      // even when Slack is refreshed this new status is shown.
      if (
        !SlackBlockUtil.populateDropdownNewInitialValue(
          payload.message.blocks,
          SlackActionId.VOTER_STATUS_DROPDOWN,
          selectedVoterStatus as VoterStatus
        )
      ) {
        logger.error(
          'SLACKINTERACTIONHANDLER.handleVoterStatusUpdate: Error updating VOTER_STATUS_DROPDOWN'
        );
      }

      // HACK: work around slack bug updating blocks: we must first remove the dropdown before we change it
      const oldBlock = payload.message.blocks[2];
      payload.message.blocks[2] = {
        type: 'section',
        block_id: 'asdf',
        text: {
          type: 'mrkdwn',
          text: 'Updating...',
          verbatim: false,
        },
      };
      await SlackInteractionApiUtil.replaceSlackMessageBlocks({
        slackChannelId: payload.channel.id,
        slackParentMessageTs: payload.container.thread_ts,
        newBlocks: payload.message.blocks,
      });
      payload.message.blocks[2] = oldBlock;

      // Replace the entire block so that the initial option change persists.
      await SlackInteractionApiUtil.replaceSlackMessageBlocks({
        slackChannelId: payload.channel.id,
        slackParentMessageTs: payload.container.thread_ts,
        newBlocks: payload.message.blocks,
      });
    }
  } else if (
    selectedVoterStatus === 'UNDO' &&
    payload.actions &&
    payload.actions[0].type === 'button'
  ) {
    logger.info(
      `SLACKINTERACTIONHANDLER.handleVoterStatusUpdate: Determined user interaction is UNDO of voter status update`
    );
    await handleVoterStatusUpdateHelper({
      payload,
      selectedVoterStatus: 'UNKNOWN',
      originatingSlackUserName,
      slackChannelName,
      userPhoneNumber,
      twilioPhoneNumber,
    });

    await SlackInteractionApiUtil.addBackVoterStatusPanel({
      slackChannelId: payload.channel.id,
      slackParentMessageTs: payload.container.thread_ts,
      oldBlocks: payload.message.blocks,
    });

    // For code simplicity, this executes even if "VOTED" is the button clicked before "UNDO".
    await RedisApiUtil.deleteHashField(
      redisClient,
      'slackBlockedUserPhoneNumbers',
      userPhoneNumber
    );
    await RedisApiUtil.deleteHashField(
      redisClient,
      'twilioBlockedUserPhoneNumbers',
      userPhoneNumber
    );
  }
}

export async function handleVolunteerUpdate({
  payload,
  originatingSlackUserName,
  slackChannelName,
  userPhoneNumber,
  twilioPhoneNumber,
}: {
  payload: Payload;
  originatingSlackUserName: string;
  slackChannelName: string | null;
  userPhoneNumber: string;
  twilioPhoneNumber: string;
}): Promise<void> {
  logger.info(
    `SLACKINTERACTIONHANDLER.handleVolunteerUpdate: Determined user interaction is a volunteer update`
  );
  if (
    !payload.actions ||
    !payload.actions[0] ||
    !(
      payload.actions[0].selected_user ||
      payload.actions[0].action_id == SlackActionId.VOLUNTEER_RELEASE_CLAIM
    )
  ) {
    throw new Error(
      'Expected selected_user or clear volunteer in SLACKINTERACTIONHANDLER.handleVolunteerUpdate'
    );
  }

  let selectedVolunteerSlackUserName = null as string | null;
  let selectedVolunteerSlackUserId = null;
  if (payload.actions && payload.actions[0].selected_user) {
    selectedVolunteerSlackUserId = payload.actions[0].selected_user;
    selectedVolunteerSlackUserName = await SlackApiUtil.fetchSlackUserName(
      selectedVolunteerSlackUserId
    );
  }
  const MD5 = new Hashes.MD5();
  const userId = MD5.hex(userPhoneNumber);

  const timeSinceEpochSecs = Math.round(Date.now() / 1000);
  // See https://api.slack.com/reference/surfaces/formatting#visual-styles
  const specialSlackTimestamp = `<!date^${timeSinceEpochSecs}^{date_num} {time_secs}|${new Date()}>`;

  // Post a message in the voter thread recording this status change.
  await SlackApiUtil.sendMessage(
    selectedVolunteerSlackUserName
      ? `*Operator:* Volunteer changed to *${selectedVolunteerSlackUserName}* by *${originatingSlackUserName}* at *${specialSlackTimestamp}*.`
      : `*Operator:* Volunteer claim released by *${originatingSlackUserName}* at *${specialSlackTimestamp}*.`,
    {
      parentMessageTs: payload.container.thread_ts,
      channel: payload.channel.id,
    }
  );

  logger.info(
    `SLACKINTERACTIONHANDLER.handleVolunteerUpdate: Successfully sent message recording volunteer claim change`
  );

  await DbApiUtil.logVolunteerVoterClaimToDb({
    userId,
    userPhoneNumber,
    twilioPhoneNumber,
    isDemo: LoadBalancer.phoneNumbersAreDemo(
      twilioPhoneNumber,
      userPhoneNumber
    ),
    volunteerSlackUserName: selectedVolunteerSlackUserName,
    volunteerSlackUserId: selectedVolunteerSlackUserId,
    originatingSlackUserName,
    originatingSlackUserId: payload.user.id,
    slackChannelName,
    slackChannelId: payload.channel.id,
    slackParentMessageTs: payload.container.thread_ts,
    actionTs: payload.actions ? payload.actions[0].action_ts : null,
  });

  // Take the blocks and replace the initial_user with the new user, so that
  // even when Slack is refreshed this new status is shown.
  if (
    !SlackBlockUtil.populateDropdownNewInitialValue(
      payload.message.blocks,
      SlackActionId.VOLUNTEER_DROPDOWN,
      selectedVolunteerSlackUserId
    )
  ) {
    logger.error(
      'SLACKINTERACTIONHANDLER.handleVoterStatusUpdate: Error updating VOLUNTEER_DROPDOWN'
    );
  }

  // Replace the entire block so that the initial user change persists.
  await SlackInteractionApiUtil.replaceSlackMessageBlocks({
    slackChannelId: payload.channel.id,
    slackParentMessageTs: payload.container.thread_ts,
    newBlocks: payload.message.blocks,
  });
}

export function prettyTimeInterval(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  if (seconds < 60 * 60) {
    return `${Math.round(seconds / 60)}m`;
  }
  if (seconds < 60 * 60 * 24) {
    return `${Math.round(seconds / 60 / 60)}h`;
  }
  return `${Math.round(seconds / 60 / 60 / 24)}d`;
}

export async function handleCommandUnclaimed(
  channelId: string,
  channelName: string,
  userId: string,
  text: string,
  responseUrl: string
): Promise<void> {
  // command argument
  let arg = text;
  if (text && !SlackApiUtil.isMemberOfAdminChannel(userId)) {
    arg = '';
  }

  const lines = ['`/unclaimed' + (arg ? ` ${arg}` : '') + '`'];

  const slackChannelIds = arg
    ? await RedisApiUtil.getHash(redisClient, 'slackPodChannelIds')
    : {};
  const slackChannelNames: Record<string, string> = {};
  for (const name in slackChannelIds) {
    slackChannelNames[slackChannelIds[name]] = name;
  }

  if (arg === '*') {
    // summary view
    let lines = ['Unclaimed voters by channel'];
    const stats = await DbApiUtil.getUnclaimedVotersByChannel();
    lines = lines.concat(
      stats.map(
        (x) =>
          `${x.count} in ${SlackApiUtil.linkToSlackChannel(
            x.channelId,
            slackChannelNames[x.channelId]
          )} - oldest ${prettyTimeInterval(x.maxLastUpdateAge)}`
      )
    );
    await SlackApiUtil.sendEphemeralResponse(responseUrl, lines.join('\n'));
    return;
  }

  // Is arg a channel (either #foo or foo)?  Empty arg means use current channel.
  let showChannelName = channelName;
  let showChannelId = channelId;
  if (arg) {
    if (arg[0] == '#') {
      arg = arg.substr(1); // strip off the # prefix
    }
    if (!(arg in slackChannelIds)) {
      await SlackApiUtil.sendEphemeralResponse(
        responseUrl,
        `Channel #${arg} not found`
      );
      return;
    }
    showChannelName = arg;
    showChannelId = slackChannelIds[showChannelName];
  }

  const threads = await DbApiUtil.getUnclaimedVoters(showChannelId);
  lines.push(`${threads.length} unclaimed voters`);

  for (const thread of threads) {
    const messageTs =
      (await DbApiUtil.getThreadLatestMessageTs(
        thread.slackParentMessageTs,
        thread.channelId
      )) || thread.slackParentMessageTs;
    const url = await SlackApiUtil.getThreadPermalink(
      thread.channelId,
      messageTs
    );
    lines.push(
      `:bust_in_silhouette: Voter ${thread.userId?.substr(
        0,
        5
      )} - age ${prettyTimeInterval(thread.lastUpdateAge || 0)} - <${url}|Open>`
    );
    if (lines.length >= maxCommandLines) {
      lines.push('... (truncated for brevity) ...');
      break;
    }
  }
  await SlackApiUtil.sendEphemeralResponse(responseUrl, lines.join('\n'));
}

async function getNeedsAttentionList(userId: string): Promise<string[]> {
  const threads = (await DbApiUtil.getThreadsNeedingAttentionFor(userId)) || [];

  const lines: string[] = [];
  for (const thread of threads) {
    const messageTs =
      (await DbApiUtil.getThreadLatestMessageTs(
        thread.slackParentMessageTs,
        thread.channelId
      )) || thread.slackParentMessageTs;
    const url = await SlackApiUtil.getThreadPermalink(
      thread.channelId,
      messageTs
    );
    lines.push(
      `:bust_in_silhouette: Voter ${thread.userId?.substr(
        0,
        5
      )} - age ${prettyTimeInterval(thread.lastUpdateAge || 0)} - <${url}|Open>`
    );
    if (lines.length >= maxCommandLines) {
      lines.push('... (truncated for brevity) ...');
      break;
    }
  }
  return lines;
}

export async function handleCommandNeedsAttention(
  channelId: string,
  channelName: string,
  userId: string,
  userName: string,
  text: string,
  responseUrl: string
): Promise<void> {
  // command argument
  let arg = text;
  if (arg && !SlackApiUtil.isMemberOfAdminChannel(userId)) {
    arg = '';
  }

  let lines = ['`/needs-attention' + (arg ? ` ${arg}` : '') + '`'];

  // Which user we'll show voters for (if the command arg doesn't have us show * or a channel)
  // Empty arg means current user.
  let showUserId = userId;

  if (arg === '*') {
    // Summary across all channels
    const slackChannelIds = await RedisApiUtil.getHash(
      redisClient,
      'slackPodChannelIds'
    );
    const slackChannelNames: Record<string, string> = {};
    for (const name in slackChannelIds) {
      slackChannelNames[slackChannelIds[name]] = name;
    }

    lines.push('Voters needing attention by channel');
    const stats = await DbApiUtil.getThreadsNeedingAttentionByChannel();
    lines = lines.concat(
      stats.map(
        (x) =>
          `${x.count} in ${SlackApiUtil.linkToSlackChannel(
            x.channelId,
            slackChannelNames[x.channelId]
          )} - oldest ${prettyTimeInterval(x.maxLastUpdateAge)}`
      )
    );

    lines.push('Voters needing attention by volunteer');
    const vstats = await DbApiUtil.getThreadsNeedingAttentionByVolunteer();
    for (const v of vstats) {
      lines.push(
        `${v.count} for <@${
          v.volunteerSlackUserId
        }> - oldest ${prettyTimeInterval(v.maxLastUpdateAge)}`
      );
    }
  } else if (
    arg &&
    arg[0] === '<' &&
    arg[arg.length - 1] === '>' &&
    arg[1] === '@'
  ) {
    // the |username portion is optional and being phased out by slack
    showUserId = arg.substr(2, arg.length - 3).split('|')[0];
  } else if (arg && arg[0] === '@') {
    lines.push(`Unrecognized user ${arg}`);
  } else if (
    (arg && arg[0] === '<' && arg[arg.length - 1] === '>' && arg[1] === '#') ||
    (arg && arg[0] === '#')
  ) {
    if (arg[0] === '#') {
      // Slack did not escape it :(
      const slackChannelIds = await RedisApiUtil.getHash(
        redisClient,
        'slackPodChannelIds'
      );
      channelName = arg.substr(1);
      channelId = slackChannelIds[channelName];
    } else {
      // Slack escaped it for us
      const parts = arg.substr(2, arg.length - 3).split('|');
      channelId = parts[0];
      channelName = parts[1];
    }

    if (!channelId) {
      lines.push(`Unrecognized channel ${arg}`);
    } else {
      lines.push(
        `Voters needing attention for ${SlackApiUtil.linkToSlackChannel(
          channelId,
          channelName
        )}`
      );
      const threads = await DbApiUtil.getThreadsNeedingAttentionForChannel(
        channelId
      );

      for (const thread of threads) {
        const messageTs =
          (await DbApiUtil.getThreadLatestMessageTs(
            thread.slackParentMessageTs,
            thread.channelId
          )) || thread.slackParentMessageTs;
        const url = await SlackApiUtil.getThreadPermalink(
          thread.channelId,
          messageTs
        );
        const owner = thread.volunteerSlackUserId
          ? `<@${thread.volunteerSlackUserId}>`
          : 'unassigned';
        lines.push(
          `:bust_in_silhouette: Voter ${thread.userId?.substr(
            0,
            5
          )} - ${owner} - age ${prettyTimeInterval(
            thread.lastUpdateAge || 0
          )} - <${url}|Open>`
        );
        if (lines.length >= maxCommandLines) {
          lines.push('... (truncated for brevity) ...');
          break;
        }
      }
    }
  } else if (arg) {
    lines.push(
      `Unrecognized argument _${arg}_: pass * for summary by channel, a channel (_#foo_), or a user (_@bar_)`
    );
  }

  if (lines.length == 1) {
    // For a single user
    const ulines = await getNeedsAttentionList(showUserId);
    lines.push(
      `*${ulines.length}* voters need attention from <@${showUserId}>`
    );
    lines = lines.concat(ulines);
  }
  await SlackApiUtil.sendEphemeralResponse(responseUrl, lines.join('\n'));
}

export async function handleCommandBroadcast(
  channelId: string,
  channelName: string,
  userId: string,
  userName: string,
  text: string,
  responseUrl: string
): Promise<void> {
  logger.info('Entering handleCommandBroadcast');
  if (!SlackApiUtil.isMemberOfAdminChannel(userId)) {
    logger.info('must be admin');
    await SlackApiUtil.sendEphemeralResponse(
      responseUrl,
      'Must be admin for this command'
    );
    return;
  }

  let preamble = '';
  const args = text.split(' ');
  if (!args) {
    await SlackApiUtil.sendEphemeralResponse(
      responseUrl,
      'Missing required argument `channel-status`|`volunteer-status`'
    );
    return;
  }
  const whatToAnnounce = args.shift();
  if (args.length) {
    preamble = args.join(' ');
  }

  switch (whatToAnnounce) {
    case 'channel-status': {
      const channels = [] as string[];

      // Gather unclaimed by channel
      for (const stat of await DbApiUtil.getUnclaimedVotersByChannel()) {
        channels.push(stat.channelId);
      }

      // Identify which channels have threads needing attention
      for (const stat of await DbApiUtil.getThreadsNeedingAttentionByChannel()) {
        if (!channels.includes(stat.channelId)) {
          channels.push(stat.channelId);
        }
      }
      for (const channelId of channels) {
        logger.info(`Sending status update message to ${channelId}`);
        const lines = [] as string[];
        if (preamble) {
          lines.push(preamble);
          lines.push('');
        }
        lines.push(`<!channel> Status Update by ${userName}`);

        // unclaimed
        let threads = await DbApiUtil.getUnclaimedVoters(channelId);
        if (threads.length > 0) {
          lines.push('*Unclaimed voters in this channel*');
          for (const thread of threads) {
            const messageTs =
              (await DbApiUtil.getThreadLatestMessageTs(
                thread.slackParentMessageTs,
                thread.channelId
              )) || thread.slackParentMessageTs;
            const url = await SlackApiUtil.getThreadPermalink(
              thread.channelId,
              messageTs
            );
            lines.push(
              `:bust_in_silhouette: Voter ${thread.userId?.substr(
                0,
                5
              )} - age ${prettyTimeInterval(
                thread.lastUpdateAge || 0
              )} - <${url}|Open>`
            );
            if (lines.length >= maxCommandLines) {
              lines.push('... (truncated for brevity) ...');
              break;
            }
          }
        }

        // needs attention
        threads = await DbApiUtil.getThreadsNeedingAttentionForChannel(
          channelId
        );
        if (threads.length > 0) {
          lines.push('*Voters needing attention in this channel*');
          for (const thread of threads) {
            const messageTs =
              (await DbApiUtil.getThreadLatestMessageTs(
                thread.slackParentMessageTs,
                thread.channelId
              )) || thread.slackParentMessageTs;
            const url = await SlackApiUtil.getThreadPermalink(
              thread.channelId,
              messageTs
            );
            const owner = thread.volunteerSlackUserId
              ? `<@${thread.volunteerSlackUserId}>`
              : 'unassigned';
            lines.push(
              `:bust_in_silhouette: Voter ${thread.userId?.substr(
                0,
                5
              )} - ${owner} - age ${prettyTimeInterval(
                thread.lastUpdateAge || 0
              )} - <${url}|Open>`
            );
            if (lines.length >= maxCommandLines) {
              lines.push('... (truncated for brevity) ...');
              break;
            }
          }
        }

        await SlackApiUtil.sendMessage(lines.join('\n'), {
          channel: channelId,
        });
      }

      await SlackApiUtil.sendEphemeralResponse(
        responseUrl,
        `Sent announcements to ${channels.length} channels.`
      );
      return;
    }
    case 'volunteer-status': {
      if (preamble) {
        preamble += '\n\n';
      }
      const volunteerStats = await DbApiUtil.getThreadsNeedingAttentionByVolunteer();
      for (const v of volunteerStats) {
        const ulines = await getNeedsAttentionList(v.volunteerSlackUserId);
        await SlackApiUtil.sendMessage(
          preamble +
            `*Current threads needing attention* (sent by ${userName}):\n` +
            ulines.join('\n'),
          {
            channel: v.volunteerSlackUserId,
          }
        );
      }

      await SlackApiUtil.sendEphemeralResponse(
        responseUrl,
        `Sent announcements to ${volunteerStats.length} volunteers.`
      );
      return;
    }
    default: {
      await SlackApiUtil.sendEphemeralResponse(
        responseUrl,
        'Must pass either `channel-status` or `volunteer-status`'
      );
      return;
    }
  }
}

export async function handleCommandFollowUp(
  channelId: string,
  channelName: string,
  userId: string,
  userName: string,
  text: string,
  responseUrl: string
): Promise<void> {
  const args = text.split(' ');
  if (args.length != 1) {
    await SlackApiUtil.sendEphemeralResponse(
      responseUrl,
      `Usage: \`/follow-up <days>`
    );
    return;
  }
  const days = parseInt(args[0], 10);
  if (isNaN(days) || days < 0) {
    await SlackApiUtil.sendEphemeralResponse(
      responseUrl,
      `Usage: \`/follow-up <days>`
    );
    return;
  }

  const slackChannelIds = await RedisApiUtil.getHash(
    redisClient,
    'slackPodChannelIds'
  );
  const slackChannelNames: Record<string, string> = {};
  for (const name in slackChannelIds) {
    slackChannelNames[slackChannelIds[name]] = name;
  }

  const threads = await DbApiUtil.getThreadsNeedingFollowUp(userId, days);
  const lines = [
    `You have *${threads.length}* voters idle for >= ${days} days`,
  ];
  for (const thread of threads) {
    const messageTs =
      (await DbApiUtil.getThreadLatestMessageTs(
        thread.slackParentMessageTs,
        thread.channelId
      )) || thread.slackParentMessageTs;
    const url = await SlackApiUtil.getThreadPermalink(
      thread.channelId,
      messageTs
    );
    lines.push(
      `:bust_in_silhouette: Voter ${thread.userId?.substr(
        0,
        5
      )} - ${SlackApiUtil.linkToSlackChannel(
        thread.channelId,
        slackChannelNames[thread.channelId]
      )} - ${thread.voterStatus} - age ${prettyTimeInterval(
        thread.lastUpdateAge || 0
      )} - <${url}|Open>`
    );
    if (lines.length >= maxCommandLines) {
      lines.push('... (truncated for brevity) ...');
      break;
    }
  }

  await SlackApiUtil.sendEphemeralResponse(responseUrl, lines.join('\n'));
}

export async function handleShortcutShowNeedsAttention({
  payload,
  viewId,
}: {
  payload: SlackInteractionEventPayload;
  viewId: string;
}): Promise<void> {
  const lines = await getNeedsAttentionList(payload.user.id);
  const slackView: SlackBlockUtil.SlackView = {
    title: {
      type: 'plain_text',
      text: `${lines.length} voters need attention`,
    },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: lines.join('\n') || 'No voters need attention right now',
        },
      },
    ],
    type: 'modal',
  };
  await SlackApiUtil.updateModal(viewId, slackView);
}

// This function receives the initial request to reset a demo
// and response by creating a modal populated with data needed
// to reset the demo if the Slack user confirms.
export async function receiveResetDemo({
  payload,
  redisClient,
  modalPrivateMetadata,
  twilioPhoneNumber,
  userId,
  viewId,
}: {
  payload: SlackInteractionEventPayload;
  redisClient: PromisifiedRedisClient;
  modalPrivateMetadata: SlackModalPrivateMetadata;
  twilioPhoneNumber: string;
  userId: string;
  viewId: string;
}): Promise<void> {
  logger.info(`Entering SLACKINTERACTIONHANDLER.receiveResetDemo`);
  let slackView;

  try {
    const redisUserInfoKey = `${userId}:${twilioPhoneNumber}`;
    const userInfo = (await RedisApiUtil.getHash(
      redisClient,
      redisUserInfoKey
    )) as UserInfo;

    if (!userInfo) {
      modalPrivateMetadata.success = false;
      modalPrivateMetadata.failureReason = 'no_user_info';
      await DbApiUtil.logCommandToDb(modalPrivateMetadata);
      throw new Error(
        `SLACKINTERACTIONHANDLER.receiveResetDemo: Interaction received for voter who has redisData but not userInfo: active redisData key is ${payload.channel.id}:${payload.message.ts}, userInfo key is ${redisUserInfoKey}.`
      );
    }

    if (!userInfo.isDemo) {
      modalPrivateMetadata.success = false;
      modalPrivateMetadata.failureReason = 'non_demo';
      await DbApiUtil.logCommandToDb(modalPrivateMetadata);
      logger.info(
        `SLACKINTERACTIONHANDLER.receiveResetDemo: Volunteer tried to reset demo on non-demo voter.`
      );
      slackView = SlackBlockUtil.getErrorSlackView(
        'demo_reset_error_not_demo',
        'This shortcut is strictly for demo conversations only. Please reach out to an admin for assistance.'
      );
    } else if (!(payload.channel.id === userInfo.activeChannelId)) {
      modalPrivateMetadata.success = false;
      modalPrivateMetadata.failureReason = 'non_active_thread';
      await DbApiUtil.logCommandToDb(modalPrivateMetadata);
      logger.info(
        `SLACKINTERACTIONHANDLER.receiveResetDemo: Volunteer issued reset demo command from #${payload.channel.id} but voter active channel is ${userInfo.activeChannelId}.`
      );
      slackView = SlackBlockUtil.getErrorSlackView(
        'demo_reset_error_not_active_thread',
        `This voter is no longer active in this thread. Please reach out to the folks at *#${userInfo.activeChannelName}*.`
      );
    } else {
      logger.info(
        `SLACKINTERACTIONHANDLER.receiveResetDemo: Reset demo command is valid.`
      );

      // Store the relevant information in the modal so that when the requested action is confirmed
      // the data needed for the necessary actions is available.
      slackView = SlackBlockUtil.resetConfirmationSlackView(
        SlackCallbackId.RESET_DEMO,
        modalPrivateMetadata
      );
    }

    await SlackApiUtil.updateModal(viewId, slackView);
  } catch (e) {
    // Update the modal to say that there was an error, then re-throw the
    // error so it ends up in Sentry / the logs
    await SlackApiUtil.updateModal(
      viewId,
      SlackBlockUtil.getErrorSlackView(
        'internal_server_error',
        'Sorry, something went wrong. Please try again.'
      )
    );
    throw e;
  }
}

// This function receives the confirmation of the resetting of
// a voter and does the actual resetting work.
export async function handleResetDemo(
  redisClient: PromisifiedRedisClient,
  modalPrivateMetadata: SlackModalPrivateMetadata
): Promise<void> {
  const redisUserInfoKey = `${modalPrivateMetadata.userId}:${modalPrivateMetadata.twilioPhoneNumber}`;

  const slackThreads = (await DbApiUtil.getSlackThreadsForVoter(
    modalPrivateMetadata.userId,
    modalPrivateMetadata.twilioPhoneNumber
  )) as SlackThreadInfo[];

  const redisDatas = slackThreads.map(
    (row) => `${row.slackChannel}:${row.slackParentMessageTs}`
  );

  const numKeysPresent = await RedisApiUtil.keysExist(redisClient, [
    redisUserInfoKey,
    ...redisDatas,
  ]);

  // If any key is missing, something is wrong, so log and don't try to delete.
  // Count = multiple Slack thread lookups + 1 phone number lookup for this user.
  let redisError = numKeysPresent !== slackThreads.length + 1;

  // If all keys are present, try to delete.
  if (!redisError) {
    const numKeysDeleted = await RedisApiUtil.deleteKeys(redisClient, [
      redisUserInfoKey,
      ...redisDatas,
    ]);
    // If all keys don't delete, something is wrong, so log.
    redisError = numKeysDeleted !== slackThreads.length + 1;
  }

  if (redisError) {
    modalPrivateMetadata.success = false;
    modalPrivateMetadata.failureReason = 'missing_redis_key';
    await DbApiUtil.logCommandToDb(modalPrivateMetadata);
    throw new Error(
      `SLACKINTERACTIONHANDLER.handleResetDemo: Either the userInfo (${redisUserInfoKey}) or one of the redisData keys (${JSON.stringify(
        slackThreads
      )}) for the voter in Redis was not found.`
    );
  }

  const timeSinceEpochSecs = Math.round(Date.now() / 1000);
  // See https://api.slack.com/reference/surfaces/formatting#visual-styles
  const specialSlackTimestamp = `<!date^${timeSinceEpochSecs}^{date_num} {time_secs}|${new Date()}>`;

  const closedVoterPanelText = `:white_check_mark: This demo conversation was closed by *${modalPrivateMetadata.originatingSlackUserName}* on *${specialSlackTimestamp}*. :white_check_mark:`;

  const closedVoterPanelBlocks = SlackBlockUtil.makeClosedVoterPanelBlocks(
    closedVoterPanelText,
    false /* include undo button */
  );

  const previousParentMessageBlocks = await SlackApiUtil.fetchSlackMessageBlocks(
    modalPrivateMetadata.slackChannelId,
    modalPrivateMetadata.slackParentMessageTs
  );

  logger.info(
    `SLACKINTERACTIONHANDLER.handleResetDemo: Fetched previousParentMessageBlocks.`
  );

  if (previousParentMessageBlocks === null) {
    modalPrivateMetadata.success = false;
    modalPrivateMetadata.failureReason = 'message_blocks_fetch_failure';
    await DbApiUtil.logCommandToDb(modalPrivateMetadata);
    throw new Error(
      `SLACKINTERACTIONHANDLER.handleResetDemo: Failed to fetch Slack message blocks for channelId (${modalPrivateMetadata.slackChannelId}) and parentMessageTs (${modalPrivateMetadata.slackParentMessageTs}).`
    );
  }

  const newParentMessageBlocks = SlackBlockUtil.replaceVoterPanelBlocks(
    previousParentMessageBlocks,
    closedVoterPanelBlocks
  );

  await SlackInteractionApiUtil.replaceSlackMessageBlocks({
    slackChannelId: modalPrivateMetadata.slackChannelId,
    slackParentMessageTs: modalPrivateMetadata.slackParentMessageTs,
    newBlocks: newParentMessageBlocks,
  });

  await DbApiUtil.archiveDemoVoter(
    modalPrivateMetadata.userId,
    modalPrivateMetadata.twilioPhoneNumber
  );

  await DbApiUtil.setThreadNeedsAttentionToDb(
    modalPrivateMetadata.slackParentMessageTs,
    modalPrivateMetadata.slackChannelId,
    false
  );

  modalPrivateMetadata.success = true;
  await DbApiUtil.logCommandToDb(modalPrivateMetadata);

  return;
}

export async function handleManageEntryPoints({
  payload,
  viewId,
  originatingSlackUserName,
  redisClient,
  action,
  values,
  isSubmission,
}: {
  payload: SlackInteractionEventPayload;
  viewId: string;
  originatingSlackUserName: string;
  redisClient: PromisifiedRedisClient;
  action?: SlackBlockUtil.SlackAction;
  values?: SlackInteractionEventValuesPayload;
  isSubmission?: boolean;
}): Promise<void> {
  logger.info('Entering SLACKINTERACTIONHANDLER.handleManageEntryPoints');

  // Auth check
  const isAdmin = await SlackApiUtil.isMemberOfAdminChannel(payload.user.id);
  if (!isAdmin) {
    logger.warn(
      `SLACKINTERACTIONHANDLER.handleManageEntryPoints: ${payload.user.id} is not an admin`
    );
    await SlackApiUtil.updateModal(
      viewId,
      SlackBlockUtil.getErrorSlackView(
        SlackCallbackId.MANAGE_ENTRY_POINTS_ERROR,
        'You must have access to #admin-control-room to do that'
      )
    );
    return;
  }

  // Process action to decide what to render
  let stateOrRegionName: string | undefined;
  let channelType: ChannelType = 'NORMAL';
  const channelInfo: PodUtil.ChannelInfo[] = [];
  let flashMessage: string | undefined;

  if (action) {
    logger.info(
      `SLACKINTERACTIONHANDLER.handleManageEntryPoints: processing action ${action.action_id}`
    );
  }

  // Populate filters + data from values
  if (values) {
    Object.keys(values).forEach((blockId) => {
      Object.keys(values[blockId]).forEach((actionId) => {
        if (
          actionId === SlackActionId.MANAGE_ENTRY_POINTS_CHANNEL_STATE_DROPDOWN
        ) {
          const weight = parseInt(
            values[blockId][actionId].selected_option?.value || '0'
          );
          const { entrypoint, channelName } = PodUtil.parseBlockId(blockId);
          channelInfo.push({ entrypoint, channelName, weight });
        } else if (
          actionId === SlackActionId.MANAGE_ENTRY_POINTS_FILTER_STATE
        ) {
          stateOrRegionName = values[blockId][actionId].selected_option?.value;
        } else if (actionId === SlackActionId.MANAGE_ENTRY_POINTS_FILTER_TYPE) {
          channelType = values[blockId][actionId].selected_option
            ?.value as ChannelType;
        }
      });
    });
  }

  // Handle submission
  if (stateOrRegionName && channelType && channelInfo.length && isSubmission) {
    await PodUtil.setChannelWeights(
      redisClient,
      { stateOrRegionName, channelType },
      channelInfo
    );
    logger.info(
      'SLACKINTERACTIONHANDLER.handleManageEntryPoints: setChannelWeights success'
    );
    flashMessage = ':white_check_mark: _Channels updated_';

    // Post a message in the admin thread recording this status change.
    const channelString = channelInfo
      .map(
        ({ channelName, weight, entrypoint }) =>
          `• ${entrypoint} \`${channelName}\` - *${weight}*`
      )
      .sort()
      .join('\n');
    const timeSinceEpochSecs = Math.round(Date.now() / 1000);
    // See https://api.slack.com/reference/surfaces/formatting#visual-styles
    const specialSlackTimestamp = `<!date^${timeSinceEpochSecs}^{date_num} {time_secs}|${new Date()}>`;
    await SlackApiUtil.sendMessage(
      `*Operator:* Channel weights changed by *${originatingSlackUserName}* at *${specialSlackTimestamp}*:\n${channelString}`,
      {
        channel: process.env.ADMIN_CONTROL_ROOM_SLACK_CHANNEL_ID as string,
      }
    );
  }

  const { push, pull } =
    stateOrRegionName && channelType
      ? await PodUtil.getPodChannelState(redisClient, {
          stateOrRegionName,
          channelType,
        })
      : {
          push: [],
          pull: [],
        };

  const slackView = await SlackBlockEntrypointUtil.getOpenCloseModal({
    redisClient,
    stateOrRegionName,
    channelType,
    pushRows: push,
    pullRows: pull,
    flashMessage,
  });

  await SlackApiUtil.updateModal(viewId, slackView);
}

export function maybeGetManageEntryPointsConfirmationModal(
  payload: SlackInteractionEventPayload
): SlackBlockUtil.SlackView | null {
  const values = payload.view?.state?.values;
  if (!values) return null;

  let hasAtLeastOnePull = false;
  let hasAtLeastOnePush = false;

  Object.keys(values).forEach((blockId) => {
    Object.keys(values[blockId]).forEach((actionId) => {
      if (
        actionId === SlackActionId.MANAGE_ENTRY_POINTS_CHANNEL_STATE_DROPDOWN
      ) {
        const { entrypoint } = PodUtil.parseBlockId(blockId);
        const weight = parseInt(
          values[blockId][actionId].selected_option?.value || '0'
        );
        if (weight > 0) {
          if (entrypoint === 'PUSH') {
            hasAtLeastOnePush = true;
          } else {
            hasAtLeastOnePull = true;
          }
        }
      }
    });
  });

  const supportedEntrypoints = PodUtil.getEntrypointTypes();
  const warnOnPull =
    supportedEntrypoints.includes('PULL') && !hasAtLeastOnePull;
  const warnOnPush =
    supportedEntrypoints.includes('PUSH') && !hasAtLeastOnePush;

  if (!warnOnPull && !warnOnPush) return null;
  return SlackBlockEntrypointUtil.openCloseConfirmationView({
    warnOnPull,
    warnOnPush,
    values,
  });
}
